import { database } from '../database.js';

export interface UserRecord {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: 'admin' | 'store' | 'customer';
  storeId?: string;
  tokenVersion: number;
  createdAt: Date;
}

const userColumns = 'id, name, email, password_hash AS "passwordHash", role, store_id AS "storeId", token_version AS "tokenVersion", created_at AS "createdAt"';

export const userRepository = {
  // Ignores letter case and spaces, so accounts saved before emails were normalized are still found.
  getByEmail: async (email: string) =>
    (await database.query<UserRecord>(`SELECT ${userColumns} FROM users WHERE lower(trim(email)) = $1 ORDER BY created_at LIMIT 1`, [email.trim().toLowerCase()])).rows[0],
  getById: async (id: string) => (await database.query<UserRecord>(`SELECT ${userColumns} FROM users WHERE id = $1`, [id])).rows[0],
  create: async (user: Omit<UserRecord, 'id' | 'createdAt' | 'tokenVersion'>) => {
    const id = crypto.randomUUID();
    const result = await database.query<UserRecord>(
      `INSERT INTO users (id, name, email, password_hash, role, store_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${userColumns}`,
      [id, user.name, user.email.toLowerCase(), user.passwordHash, user.role, user.storeId],
    );
    return result.rows[0];
  },
  getTokenVersion: async (id: string) =>
    (await database.query<{ tokenVersion: number }>('SELECT token_version AS "tokenVersion" FROM users WHERE id = $1', [id])).rows[0]?.tokenVersion,
  updateName: async (id: string, name: string) => (await database.query<UserRecord>(`UPDATE users SET name = $2 WHERE id = $1 RETURNING ${userColumns}`, [id, name])).rows[0],
  // Changing the password bumps the token version, which closes every other open session.
  updatePassword: async (id: string, passwordHash: string) =>
    (await database.query<UserRecord>(`UPDATE users SET password_hash = $2, token_version = token_version + 1 WHERE id = $1 RETURNING ${userColumns}`, [id, passwordHash])).rows[0],
  updateEmail: async (id: string, email: string) =>
    (await database.query<UserRecord>(`UPDATE users SET email = $2, token_version = token_version + 1 WHERE id = $1 RETURNING ${userColumns}`, [id, email.toLowerCase()])).rows[0],
};
