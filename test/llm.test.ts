import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { z } from 'zod';
import { config } from '../src/config.js';
import { extractJson, hasBudget, modelChain, pauseAfterRateLimit, reasoningOptions, requestChatJson, requestJson, resetModelUsage, stripReasoning } from '../src/services/llm.js';

const schema = z.object({ answer: z.string() });
const ok = (content: string, totalTokens?: number) => new Response(JSON.stringify({ choices: [{ message: { content } }], ...(totalTokens ? { usage: { total_tokens: totalTokens } } : {}) }));

const groqAndGemini = () =>
  Object.assign(config, {
    aiProvider: 'openai',
    openAiApiKey: 'gsk_clave_secreta_de_prueba',
    openAiBaseUrl: 'https://groq.simulado/openai/v1',
    openAiModel: 'openai/gpt-oss-120b',
    aiModels: ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-20b'],
    aiFallbackApiKey: 'AIza_clave_secreta_de_prueba',
    aiFallbackBaseUrl: 'https://gemini.simulado/v1beta/openai/',
    aiFallbackModels: ['gemini-2.5-flash', 'gemini-2.5-flash-lite'],
  });

// Registra qué modelo pidió cada petición y deja que cada prueba decida la respuesta por modelo.
const simulate = (answer: (model: string, body: Record<string, any>) => Response) => {
  const calls: Array<{ url: string; model: string; body: Record<string, any> }> = [];
  mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push({ url, model: body.model, body });
    return answer(body.model, body);
  });
  return calls;
};

describe('model chain', () => {
  const original = { ...config };
  beforeEach(() => resetModelUsage());
  afterEach(() => {
    Object.assign(config, original);
    mock.restoreAll();
    resetModelUsage();
  });

  it('never calls a provider with the local provider or without a key', async () => {
    const calls = simulate(() => ok('{"answer":"hola"}'));
    assert.equal(await requestJson('x', {}, schema), null);
    Object.assign(config, { aiProvider: 'openai', openAiApiKey: '' });
    assert.equal(await requestJson('x', {}, schema), null);
    assert.equal(calls.length, 0);
  });

  it('builds the chain from AI_MODELS and AI_FALLBACK_MODELS, or from the single model', () => {
    groqAndGemini();
    assert.deepEqual(modelChain().map((target) => `${target.provider}:${target.model}`), [
      'principal:openai/gpt-oss-120b',
      'principal:qwen/qwen3.8-27b',
      'principal:openai/gpt-oss-20b',
      'respaldo:gemini-2.5-flash',
      'respaldo:gemini-2.5-flash-lite',
    ]);
    Object.assign(config, { aiModels: [], aiFallbackModels: [], aiFallbackModel: '' });
    assert.deepEqual(modelChain().map((target) => target.model), ['openai/gpt-oss-120b']);
  });

  it('moves to the next model on 429 and keeps the exhausted one paused for Retry-After', async () => {
    groqAndGemini();
    const calls = simulate((model) => (model === 'openai/gpt-oss-120b' ? new Response('{"error":"rate limit"}', { status: 429, headers: { 'retry-after': '120' } }) : ok('{"answer":"qwen"}')));
    assert.deepEqual(await requestJson('x', {}, schema), { answer: 'qwen' });
    assert.deepEqual(await requestJson('x', {}, schema), { answer: 'qwen' });
    assert.deepEqual(calls.map((call) => call.model), ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'qwen/qwen3.8-27b'], 'the paused model is skipped');
  });

  it('pauses a model until the next day when its daily quota is used up', () => {
    const now = Date.parse('2026-10-19T15:00:00Z');
    const daily = pauseAfterRateLimit(new Headers({ 'x-ratelimit-remaining-requests': '0' }), '', now);
    assert.equal(now + daily, Date.parse('2026-10-20T00:00:00Z'));
    const byText = pauseAfterRateLimit(new Headers(), 'Rate limit reached for model on tokens per day (TPD)', now);
    assert.equal(now + byText, Date.parse('2026-10-20T00:00:00Z'));
    assert.equal(pauseAfterRateLimit(new Headers({ 'retry-after': '7' }), '', now), 7000);
    assert.equal(pauseAfterRateLimit(new Headers(), '', now), 60_000);
  });

  it('goes through the Gemini fallback models and then gives up so local rules answer', async () => {
    groqAndGemini();
    const calls = simulate((model) => (model.startsWith('gemini-2.5-flash-lite') ? ok('{"answer":"lite"}') : new Response('caído', { status: model.startsWith('gemini') ? 429 : 503 })));
    assert.deepEqual(await requestJson('x', {}, schema), { answer: 'lite' });
    assert.deepEqual(calls.map((call) => call.model), ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-20b', 'gemini-2.5-flash', 'gemini-2.5-flash-lite']);
    assert.equal(calls[3].url, 'https://gemini.simulado/v1beta/openai/chat/completions');
    mock.restoreAll();
    const none = simulate(() => new Response('caído', { status: 500 }));
    assert.equal(await requestJson('x', {}, schema), null);
    assert.deepEqual(none.map((call) => call.model), ['gemini-2.5-flash-lite'], 'only the model that was still available is tried');
  });

  it('respects the per-model token budget with its safety margin', async () => {
    groqAndGemini();
    Object.assign(config, { aiTokensPerDay: 1000, aiModels: ['openai/gpt-oss-120b'], aiFallbackModels: [] });
    const calls = simulate(() => ok('{"answer":"hola"}', 900));
    assert.deepEqual(await requestJson('x', {}, schema), { answer: 'hola' });
    // 900 tokens reales usados: otra petición de unos 310 tokens ya no cabe en el presupuesto diario de 1.000.
    assert.equal(await requestJson('x', {}, schema), null);
    assert.equal(calls.length, 1);
    assert.equal(hasBudget(modelChain()[0], 50), true);
  });

  it('keeps under the per-minute request and token limits', async () => {
    groqAndGemini();
    Object.assign(config, { aiRequestsPerMinute: 2, aiModels: ['openai/gpt-oss-120b'], aiFallbackModels: [] });
    const calls = simulate(() => ok('{"answer":"hola"}'));
    await requestJson('x', {}, schema);
    await requestJson('x', {}, schema);
    assert.equal(await requestJson('x', {}, schema), null);
    assert.equal(calls.length, 2);
    assert.equal(config.aiTokensPerMinute < 8000, true);
    assert.equal(config.aiTokensPerDay, 150_000);
  });

  it('sends short requests with low reasoning and never returns the hidden reasoning', async () => {
    groqAndGemini();
    const calls = simulate((model) => ok(model.startsWith('openai/gpt-oss-120b') ? '<think>el cliente quiere... razonamiento interno</think>{"answer":"visible"}' : '{"answer":"x"}'));
    assert.deepEqual(await requestJson('x', {}, schema), { answer: 'visible' });
    assert.equal(calls[0].body.max_tokens, 300);
    assert.equal(calls[0].body.reasoning_effort, 'low');
    assert.equal(calls[0].body.include_reasoning, false);
    assert.deepEqual(reasoningOptions('qwen/qwen3.8-27b'), { reasoning_effort: 'none', reasoning_format: 'hidden' });
    assert.deepEqual(reasoningOptions('gemini-2.5-flash-lite'), { reasoning_effort: 'low' });
    assert.equal(stripReasoning('<thinking>secreto</thinking>respuesta'), 'respuesta');
  });

  it('does not send prompts over the size limit', async () => {
    groqAndGemini();
    const calls = simulate(() => ok('{"answer":"hola"}'));
    const long = 'x'.repeat(4 * 800);
    assert.equal(await requestChatJson([{ role: 'user', content: long }], schema), null);
    assert.equal(calls.length, 0);
  });

  it('never writes the keys in the logs', async () => {
    groqAndGemini();
    const lines: string[] = [];
    mock.method(console, 'warn', (...args: unknown[]) => lines.push(args.join(' ')));
    mock.method(console, 'error', (...args: unknown[]) => lines.push(args.join(' ')));
    simulate(() => new Response('{"error":"quota"}', { status: 429 }));
    await requestJson('x', {}, schema);
    assert.ok(lines.length > 0);
    assert.equal(lines.some((line) => line.includes('clave_secreta')), false);
  });

  it('extracts the JSON object from a longer text', () => {
    assert.deepEqual(extractJson('Claro: {"a":1} listo'), { a: 1 });
    assert.throws(() => extractJson('sin json'));
  });
});
