import { integrationSkip, useTestApi } from './helpers/api.js';
import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { config } from '../src/config.js';
import { addDays, todayInBogota } from '../src/dates.js';
import { askNeighborhood, buildReply, gradeScore, rankResults, type AssistantResult } from '../src/services/assistant.js';

const result = (overrides: Partial<AssistantResult>): AssistantResult => ({
  productId: 'x', name: 'Huevos AA x 30', category: 'Huevos', price: 18000, offerPrice: 18000, discountPercent: 0, stock: 5,
  expirationDate: '2026-10-25', daysToExpire: 7, store: { id: 's', name: 'Tienda', neighborhood: 'Chapinero', address: 'Calle 1' }, ...overrides,
});

describe('rankResults', () => {
  const cheap = result({ productId: 'cheap', offerPrice: 7000, discountPercent: 0, daysToExpire: 9, name: 'Huevos A x 12' });
  const near = result({ productId: 'near', offerPrice: 9000, discountPercent: 10, daysToExpire: 3, name: 'Huevos AA x 12' });
  const deal = result({ productId: 'deal', offerPrice: 12000, discountPercent: 30, daysToExpire: 1, name: 'Huevos AAA x 15' });
  const ids = (items: AssistantResult[]) => items.map((item) => item.productId);

  it('orders by the requested criterion', () => {
    assert.deepEqual(ids(rankResults([near, deal, cheap], 'cheapest')), ['cheap', 'near', 'deal']);
    assert.deepEqual(ids(rankResults([cheap, near, deal], 'best_deal')), ['deal', 'near', 'cheap']);
    assert.deepEqual(ids(rankResults([cheap, near, deal], 'best_grade')), ['deal', 'near', 'cheap']);
    assert.deepEqual(ids(rankResults([cheap, near, deal], 'expiring')), ['deal', 'near', 'cheap']);
    assert.deepEqual(ids(rankResults([cheap, near, deal], 'relevance')), ['deal', 'near', 'cheap'], 'what expires first, then the cheapest');
  });

  it('scores Colombian grades', () => {
    assert.deepEqual(['Huevos AAA', 'Huevos AA x 30', 'Huevos A x 30', 'Leche entera'].map(gradeScore), [3, 2, 1, 0]);
  });
});

describe('buildReply', () => {
  it('asks for the neighborhood when the customer wants something nearby without saying where', () => {
    const reply = buildReply({ terms: ['leche'], preference: 'relevance', wantsNearby: true }, [result({ name: 'Leche entera 1 L', offerPrice: 4900 })], ['Chapinero', 'Suba']);
    assert.match(reply, /^Encontré 1 opción de «leche»\. Te recomiendo: Leche entera 1 L en Tienda \(Chapinero\) a \$ 4\.900; vence en 7 días\./);
    assert.match(reply, /Para buscar cerca de ti, dime tu barrio\. Hay tiendas en Chapinero y Suba\.$/);
    assert.doesNotMatch(reply, /ubicación| km\b| m\b/);
  });

  it('does not ask for the neighborhood when it is already known', () => {
    const reply = buildReply({ terms: ['leche'], preference: 'relevance', wantsNearby: true, neighborhood: 'Chapinero' }, [result({})], ['Chapinero', 'Suba']);
    assert.doesNotMatch(reply, /dime tu barrio/);
  });

  it('lists at most six neighborhoods', () => {
    assert.equal(askNeighborhood(['A', 'B', 'C', 'D', 'E', 'F', 'G']), 'Para buscar cerca de ti, dime tu barrio. Hay tiendas en A, B, C, D, E y F.');
    assert.equal(askNeighborhood(['Chapinero']), 'Para buscar cerca de ti, dime tu barrio. Hay tiendas en Chapinero.');
    assert.equal(askNeighborhood([]), 'Para buscar cerca de ti, dime tu barrio.');
  });

  it('explains when nothing was found', () => {
    assert.match(buildReply({ terms: ['caviar'], preference: 'cheapest', wantsNearby: false }, []), /^No encontré «caviar» disponibles/);
  });
});

describe('assistant API', { skip: integrationSkip }, () => {
  const context = useTestApi();
  const { call, registerStore } = context;
  const today = todayInBogota();

  afterEach(() => {
    mock.restoreAll();
    config.aiProvider = 'local';
    config.openAiApiKey = '';
  });

  const setupStores = async () => {
    const near = await registerStore('asis-cerca', { storeName: 'Tienda Cerca', neighborhood: 'Chapinero' });
    const far = await registerStore('asis-lejos', { storeName: 'Tienda Lejos', neighborhood: 'Suba' });
    const product = { category: 'Huevos', stock: 10, discountPercent: 0 };
    await call('POST', '/api/products', { ...product, name: 'Huevos AA x 30', price: 19000, expirationDate: addDays(today, 8) }, near.token);
    await call('POST', '/api/products', { ...product, name: 'Huevos A x 30', price: 16000, expirationDate: addDays(today, 5) }, far.token);
    await call('POST', '/api/products', { ...product, name: 'Leche entera 1 L', category: 'Lácteos', price: 4900, expirationDate: addDays(today, 2) }, far.token);
    await call('POST', '/api/products', { ...product, name: 'Leche deslactosada 1 L', category: 'Lácteos', price: 5600, expirationDate: addDays(today, 4) }, near.token);
    await call('POST', '/api/products', { ...product, name: 'Leche vencida', category: 'Lácteos', price: 3000, expirationDate: addDays(today, -1) }, near.token);
  };

  it('answers "busco huevos baratos" with the cheapest eggs first', async () => {
    await setupStores();
    const response = await call('POST', '/api/assistant/search', { message: 'busco huevos baratos' });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.data.results.map((item: { name: string }) => item.name), ['Huevos A x 30', 'Huevos AA x 30']);
    assert.match(response.body.data.reply, /La más barata: Huevos A x 30 en Tienda Lejos \(Suba\) a \$ 16\.000/);
    assert.equal('distanceKm' in response.body.data.results[0], false);
  });

  it('answers "leche cerca de mí" with every store and asks for the neighborhood, without expired products', async () => {
    const response = await call('POST', '/api/assistant/search', { message: 'leche cerca de mí' });
    assert.deepEqual(response.body.data.results.map((item: { name: string }) => item.name), ['Leche entera 1 L', 'Leche deslactosada 1 L']);
    assert.match(response.body.data.reply, /dime tu barrio\. Hay tiendas en Chapinero y Suba\./);
    assert.equal('origin' in response.body.data, false);
  });

  it('uses the chosen neighborhood as a filter when the message does not name one', async () => {
    const response = await call('POST', '/api/assistant/search', { message: 'leche cerca', neighborhood: 'suba' });
    assert.deepEqual(response.body.data.results.map((item: { store: { name: string } }) => item.store.name), ['Tienda Lejos']);
    assert.equal(response.body.data.intent.neighborhood, 'Suba');
    assert.doesNotMatch(response.body.data.reply, /dime tu barrio/);
  });

  it('filters by a neighborhood written in the message', async () => {
    const response = await call('POST', '/api/assistant/search', { message: 'huevos en chapinero' });
    assert.deepEqual(response.body.data.results.map((item: { store: { name: string } }) => item.store.name), ['Tienda Cerca']);
    assert.equal(response.body.data.intent.neighborhood, 'Chapinero');
  });

  it('validates the request', async () => {
    assert.equal((await call('POST', '/api/assistant/search', { message: '' })).status, 400);
    const older = await call('POST', '/api/assistant/search', { message: 'leche', latitude: 4.6, longitude: -74.06 });
    assert.equal(older.status, 200, 'coordinates from older clients are ignored');
    assert.equal(JSON.stringify(older.body).includes('distance'), false);
  });

  it('asks the provider only when the rules do not understand the product, and validates its answer', async () => {
    config.aiProvider = 'openai';
    config.openAiApiKey = 'clave-de-prueba';
    const realFetch = globalThis.fetch;
    let answer = '';
    let providerCalls = 0;
    mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
      if (!String(input).startsWith(config.openAiBaseUrl)) return realFetch(input, init);
      providerCalls++;
      return new Response(JSON.stringify({ choices: [{ message: { content: answer } }] }));
    });
    answer = JSON.stringify({ terms: ['huevos'], preference: 'best_grade' });
    const clear = await call('POST', '/api/assistant/search', { message: 'quiero los mejores huevitos' });
    assert.equal(providerCalls, 0, 'the rules understood it');
    assert.equal(clear.body.data.intent.preference, 'best_grade');

    const unclear = await call('POST', '/api/assistant/search', { message: 'ayúdame por favor' });
    assert.equal(providerCalls, 1);
    assert.equal(unclear.body.data.intent.preference, 'best_grade');
    assert.equal(unclear.body.data.results[0].name, 'Huevos AA x 30');

    answer = JSON.stringify({ terms: ["'; DROP TABLE products; --"], preference: 'cheapest' });
    const invalid = await call('POST', '/api/assistant/search', { message: 'me ayudas?' });
    assert.deepEqual(invalid.body.data.intent.terms, []);
  });

  it('lists the neighborhoods that have stores', async () => {
    const neighborhoods = await call('GET', '/api/stores/neighborhoods');
    assert.deepEqual(neighborhoods.body.data, ['Chapinero', 'Suba']);
  });
});
