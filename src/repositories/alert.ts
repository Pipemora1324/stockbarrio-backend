import type { PoolClient } from 'pg';
import { database } from '../database.js';

export interface AlertSubscriptionRecord {
  id: string;
  userId: string;
  query: string | null;
  category: string | null;
  neighborhood: string | null;
  minDiscount: number;
  active: boolean;
  createdAt: Date;
}

export interface NotificationRecord {
  id: string;
  title: string;
  message: string;
  productId: string | null;
  productName?: string | null;
  createdAt: Date;
  readAt: Date | null;
}

// The latitude, longitude and radius_km columns stay in the table but are no longer written nor read.
const subscriptionColumnsOf = (alias: string) => `${alias}.id, ${alias}.user_id AS "userId", ${alias}.query, ${alias}.category, ${alias}.neighborhood,
  ${alias}.min_discount AS "minDiscount", ${alias}.active, ${alias}.created_at AS "createdAt"`;
const subscriptionColumns = subscriptionColumnsOf('alert_subscriptions');
const notificationColumns = `id, title, message, product_id AS "productId", created_at AS "createdAt", read_at AS "readAt"`;
// Start of the current day in Bogota, as a timestamp, for the daily notification limit.
const startOfBogotaDay = `(date_trunc('day', now() AT TIME ZONE 'America/Bogota') AT TIME ZONE 'America/Bogota')`;

export const alertRepository = {
  listByUser: async (userId: string) =>
    (await database.query<AlertSubscriptionRecord>(`SELECT ${subscriptionColumns} FROM alert_subscriptions WHERE user_id = $1 AND active = true ORDER BY created_at DESC`, [userId])).rows,
  countActiveByUser: async (userId: string) =>
    Number((await database.query<{ count: string }>('SELECT COUNT(*) AS count FROM alert_subscriptions WHERE user_id = $1 AND active = true', [userId])).rows[0].count),
  create: async (userId: string, values: Omit<AlertSubscriptionRecord, 'id' | 'userId' | 'active' | 'createdAt'>) =>
    (
      await database.query<AlertSubscriptionRecord>(
        `INSERT INTO alert_subscriptions (user_id, query, category, neighborhood, min_discount)
         VALUES ($1,$2,$3,$4,$5) RETURNING ${subscriptionColumns}`,
        [userId, values.query, values.category, values.neighborhood, values.minDiscount],
      )
    ).rows[0],
  deactivate: async (userId: string, id: string) =>
    (await database.query('UPDATE alert_subscriptions SET active = false WHERE id = $1 AND user_id = $2 AND active = true', [id, userId])).rowCount,
  // Candidates for a product with a given discount; text and neighborhood matching happen in the service.
  // Older radius alerts are left out: without distances they would match every store.
  candidatesFor: async (client: PoolClient, discountPercent: number) =>
    (
      await client.query<AlertSubscriptionRecord>(
        `SELECT ${subscriptionColumnsOf('a')} FROM alert_subscriptions a JOIN users u ON u.id = a.user_id
         WHERE a.active = true AND a.min_discount <= $1 AND a.radius_km IS NULL AND u.role = 'customer'`,
        [discountPercent],
      )
    ).rows,
};

export const notificationRepository = {
  // Includes the product name so the inbox can link to its current offers.
  listByUser: async (userId: string, limit = 50) =>
    (
      await database.query<NotificationRecord>(
        `SELECT n.id, n.title, n.message, n.product_id AS "productId", p.name AS "productName", n.created_at AS "createdAt", n.read_at AS "readAt"
         FROM notifications n LEFT JOIN products p ON p.id = n.product_id WHERE n.user_id = $1 ORDER BY n.created_at DESC LIMIT $2`,
        [userId, limit],
      )
    ).rows,
  unreadCount: async (userId: string) =>
    Number((await database.query<{ count: string }>('SELECT COUNT(*) AS count FROM notifications WHERE user_id = $1 AND read_at IS NULL', [userId])).rows[0].count),
  markRead: async (userId: string, id: string) =>
    (await database.query('UPDATE notifications SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP) WHERE id = $1 AND user_id = $2', [id, userId])).rowCount,
  markAllRead: async (userId: string) => (await database.query('UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND read_at IS NULL', [userId])).rowCount,
  countToday: async (client: PoolClient, userId: string) =>
    Number((await client.query<{ count: string }>(`SELECT COUNT(*) AS count FROM notifications WHERE user_id = $1 AND created_at >= ${startOfBogotaDay}`, [userId])).rows[0].count),
  alreadyNotified: async (client: PoolClient, userId: string, productId: string) =>
    Boolean((await client.query('SELECT 1 FROM notifications WHERE user_id = $1 AND product_id = $2 LIMIT 1', [userId, productId])).rowCount),
  // Returns the new row, or undefined when this subscription already got a notice for the product.
  insert: async (client: PoolClient, values: { userId: string; subscriptionId: string; productId: string; title: string; message: string }) =>
    (
      await client.query<NotificationRecord>(
        `INSERT INTO notifications (user_id, subscription_id, product_id, title, message) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (subscription_id, product_id) DO NOTHING RETURNING ${notificationColumns}`,
        [values.userId, values.subscriptionId, values.productId, values.title, values.message],
      )
    ).rows[0],
};
