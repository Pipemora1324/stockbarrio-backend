import { database } from '../database.js';
import { priceWithDiscount } from '../services/discount-rules.js';

export interface ProductRecord {
  id: string;
  storeId: string;
  name: string;
  category: string;
  description: string;
  price: number;
  offerPrice: number;
  stock: number;
  expirationDate: string;
  discountPercent: number;
  imageUrl: string;
  active: boolean;
  createdAt: Date;
}

export interface ProductFilters {
  neighborhood?: string;
  category?: string;
  search?: string;
}

const productColumns = `p.id, p.store_id AS "storeId", p.name, p.category, p.description, p.price, p.offer_price AS "offerPrice",
  p.stock, p.expiration_date AS "expirationDate", p.discount_percent AS "discountPercent", p.image_url AS "imageUrl",
  p.active, p.created_at AS "createdAt"`;

export const buildProductFilters = (filters: ProductFilters) => {
  const params: unknown[] = [];
  const conditions = ['p.active = true', 's.active = true'];
  const addParam = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };
  if (filters.neighborhood) conditions.push(`s.neighborhood ILIKE ${addParam(`%${filters.neighborhood}%`)}`);
  if (filters.category) conditions.push(`p.category ILIKE ${addParam(`%${filters.category}%`)}`);
  if (filters.search) {
    const placeholder = addParam(`%${filters.search}%`);
    conditions.push(`(p.name ILIKE ${placeholder} OR p.description ILIKE ${placeholder})`);
  }
  return { where: conditions.join(' AND '), params };
};

export interface SearchRow extends ProductRecord {
  storeName: string;
  neighborhood: string;
  address: string;
}

// Lowercase and accent-free text of a product, so "lacteos" matches "Lácteos".
const searchableText = `translate(lower(p.name || ' ' || p.category || ' ' || p.description), 'áéíóúüñ', 'aeiouun')`;

export const productRepository = {
  search: async (terms: string[], options: { neighborhood?: string; category?: string; maxPrice?: number; onlyDiscounted?: boolean; matchAll: boolean; limit: number }) => {
    const params: unknown[] = [];
    const addParam = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };
    const termConditions = terms.map((term) => `${searchableText} LIKE ${addParam(`%${term}%`)}`);
    const conditions = ['p.active = true', 's.active = true', 'p.stock > 0'];
    if (termConditions.length) conditions.push(`(${termConditions.join(options.matchAll ? ' AND ' : ' OR ')})`);
    if (options.neighborhood) conditions.push(`lower(s.neighborhood) = lower(${addParam(options.neighborhood)})`);
    if (options.category) conditions.push(`lower(p.category) = lower(${addParam(options.category)})`);
    if (options.maxPrice) conditions.push(`p.offer_price <= ${addParam(options.maxPrice)}`);
    if (options.onlyDiscounted) conditions.push('p.discount_percent > 0');
    const result = await database.query<SearchRow>(
      `SELECT ${productColumns}, s.name AS "storeName", s.neighborhood, s.address
       FROM products p JOIN stores s ON s.id = p.store_id WHERE ${conditions.join(' AND ')}
       ORDER BY p.expiration_date ASC LIMIT ${addParam(options.limit)}`,
      params,
    );
    return result.rows;
  },
  list: async (filters: ProductFilters) => {
    const { where, params } = buildProductFilters(filters);
    const result = await database.query<ProductRecord & { neighborhood: string; storeName: string }>(
      `SELECT ${productColumns}, s.neighborhood, s.name AS "storeName" FROM products p JOIN stores s ON s.id = p.store_id WHERE ${where} ORDER BY p.expiration_date ASC`,
      params,
    );
    return result.rows;
  },
  // Products that currently have a discount, can be bought and are not expired (Bogota calendar).
  listOffers: async (filters: { neighborhood?: string; category?: string; search?: string; today: string; limit: number }) => {
    const params: unknown[] = [filters.today];
    const addParam = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };
    const conditions = ['p.active = true', 's.active = true', 'p.stock > 0', 'p.discount_percent > 0', 'p.expiration_date >= $1'];
    if (filters.neighborhood) conditions.push(`lower(s.neighborhood) = lower(${addParam(filters.neighborhood)})`);
    if (filters.category) conditions.push(`lower(p.category) = lower(${addParam(filters.category)})`);
    if (filters.search) conditions.push(`${searchableText} LIKE ${addParam(`%${filters.search}%`)}`);
    const result = await database.query<SearchRow>(
      `SELECT ${productColumns}, s.name AS "storeName", s.neighborhood, s.address
       FROM products p JOIN stores s ON s.id = p.store_id WHERE ${conditions.join(' AND ')}
       ORDER BY p.discount_percent DESC, p.expiration_date ASC LIMIT ${addParam(filters.limit)}`,
      params,
    );
    return result.rows;
  },
  listByStore: async (storeId: string) =>
    (await database.query<ProductRecord>(`SELECT ${productColumns} FROM products p WHERE p.store_id = $1 AND p.active = true ORDER BY p.expiration_date ASC`, [storeId])).rows,
  getById: async (id: string) => (await database.query<ProductRecord>(`SELECT ${productColumns} FROM products p WHERE p.id = $1 AND p.active = true`, [id])).rows[0],
  upsert: async (product: Partial<ProductRecord> & { id?: string; storeId: string; name: string; price: number; stock: number; expirationDate: string; discountPercent: number }) => {
    const id = product.id ?? crypto.randomUUID();
    const offerPrice = priceWithDiscount(product.price, product.discountPercent);
    const result = await database.query<ProductRecord>(
      `INSERT INTO products AS p (id, store_id, name, category, description, price, offer_price, stock, expiration_date, discount_percent, image_url, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true)
       ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, category=EXCLUDED.category,
       description=EXCLUDED.description, price=EXCLUDED.price, offer_price=EXCLUDED.offer_price,
       stock=EXCLUDED.stock, expiration_date=EXCLUDED.expiration_date, discount_percent=EXCLUDED.discount_percent,
       image_url=EXCLUDED.image_url
       RETURNING ${productColumns}`,
      [id, product.storeId, product.name, product.category ?? 'Alimentación', product.description ?? '', product.price, offerPrice, product.stock, product.expirationDate, product.discountPercent, product.imageUrl ?? ''],
    );
    return result.rows[0];
  },
  delete: async (id: string) => (await database.query('UPDATE products SET active = false WHERE id = $1 AND active = true', [id])).rowCount,
};
