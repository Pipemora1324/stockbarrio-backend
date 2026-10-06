import { database } from '../database.js';

export interface UserRecord {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: 'admin' | 'store';
  storeId?: string;
  createdAt: Date;
}

const userColumns = 'id, name, email, password_hash AS "passwordHash", role, store_id AS "storeId", created_at AS "createdAt"';

export const userRepository = {
  getByEmail: async (email: string) => (await database.query<UserRecord>(`SELECT ${userColumns} FROM users WHERE email = $1`, [email.toLowerCase()])).rows[0],
  getById: async (id: string) => (await database.query<UserRecord>(`SELECT ${userColumns} FROM users WHERE id = $1`, [id])).rows[0],
  create: async (user: Omit<UserRecord, 'id' | 'createdAt'>) => {
    const id = crypto.randomUUID();
    const result = await database.query<UserRecord>(
      `INSERT INTO users (id, name, email, password_hash, role, store_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${userColumns}`,
      [id, user.name, user.email.toLowerCase(), user.passwordHash, user.role, user.storeId],
    );
    return result.rows[0];
  },
};
