import { integrationSkip } from './helpers/api.js';
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { addDays, todayInBogota } from '../src/dates.js';

const migrationsDirectory = join(import.meta.dirname, '..', 'src', 'migrations');

describe('migration 009 (several stores and offer dates)', { skip: integrationSkip }, () => {
  let pool: typeof import('../src/database.js').pool;
  let previousDirectory: string;
  const today = todayInBogota();

  before(async () => {
    ({ pool } = await import('../src/database.js'));
    const { rows } = await pool.query<{ name: string }>('SELECT current_database() AS name');
    assert.match(rows[0].name, /_test$/);
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    // La base como la tiene producción hoy: todas las migraciones anteriores a la 009.
    previousDirectory = await mkdtemp(join(tmpdir(), 'migraciones-'));
    const { listMigrationFiles, migrate } = await import('../src/migrate.js');
    for (const file of (await listMigrationFiles(migrationsDirectory)).filter((name) => name < '009')) await copyFile(join(migrationsDirectory, file), join(previousDirectory, file));
    await migrate(previousDirectory);
  });

  after(async () => {
    await rm(previousDirectory, { recursive: true, force: true });
    await pool?.end();
  });

  it('keeps every row and value, and gives the existing offers a range so they keep showing', async () => {
    const user = await pool.query<{ id: string }>(`INSERT INTO users (name, email, password_hash, role, auth_id) VALUES ('Ana', 'ana@stockbarrio.test', 'hash', 'store', gen_random_uuid()) RETURNING id`);
    const store = await pool.query<{ id: string }>(`INSERT INTO stores (user_id, name, neighborhood, address, phone) VALUES ($1, 'Tienda Ana', 'Suba', 'Calle 1 # 2-3', '3001234567') RETURNING id`, [user.rows[0].id]);
    await pool.query('UPDATE users SET store_id = $1 WHERE id = $2', [store.rows[0].id, user.rows[0].id]);
    // Antes de la 009 era imposible un segundo local para el mismo usuario.
    await assert.rejects(pool.query(`INSERT INTO stores (user_id, name, neighborhood, address) VALUES ($1, 'Otra', 'Suba', 'Calle 2')`, [user.rows[0].id]), { code: '23505' });
    const expiration = addDays(today, 5);
    await pool.query(
      `INSERT INTO products (store_id, name, price, offer_price, stock, expiration_date, discount_percent, created_at) VALUES
       ($1, 'Con oferta', 10000, 8000, 3, $2, 20, now() - interval '2 days'), ($1, 'Sin oferta', 5000, 5000, 9, $2, 0, now())`,
      [store.rows[0].id, expiration],
    );
    const before = await pool.query(`SELECT (SELECT count(*) FROM users) AS users, (SELECT count(*) FROM stores) AS stores, (SELECT count(*) FROM products) AS products`);

    const { migrate } = await import('../src/migrate.js');
    assert.equal((await migrate(migrationsDirectory))[0], '009_multi_store_offer_dates.sql');

    const afterCounts = await pool.query(`SELECT (SELECT count(*) FROM users) AS users, (SELECT count(*) FROM stores) AS stores, (SELECT count(*) FROM products) AS products`);
    assert.deepEqual(afterCounts.rows, before.rows);
    const account = await pool.query('SELECT store_id AS "storeId", auth_id IS NOT NULL AS linked FROM users WHERE id = $1', [user.rows[0].id]);
    assert.deepEqual(account.rows, [{ storeId: store.rows[0].id, linked: true }]);
    const products = await pool.query(
      `SELECT name, price, offer_price AS "offerPrice", discount_percent AS "discountPercent", offer_starts_on AS "startsOn", offer_ends_on AS "endsOn"
       FROM products ORDER BY name`,
    );
    assert.deepEqual(products.rows, [
      { name: 'Con oferta', price: 10000, offerPrice: 8000, discountPercent: 20, startsOn: addDays(today, -2), endsOn: expiration },
      { name: 'Sin oferta', price: 5000, offerPrice: 5000, discountPercent: 0, startsOn: null, endsOn: null },
    ]);
  });

  it('lets a user have a second store and rejects a backwards range in the database too', async () => {
    const { rows } = await pool.query<{ id: string }>('SELECT id FROM users LIMIT 1');
    await pool.query(`INSERT INTO stores (user_id, name, neighborhood, address) VALUES ($1, 'Segundo local', 'Suba', 'Calle 2 # 3-4')`, [rows[0].id]);
    const count = await pool.query('SELECT count(*)::int AS count FROM stores WHERE user_id = $1', [rows[0].id]);
    assert.equal(count.rows[0].count, 2);
    await assert.rejects(pool.query(`UPDATE products SET offer_starts_on = $1, offer_ends_on = $2 WHERE name = 'Con oferta'`, [today, addDays(today, -1)]), /products_offer_range_check/);
  });

  it('keeps row level security on and only drops the unique constraint of stores.user_id', async () => {
    const rls = await pool.query(`SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('users', 'stores', 'products') ORDER BY relname`);
    assert.ok(rls.rows.every((row) => row.relrowsecurity), JSON.stringify(rls.rows));
    const sql = (await readFile(join(migrationsDirectory, '009_multi_store_offer_dates.sql'), 'utf8')).replace(/--.*$/gm, '');
    assert.deepEqual(sql.match(/\bDROP\b[^;']*/gi), ['DROP CONSTRAINT %I']);
    assert.match(sql, /conrelid = 'stores'::regclass AND c\.contype = 'u'/);
    const index = await pool.query(`SELECT 1 FROM pg_indexes WHERE tablename = 'stores' AND indexname = 'idx_stores_user'`);
    assert.equal(index.rowCount, 1);
  });
});
