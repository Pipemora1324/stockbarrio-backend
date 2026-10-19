import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { PoolClient } from 'pg';
import { pool } from './database.js';

const migrationsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), 'migrations');
// Arbitrary constant so concurrent instances never run the same migration twice.
const migrationLockKey = 724_501;

export const listMigrationFiles = async (directory = migrationsDirectory): Promise<string[]> =>
  (await readdir(directory)).filter((file) => /^\d{3}_[\w-]+\.sql$/.test(file)).sort();

const listPublicTables = async (client: PoolClient): Promise<Set<string>> => {
  const result = await client.query<{ name: string }>(`SELECT relname AS name FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r', 'p')`);
  return new Set(result.rows.map((row) => row.name));
};

// Every table created by a migration gets row level security (without policies) in the same transaction.
const enableRlsOnNewTables = async (client: PoolClient, before: Set<string>): Promise<string[]> => {
  const created = [...(await listPublicTables(client))].filter((table) => !before.has(table));
  for (const table of created) await client.query(`ALTER TABLE public.${client.escapeIdentifier(table)} ENABLE ROW LEVEL SECURITY`);
  return created;
};

export const migrate = async (directory = migrationsDirectory): Promise<string[]> => {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name VARCHAR(200) PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;`);
  const applied: string[] = [];
  for (const file of await listMigrationFiles(directory)) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)', [migrationLockKey]);
      const existing = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [file]);
      if (existing.rowCount) {
        await client.query('COMMIT');
        continue;
      }
      const tablesBefore = await listPublicTables(client);
      await client.query(await readFile(resolve(directory, file), 'utf8'));
      await enableRlsOnNewTables(client, tablesBefore);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      applied.push(file);
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`Falló la migración ${file}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      client.release();
    }
  }
  console.info(applied.length ? `Migraciones aplicadas: ${applied.join(', ')}.` : 'La base de datos ya está al día.');
  return applied;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  migrate()
    .then(() => pool.end())
    .catch(async (error) => {
      console.error('No se pudo ejecutar la migración.', error);
      await pool.end();
      process.exitCode = 1;
    });
}
