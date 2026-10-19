import { integrationSkip, useTestApi } from './helpers/api.js';
import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { config } from '../src/config.js';
import { addDays, todayInBogota } from '../src/dates.js';
import { isTrustworthyReason } from '../src/services/suggestions.js';

const reasonInput = { productId: 'a', productName: 'Leche', category: 'Lácteos', stock: 30, daysToExpire: 1, currentPercent: 0, suggestedPercent: 55, price: 5000, suggestedPrice: 2250 };

describe('isTrustworthyReason', () => {
  it('accepts a text that only uses the numbers from the rules', () => {
    assert.equal(isTrustworthyReason('La leche vence mañana: con 55 % queda en $ 2.250 y se vende hoy.', reasonInput), true);
  });

  it('rejects invented percents, prices, links or markup', () => {
    assert.equal(isTrustworthyReason('Mejor ponle 80 % de descuento.', reasonInput), false);
    assert.equal(isTrustworthyReason('Véndela a $ 1.000 para salir rápido.', reasonInput), false);
    assert.equal(isTrustworthyReason('Más información en https://ejemplo.com', reasonInput), false);
    assert.equal(isTrustworthyReason('<b>Vence mañana</b>', reasonInput), false);
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

  it('lets the provider write each reason once, never the percent', async () => {
    const { token } = await registerStore('sug-seis');
    await createProducts(token);
    config.aiProvider = 'openai';
    config.openAiApiKey = 'clave-de-prueba';
    const realFetch = globalThis.fetch;
    let providerCalls = 0;
    let answer = '';
    mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
      if (!String(input).startsWith(config.openAiBaseUrl)) return realFetch(input, init);
      providerCalls++;
      const sent = JSON.parse(JSON.parse(String(init!.body)).messages[1].content) as { descuentos: Array<{ productId: string; productName: string }> };
      answer = JSON.stringify({
        reasons: sent.descuentos.map((item) => ({
          productId: item.productId,
          reason: item.productName.startsWith('Leche') ? 'La leche vence mañana y tienes mucha: el 55 % ayuda a venderla hoy.' : 'Sube el descuento al 90 % ya mismo.',
        })),
      });
      return new Response(JSON.stringify({ choices: [{ message: { content: answer } }] }));
    });

    const first = await call('GET', '/api/suggestions', undefined, token);
    const milk = first.body.data.find((item: { productName: string }) => item.productName === 'Leche entera 1 L');
    const bread = first.body.data.find((item: { productName: string }) => item.productName === 'Pan tajado');
    assert.deepEqual([milk.source, milk.suggestedPercent, milk.reason], ['ai', 55, 'La leche vence mañana y tienes mucha: el 55 % ayuda a venderla hoy.']);
    // The bread text invented a 90 %, so the rule text stays.
    assert.deepEqual([bread.source, bread.suggestedPercent], ['local', 35]);
    assert.equal(providerCalls, 1);

    await call('GET', '/api/suggestions', undefined, token);
    await call('GET', '/api/suggestions', undefined, token);
    assert.equal(providerCalls, 1, 'texts are stored once, not requested on every visit');

    // A product added later the same day gets the rule text: still one call per store per day.
    await call('POST', '/api/products', { name: 'Queso campesino', category: 'Lácteos', price: 9000, stock: 4, expirationDate: addDays(today, 2) }, token);
    const sameDay = (await call('GET', '/api/suggestions', undefined, token)).body.data.find((item: { productName: string }) => item.productName === 'Queso campesino');
    assert.equal(sameDay.source, 'local');
    assert.equal(providerCalls, 1);

    // The next day the store gets one new batch with all its suggestions.
    const { refreshSuggestions } = await import('../src/services/suggestions.js');
    const storeId = (await call('GET', '/api/stores/me', undefined, token)).body.data.id as string;
    await refreshSuggestions(storeId, addDays(today, 1));
    assert.equal(providerCalls, 2);
  });

  it('is only for stores', async () => {
    assert.equal((await call('GET', '/api/suggestions')).status, 401);
  });
});
