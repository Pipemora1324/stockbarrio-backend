import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildProductFilters } from '../src/repositories/product.js';

describe('buildProductFilters', () => {
  it('keeps today as $1 and numbers the other placeholders by the filters that are present', () => {
    const { where, params } = buildProductFilters({ category: 'Lácteos', search: 'leche' }, '2026-10-19');
    assert.match(where, /lower\(p\.category\) = lower\(\$2\)/);
    assert.match(where, /p\.name ILIKE \$3 OR p\.description ILIKE \$3/);
    assert.deepEqual(params, ['2026-10-19', 'Lácteos', '%leche%']);
  });

  it('leaves out expired products and products with an active offer even without filters', () => {
    const { where, params } = buildProductFilters({}, '2026-10-19');
    assert.match(where, /^p\.active = true AND s\.active = true AND p\.expiration_date >= \$1::date AND NOT \(p\.discount_percent > 0/);
    assert.match(where, /\$1::date BETWEEN p\.offer_starts_on AND p\.offer_ends_on/);
    assert.deepEqual(params, ['2026-10-19']);
  });
});
