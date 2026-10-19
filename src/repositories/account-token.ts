import { createHash, randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { database } from '../database.js';

// 32 random bytes as URL-safe text: impossible to guess, and only its hash is saved.
export const generateAccountToken = () => randomBytes(32).toString('base64url');
export const hashAccountToken = (token: string) => createHash('sha256').update(token).digest('hex');

export const accountTokenRepository = {
  createPasswordReset: async (userId: string, tokenHash: string, ttlMinutes: number) =>
    database.withTransaction(async (client) => {
      // A new link replaces the previous ones.
      await client.query('UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND used_at IS NULL', [userId]);
      await client.query(`INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, now() + ($3 || ' minutes')::interval)`, [userId, tokenHash, String(ttlMinutes)]);
    }),
  // Marks the token as used in the same step that reads it, so it can only work once.
  consumePasswordReset: async (client: PoolClient, tokenHash: string) =>
    (
      await client.query<{ userId: string }>(
        `UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING user_id AS "userId"`,
        [tokenHash],
      )
    ).rows[0],
  invalidatePasswordResets: (client: PoolClient, userId: string) =>
    client.query('UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND used_at IS NULL', [userId]),
  createEmailChange: async (userId: string, newEmail: string, tokenHash: string, ttlMinutes: number) =>
    database.withTransaction(async (client) => {
      await client.query('UPDATE email_change_tokens SET used_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND used_at IS NULL', [userId]);
      await client.query(`INSERT INTO email_change_tokens (user_id, new_email, token_hash, expires_at) VALUES ($1, $2, $3, now() + ($4 || ' minutes')::interval)`, [userId, newEmail, tokenHash, String(ttlMinutes)]);
    }),
  consumeEmailChange: async (client: PoolClient, tokenHash: string) =>
    (
      await client.query<{ userId: string; newEmail: string }>(
        `UPDATE email_change_tokens SET used_at = CURRENT_TIMESTAMP WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING user_id AS "userId", new_email AS "newEmail"`,
        [tokenHash],
      )
    ).rows[0],
  pendingEmailChange: async (userId: string) =>
    (await database.query<{ newEmail: string }>('SELECT new_email AS "newEmail" FROM email_change_tokens WHERE user_id = $1 AND used_at IS NULL AND expires_at > now() ORDER BY created_at DESC LIMIT 1', [userId])).rows[0]?.newEmail ?? null,
};
