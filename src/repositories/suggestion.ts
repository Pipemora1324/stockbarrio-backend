import type { PoolClient } from 'pg';
import { database } from '../database.js';

export type SuggestionStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export interface SuggestionRecord {
  id: string;
  productId: string;
  storeId: string;
  productName: string;
  category: string;
  price: number;
  stock: number;
  expirationDate: string;
  currentPercent: number;
  suggestedPercent: number;
  suggestedPrice: number;
  daysToExpire: number;
  reason: string;
  priority: number;
  source: 'local' | 'ai';
  status: SuggestionStatus;
  createdAt: Date;
  decidedAt: Date | null;
}

export interface SuggestionValues {
  productId: string;
  currentPercent: number;
  suggestedPercent: number;
  suggestedPrice: number;
  daysToExpire: number;
  reason: string;
  priority: number;
  source: 'local' | 'ai';
}

const suggestionColumns = `s.id, s.product_id AS "productId", s.store_id AS "storeId", p.name AS "productName", p.category, p.price, p.stock,
  p.expiration_date AS "expirationDate", s.current_percent AS "currentPercent", s.suggested_percent AS "suggestedPercent",
  s.suggested_price AS "suggestedPrice", s.days_to_expire AS "daysToExpire", s.reason, s.priority, s.source, s.status,
  s.created_at AS "createdAt", s.decided_at AS "decidedAt"`;

export const suggestionRepository = {
  listPending: async (storeId: string) =>
    (
      await database.query<SuggestionRecord>(
        `SELECT ${suggestionColumns} FROM discount_suggestions s JOIN products p ON p.id = s.product_id
         WHERE s.store_id = $1 AND s.status = 'pending' ORDER BY s.priority ASC, s.days_to_expire ASC, s.suggested_percent DESC`,
        [storeId],
      )
    ).rows,
  // Highest rejected percent per product, so a rejected suggestion only comes back if it grows.
  rejectedPercents: async (client: PoolClient, storeId: string) => {
    const result = await client.query<{ productId: string; percent: number }>(
      `SELECT product_id AS "productId", MAX(suggested_percent) AS percent FROM discount_suggestions
       WHERE store_id = $1 AND status = 'rejected' GROUP BY product_id`,
      [storeId],
    );
    return new Map(result.rows.map((row) => [row.productId, Number(row.percent)]));
  },
  pendingByProduct: async (client: PoolClient, storeId: string) => {
    const result = await client.query<{ id: string; productId: string; suggestedPercent: number; daysToExpire: number; reason: string; source: 'local' | 'ai' }>(
      `SELECT id, product_id AS "productId", suggested_percent AS "suggestedPercent", days_to_expire AS "daysToExpire", reason, source
       FROM discount_suggestions WHERE store_id = $1 AND status = 'pending' FOR UPDATE`,
      [storeId],
    );
    return new Map(result.rows.map((row) => [row.productId, row]));
  },
  // Same as pendingByProduct but without locking, to decide which texts must be written before opening a transaction.
  pendingSnapshot: async (storeId: string) => {
    const result = await database.query<{ productId: string; suggestedPercent: number; daysToExpire: number }>(
      `SELECT product_id AS "productId", suggested_percent AS "suggestedPercent", days_to_expire AS "daysToExpire" FROM discount_suggestions WHERE store_id = $1 AND status = 'pending'`,
      [storeId],
    );
    return new Map(result.rows.map((row) => [row.productId, row]));
  },
  insert: (client: PoolClient, storeId: string, values: SuggestionValues) =>
    client.query(
      `INSERT INTO discount_suggestions (product_id, store_id, current_percent, suggested_percent, suggested_price, days_to_expire, reason, priority, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [values.productId, storeId, values.currentPercent, values.suggestedPercent, values.suggestedPrice, values.daysToExpire, values.reason, values.priority, values.source],
    ),
  update: (client: PoolClient, id: string, values: SuggestionValues) =>
    client.query(
      `UPDATE discount_suggestions SET current_percent=$2, suggested_percent=$3, suggested_price=$4, days_to_expire=$5, reason=$6, priority=$7, source=$8 WHERE id = $1`,
      [id, values.currentPercent, values.suggestedPercent, values.suggestedPrice, values.daysToExpire, values.reason, values.priority, values.source],
    ),
  expire: (client: PoolClient, ids: string[]) =>
    client.query(`UPDATE discount_suggestions SET status = 'expired', decided_at = CURRENT_TIMESTAMP WHERE id = ANY($1::uuid[])`, [ids]),
  lockPending: async (client: PoolClient, storeId: string, id?: string) =>
    (
      await client.query<{ id: string; productId: string; suggestedPercent: number }>(
        `SELECT id, product_id AS "productId", suggested_percent AS "suggestedPercent" FROM discount_suggestions
         WHERE store_id = $1 AND status = 'pending' ${id ? 'AND id = $2' : ''} ORDER BY priority ASC FOR UPDATE`,
        id ? [storeId, id] : [storeId],
      )
    ).rows,
  findForStore: async (storeId: string, id: string) =>
    (await database.query<{ id: string; status: SuggestionStatus }>('SELECT id, status FROM discount_suggestions WHERE id = $1 AND store_id = $2', [id, storeId])).rows[0],
  setStatus: (client: PoolClient, id: string, status: SuggestionStatus) =>
    client.query(`UPDATE discount_suggestions SET status = $2, decided_at = CURRENT_TIMESTAMP WHERE id = $1`, [id, status]),
};
