import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { z } from 'zod';
import { config } from '../src/config.js';
import { requestJson } from '../src/services/llm.js';

const schema = z.object({ answer: z.string() });
const reply = (content: string, ok = true) => mock.method(globalThis, 'fetch', async () => ({ ok, json: async () => ({ choices: [{ message: { content } }] }) }) as Response);

describe('requestJson', () => {
  const original = { ...config };
  afterEach(() => {
    Object.assign(config, original);
    mock.restoreAll();
  });

  it('never calls the provider with the local provider', async () => {
    const fetchMock = reply('{"answer":"hola"}');
    assert.equal(await requestJson('x', {}, schema), null);
    assert.equal(fetchMock.mock.callCount(), 0);
  });

  it('returns the validated answer', async () => {
    Object.assign(config, { aiProvider: 'openai', openAiApiKey: 'clave-de-prueba' });
    reply('{"answer":"hola"}');
    assert.deepEqual(await requestJson('x', {}, schema), { answer: 'hola' });
  });

  it('returns null for invalid JSON, a wrong shape or an HTTP error', async () => {
    Object.assign(config, { aiProvider: 'openai', openAiApiKey: 'clave-de-prueba' });
    reply('no es json');
    assert.equal(await requestJson('x', {}, schema), null);
    mock.restoreAll();
    reply('{"answer":42}');
    assert.equal(await requestJson('x', {}, schema), null);
    mock.restoreAll();
    reply('{"answer":"hola"}', false);
    assert.equal(await requestJson('x', {}, schema), null);
  });
});
