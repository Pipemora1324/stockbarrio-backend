import { integrationSkip, useTestApi } from './helpers/api.js';
import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { config } from '../src/config.js';
import { addDays, todayInBogota } from '../src/dates.js';
import type { DiscountSuggestion } from '../src/services/discount-rules.js';
import { mergeAiSuggestions } from '../src/services/suggestions.js';

const local: DiscountSuggestion[] = [
  { productId: 'a', productName: 'Leche', daysToExpire: 1, currentPercent: 0, suggestedPercent: 40, suggestedPrice: 3000, reason: 'Regla local A.' },
  { productId: 'b', productName: 'Pan', daysToExpire: 3, currentPercent: 10, suggestedPercent: 30, suggestedPrice: 3500, reason: 'Regla local B.' },
];

describe('mergeAiSuggestions', () => {
  it('keeps the local result when there is no answer', () => {
    const merged = mergeAiSuggestions(local, null);
    assert.deepEqual(merged.map((item) => [item.productId, item.source, item.priority]), [['a', 'local', 0], ['b', 'local', 1]]);
  });

  it('accepts a new order and wording and clamps the percent to the allowed range', () => {
    const merged = mergeAiSuggestions(local, {
      suggestions: [
        { productId: 'b', reason: 'El pan se vence pronto, mejor bajarlo.', suggestedPercent: 90 },
        { productId: 'a', reason: 'La leche vence mañana, rebájala ya.', suggestedPercent: 10 },
      ],
    });
    assert.deepEqual(merged.map((item) => [item.productId, item.suggestedPercent, item.source]), [['b', 35, 'ai'], ['a', 35, 'ai']]);
    assert.equal(merged[0].reason, 'El pan se vence pronto, mejor bajarlo.');
  });

  it('falls back to local rules when the answer invents, drops or repeats products', () => {
    const invented = mergeAiSuggestions(local, { suggestions: [{ productId: 'a', reason: 'Texto suficiente.' }, { productId: 'zzz', reason: 'Producto inventado.' }] });
    const repeated = mergeAiSuggestions(local, { suggestions: [{ productId: 'a', reason: 'Texto suficiente.' }, { productId: 'a', reason: 'Texto repetido aquí.' }] });
    const dropped = mergeAiSuggestions(local, { suggestions: [{ productId: 'a', reason: 'Texto suficiente.' }] });
    for (const merged of [invented, repeated, dropped]) assert.deepEqual(merged.map((item) => item.source), ['local', 'local']);
  });
});

describe('suggestions API', { skip: integrationSkip }, () => {
  const context = useTestApi();
  const { call, registerStore } = context;
  const today = todayInBogota();

  afterEach(() => {
    mock.restoreAll();
    config.aiProvider = 'local';
    config.openAiApiKey = '';
  });

  const createProducts = async (token: string) => {
    const products = [
      { name: 'Leche entera 1 L', category: 'Lácteos', price: 5000, stock: 30, expirationDate: addDays(today, 1), discountPercent: 0 },
      { name: 'Pan tajado', category: 'Panadería', price: 6000, stock: 5, expirationDate: addDays(today, 3), discountPercent: 0 },
      { name: 'Arroz 1 kg', category: 'Granos', price: 4300, stock: 40, expirationDate: addDays(today, 200), discountPercent: 0 },
    ];
    const ids: string[] = [];
    for (const product of products) ids.push((await call('POST', '/api/products', product, token)).body.data.id);
    return ids;
  };

  it('lists suggestions for products about to expire, most urgent first', async () => {
    const { token } = await registerStore('sug-uno');
    await createProducts(token);
    const result = await call('GET', '/api/suggestions', undefined, token);
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.data.map((item: { productName: string; suggestedPercent: number }) => [item.productName, item.suggestedPercent]), [['Leche entera 1 L', 55], ['Pan tajado', 35]]);
    assert.match(result.body.data[0].reason, /Vence mañana, tienes 30 unidades/);
    // Asking again does not duplicate pending suggestions.
    assert.equal((await call('GET', '/api/suggestions', undefined, token)).body.data.length, 2);
  });

  it('applies a discount only after approval and keeps other stores out', async () => {
    const owner = await registerStore('sug-dos');
    const other = await registerStore('sug-tres');
    const [milkId] = await createProducts(owner.token);
    const [milk] = (await call('GET', '/api/suggestions', undefined, owner.token)).body.data;

    const beforeApproval = (await call('GET', '/api/products/mine', undefined, owner.token)).body.data.find((item: { id: string }) => item.id === milkId);
    assert.equal(beforeApproval.discountPercent, 0);

    assert.equal((await call('POST', `/api/suggestions/${milk.id}/approve`, undefined, other.token)).status, 404);
    const approved = await call('POST', `/api/suggestions/${milk.id}/approve`, undefined, owner.token);
    assert.equal(approved.status, 200);
    assert.deepEqual([approved.body.data.discountPercent, approved.body.data.offerPrice], [55, 2250]);
    assert.equal((await call('POST', `/api/suggestions/${milk.id}/approve`, undefined, owner.token)).status, 409);

    const afterApproval = (await call('GET', '/api/products/mine', undefined, owner.token)).body.data.find((item: { id: string }) => item.id === milkId);
    assert.deepEqual([afterApproval.discountPercent, afterApproval.offerPrice], [55, 2250]);
    assert.deepEqual((await call('GET', '/api/suggestions', undefined, owner.token)).body.data.map((item: { productName: string }) => item.productName), ['Pan tajado']);
  });

  it('does not bring back a rejected suggestion with the same discount', async () => {
    const { token } = await registerStore('sug-cuatro');
    await createProducts(token);
    const [milk] = (await call('GET', '/api/suggestions', undefined, token)).body.data;
    assert.equal((await call('POST', `/api/suggestions/${milk.id}/reject`, undefined, token)).status, 200);
    const again = await call('GET', '/api/suggestions', undefined, token);
    assert.deepEqual(again.body.data.map((item: { productName: string }) => item.productName), ['Pan tajado']);
  });

  it('approves every pending suggestion at once', async () => {
    const { token } = await registerStore('sug-cinco');
    await createProducts(token);
    await call('GET', '/api/suggestions', undefined, token);
    const result = await call('POST', '/api/suggestions/approve-all', undefined, token);
    assert.equal(result.body.data.length, 2);
    assert.equal(result.body.message, 'Se aplicaron 2 descuentos.');
    assert.equal((await call('GET', '/api/suggestions', undefined, token)).body.data.length, 0);
  });

  it('uses the provider only when its answer is valid and falls back otherwise', async () => {
    const { token } = await registerStore('sug-seis');
    await createProducts(token);
    config.aiProvider = 'openai';
    config.openAiApiKey = 'clave-de-prueba';
    const realFetch = globalThis.fetch;
    let answer = '';
    mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
      if (!String(input).startsWith(config.openAiBaseUrl)) return realFetch(input, init);
      return new Response(JSON.stringify({ choices: [{ message: { content: answer } }] }));
    });

    answer = JSON.stringify({ suggestions: [{ productId: 'inventado', reason: 'Texto inventado por el modelo.' }] });
    const fallback = await call('GET', '/api/suggestions', undefined, token);
    assert.deepEqual(fallback.body.data.map((item: { source: string }) => item.source), ['local', 'local']);

    const ids = fallback.body.data.map((item: { productId: string }) => item.productId);
    answer = JSON.stringify({ suggestions: [{ productId: ids[1], reason: 'Primero el pan, que se pone duro.' }, { productId: ids[0], reason: 'Luego la leche de mañana.', suggestedPercent: 99 }] });
    const improved = await call('GET', '/api/suggestions', undefined, token);
    assert.deepEqual(improved.body.data.map((item: { productName: string; source: string; suggestedPercent: number }) => [item.productName, item.source, item.suggestedPercent]), [['Pan tajado', 'ai', 35], ['Leche entera 1 L', 'ai', 60]]);
    assert.equal(improved.body.data[1].suggestedPrice, 2000);
  });

  it('is only for stores', async () => {
    assert.equal((await call('GET', '/api/suggestions')).status, 401);
  });
});
