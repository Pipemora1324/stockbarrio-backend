import { integrationSkip, useTestApi } from './helpers/api.js';
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { addDays, todayInBogota } from '../src/dates.js';
import { maxStoresPerUser } from '../src/repositories/store.js';

describe('several stores per seller', { skip: integrationSkip }, () => {
  const context = useTestApi();
  const { call, registerStore } = context;
  const today = todayInBogota();
  const product = { name: 'Queso campesino', category: 'Lácteos', price: 9000, stock: 5, expirationDate: addDays(today, 10) };
  let owner: Awaited<ReturnType<typeof registerStore>>;
  let other: Awaited<ReturnType<typeof registerStore>>;
  let secondId: string;

  before(async () => {
    owner = await registerStore('varios', { storeName: 'Local Uno', neighborhood: 'Chapinero' });
    other = await registerStore('ajeno', { storeName: 'Tienda Ajena', neighborhood: 'Suba' });
  });

  const names = (body: Record<string, any>) => (body.data as Array<{ name: string }>).map((item) => item.name);

  it('creates a second store and lists both, the main one first', async () => {
    const created = await call('POST', '/api/stores', { name: 'Local Dos', neighborhood: 'Teusaquillo', address: 'Calle 45 # 16-20', phone: '310 123 4567' }, owner.token);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.message, 'El local se creó correctamente.');
    assert.equal(created.body.data.phone, '3101234567');
    secondId = created.body.data.id;
    const mine = await call('GET', '/api/stores/mine', undefined, owner.token);
    assert.deepEqual(names(mine.body), ['Local Uno', 'Local Dos']);
    assert.equal(mine.body.max, maxStoresPerUser);
    // The old store id in the account stays the main one.
    assert.equal(mine.body.data[0].id, owner.user.storeId);
  });

  it('validates the store data with the same rules as the sign up', async () => {
    const invalid = await call('POST', '/api/stores', { name: '!!', neighborhood: 'X', address: 'Cl', phone: '123' }, owner.token);
    assert.equal(invalid.status, 400);
    assert.match(invalid.body.message, /nombre de la tienda/);
    const taken = await call('POST', '/api/stores', { name: 'tienda ajena', neighborhood: 'suba', address: 'Calle 1 # 2-3' }, owner.token);
    assert.equal(taken.status, 409);
    assert.equal(taken.body.message, 'Ya existe una tienda con este nombre en ese barrio.');
  });

  it('saves and lists products of the store chosen with storeId', async () => {
    const inSecond = await call('POST', '/api/products', { ...product, name: 'Yogur natural', storeId: secondId }, owner.token);
    assert.equal(inSecond.status, 201);
    assert.equal(inSecond.body.data.storeId, secondId);
    const inMain = await call('POST', '/api/products', product, owner.token);
    assert.equal(inMain.body.data.storeId, owner.user.storeId, 'without storeId the main store is used, like older clients expect');

    const second = await call('GET', `/api/products/mine?storeId=${secondId}`, undefined, owner.token);
    assert.deepEqual(names(second.body), ['Yogur natural']);
    assert.equal(second.body.store.id, secondId);
    assert.equal(second.body.stores.length, 2);
    const main = await call('GET', '/api/products/mine', undefined, owner.token);
    assert.deepEqual(names(main.body), ['Queso campesino']);
    assert.equal(main.body.store.name, 'Local Uno');
  });

  it('answers 403 when the store or the product belongs to another seller', async () => {
    const theirs = other.user.storeId;
    assert.equal((await call('GET', `/api/products/mine?storeId=${theirs}`, undefined, owner.token)).status, 403);
    const create = await call('POST', '/api/products', { ...product, storeId: theirs }, owner.token);
    assert.equal(create.status, 403);
    assert.equal(create.body.message, 'Este local no pertenece a tu cuenta.');
    assert.equal((await call('GET', '/api/products/mine?storeId=no-es-un-id', undefined, owner.token)).status, 400);
    assert.equal((await call('GET', `/api/suggestions?storeId=${theirs}`, undefined, owner.token)).status, 403);

    const foreign = await call('POST', '/api/products', { ...product, name: 'Pan ajeno', category: 'Panadería' }, other.token);
    assert.equal((await call('PUT', `/api/products/${foreign.body.data.id}`, { stock: 1 }, owner.token)).status, 403);
    assert.equal((await call('DELETE', `/api/products/${foreign.body.data.id}`, undefined, owner.token)).status, 403);

    assert.equal((await call('PATCH', `/api/stores/${theirs}`, { name: 'Robada' }, owner.token)).status, 403);
    assert.equal((await call('DELETE', `/api/stores/${theirs}`, undefined, owner.token)).status, 403);
    assert.equal((await call('PATCH', '/api/stores/00000000-0000-4000-8000-000000000000', { name: 'Nada' }, owner.token)).status, 404);
  });

  it('edits a product of any of its stores, whatever store is selected', async () => {
    const [yogurt] = (await call('GET', `/api/products/mine?storeId=${secondId}`, undefined, owner.token)).body.data;
    const edited = await call('PUT', `/api/products/${yogurt.id}`, { stock: 9 }, owner.token);
    assert.equal(edited.status, 200);
    assert.equal(edited.body.data.stock, 9);
  });

  it('renames a store and keeps the name unique in its neighborhood', async () => {
    const renamed = await call('PATCH', `/api/stores/${secondId}`, { name: 'Local Dos Express' }, owner.token);
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.data.name, 'Local Dos Express');
    assert.equal((await call('PATCH', `/api/stores/${secondId}`, {}, owner.token)).status, 400);
    const clash = await call('PATCH', `/api/stores/${secondId}`, { name: 'Tienda Ajena', neighborhood: 'Suba' }, owner.token);
    assert.equal(clash.status, 409);
  });

  it('is only for store accounts', async () => {
    const customer = await call('POST', '/api/auth/register', { accountType: 'customer', name: 'Ana Cliente', email: 'ana.varios@stockbarrio.test', password: 'cliente12345' });
    assert.equal((await call('GET', '/api/stores/mine', undefined, customer.body.token)).status, 403);
    assert.equal((await call('POST', '/api/stores', { name: 'Mi tienda', neighborhood: 'Usme', address: 'Calle 1 # 2-3' }, customer.body.token)).status, 403);
    assert.equal((await call('GET', '/api/stores/mine')).status, 401);
  });

  it('deletes a store softly: it disappears for customers and its owner, but no row is erased', async () => {
    const removed = await call('DELETE', `/api/stores/${secondId}`, undefined, owner.token);
    assert.equal(removed.status, 200);
    assert.equal(removed.body.message, 'Se eliminó el local «Local Dos Express».');
    assert.deepEqual(names((await call('GET', '/api/stores/mine', undefined, owner.token)).body), ['Local Uno']);
    assert.ok(!names((await call('GET', '/api/stores')).body).includes('Local Dos Express'));
    assert.equal((await call('GET', `/api/products/mine?storeId=${secondId}`, undefined, owner.token)).status, 403);
    const rows = await context.pool.query('SELECT active FROM stores WHERE id = $1', [secondId]);
    assert.deepEqual(rows.rows, [{ active: false }]);
    const products = await context.pool.query('SELECT active FROM products WHERE store_id = $1', [secondId]);
    assert.deepEqual(products.rows, [{ active: false }], 'the product row stays, deactivated');
  });

  it('deactivates every product of a deleted store and hides them from every public query', async () => {
    const seller = await registerStore('borra-productos', { storeName: 'Sede Vieja', neighborhood: 'Engativá' });
    const second = (await call('POST', '/api/stores', { name: 'Sede Que Se Va', neighborhood: 'Engativá', address: 'Calle 8 # 7-6' }, seller.token)).body.data.id as string;
    const base = { category: 'Lácteos', price: 8000, stock: 9, expirationDate: addDays(today, 2), storeId: second };
    const offer = (await call('POST', '/api/products', { ...base, name: 'Kumis que se va', discountPercent: 30 }, seller.token)).body.data;
    const plain = (await call('POST', '/api/products', { ...base, name: 'Queso que se va' }, seller.token)).body.data;
    // Visible before deleting the store.
    assert.ok((await call('POST', '/api/offers/search', {})).body.data.some((item: { name: string }) => item.name === 'Kumis que se va'));

    assert.equal((await call('DELETE', `/api/stores/${second}`, undefined, seller.token)).status, 200);
    const rows = await context.pool.query('SELECT name, active FROM products WHERE store_id = $1 ORDER BY name', [second]);
    assert.deepEqual(rows.rows, [
      { name: 'Kumis que se va', active: false },
      { name: 'Queso que se va', active: false },
    ]);
    const names = (items: Array<{ name: string }>) => items.map((item) => item.name);
    const gone = (list: string[]) => !list.some((name) => name.endsWith('que se va'));
    assert.ok(gone(names((await call('POST', '/api/offers/search', {})).body.data)), 'ofertas');
    const catalog = (await call('GET', '/api/products/catalog')).body.data as Array<{ products: Array<{ name: string }> }>;
    assert.ok(gone(catalog.flatMap((group) => names(group.products))), 'catálogo agrupado');
    const chat = await call('POST', '/api/assistant/chat', { messages: [{ role: 'user', content: 'kumis' }] });
    assert.ok(gone(names(chat.body.data.results)), 'chat');
    const home = (await call('GET', '/api/stores')).body.data as Array<{ id: string }>;
    assert.ok(!home.some((store) => store.id === second), 'inicio');
    // Nor can its owner edit them, and they never come back as suggestions.
    assert.equal((await call('PUT', `/api/products/${offer.id}`, { stock: 1 }, seller.token)).status, 404);
    assert.equal((await call('DELETE', `/api/products/${plain.id}`, undefined, seller.token)).status, 404);
    const suggestions = await call('GET', '/api/suggestions', undefined, seller.token);
    assert.ok(gone(suggestions.body.data.map((item: { productName: string }) => item.productName)), 'sugerencias');
  });

  it('moves the main store when it is deleted, and works with no stores at all', async () => {
    const seller = await registerStore('sin-locales', { storeName: 'Primer Local', neighborhood: 'Bosa' });
    const extra = await call('POST', '/api/stores', { name: 'Segundo Local', neighborhood: 'Bosa', address: 'Calle 2 # 3-4' }, seller.token);
    await call('DELETE', `/api/stores/${seller.user.storeId}`, undefined, seller.token);
    const account = await context.pool.query('SELECT store_id AS "storeId" FROM users WHERE id = $1', [seller.user.id]);
    assert.equal(account.rows[0].storeId, extra.body.data.id);
    assert.equal((await call('GET', '/api/stores/mine', undefined, seller.token)).body.data[0].name, 'Segundo Local');

    await call('DELETE', `/api/stores/${extra.body.data.id}`, undefined, seller.token);
    assert.deepEqual((await call('GET', '/api/stores/mine', undefined, seller.token)).body.data, []);
    const inventory = await call('GET', '/api/products/mine', undefined, seller.token);
    assert.equal(inventory.status, 403);
    assert.equal(inventory.body.message, 'Tu cuenta no tiene una tienda asociada. Crea un local para empezar.');

    const again = await call('POST', '/api/stores', { name: 'Local Nuevo', neighborhood: 'Bosa', address: 'Calle 3 # 4-5' }, seller.token);
    assert.equal(again.status, 201);
    const main = await context.pool.query('SELECT store_id AS "storeId" FROM users WHERE id = $1', [seller.user.id]);
    assert.equal(main.rows[0].storeId, again.body.data.id, 'the first store after having none becomes the main one');
    // A deleted store's name can be used again.
    assert.equal((await call('POST', '/api/stores', { name: 'Primer Local', neighborhood: 'Bosa', address: 'Calle 1 # 2-3' }, seller.token)).status, 201);
  });

  it(`allows at most ${maxStoresPerUser} stores per seller`, async () => {
    const seller = await registerStore('muchos', { storeName: 'Local 1', neighborhood: 'Usme' });
    for (let index = 2; index <= maxStoresPerUser; index++) {
      const created = await call('POST', '/api/stores', { name: `Local ${index}`, neighborhood: 'Usme', address: 'Calle 1 # 2-3' }, seller.token);
      assert.equal(created.status, 201);
    }
    const tooMany = await call('POST', '/api/stores', { name: 'Local de más', neighborhood: 'Usme', address: 'Calle 1 # 2-3' }, seller.token);
    assert.equal(tooMany.status, 409);
    assert.equal(tooMany.body.message, `Puedes tener como máximo ${maxStoresPerUser} locales.`);
  });

  it('keeps suggestions separate for each store', async () => {
    const seller = await registerStore('sug-locales', { storeName: 'Sede Norte', neighborhood: 'Usaquén' });
    const south = (await call('POST', '/api/stores', { name: 'Sede Sur', neighborhood: 'Kennedy', address: 'Calle 9 # 8-7' }, seller.token)).body.data.id;
    await call('POST', '/api/products', { name: 'Leche norte', category: 'Lácteos', price: 5000, stock: 5, expirationDate: addDays(today, 1) }, seller.token);
    await call('POST', '/api/products', { name: 'Leche sur', category: 'Lácteos', price: 5000, stock: 5, expirationDate: addDays(today, 1), storeId: south }, seller.token);
    const north = await call('GET', '/api/suggestions', undefined, seller.token);
    assert.deepEqual(north.body.data.map((item: { productName: string }) => item.productName), ['Leche norte']);
    const southSuggestions = await call('GET', `/api/suggestions?storeId=${south}`, undefined, seller.token);
    assert.deepEqual(southSuggestions.body.data.map((item: { productName: string }) => item.productName), ['Leche sur']);
    // Approving needs the store of the suggestion.
    assert.equal((await call('POST', `/api/suggestions/${southSuggestions.body.data[0].id}/approve`, {}, seller.token)).status, 404);
    assert.equal((await call('POST', `/api/suggestions/${southSuggestions.body.data[0].id}/approve?storeId=${south}`, {}, seller.token)).status, 200);
  });
});
