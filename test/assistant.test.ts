import { integrationSkip, useTestApi } from './helpers/api.js';
import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { config } from '../src/config.js';
import { addDays, todayInBogota } from '../src/dates.js';
import { buildReply, gradeScore, rankResults, type AssistantResult } from '../src/services/assistant.js';

const result = (overrides: Partial<AssistantResult>): AssistantResult => ({
  productId: 'x', name: 'Huevos AA x 30', category: 'Huevos', price: 18000, offerPrice: 18000, discountPercent: 0, stock: 5,
  expirationDate: '2026-10-25', daysToExpire: 7, distanceKm: null, store: { id: 's', name: 'Tienda', neighborhood: 'Chapinero', address: 'Calle 1' }, ...overrides,
});

describe('rankResults', () => {
  const cheap = result({ productId: 'cheap', offerPrice: 7000, distanceKm: 5, discountPercent: 0, daysToExpire: 9, name: 'Huevos A x 12' });
  const near = result({ productId: 'near', offerPrice: 9000, distanceKm: 0.4, discountPercent: 10, daysToExpire: 3, name: 'Huevos AA x 12' });
  const deal = result({ productId: 'deal', offerPrice: 12000, distanceKm: null, discountPercent: 30, daysToExpire: 1, name: 'Huevos AAA x 15' });
  const ids = (items: AssistantResult[]) => items.map((item) => item.productId);

  it('orders by the requested criterion', () => {
    assert.deepEqual(ids(rankResults([near, deal, cheap], 'cheapest', false)), ['cheap', 'near', 'deal']);
    assert.deepEqual(ids(rankResults([cheap, near, deal], 'best_deal', false)), ['deal', 'near', 'cheap']);
    assert.deepEqual(ids(rankResults([cheap, near, deal], 'best_grade', false)), ['deal', 'near', 'cheap']);
    assert.deepEqual(ids(rankResults([deal, cheap, near], 'nearest', true)), ['near', 'cheap', 'deal']);
    assert.deepEqual(ids(rankResults([cheap, near, deal], 'expiring', false)), ['deal', 'near', 'cheap']);
  });

  it('scores Colombian grades', () => {
    assert.deepEqual(['Huevos AAA', 'Huevos AA x 30', 'Huevos A x 30', 'Leche entera'].map(gradeScore), [3, 2, 1, 0]);
  });
});

describe('buildReply', () => {
  it('asks for the location when the customer wants something nearby without sharing it', () => {
    const reply = buildReply({ terms: ['leche'], preference: 'nearest', wantsNearby: true }, [result({ name: 'Leche entera 1 L', offerPrice: 4900 })], false);
    assert.match(reply, /^Encontré 1 opción de «leche»\. La más cercana: Leche entera 1 L en Tienda \(Chapinero\) a \$ 4\.900; vence en 7 días\./);
    assert.match(reply, /comparte tu ubicación o elige tu barrio/);
  });

  it('explains when nothing was found', () => {
    assert.match(buildReply({ terms: ['caviar'], preference: 'cheapest', wantsNearby: false }, [], false), /^No encontré «caviar» disponibles/);
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
    await call('PUT', '/api/stores/me', { latitude: 4.641, longitude: -74.0636 }, near.token);
    await call('PUT', '/api/stores/me', { latitude: 4.7286, longitude: -74.0657 }, far.token);
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
    assert.equal(response.body.data.results[0].distanceKm, null);
  });

  it('answers "leche cerca de mí" ordered by distance from the shared location, without expired products', async () => {
    const response = await call('POST', '/api/assistant/search', { message: 'leche cerca de mí', latitude: 4.6405, longitude: -74.064 });
    const results = response.body.data.results as Array<{ name: string; distanceKm: number; store: { name: string } }>;
    assert.deepEqual(results.map((item) => item.name), ['Leche deslactosada 1 L', 'Leche entera 1 L']);
    assert.ok(results[0].distanceKm < 0.2);
    assert.ok(results[1].distanceKm > 9);
    assert.equal(response.body.data.origin, 'location');
    assert.match(response.body.data.reply, /La más cercana: Leche deslactosada 1 L en Tienda Cerca \(Chapinero\) a \$ 5\.600, a \d+ m/);
  });

  it('uses the chosen neighborhood as origin when there is no location', async () => {
    const response = await call('POST', '/api/assistant/search', { message: 'leche cerca', neighborhood: 'Suba' });
    assert.equal(response.body.data.origin, 'neighborhood');
    assert.equal(response.body.data.results[0].store.name, 'Tienda Lejos');
  });

  it('filters by a neighborhood written in the message', async () => {
    const response = await call('POST', '/api/assistant/search', { message: 'huevos en chapinero' });
    assert.deepEqual(response.body.data.results.map((item: { store: { name: string } }) => item.store.name), ['Tienda Cerca']);
    assert.equal(response.body.data.intent.neighborhood, 'Chapinero');
  });

  it('never stores the customer location', async () => {
    await call('POST', '/api/assistant/search', { message: 'leche cerca de mí', latitude: 4.6123, longitude: -74.0711 });
    const columns = await context.pool.query(`SELECT 1 FROM stores WHERE latitude = 4.6123 OR longitude = -74.0711`);
    assert.equal(columns.rowCount, 0);
  });

  it('validates the request', async () => {
    assert.equal((await call('POST', '/api/assistant/search', { message: 'leche', latitude: 4.6 })).status, 400);
    assert.equal((await call('POST', '/api/assistant/search', { message: '' })).status, 400);
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

  it('lets a store save valid coordinates only', async () => {
    const { token } = await registerStore('asis-ubica');
    const saved = await call('PUT', '/api/stores/me', { latitude: 6.2456, longitude: -75.5923 }, token);
    assert.equal(saved.status, 200);
    assert.deepEqual([saved.body.data.latitude, saved.body.data.longitude], [6.2456, -75.5923]);
    const swapped = await call('PUT', '/api/stores/me', { latitude: -75.5923, longitude: 6.2456 }, token);
    assert.equal(swapped.status, 400);
    assert.match(swapped.body.message, /fuera de Colombia/);
    const neighborhoods = await call('GET', '/api/stores/neighborhoods');
    assert.deepEqual(neighborhoods.body.data, ['Chapinero', 'Suba']);
  });
});
