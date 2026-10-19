import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { analyzeInventory, suggestDiscount, type InventoryItem } from '../src/services/discount-rules.js';

const today = '2026-10-18';
const item = (overrides: Partial<InventoryItem>): InventoryItem => ({
  id: 'p1', name: 'Arroz 1 kg', category: 'Granos', price: 10000, stock: 5, expirationDate: '2026-10-20', discountPercent: 0, ...overrides,
});

describe('suggestDiscount', () => {
  it('follows the tier for the days left', () => {
    assert.equal(suggestDiscount(item({ expirationDate: '2026-10-18' }), today)?.suggestedPercent, 50);
    assert.equal(suggestDiscount(item({ expirationDate: '2026-10-19' }), today)?.suggestedPercent, 40);
    assert.equal(suggestDiscount(item({ expirationDate: '2026-10-21' }), today)?.suggestedPercent, 30);
    assert.equal(suggestDiscount(item({ expirationDate: '2026-10-25' }), today)?.suggestedPercent, 20);
    assert.equal(suggestDiscount(item({ expirationDate: '2026-11-01' }), today)?.suggestedPercent, 10);
  });

  it('does not suggest anything with more than 14 days left, when expired or without stock', () => {
    assert.equal(suggestDiscount(item({ expirationDate: '2026-11-02' }), today), null);
    assert.equal(suggestDiscount(item({ expirationDate: '2026-10-17' }), today), null);
    assert.equal(suggestDiscount(item({ stock: 0 }), today), null);
  });

  it('adds points for excess stock and perishable categories and explains them', () => {
    const suggestion = suggestDiscount(item({ category: 'Lácteos', stock: 30, expirationDate: '2026-10-20' }), today);
    assert.equal(suggestion?.suggestedPercent, 45);
    assert.match(suggestion!.reason, /^Vence en 2 días, tienes 30 unidades \(exceso de stock\), lácteos es una categoría perecedera: sugerimos 45 % de descuento\.$/);
    assert.equal(suggestion?.suggestedPrice, 5500);
  });

  it('never goes over the maximum discount', () => {
    assert.equal(suggestDiscount(item({ category: 'Panadería', stock: 100, expirationDate: today }), today)?.suggestedPercent, 65);
    assert.equal(suggestDiscount(item({ category: 'Panadería', stock: 100, expirationDate: today, price: 3000 }), today)!.suggestedPercent <= 70, true);
  });

  it('skips products that already have an equal or bigger discount', () => {
    assert.equal(suggestDiscount(item({ discountPercent: 30, expirationDate: '2026-10-21' }), today), null);
    assert.equal(suggestDiscount(item({ discountPercent: 20, expirationDate: '2026-10-21' }), today)?.currentPercent, 20);
  });
});

describe('analyzeInventory', () => {
  it('sorts the most urgent products first', () => {
    const result = analyzeInventory(
      [item({ id: 'a', expirationDate: '2026-10-25' }), item({ id: 'b', expirationDate: '2026-10-19' }), item({ id: 'c', expirationDate: '2026-12-01' })],
      today,
    );
    assert.deepEqual(result.map((suggestion) => suggestion.productId), ['b', 'a']);
  });
});
