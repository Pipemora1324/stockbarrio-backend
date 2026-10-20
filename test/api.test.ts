import { integrationSkip, useTestApi } from './helpers/api.js';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { addDays, todayInBogota } from '../src/dates.js';

describe('API', { skip: integrationSkip }, () => {
  const context = useTestApi();
  const { call, registerStore } = context;

  const inTwoDays = addDays(todayInBogota(), 2);
  const product = { name: 'Leche entera 1 L', category: 'Lácteos', price: 4900, stock: 10, expirationDate: inTwoDays, discountPercent: 0 };

  it('does not reapply migrations that already ran', async () => {
    const { migrate } = await import('../src/migrate.js');
    assert.deepEqual(await migrate(), []);
  });

  const tablesWithoutRls = async () =>
    (await context.pool.query<{ relname: string }>(`SELECT relname FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND NOT relrowsecurity`)).rows.map((row) => row.relname);

  it('enables row level security on every table after migrating', async () => {
    assert.deepEqual(await tablesWithoutRls(), []);
  });

  it('enables row level security on tables created by future migrations', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'stockbarrio-migrations-'));
    try {
      await writeFile(join(directory, '999_future_table.sql'), 'CREATE TABLE future_table (id SERIAL PRIMARY KEY);');
      const { migrate } = await import('../src/migrate.js');
      assert.deepEqual(await migrate(directory), ['999_future_table.sql']);
      assert.deepEqual(await tablesWithoutRls(), []);
    } finally {
      await context.pool.query(`DROP TABLE IF EXISTS future_table; DELETE FROM schema_migrations WHERE name = '999_future_table.sql';`);
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rolls back a failing migration completely and does not record it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'stockbarrio-migrations-'));
    try {
      await writeFile(join(directory, '997_good.sql'), 'CREATE TABLE good_table (id SERIAL PRIMARY KEY);');
      await writeFile(join(directory, '998_broken.sql'), 'CREATE TABLE half_table (id SERIAL PRIMARY KEY); SELECT 1 / 0;');
      await writeFile(join(directory, '999_after.sql'), 'CREATE TABLE after_table (id SERIAL PRIMARY KEY);');
      await writeFile(join(directory, 'notas.sql'), 'SELECT 1 / 0;');
      await writeFile(join(directory, '12_bad_name.sql'), 'SELECT 1 / 0;');
      const { migrate, listMigrationFiles } = await import('../src/migrate.js');
      assert.deepEqual(await listMigrationFiles(directory), ['997_good.sql', '998_broken.sql', '999_after.sql'], 'only NNN_name.sql files, in order');
      await assert.rejects(migrate(directory), /Falló la migración 998_broken\.sql: /);
      const tables = await context.pool.query<{ name: string }>(`SELECT to_regclass('good_table')::text AS name UNION ALL SELECT to_regclass('half_table')::text UNION ALL SELECT to_regclass('after_table')::text`);
      assert.deepEqual(tables.rows.map((row) => row.name), ['good_table', null, null], 'earlier migrations stay, the broken one leaves nothing and later ones wait');
      const recorded = await context.pool.query<{ name: string }>(`SELECT name FROM schema_migrations WHERE name LIKE '99%' ORDER BY name`);
      assert.deepEqual(recorded.rows.map((row) => row.name), ['997_good.sql']);
    } finally {
      await context.pool.query(`DROP TABLE IF EXISTS good_table, half_table, after_table; DELETE FROM schema_migrations WHERE name LIKE '99%';`);
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('keeps every existing migration additive: no DROP, TRUNCATE or DELETE, with two documented exceptions', async () => {
    const { listMigrationFiles } = await import('../src/migrate.js');
    const { readFile } = await import('node:fs/promises');
    const directory = join(import.meta.dirname, '..', 'src', 'migrations');
    const files = await listMigrationFiles(directory);
    assert.ok(files.length >= 9);
    // 004 replaces the role CHECK with a wider one; 009 removes the UNIQUE of stores.user_id (several stores per seller).
    // Both only drop a constraint, never data, and the 009 one is explained in CAMBIOS.md.
    const allowedDrops: Record<string, string[]> = {
      '004_customer_role.sql': ['DROP CONSTRAINT %I'],
      '009_multi_store_offer_dates.sql': ['DROP CONSTRAINT %I'],
    };
    for (const file of files) {
      const sql = (await readFile(join(directory, file), 'utf8')).replace(/--.*$/gm, '');
      assert.doesNotMatch(sql, /\bTRUNCATE\b|\bDELETE\s+FROM\b/i, file);
      assert.deepEqual(sql.match(/\bDROP\b[^;']*/gi) ?? [], allowedDrops[file] ?? [], file);
    }
  });

  it('rejects a public registration without store data instead of creating an admin', async () => {
    const result = await call('POST', '/api/auth/register', { name: 'Colado', email: 'colado@stockbarrio.test', password: '12345678' });
    assert.equal(result.status, 400);
    assert.match(result.body.message, /El nombre de la tienda es obligatorio/);
    const admins = await context.pool.query(`SELECT 1 FROM users WHERE role = 'admin'`);
    assert.equal(admins.rowCount, 0);
  });

  it('registers a store with a token that carries no password hash', async () => {
    const { token, user } = await registerStore('uno');
    assert.equal(user.role, 'store');
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    assert.equal(payload.password_hash, undefined);
    assert.equal(payload.passwordHash, undefined);
    const me = await call('GET', '/api/auth/me', undefined, token);
    assert.equal(me.status, 200);
    assert.equal(me.body.user.storeId, user.storeId);
  });

  it('answers 401 for an invalid token', async () => {
    const result = await call('GET', '/api/auth/me', undefined, 'token-falso');
    assert.equal(result.status, 401);
  });

  it('lets a store manage only its own products', async () => {
    const owner = await registerStore('dos');
    const other = await registerStore('tres');
    const created = await call('POST', '/api/products', product, owner.token);
    assert.equal(created.status, 201);
    assert.equal(created.body.data.storeId, owner.user.storeId);
    assert.equal(created.body.data.expirationDate, inTwoDays);
    assert.equal(created.body.data.offerPrice, 4900);

    const id = created.body.data.id as string;
    assert.equal((await call('PUT', `/api/products/${id}`, { stock: 1 }, other.token)).status, 403);
    assert.equal((await call('DELETE', `/api/products/${id}`, undefined, other.token)).status, 403);

    const updated = await call('PUT', `/api/products/${id}`, { discountPercent: 20 }, owner.token);
    assert.equal(updated.status, 200);
    assert.equal(updated.body.data.offerPrice, 3920);
    assert.equal(updated.body.data.category, 'Lácteos');

    const mine = await call('GET', '/api/products/mine', undefined, owner.token);
    assert.equal(mine.body.data.length, 1);
    assert.equal((await call('DELETE', `/api/products/${id}`, undefined, owner.token)).status, 200);
    assert.equal((await call('DELETE', `/api/products/${id}`, undefined, owner.token)).status, 404);
  });

  it('keeps the old ISO date format working for older clients', async () => {
    const owner = await registerStore('cuatro');
    const later = addDays(todayInBogota(), 18);
    const created = await call('POST', '/api/products', { ...product, expirationDate: `${later}T00:00:00.000Z` }, owner.token);
    assert.equal(created.body.data.expirationDate, later);
  });

  it('forbids product writes for accounts that are not stores', async () => {
    await context.pool.query(`INSERT INTO users (name, email, password_hash, role) VALUES ('Admin', 'admin@stockbarrio.test', 'x', 'admin')`);
    const { createToken } = await import('../src/services/auth.js');
    const admin = await context.pool.query<{ id: string }>(`SELECT id FROM users WHERE email = 'admin@stockbarrio.test'`);
    const token = createToken({ id: admin.rows[0].id, name: 'Admin', email: 'admin@stockbarrio.test', role: 'admin' });
    assert.equal((await call('POST', '/api/products', product, token)).status, 403);
  });

  it('combines optional filters with the right placeholders', async () => {
    const owner = await registerStore('cinco');
    await call('POST', '/api/products', { ...product, name: 'Queso campesino', category: 'Lácteos' }, owner.token);
    await call('POST', '/api/products', { ...product, name: 'Queso crema', category: 'Despensa' }, owner.token);
    const result = await call('GET', '/api/products?category=l%C3%A1cteos&search=queso');
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.data.map((item: { name: string }) => item.name), ['Queso campesino']);
    const onlySearch = await call('GET', '/api/products?search=queso');
    assert.equal(onlySearch.body.data.length, 2);
  });

  it('returns Spanish validation messages and 400 for bad identifiers', async () => {
    const owner = await registerStore('seis');
    const invalid = await call('POST', '/api/products', { ...product, price: -1, expirationDate: '2026-02-30' }, owner.token);
    assert.equal(invalid.status, 400);
    assert.match(invalid.body.message, /El precio debe ser mayor que 0/);
    assert.match(invalid.body.message, /La fecha no es válida/);
    assert.equal((await call('GET', '/api/stores/no-es-un-uuid')).status, 400);
  });
});
