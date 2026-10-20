import { fileURLToPath } from 'node:url';
import type { PoolClient } from 'pg';
import { database, pool } from './database.js';
import { migrate } from './migrate.js';
import { hashPassword } from './services/auth.js';

// Manual script: creates or updates the administrator from ADMIN_EMAIL and ADMIN_PASSWORD. It never loads sample data,
// so it is the only one that may run against production. Usage: npm run admin:create
export const minAdminPasswordLength = 12;

export const upsertAdmin = async (client: PoolClient, email: string | undefined, password: string | undefined) => {
  const normalized = email?.trim().toLowerCase();
  if (!normalized || !password) throw new Error('Define ADMIN_EMAIL y ADMIN_PASSWORD para crear el administrador.');
  if (password.length < minAdminPasswordLength) throw new Error(`ADMIN_PASSWORD debe tener al menos ${minAdminPasswordLength} caracteres.`);
  const existing = await client.query<{ role: string }>('SELECT role FROM users WHERE lower(trim(email)) = $1', [normalized]);
  if (existing.rows[0] && existing.rows[0].role !== 'admin') throw new Error(`El correo ${normalized} ya pertenece a una cuenta que no es de administrador.`);
  const passwordHash = await hashPassword(password);
  if (existing.rows[0]) {
    await client.query('UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE lower(trim(email)) = $2', [passwordHash, normalized]);
    return 'updated' as const;
  }
  await client.query(`INSERT INTO users (name, email, password_hash, role) VALUES ('Administrador', $1, $2, 'admin')`, [normalized, passwordHash]);
  return 'created' as const;
};

export const createAdmin = async () => {
  await migrate();
  const email = process.env.ADMIN_EMAIL;
  const result = await database.withTransaction((client) => upsertAdmin(client, email, process.env.ADMIN_PASSWORD));
  console.info(`Administrador ${email?.trim().toLowerCase()} ${result === 'created' ? 'creado' : 'actualizado'}.`);
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createAdmin()
    .then(() => pool.end())
    .catch(async (error) => {
      console.error('No se pudo crear el administrador.', error instanceof Error ? error.message : error);
      await pool.end();
      process.exitCode = 1;
    });
}
