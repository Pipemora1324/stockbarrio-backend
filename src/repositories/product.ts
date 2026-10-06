import { database } from '../database.js';

export interface ProductRecord {
  id: string;
  storeId: string;
  name: string;
  category: string;
  description: string;
  price: number;
  offerPrice: number;
  stock: number;
  expirationDate: Date;
  discountPercent: number;
  imageUrl: string;
  active: boolean;
  createdAt: Date;
}

export const productRepository = {
  list: async (filters: { neighborhood?: string; category?: string; search?: string }) => {
    const params: unknown[] = [];
    const conditions = ['p.active = true'];
    if (filters.neighborhood) {
      conditions.push('s.neighborhood ILIKE $1');
      params.push(`%${filters.neighborhood}%`);
    }
    if (filters.category) {
      conditions.push('p.category ILIKE $2');
      params.push(`%${filters.category}%`);
    }
    if (filters.search) {
      conditions.push('(p.name ILIKE $3 OR p.description ILIKE $3)');
      params.push(`%${filters.search}%`);
    }
    const result = await database.query<ProductRecord & { neighborhood: string; storeName: string }>(
      `SELECT p.*, s.neighborhood, s.name AS "storeName" FROM products p JOIN stores s ON s.id = p.store_id WHERE ${conditions.join(' AND ')} ORDER BY p.expiration_date ASC`,
      params,
    );
    return result.rows;
  },
  listByStore: async (storeId: string) => (await database.query<ProductRecord>('SELECT * FROM products WHERE store_id = $1 AND active = true ORDER BY expiration_date ASC', [storeId])).rows,
  getById: async (id: string) => (await database.query<ProductRecord>('SELECT * FROM products WHERE id = $1', [id])).rows[0],
  upsert: async (product: Partial<ProductRecord> & { id?: string; storeId: string; name: string; price: number; stock: number; expirationDate: Date; discountPercent: number }) => {
    const id = product.id ?? crypto.randomUUID();
    const offerPrice = Math.max(0, product.price * (1 - product.discountPercent / 100));
    const result = await database.query<ProductRecord>(
      `INSERT INTO products (id, store_id, name, category, description, price, offer_price, stock, expiration_date, discount_percent, image_url, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true)
       ON CONFLICT (id) DO UPDATE SET store_id=EXCLUDED.store_id, name=EXCLUDED.name, category=EXCLUDED.category,
       description=EXCLUDED.description, price=EXCLUDED.price, offer_price=EXCLUDED.offer_price,
       stock=EXCLUDED.stock, expiration_date=EXCLUDED.expiration_date, discount_percent=EXCLUDED.discount_percent,
       image_url=EXCLUDED.image_url
       RETURNING *`,
      [id, product.storeId, product.name, product.category ?? 'Alimentación', product.description ?? '', product.price, offerPrice, product.stock, product.expirationDate, product.discountPercent, product.imageUrl ?? ''],
    );
    return result.rows[0];
  },
  delete: async (id: string) => (await database.query('UPDATE products SET active = false WHERE id = $1', [id])).rowCount,
};
