import { integrationSkip, useTestApi } from './helpers/api.js';
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { addDays, todayInBogota } from '../src/dates.js';

describe('stores, public products and errors API', { skip: integrationSkip }, () => {
  const context = useTestApi();
  const { call, registerStore } = context;
  const today = todayInBogota();
  let norte: Awaited<ReturnType<typeof registerStore>>;
  let sur: Awaited<ReturnType<typeof registerStore>>;

  before(async () => {
    norte = await registerStore('norte', { storeName: 'Tienda Doña Luz', neighborhood: 'Chapinero Alto' });
    sur = await registerStore('sur', { storeName: 'Fruver El Sur', neighborhood: 'Kennedy' });
  });

  const product = { name: 'Queso campesino', category: 'Lácteos', price: 9000, stock: 5, expirationDate: addDays(today, 3) };

  it('lists stores filtered by neighborhood or by name, ignoring letter case', async () => {
    const all = await call('GET', '/api/stores');
    assert.deepEqual(all.body.data.map((store: { name: string }) => store.name), ['Fruver El Sur', 'Tienda Doña Luz']);
    const byNeighborhood = await call('GET', '/api/stores?neighborhood=chapinero');
    assert.deepEqual(byNeighborhood.body.data.map((store: { name: string }) => store.name), ['Tienda Doña Luz']);
    const bySearch = await call('GET', '/api/stores?search=FRUVER');
    assert.deepEqual(bySearch.body.data.map((store: { name: string }) => store.name), ['Fruver El Sur']);
  });

  it('no longer has the routes the app stopped using', async () => {
    for (const path of ['/api/stores/neighborhoods', `/api/stores/${norte.user.storeId}`, `/api/products/store/${norte.user.storeId}`]) {
      const response = await call('GET', path);
      assert.equal(response.status, 404, path);
    }
    assert.equal((await call('GET', '/api/stores/me', undefined, norte.token)).status, 404);
    assert.equal((await call('POST', '/api/assistant/search', { message: 'leche' })).status, 404);
  });

  it('shows the store as text only: no coordinates and no location route', async () => {
    await context.pool.query('UPDATE stores SET latitude = 4.6486, longitude = -74.0628 WHERE id = $1', [norte.user.storeId]);
    const responses = [await call('GET', '/api/stores'), await call('GET', '/api/stores/mine', undefined, norte.token), await call('GET', '/api/products/mine', undefined, norte.token)];
    for (const response of responses) {
      assert.equal(response.status, 200);
      assert.doesNotMatch(JSON.stringify(response.body), /latitude|longitude|4\.6486/);
    }
    assert.deepEqual(Object.keys(responses[1].body.data[0]).sort(), ['active', 'address', 'createdAt', 'id', 'name', 'neighborhood', 'phone', 'productCount', 'userId']);
    const update = await call('PUT', '/api/stores/me', { latitude: 4.65, longitude: -74.06 }, norte.token);
    assert.equal(update.status, 404);
  });

  it('shows the active products of a store in the catalog, without the deleted ones', async () => {
    const kept = await call('POST', '/api/products', product, norte.token);
    const removed = await call('POST', '/api/products', { ...product, name: 'Yogur natural' }, norte.token);
    await call('POST', '/api/products', { ...product, name: 'Mango tommy', category: 'Frutas y verduras' }, sur.token);
    await call('DELETE', `/api/products/${removed.body.data.id}`, undefined, norte.token);

    const catalog = (await call('GET', '/api/products/catalog')).body.data as Array<{ store: { id: string }; products: Array<{ id: string }> }>;
    const norteGroup = catalog.find((group) => group.store.id === norte.user.storeId)!;
    assert.deepEqual(norteGroup.products.map((item) => item.id), [kept.body.data.id]);
    const mine = await call('GET', '/api/products/mine', undefined, norte.token);
    assert.ok(!mine.body.data.some((item: { id: string }) => item.id === removed.body.data.id), 'a deleted product is gone for its store too');
  });

  it('allows a past date and a legacy category when editing, but not when creating', async () => {
    assert.equal((await call('POST', '/api/products', { ...product, expirationDate: addDays(today, -1) }, norte.token)).status, 400);
    const created = await call('POST', '/api/products', { ...product, name: 'Kumis' }, norte.token);
    const id = created.body.data.id as string;
    await context.pool.query(`UPDATE products SET category = 'Comestibles' WHERE id = $1`, [id]);

    const fixed = await call('PUT', `/api/products/${id}`, { expirationDate: addDays(today, -1), category: 'Comestibles' }, norte.token);
    assert.equal(fixed.status, 200);
    assert.deepEqual([fixed.body.data.expirationDate, fixed.body.data.category], [addDays(today, -1), 'Comestibles']);

    const badCategory = await call('PUT', `/api/products/${id}`, { category: 'Inventada' }, norte.token);
    assert.equal(badCategory.status, 400);
    assert.match(badCategory.body.message, /Elige una categoría de la lista/);
    const mapped = await call('PUT', `/api/products/${id}`, { category: 'lacteos' }, norte.token);
    assert.equal(mapped.body.data.category, 'Lácteos');
  });

  it('keeps stock at zero valid and rejects negative or fractional stock', async () => {
    const empty = await call('POST', '/api/products', { ...product, name: 'Mantequilla', stock: 0 }, norte.token);
    assert.equal(empty.status, 201);
    assert.equal(empty.body.data.stock, 0);
    for (const stock of [-1, 2.5])
      assert.equal((await call('POST', '/api/products', { ...product, name: 'Mantequilla', stock }, norte.token)).status, 400, String(stock));
    assert.equal((await call('PUT', `/api/products/00000000-0000-4000-8000-000000000000`, { stock: 1 }, norte.token)).status, 404);
  });

  it('answers in Spanish for broken JSON, unknown routes and the health check', async () => {
    const response = await fetch(`${context.baseUrl}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"email": ' });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { message: 'El cuerpo de la petición no es un JSON válido.' });

    const missing = await call('GET', '/api/no-existe');
    assert.equal(missing.status, 404);
    assert.equal(missing.body.message, 'La ruta no existe.');

    const health = await call('GET', '/api/health');
    assert.equal(health.body.status, 'ok');
  });

  it('never leaks database details for a failing query', async () => {
    const original = context.pool.query.bind(context.pool);
    context.pool.query = (async () => {
      throw new Error('connection to server at "db.interno" failed: password authentication failed for user "postgres"');
    }) as typeof context.pool.query;
    const consoleError = console.error;
    console.error = () => {};
    try {
      const result = await call('GET', '/api/stores');
      assert.equal(result.status, 500);
      assert.deepEqual(result.body, { message: 'Ha ocurrido un error inesperado.' });
    } finally {
      context.pool.query = original;
      console.error = consoleError;
    }
  });
});

