import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildProductFilters } from '../src/repositories/product.js';

describe('buildProductFilters', () => {
  it('keeps today as $1 and the category as $2', () => {
    const { where, params } = buildProductFilters({ category: 'Lácteos' }, '2026-10-19');
    assert.match(where, /lower\(p\.category\) = lower\(\$2\)/);
    assert.deepEqual(params, ['2026-10-19', 'Lácteos']);
  });

  it('leaves out expired products and inactive stores, but keeps the products on offer', () => {
    const { where, params } = buildProductFilters({}, '2026-10-19');
    assert.equal(where, 'p.active = true AND s.active = true AND p.expiration_date >= $1::date');
    assert.doesNotMatch(where, /offer/);
    assert.deepEqual(params, ['2026-10-19']);
  });
});
