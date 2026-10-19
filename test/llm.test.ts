import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { z } from 'zod';
import { config } from '../src/config.js';
import { activeProviders, extractJson, requestJson } from '../src/services/llm.js';

const schema = z.object({ answer: z.string() });
const reply = (content: string, ok = true) => mock.method(globalThis, 'fetch', async () => ({ ok, json: async () => ({ choices: [{ message: { content } }] }) }) as Response);
const withMainProvider = () => Object.assign(config, { aiProvider: 'openai', openAiApiKey: 'clave-de-prueba', openAiBaseUrl: 'https://principal.test/v1' });
const withFallback = () => Object.assign(config, { aiFallbackApiKey: 'clave-respaldo', aiFallbackModel: 'modelo-respaldo', aiFallbackBaseUrl: 'https://respaldo.test/openai/' });

describe('requestJson', () => {
  const original = { ...config };
  afterEach(() => {
    Object.assign(config, original);
    mock.restoreAll();
  });

  it('never calls a provider with the local provider or without a key', async () => {
    const fetchMock = reply('{"answer":"hola"}');
    assert.equal(await requestJson('x', {}, schema), null);
    Object.assign(config, { aiProvider: 'openai', openAiApiKey: '' });
    assert.equal(await requestJson('x', {}, schema), null);
    assert.equal(fetchMock.mock.callCount(), 0);
  });

  it('returns the validated answer, also when it comes inside code fences', async () => {
    withMainProvider();
    reply('```json\n{"answer":"hola"}\n```');
    assert.deepEqual(await requestJson('x', {}, schema), { answer: 'hola' });
  });

  it('returns null for invalid JSON, a wrong shape or an HTTP error', async () => {
    withMainProvider();
    reply('no es json');
    assert.equal(await requestJson('x', {}, schema), null);
    mock.restoreAll();
    reply('{"answer":42}');
    assert.equal(await requestJson('x', {}, schema), null);
    mock.restoreAll();
    reply('{"answer":"hola"}', false);
    assert.equal(await requestJson('x', {}, schema), null);
  });

  it('uses the fallback provider when the main one answers 429 or 5xx', async () => {
    withMainProvider();
    withFallback();
    const calls: string[] = [];
    mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
      calls.push(url);
      if (url.startsWith('https://principal.test')) return new Response('{"error":"quota"}', { status: 429 });
      assert.equal(JSON.parse(String(init.body)).model, 'modelo-respaldo');
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"answer":"del respaldo"}' } }] }));
    });
    assert.deepEqual(await requestJson('x', {}, schema), { answer: 'del respaldo' });
    assert.deepEqual(calls, ['https://principal.test/v1/chat/completions', 'https://respaldo.test/openai/chat/completions']);
  });

  it('returns null when every provider fails, so callers use local rules', async () => {
    withMainProvider();
    withFallback();
    mock.method(globalThis, 'fetch', async () => new Response('caído', { status: 503 }));
    assert.equal(await requestJson('x', {}, schema), null);
  });

  it('lists the active providers in order', () => {
    withMainProvider();
    withFallback();
    assert.deepEqual(activeProviders().map((provider) => provider.name), ['principal', 'respaldo']);
  });

  it('extracts the JSON object from a longer text', () => {
    assert.deepEqual(extractJson('Claro: {"a":1} listo'), { a: 1 });
    assert.throws(() => extractJson('sin json'));
  });
});
