import { integrationSkip } from './helpers/api.js';
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { addDays, todayInBogota } from '../src/dates.js';

const migrationsDirectory = join(import.meta.dirname, '..', 'src', 'migrations');
const file = '010_deactivate_orphan_products.sql';

describe('migration 010 (products of deleted stores)', { skip: integrationSkip }, () => {
  let pool: typeof import('../src/database.js').pool;
  let previousDirectory: string;

  before(async () => {
    ({ pool } = await import('../src/database.js'));
    const { rows } = await pool.query<{ name: string }>('SELECT current_database() AS name');
    assert.match(rows[0].name, /_test$/);
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    previousDirectory = await mkdtemp(join(tmpdir(), 'migraciones-'));
    const { listMigrationFiles, migrate } = await import('../src/migrate.js');
    for (const name of (await listMigrationFiles(migrationsDirectory)).filter((item) => item < '010')) await copyFile(join(migrationsDirectory, name), join(previousDirectory, name));
    await migrate(previousDirectory);
  });

  after(async () => {
    await rm(previousDirectory, { recursive: true, force: true });
    await pool?.end();
  });

  it('deactivates only the products of inactive stores, deletes nothing and can run again', async () => {
    const user = await pool.query<{ id: string }>(`INSERT INTO users (name, email, password_hash, role) VALUES ('Ana', 'ana@stockbarrio.test', 'hash', 'store') RETURNING id`);
    const insertStore = async (name: string, active: boolean) =>
      (await pool.query<{ id: string }>('INSERT INTO stores (user_id, name, neighborhood, address, active) VALUES ($1, $2, $3, $4, $5) RETURNING id', [user.rows[0].id, name, 'Suba', 'Calle 1 # 2-3', active])).rows[0].id;
    const open = await insertStore('Abierta', true);
    const closed = await insertStore('Cerrada', false);
    const expiration = addDays(todayInBogota(), 5);
    for (const [storeId, name] of [[open, 'Vigente'], [closed, 'Huérfano'], [closed, 'Otro huérfano']])
      await pool.query('INSERT INTO products (store_id, name, price, offer_price, stock, expiration_date) VALUES ($1, $2, 1000, 1000, 3, $3)', [storeId, name, expiration]);

    const { migrate } = await import('../src/migrate.js');
    assert.deepEqual(await migrate(migrationsDirectory), [file]);
    const rows = await pool.query('SELECT name, active FROM products ORDER BY name');
    assert.deepEqual(rows.rows, [
      { name: 'Huérfano', active: false },
      { name: 'Otro huérfano', active: false },
      { name: 'Vigente', active: true },
    ]);
    // Running the same SQL again changes nothing.
    const again = await pool.query(await readFile(join(migrationsDirectory, file), 'utf8'));
    assert.equal(again.rowCount, 0);
  });

  it('is a single UPDATE without DELETE', async () => {
    const sql = (await readFile(join(migrationsDirectory, file), 'utf8')).replace(/--.*$/gm, '');
    assert.doesNotMatch(sql, /\bDELETE\b|\bDROP\b|\bTRUNCATE\b|\bALTER\b/i);
    assert.equal(sql.match(/\bUPDATE\b/gi)?.length, 1);
  });
});
