import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { config } from '../src/config.js';
import { getRecommendations, localRecommendation, type RecommendationProduct } from '../src/services/ai.js';

const today = '2026-10-18';
const product = (overrides: Partial<RecommendationProduct>): RecommendationProduct => ({
  id: 'x', name: 'Producto', price: 5000, offerPrice: 4000, stock: 10, expirationDate: '2026-10-25', ...overrides,
});

describe('localRecommendation', () => {
  it('puts the products that expire first at the top', () => {
    const result = localRecommendation({
      budget: 100000,
      neighborhood: 'Chapinero',
      products: [product({ id: 'late', name: 'Arroz', expirationDate: '2026-12-01' }), product({ id: 'soon', name: 'Leche', expirationDate: '2026-10-19' })],
    }, today);
    assert.deepEqual(result.products.map((item) => item.productId), ['soon', 'late']);
    assert.match(result.suggestion, /Primero va lo que vence antes: Leche/);
  });

  it('keeps the running total inside the budget', () => {
    const result = localRecommendation({
      budget: 10000,
      neighborhood: 'Centro',
      products: [product({ id: 'a', offerPrice: 3000, expirationDate: '2026-10-19' }), product({ id: 'b', offerPrice: 3000, expirationDate: '2026-10-20' }), product({ id: 'c', offerPrice: 900, expirationDate: '2026-10-21' })],
    }, today);
    // 3 x 3000 fills most of the budget; the next 3000 item no longer fits, the 900 one does.
    assert.deepEqual(result.products.map((item) => [item.productId, item.quantity]), [['a', 3], ['c', 1]]);
    assert.equal(result.total, 9900);
    assert.equal(result.total <= 10000, true);
  });

  it('never asks for more units than the stock', () => {
    const result = localRecommendation({ budget: 100000, neighborhood: 'Centro', products: [product({ stock: 2 })] }, today);
    assert.equal(result.products[0].quantity, 2);
  });

  it('skips expired and out of stock products', () => {
    const result = localRecommendation({ budget: 30000, neighborhood: 'Centro', products: [product({ stock: 0 }), product({ id: 'old', expirationDate: '2026-10-10' })] }, today);
    assert.match(result.suggestion, /No hay productos suficientes/);
    assert.deepEqual(result.products, []);
  });

  it('computes the savings from the original price', () => {
    const result = localRecommendation({ budget: 8000, neighborhood: 'Centro', products: [product({ price: 5000, offerPrice: 4000 })] }, today);
    assert.deepEqual([result.total, result.savings], [8000, 2000]);
    assert.match(result.suggestion, /\$ 8\.000 y ahorras \$ 2\.000/);
  });
});

describe('localRecommendation limits', () => {
  it('still offers a product that expires today, but never one that expired yesterday', () => {
    const result = localRecommendation({ budget: 50000, neighborhood: 'Centro', products: [product({ id: 'hoy', expirationDate: today }), product({ id: 'ayer', expirationDate: '2026-10-17' })] }, today);
    assert.deepEqual(result.products.map((item) => item.productId), ['hoy']);
  });

  it('uses at most five products and three units of each', () => {
    const many = Array.from({ length: 8 }, (_, index) => product({ id: `p${index}`, offerPrice: 1000, expirationDate: `2026-10-2${index}` }));
    const result = localRecommendation({ budget: 1_000_000, neighborhood: 'Centro', products: many }, today);
    assert.equal(result.products.length, 5);
    assert.deepEqual(result.products.map((item) => item.quantity), [3, 3, 3, 3, 3]);
    assert.deepEqual(result.products.map((item) => item.productId), ['p0', 'p1', 'p2', 'p3', 'p4']);
  });

  it('breaks ties on the same day by the biggest relative saving, then by the lowest price', () => {
    const result = localRecommendation({
      budget: 1_000_000,
      neighborhood: 'Centro',
      products: [
        product({ id: 'poco', price: 10000, offerPrice: 9000 }),
        product({ id: 'mitad-cara', price: 10000, offerPrice: 5000 }),
        product({ id: 'mitad-barata', price: 4000, offerPrice: 2000 }),
      ],
    }, today);
    assert.deepEqual(result.products.map((item) => item.productId), ['mitad-barata', 'mitad-cara', 'poco']);
  });

  it('fills a budget exactly and returns nothing when not even one unit fits', () => {
    const exact = localRecommendation({ budget: 4000, neighborhood: 'Centro', products: [product({})] }, today);
    assert.deepEqual([exact.products.length, exact.total], [1, 4000]);
    assert.match(exact.suggestion, /combo de 1 producto por/);
    const short = localRecommendation({ budget: 3999, neighborhood: 'Centro', products: [product({})] }, today);
    assert.deepEqual([short.products, short.total, short.savings], [[], 0, 0]);
  });

  it('does not talk about savings when nothing is discounted', () => {
    const result = localRecommendation({ budget: 20000, neighborhood: 'Centro', products: [product({ price: 4000, offerPrice: 4000 })] }, today);
    assert.equal(result.savings, 0);
    assert.doesNotMatch(result.suggestion, /ahorras/);
  });
});

describe('getRecommendations', () => {
  afterEach(() => {
    mock.restoreAll();
    config.aiProvider = 'local';
    config.openAiApiKey = '';
  });

  it('never calls the AI provider, even when one is configured', async () => {
    config.aiProvider = 'openai';
    config.openAiApiKey = 'clave-de-prueba';
    const fetchMock = mock.method(globalThis, 'fetch', async () => new Response('{}'));
    const result = await getRecommendations({ budget: 30000, neighborhood: 'Centro', products: [product({ id: 'a', expirationDate: '2099-01-01' })] });
    assert.equal(fetchMock.mock.callCount(), 0);
    assert.equal(result.products[0].quantity, 3);
  });
});
