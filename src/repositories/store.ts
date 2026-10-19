import { database } from '../database.js';

export interface StoreRecord {
  id: string;
  name: string;
  neighborhood: string;
  address: string;
  phone: string;
  active: boolean;
  createdAt: Date;
}

// The latitude and longitude columns stay in the table but are no longer read nor exposed.
const storeColumns = 'id, name, neighborhood, address, phone, active, created_at AS "createdAt"';

export const storeRepository = {
  list: async (neighborhood?: string) => {
    const result = await database.query<StoreRecord>(
      neighborhood
        ? `SELECT ${storeColumns} FROM stores WHERE active = true AND neighborhood ILIKE $1 ORDER BY name`
        : `SELECT ${storeColumns} FROM stores WHERE active = true ORDER BY name`,
      neighborhood ? [`%${neighborhood}%`] : [],
    );
    return result.rows;
  },
  getById: async (id: string) => (await database.query<StoreRecord>(`SELECT ${storeColumns} FROM stores WHERE id = $1`, [id])).rows[0],
  listNeighborhoods: async () =>
    (await database.query<{ neighborhood: string }>(`SELECT DISTINCT neighborhood FROM stores WHERE active = true AND neighborhood <> '' ORDER BY neighborhood`)).rows.map((row) => row.neighborhood),
  // Claims today's AI call for the store. Only the first caller of the day gets true, even with simultaneous visits.
  claimAiReasonsDay: async (id: string, day: string) =>
    Boolean((await database.query(`UPDATE stores SET ai_reasons_on = $2 WHERE id = $1 AND ai_reasons_on IS DISTINCT FROM $2::date RETURNING id`, [id, day])).rowCount),
  getByUserId: async (userId: string) => (await database.query<StoreRecord>(`SELECT ${storeColumns} FROM stores WHERE user_id = $1`, [userId])).rows[0],
};
