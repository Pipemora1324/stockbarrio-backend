import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getRecommendations } from '../src/services/ai.js';

describe('getRecommendations', () => {
  it('builds a combination with products inside the budget', async () => {
    const result = await getRecommendations({
      budget: 30,
      neighborhood: 'Centro',
      products: [
        { name: 'Pan', price: 4, offerPrice: 2, stock: 10, expirationDate: '2026-12-01' },
        { name: 'Queso', price: 6, offerPrice: 3, stock: 5, expirationDate: '2026-11-01' },
        { name: 'Tomate', price: 5, offerPrice: 2.5, stock: 8, expirationDate: '2026-12-10' },
      ],
    });

    assert.equal(result.total <= 30, true);
    assert.equal(result.products.length > 0, true);
    assert.equal(result.savings >= 0, true);
    assert.equal(result.confidence, 0.82);
  });

  it('returns an empty recommendation when no product is available', async () => {
    const result = await getRecommendations({
      budget: 30,
      neighborhood: 'Centro',
      products: [{ name: 'Pan', price: 4, offerPrice: 2, stock: 0, expirationDate: '2026-12-01' }],
    });

    assert.match(result.suggestion, /No hay productos suficientes/);
    assert.deepEqual(result.products, []);
  });
});
