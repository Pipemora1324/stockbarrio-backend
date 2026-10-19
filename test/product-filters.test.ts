import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildProductFilters } from '../src/repositories/product.js';

describe('buildProductFilters', () => {
  it('numbers placeholders by the filters that are present', () => {
    const { where, params } = buildProductFilters({ category: 'Lácteos', search: 'leche' });
    assert.match(where, /p\.category ILIKE \$1/);
    assert.match(where, /p\.name ILIKE \$2 OR p\.description ILIKE \$2/);
    assert.deepEqual(params, ['%Lácteos%', '%leche%']);
  });

  it('uses only the active conditions without filters', () => {
    const { where, params } = buildProductFilters({});
    assert.equal(where, 'p.active = true AND s.active = true');
    assert.deepEqual(params, []);
  });
});
