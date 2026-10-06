import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { pool } from './database.js';

const migrationsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), 'migrations');

export const migrate = async (): Promise<void> => {
  const migrationPath = resolve(migrationsDirectory, '001_init.sql');
  const sql = await readFile(migrationPath, 'utf8');
  await pool.query(sql);
  console.info('Migración de PostgreSQL completada.');
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
