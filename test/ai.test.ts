import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { config } from '../src/config.js';
import { getRecommendations, localRecommendation, validateAiCombo, type RecommendationProduct } from '../src/services/ai.js';

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

describe('validateAiCombo', () => {
  const input = { budget: 10000, neighborhood: 'Centro', products: [product({ id: 'a', offerPrice: 3000, stock: 2 }), product({ id: 'b', offerPrice: 2000 })] };

  it('accepts a valid combo and recomputes the totals', () => {
    const result = validateAiCombo(input, { suggestion: 'Combo sugerido por la IA.', items: [{ productId: 'a', quantity: 2 }, { productId: 'b', quantity: 1 }] }, today);
    assert.deepEqual([result?.total, result?.confidence], [8000, 0.9]);
  });

  it('rejects combos over budget, over stock or with unknown products', () => {
    assert.equal(validateAiCombo(input, { suggestion: 'Combo demasiado caro.', items: [{ productId: 'b', quantity: 3 }, { productId: 'a', quantity: 2 }] }, today), null);
    assert.equal(validateAiCombo(input, { suggestion: 'Más que el stock.', items: [{ productId: 'a', quantity: 3 }] }, today), null);
    assert.equal(validateAiCombo(input, { suggestion: 'Producto inventado.', items: [{ productId: 'zzz', quantity: 1 }] }, today), null);
  });
});

describe('getRecommendations', () => {
  afterEach(() => {
    mock.restoreAll();
    config.aiProvider = 'local';
    config.openAiApiKey = '';
  });

  it('falls back to the local combo when the provider answers something invalid', async () => {
    config.aiProvider = 'openai';
    config.openAiApiKey = 'clave-de-prueba';
    mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"suggestion":"Combo enorme.","items":[{"productId":"a","quantity":50}]}' } }] })));
    const result = await getRecommendations({ budget: 30000, neighborhood: 'Centro', products: [product({ id: 'a', expirationDate: '2099-01-01' })] });
    assert.equal(result.confidence, 0.8);
    assert.equal(result.products[0].quantity, 3);
  });
});
