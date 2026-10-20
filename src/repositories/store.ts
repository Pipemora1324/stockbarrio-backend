import type { PoolClient } from 'pg';
import { database } from '../database.js';
import { activeOfferSql } from '../services/offer-rules.js';

export interface StoreRecord {
  id: string;
  name: string;
  neighborhood: string;
  address: string;
  phone: string;
  active: boolean;
  createdAt: Date;
}

export interface OwnedStoreRecord extends StoreRecord {
  userId: string;
  productCount: number;
}

export interface PublicStoreRecord extends StoreRecord {
  productCount: number;
  offerCount: number;
}

export interface StoreInput {
  name: string;
  neighborhood: string;
  address: string;
  phone: string;
}

// Las columnas latitude y longitude siguen en la tabla, pero ya no se leen ni se exponen.
const storeColumns = 's.id, s.name, s.neighborhood, s.address, s.phone, s.active, s.created_at AS "createdAt"';
const productCount = `(SELECT count(*)::int FROM products p WHERE p.store_id = s.id AND p.active = true) AS "productCount"`;

// Un vendedor puede tener varios locales. El "principal" (users.store_id, normalmente el primero) es el que usan los endpoints sin storeId.
const ownedStoresQuery = `SELECT ${storeColumns}, s.user_id AS "userId", ${productCount}
  FROM stores s JOIN users u ON u.id = s.user_id
  WHERE s.user_id = $1 AND s.active = true
  ORDER BY (s.id = u.store_id) DESC NULLS LAST, s.created_at ASC, s.id ASC`;

export const maxStoresPerUser = 10;

export const storeRepository = {
  // Lista pública con cuántos productos y ofertas (activas hoy) tiene cada local.
  list: async (neighborhood: string | undefined, today: string) => {
    const params: unknown[] = [today];
    if (neighborhood) params.push(`%${neighborhood}%`);
    const offerCount = `(SELECT count(*)::int FROM products p WHERE p.store_id = s.id AND p.active = true AND p.stock > 0 AND ${activeOfferSql('$1')}) AS "offerCount"`;
    const result = await database.query<PublicStoreRecord>(
      `SELECT ${storeColumns}, ${productCount}, ${offerCount} FROM stores s
       WHERE s.active = true ${neighborhood ? 'AND s.neighborhood ILIKE $2' : ''} ORDER BY lower(s.name), s.id`,
      params,
    );
    return result.rows;
  },
  // Incluye al dueño, para comprobar la propiedad.
  getOwned: async (id: string) =>
    (await database.query<StoreRecord & { userId: string }>(`SELECT ${storeColumns}, s.user_id AS "userId" FROM stores s WHERE s.id = $1 AND s.active = true`, [id])).rows[0],
  listNeighborhoods: async () =>
    (await database.query<{ neighborhood: string }>(`SELECT DISTINCT neighborhood FROM stores WHERE active = true AND neighborhood <> '' ORDER BY neighborhood`)).rows.map((row) => row.neighborhood),
  // Reserva la llamada a la IA de hoy para el local. Solo la primera petición del día recibe true, aunque lleguen varias a la vez.
  claimAiReasonsDay: async (id: string, day: string) =>
    Boolean((await database.query(`UPDATE stores SET ai_reasons_on = $2 WHERE id = $1 AND ai_reasons_on IS DISTINCT FROM $2::date RETURNING id`, [id, day])).rowCount),
  listByUser: async (userId: string) => (await database.query<OwnedStoreRecord>(ownedStoresQuery, [userId])).rows,
  // Otro local activo con el mismo nombre en el mismo barrio (sin importar mayúsculas).
  isNameTaken: async (name: string, neighborhood: string, exceptId?: string) =>
    Boolean(
      (
        await database.query(
          `SELECT 1 FROM stores WHERE active = true AND lower(name) = lower($1) AND lower(neighborhood) = lower($2) AND ($3::uuid IS NULL OR id <> $3::uuid)`,
          [name, neighborhood, exceptId ?? null],
        )
      ).rowCount,
    ),
  create: (userId: string, input: StoreInput) =>
    database.withTransaction(async (client) => {
      const created = await client.query<{ id: string }>('INSERT INTO stores (user_id, name, neighborhood, address, phone) VALUES ($1,$2,$3,$4,$5) RETURNING id', [
        userId,
        input.name,
        input.neighborhood,
        input.address,
        input.phone,
      ]);
      // El primer local (o el primero después de eliminarlos todos) pasa a ser el principal.
      await client.query('UPDATE users SET store_id = $1 WHERE id = $2 AND (store_id IS NULL OR NOT EXISTS (SELECT 1 FROM stores WHERE id = users.store_id AND active = true))', [
        created.rows[0].id,
        userId,
      ]);
      return created.rows[0].id;
    }),
  update: async (id: string, input: Partial<StoreInput>) =>
    (
      await database.query<StoreRecord>(
        `UPDATE stores s SET name = COALESCE($2, name), neighborhood = COALESCE($3, neighborhood), address = COALESCE($4, address), phone = COALESCE($5, phone)
         WHERE id = $1 AND active = true RETURNING ${storeColumns}`,
        [id, input.name ?? null, input.neighborhood ?? null, input.address ?? null, input.phone ?? null],
      )
    ).rows[0],
  // Borrado lógico: el local y todos sus productos dejan de verse, pero no se borra ninguna fila (se puede recuperar a mano).
  // Sus sugerencias pendientes se cierran y el local principal del vendedor pasa al siguiente, o a ninguno.
  deactivate: (id: string, userId: string) =>
    database.withTransaction(async (client: PoolClient) => {
      await client.query('UPDATE stores SET active = false WHERE id = $1', [id]);
      await client.query('UPDATE products SET active = false WHERE store_id = $1 AND active = true', [id]);
      await client.query(`UPDATE discount_suggestions SET status = 'expired', decided_at = CURRENT_TIMESTAMP WHERE store_id = $1 AND status = 'pending'`, [id]);
      await client.query(
        `UPDATE users SET store_id = (SELECT s.id FROM stores s WHERE s.user_id = $2 AND s.active = true ORDER BY s.created_at ASC, s.id ASC LIMIT 1)
         WHERE id = $2 AND (store_id IS NULL OR store_id = $1)`,
        [id, userId],
      );
    }),
};
