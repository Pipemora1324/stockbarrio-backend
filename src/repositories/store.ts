import { database } from '../database.js';

export interface StoreRecord {
  id: string;
  name: string;
  neighborhood: string;
  address: string;
  phone: string;
  latitude: number;
  longitude: number;
  active: boolean;
  createdAt: Date;
}

export const storeRepository = {
  list: async (neighborhood?: string) => {
    const result = await database.query<StoreRecord>(
      neighborhood
        ? `SELECT * FROM stores WHERE active = true AND neighborhood ILIKE $1 ORDER BY name`
        : `SELECT * FROM stores WHERE active = true ORDER BY name`,
      neighborhood ? [`%${neighborhood}%`] : [],
    );
    return result.rows;
  },
  getById: async (id: string) => (await database.query<StoreRecord>('SELECT * FROM stores WHERE id = $1', [id])).rows[0],
  getByUserId: async (userId: string) => (await database.query<StoreRecord>('SELECT * FROM stores WHERE user_id = $1', [userId])).rows[0],
};
