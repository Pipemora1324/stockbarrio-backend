import { integrationSkip, useTestApi } from './helpers/api.js';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addDays, todayInBogota } from '../src/dates.js';

describe('offers API', { skip: integrationSkip }, () => {
  const context = useTestApi();
  const { call, registerStore } = context;
  const today = todayInBogota();

  const setup = async () => {
    const near = await registerStore('ofertas-cerca', { storeName: 'Tienda Cerca', neighborhood: 'Chapinero' });
    const far = await registerStore('ofertas-lejos', { storeName: 'Tienda Lejos', neighborhood: 'Suba' });
    await call('PUT', '/api/stores/me', { latitude: 4.641, longitude: -74.0636 }, near.token);
    await call('PUT', '/api/stores/me', { latitude: 4.7286, longitude: -74.0657 }, far.token);
    const base = { stock: 10, price: 10000 };
    await call('POST', '/api/products', { ...base, name: 'Leche entera', category: 'Lácteos', discountPercent: 20, expirationDate: addDays(today, 6) }, near.token);
    await call('POST', '/api/products', { ...base, name: 'Pan tajado', category: 'Panadería', discountPercent: 40, expirationDate: addDays(today, 3) }, far.token);
    await call('POST', '/api/products', { ...base, name: 'Queso campesino', category: 'Lácteos', discountPercent: 30, expirationDate: addDays(today, 1) }, far.token);
    await call('POST', '/api/products', { ...base, name: 'Arroz sin oferta', category: 'Granos', discountPercent: 0, expirationDate: addDays(today, 90) }, near.token);
    await call('POST', '/api/products', { ...base, name: 'Huevos agotados', category: 'Huevos', discountPercent: 50, stock: 0, expirationDate: addDays(today, 5) }, near.token);
  };
  const names = (body: Record<string, any>) => (body.data as Array<{ name: string }>).map((item) => item.name);

  it('lists only discounted, available products, biggest discount first', async () => {
    await setup();
    const result = await call('POST', '/api/offers/search', {});
    assert.equal(result.status, 200);
    assert.deepEqual(names(result.body), ['Pan tajado', 'Queso campesino', 'Leche entera']);
  });

  it('filters by neighborhood and category', async () => {
    assert.deepEqual(names((await call('POST', '/api/offers/search', { neighborhood: 'suba' })).body), ['Pan tajado', 'Queso campesino']);
    assert.deepEqual(names((await call('POST', '/api/offers/search', { category: 'Lácteos' })).body), ['Queso campesino', 'Leche entera']);
    assert.deepEqual(names((await call('POST', '/api/offers/search', { search: 'queso' })).body), ['Queso campesino']);
  });

  it('sorts by expiration or by distance and filters by radius', async () => {
    assert.deepEqual(names((await call('POST', '/api/offers/search', { sort: 'expiring' })).body), ['Queso campesino', 'Pan tajado', 'Leche entera']);
    const nearest = await call('POST', '/api/offers/search', { sort: 'nearest', latitude: 4.6405, longitude: -74.064 });
    assert.equal(nearest.body.data[0].name, 'Leche entera');
    assert.ok(nearest.body.data[0].distanceKm < 0.2);
    const inRadius = await call('POST', '/api/offers/search', { latitude: 4.6405, longitude: -74.064, radiusKm: 2 });
    assert.deepEqual(names(inRadius.body), ['Leche entera']);
  });

  it('asks for a location to sort by distance', async () => {
    const result = await call('POST', '/api/offers/search', { sort: 'nearest' });
    assert.equal(result.status, 400);
    assert.match(result.body.message, /comparte tu ubicación/);
  });

  it('keeps an offer until the end of its expiration day and hides it the day after', async () => {
    const { token } = await registerStore('ofertas-borde', { storeName: 'Tienda Borde', neighborhood: 'Usaquén' });
    const fresh = await call('POST', '/api/products', { name: 'Yogur de hoy', category: 'Lácteos', price: 5000, stock: 3, discountPercent: 50, expirationDate: today }, token);
    const old = await call('POST', '/api/products', { name: 'Yogur de ayer', category: 'Lácteos', price: 5000, stock: 3, discountPercent: 50, expirationDate: today }, token);
    await context.pool.query('UPDATE products SET expiration_date = $2 WHERE id = $1', [old.body.data.id, addDays(today, -1)]);
    const result = await call('POST', '/api/offers/search', { neighborhood: 'Usaquén' });
    assert.deepEqual(names(result.body), ['Yogur de hoy']);
    assert.equal(result.body.data[0].offerPrice, 2500);
    assert.equal(result.body.data[0].productId, fresh.body.data.id);
  });
});
