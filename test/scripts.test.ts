import { integrationSkip, useTestApi } from './helpers/api.js';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { minAdminPasswordLength, upsertAdmin } from '../src/create-admin.js';
import { assertDevelopmentOnly } from '../src/seed-dev.js';

describe('seed:dev', () => {
  it('refuses to run with NODE_ENV=production, with no way around it', () => {
    assert.throws(() => assertDevelopmentOnly('production'), /solo es para desarrollo local y pruebas: no se ejecuta con NODE_ENV=production/);
    assert.doesNotThrow(() => assertDevelopmentOnly('development'));
    assert.doesNotThrow(() => assertDevelopmentOnly('test'));
  });
});

describe('admin:create and seed:dev on the test database', { skip: integrationSkip }, () => {
  const context = useTestApi();

  const run = (email: string | undefined, password: string | undefined) => context.pool.connect().then(async (client) => {
    try {
      return await upsertAdmin(client, email, password);
    } finally {
      client.release();
    }
  });

  it('needs both variables and a long password', async () => {
    await assert.rejects(run(undefined, 'clave-larga-de-admin'), /Define ADMIN_EMAIL y ADMIN_PASSWORD/);
    await assert.rejects(run('admin@stockbarrio.test', 'corta'), new RegExp(`al menos ${minAdminPasswordLength} caracteres`));
  });

  it('creates the administrator once and then only updates its password', async () => {
    assert.equal(await run(' Admin@StockBarrio.test ', 'clave-larga-de-admin'), 'created');
    assert.equal(await run('admin@stockbarrio.test', 'otra-clave-larga-1'), 'updated');
    const admins = await context.pool.query(`SELECT email, token_version AS "tokenVersion" FROM users WHERE role = 'admin'`);
    assert.deepEqual(admins.rows, [{ email: 'admin@stockbarrio.test', tokenVersion: 1 }]);
    const login = await context.call('POST', '/api/auth/login', { email: 'admin@stockbarrio.test', password: 'otra-clave-larga-1' });
    assert.equal(login.status, 200);
    assert.equal(login.body.user.role, 'admin');
  });

  it('never turns a store or customer account into an administrator', async () => {
    const store = await context.registerStore('no-admin');
    const email = `tienda-no-admin@stockbarrio.test`;
    await assert.rejects(run(email, 'clave-larga-de-admin'), /no es de administrador/);
    const role = await context.pool.query('SELECT role FROM users WHERE id = $1', [store.user.id]);
    assert.equal(role.rows[0].role, 'store');
  });

  it('creates no stores or products: production starts empty', async () => {
    const counts = await context.pool.query(`SELECT (SELECT count(*)::int FROM products) AS products`);
    assert.equal(counts.rows[0].products, 0);
  });

  it('runs as a script with the variables of the environment', async () => {
    const { createAdmin } = await import('../src/create-admin.js');
    Object.assign(process.env, { ADMIN_EMAIL: 'script@stockbarrio.test', ADMIN_PASSWORD: 'clave-del-script-1' });
    const info = console.info;
    const printed: string[] = [];
    console.info = (message: string) => printed.push(message);
    try {
      await createAdmin();
    } finally {
      console.info = info;
      delete process.env.ADMIN_EMAIL;
      delete process.env.ADMIN_PASSWORD;
    }
    assert.ok(printed.includes('Administrador script@stockbarrio.test creado.'), printed.join('\n'));
  });

  it('seed:dev loads sample stores, a seller with two stores and offers with a date range, and can run twice', async () => {
    const { seed } = await import('../src/seed-dev.js');
    const info = console.info;
    console.info = () => {};
    try {
      await seed();
      await seed();
    } finally {
      console.info = info;
    }
    const stores = await context.pool.query(`SELECT u.email, count(s.id)::int AS stores FROM users u JOIN stores s ON s.user_id = u.id GROUP BY u.email ORDER BY u.email`);
    assert.ok(stores.rows.length >= 5);
    assert.equal(stores.rows.find((row) => row.email === 'tienda.donaluz@stockbarrio.test').stores, 2);
    const offers = await context.pool.query(`SELECT count(*)::int AS missing FROM products WHERE discount_percent > 0 AND (offer_starts_on IS NULL OR offer_ends_on IS NULL OR offer_ends_on > expiration_date)`);
    assert.equal(offers.rows[0].missing, 0, 'every sample offer has a valid range');
    const scheduled = await context.call('GET', '/api/products/mine', undefined, (await context.call('POST', '/api/auth/login', { email: 'tienda.donaluz@stockbarrio.test', password: 'tienda12345' })).body.token);
    assert.equal(scheduled.body.stores.length, 2);
    const duplicates = await context.pool.query(`SELECT name, store_id, count(*) FROM products GROUP BY name, store_id HAVING count(*) > 1`);
    assert.equal(duplicates.rowCount, 0, 'the second run adds nothing');
  });
});
