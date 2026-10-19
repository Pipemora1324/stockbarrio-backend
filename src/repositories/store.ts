import { database } from '../database.js';

export interface StoreRecord {
  id: string;
  name: string;
  neighborhood: string;
  address: string;
  phone: string;
  latitude: number | null;
  longitude: number | null;
  active: boolean;
  createdAt: Date;
}

const storeColumns = 'id, name, neighborhood, address, phone, latitude, longitude, active, created_at AS "createdAt"';

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
  // Average position of the stores of a neighborhood, used as the origin when the customer picks a neighborhood instead of sharing a location.
  neighborhoodCenter: async (neighborhood: string) => {
    const result = await database.query<{ latitude: number | null; longitude: number | null }>(
      `SELECT AVG(latitude)::float8 AS latitude, AVG(longitude)::float8 AS longitude FROM stores
       WHERE active = true AND lower(neighborhood) = lower($1) AND latitude IS NOT NULL AND longitude IS NOT NULL`,
      [neighborhood],
    );
    const center = result.rows[0];
    return center?.latitude != null && center.longitude != null ? { latitude: center.latitude, longitude: center.longitude } : null;
  },
  updateLocation: async (id: string, values: { latitude: number | null; longitude: number | null; address?: string; phone?: string }) =>
    (
      await database.query<StoreRecord>(
        `UPDATE stores SET latitude = $2, longitude = $3, address = COALESCE($4, address), phone = COALESCE($5, phone) WHERE id = $1 RETURNING ${storeColumns}`,
        [id, values.latitude, values.longitude, values.address ?? null, values.phone ?? null],
      )
    ).rows[0],
  getByUserId: async (userId: string) => (await database.query<StoreRecord>(`SELECT ${storeColumns} FROM stores WHERE user_id = $1`, [userId])).rows[0],
};
