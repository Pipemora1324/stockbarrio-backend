import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addDays } from '../src/dates.js';
import { analyzeInventory, isPerishable, perishableCategories, suggestDiscount, type InventoryItem } from '../src/services/discount-rules.js';
import { productCategories } from '../src/validation.js';

const today = '2026-10-18';
const item = (overrides: Partial<InventoryItem>): InventoryItem => ({
  id: 'p1', name: 'Leche entera 1 L', category: 'Lácteos', price: 10000, stock: 5, expirationDate: '2026-10-20', discountPercent: 0, ...overrides,
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
    assert.equal(suggestDiscount(item({ stock: -3 }), today), null);
  });

  it('adds points for high stock and explains it without talking about sales or rotation', () => {
    const suggestion = suggestDiscount(item({ stock: 30, expirationDate: '2026-10-20' }), today);
    assert.equal(suggestion?.suggestedPercent, 40);
    assert.equal(suggestion!.reason, 'Vence en 2 días, tienes 30 unidades (stock alto): sugerimos 40 % de descuento.');
    assert.equal(suggestion?.suggestedPrice, 6000);
    assert.doesNotMatch(suggestion!.reason, /rotaci|ventas|vende mucho/i);
  });

  it('never goes over the maximum discount', () => {
    assert.equal(suggestDiscount(item({ category: 'Panadería', stock: 100, expirationDate: today }), today)?.suggestedPercent, 60);
    assert.ok(suggestDiscount(item({ category: 'Panadería', stock: 100, expirationDate: today, price: 3000 }), today)!.suggestedPercent <= 70);
  });

  it('skips products that already have an equal or bigger discount', () => {
    assert.equal(suggestDiscount(item({ discountPercent: 30, expirationDate: '2026-10-21' }), today), null);
    assert.equal(suggestDiscount(item({ discountPercent: 20, expirationDate: '2026-10-21' }), today)?.currentPercent, 20);
  });
});

describe('perishable products only', () => {
  it('suggests discounts for fresh food: vegetables, meat, dairy, prepared food and bakery', () => {
    for (const category of ['Frutas y verduras', 'Carnes', 'Carnes frías', 'Pollo', 'Pescados y mariscos', 'Lácteos', 'Comidas preparadas', 'Panadería', 'Huevos'])
      assert.equal(suggestDiscount(item({ category, expirationDate: addDays(today, 1) }), today)?.suggestedPercent, 40, category);
  });

  it('never suggests canned food, grains, drinks or cleaning products, even on their last day and with a lot of stock', () => {
    for (const category of ['Despensa', 'Granos', 'Bebidas', 'Aseo', 'Snacks y dulces', 'Alimentación'])
      assert.equal(suggestDiscount(item({ category, stock: 200, expirationDate: today }), today), null, category);
  });

  it('recognizes perishable categories in any letter case and with or without accents', () => {
    for (const category of ['CARNES FRÍAS', 'panaderia', 'lacteos', 'Frutas y verduras']) assert.equal(isPerishable(category), true, category);
    assert.equal(isPerishable('Enlatados'), false);
  });

  it('only lists categories that exist in the catalog', () => {
    const catalog = new Set(productCategories.map((category) => category.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()));
    for (const category of perishableCategories) assert.ok(catalog.has(category), category);
  });
});

describe('analyzeInventory', () => {
  it('sorts the most urgent products first and leaves out the non perishable ones', () => {
    const result = analyzeInventory(
      [
        item({ id: 'a', expirationDate: '2026-10-25' }),
        item({ id: 'b', expirationDate: '2026-10-19' }),
        item({ id: 'c', expirationDate: '2026-12-01' }),
        item({ id: 'lata', category: 'Despensa', expirationDate: '2026-10-18' }),
      ],
      today,
    );
    assert.deepEqual(result.map((suggestion) => suggestion.productId), ['b', 'a']);
  });

  it('keeps the bigger discount first when two products expire the same day', () => {
    const result = analyzeInventory([item({ id: 'poco' }), item({ id: 'mucho', stock: 40 })], today);
    assert.deepEqual(result.map((suggestion) => suggestion.productId), ['mucho', 'poco']);
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

  it('rounds the suggested price to whole pesos', () => {
    const suggestion = suggestDiscount(item({ price: 4990, stock: 30, expirationDate: addDays(today, 2) }), today)!;
    assert.equal(suggestion.suggestedPercent, 40);
    assert.equal(suggestion.suggestedPrice, 2994);
    assert.equal(Number.isInteger(suggestion.suggestedPrice), true);
  });
});
