import { integrationSkip, useTestApi } from './helpers/api.js';
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { addDays, todayInBogota } from '../src/dates.js';

describe('combo recommendations API', { skip: integrationSkip }, () => {
  const context = useTestApi();
  const { call, registerStore } = context;
  const today = todayInBogota();
  const ids: Record<string, string> = {};

  before(async () => {
    const chapinero = await registerStore('combo-norte');
    const kennedy = await registerStore('combo-sur', { neighborhood: 'Kennedy' });
    const add = async (token: string, key: string, product: Record<string, unknown>) => {
      const created = await call('POST', '/api/products', { category: 'Despensa', stock: 10, expirationDate: addDays(today, 5), discountPercent: 0, ...product }, token);
      assert.equal(created.status, 201, JSON.stringify(created.body));
      ids[key] = created.body.data.id;
    };
    await add(chapinero.token, 'leche', { name: 'Leche entera', category: 'Lácteos', price: 5000, discountPercent: 20, expirationDate: addDays(today, 1) });
    await add(chapinero.token, 'arroz', { name: 'Arroz 1 kg', price: 4000 });
    await add(chapinero.token, 'agotado', { name: 'Aceite', price: 1000, stock: 0, expirationDate: today });
    await add(kennedy.token, 'pan', { name: 'Pan tajado', price: 3000, expirationDate: today });
  });

  const recommend = (body: Record<string, unknown>) => call('POST', '/api/recommendations', body);

  it('builds a combo from the products of the chosen neighborhood only, the closest to expire first', async () => {
    const result = await recommend({ budget: 30000, neighborhood: 'chapinero' });
    assert.equal(result.status, 200);
    const combo = result.body.data;
    assert.deepEqual(combo.products.map((item: { name: string }) => item.name), ['Leche entera', 'Arroz 1 kg']);
    assert.deepEqual(combo.products.map((item: { quantity: number }) => item.quantity), [3, 3]);
    assert.equal(combo.total, 3 * 4000 + 3 * 4000);
    assert.equal(combo.savings, 3 * 1000);
    assert.ok(combo.total <= 30000);
  });

  it('uses only the selected products and ignores ids from other neighborhoods', async () => {
    const result = await recommend({ budget: 30000, neighborhood: 'Chapinero', productIds: [ids.arroz, ids.pan, ids.agotado] });
    assert.deepEqual(result.body.data.products.map((item: { productId: string }) => item.productId), [ids.arroz]);
  });

  it('explains when the budget is too small', async () => {
    const result = await recommend({ budget: 1000, neighborhood: 'Chapinero' });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.data.products, []);
    assert.match(result.body.data.suggestion, /No hay productos suficientes/);
  });

  it('rejects an empty or negative budget, bad ids and a missing neighborhood', async () => {
    for (const body of [
      { budget: 0, neighborhood: 'Chapinero' },
      { budget: -5000, neighborhood: 'Chapinero' },
      { budget: 'mucho', neighborhood: 'Chapinero' },
      { budget: 20000 },
      { budget: 20000, neighborhood: 'Chapinero', productIds: ['no-es-un-id'] },
      { budget: 20000, neighborhood: 'Chapinero', productIds: Array.from({ length: 31 }, () => ids.arroz) },
    ])
      assert.equal((await recommend(body)).status, 400, JSON.stringify(body));
  });
});
