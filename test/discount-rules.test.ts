import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addDays } from '../src/dates.js';
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

describe('discount rule boundaries', () => {
  it('uses the right tier on every edge of the table', () => {
    const percentFor = (days: number) => suggestDiscount(item({ expirationDate: addDays(today, days) }), today)?.suggestedPercent ?? null;
    assert.deepEqual([0, 1, 2, 3, 4, 7, 8, 14, 15].map(percentFor), [50, 40, 30, 30, 20, 20, 10, 10, null]);
  });

  it('adds the stock bonus from exactly 15 and 30 units', () => {
    const percentFor = (stock: number) => suggestDiscount(item({ stock, expirationDate: addDays(today, 10) }), today)?.suggestedPercent;
    assert.deepEqual([1, 14, 15, 29, 30].map(percentFor), [10, 10, 15, 15, 20]);
  });

  it('recognizes perishable categories in any letter case and with or without accents', () => {
    for (const category of ['CARNES FRÍAS', 'panaderia', 'Frutas y verduras'])
      assert.equal(suggestDiscount(item({ category, expirationDate: addDays(today, 10) }), today)?.suggestedPercent, 15, category);
    assert.equal(suggestDiscount(item({ category: 'Aseo', expirationDate: addDays(today, 10) }), today)?.suggestedPercent, 10);
  });

  it('rounds the suggested price to whole pesos', () => {
    const suggestion = suggestDiscount(item({ price: 4990, category: 'Lácteos', stock: 30, expirationDate: addDays(today, 2) }), today)!;
    assert.equal(suggestion.suggestedPercent, 45);
    assert.equal(suggestion.suggestedPrice, 2745);
    assert.equal(Number.isInteger(suggestion.suggestedPrice), true);
  });

  it('does not suggest anything for negative stock', () => {
    assert.equal(suggestDiscount(item({ stock: -3 }), today), null);
  });

  it('keeps the bigger discount first when two products expire the same day', () => {
    const result = analyzeInventory([item({ id: 'normal' }), item({ id: 'lacteo', category: 'Lácteos' })], today);
    assert.deepEqual(result.map((suggestion) => suggestion.productId), ['lacteo', 'normal']);
  });
});
