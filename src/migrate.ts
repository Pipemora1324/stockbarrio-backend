import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { pool } from './database.js';

const migrationsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), 'migrations');
// Arbitrary constant so concurrent instances never run the same migration twice.
const migrationLockKey = 724_501;

export const listMigrationFiles = async (): Promise<string[]> =>
  (await readdir(migrationsDirectory)).filter((file) => /^\d{3}_[\w-]+\.sql$/.test(file)).sort();

export const migrate = async (): Promise<string[]> => {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name VARCHAR(200) PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  const applied: string[] = [];
  for (const file of await listMigrationFiles()) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)', [migrationLockKey]);
      const existing = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [file]);
      if (existing.rowCount) {
        await client.query('COMMIT');
        continue;
      }
      await client.query(await readFile(resolve(migrationsDirectory, file), 'utf8'));
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
