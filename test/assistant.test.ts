import { integrationSkip, useTestApi } from './helpers/api.js';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addDays, todayInBogota } from '../src/dates.js';
import { askNeighborhood, buildReply, gradeScore, rankResults, type AssistantResult } from '../src/services/assistant.js';
import { parseIntent } from '../src/services/search-intent.js';

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

describe('findResults (search used by the chat)', { skip: integrationSkip }, () => {
  const context = useTestApi();
  const { call, registerStore } = context;
  const today = todayInBogota();
  const neighborhoods = ['Chapinero', 'Suba'];
  const search = async (message: string, chosen?: string) => {
    const { findResults, withChosenNeighborhood } = await import('../src/services/assistant.js');
    const intent = withChosenNeighborhood(parseIntent(message, neighborhoods), chosen, neighborhoods);
    const results = await findResults(intent);
    return { intent, results, reply: buildReply(intent, results, neighborhoods) };
  };

  it('finds the cheapest eggs first, never expired products, in every store', async () => {
    const near = await registerStore('asis-cerca', { storeName: 'Tienda Cerca', neighborhood: 'Chapinero' });
    const far = await registerStore('asis-lejos', { storeName: 'Tienda Lejos', neighborhood: 'Suba' });
    const product = { category: 'Huevos', stock: 10, discountPercent: 0 };
    await call('POST', '/api/products', { ...product, name: 'Huevos AA x 30', price: 19000, expirationDate: addDays(today, 8) }, near.token);
    await call('POST', '/api/products', { ...product, name: 'Huevos A x 30', price: 16000, expirationDate: addDays(today, 5) }, far.token);
    await call('POST', '/api/products', { ...product, name: 'Leche entera 1 L', category: 'Lácteos', price: 4900, expirationDate: addDays(today, 2) }, far.token);
    await call('POST', '/api/products', { ...product, name: 'Leche deslactosada 1 L', category: 'Lácteos', price: 5600, expirationDate: addDays(today, 4) }, near.token);
    const expired = await call('POST', '/api/products', { ...product, name: 'Leche vencida', category: 'Lácteos', price: 3000, expirationDate: addDays(today, 1) }, near.token);
    await context.pool.query('UPDATE products SET expiration_date = $2 WHERE id = $1', [expired.body.data.id, addDays(today, -1)]);

    const eggs = await search('busco huevos baratos');
    assert.deepEqual(eggs.results.map((item) => item.name), ['Huevos A x 30', 'Huevos AA x 30']);
    assert.match(eggs.reply, /La más barata: Huevos A x 30 en Tienda Lejos \(Suba\) a \$ 16\.000/);
    const milk = await search('leche cerca de mí');
    assert.deepEqual(milk.results.map((item) => item.name), ['Leche entera 1 L', 'Leche deslactosada 1 L']);
    assert.match(milk.reply, /dime tu barrio\. Hay tiendas en Chapinero y Suba\./);
  });

  it('filters by the remembered neighborhood or by one written in the message', async () => {
    const chosen = await search('leche cerca', 'suba');
    assert.deepEqual(chosen.results.map((item) => item.store.name), ['Tienda Lejos']);
    assert.equal(chosen.intent.neighborhood, 'Suba');
    const written = await search('huevos en chapinero');
    assert.deepEqual(written.results.map((item) => item.store.name), ['Tienda Cerca']);
  });
});
