import { database } from '../database.js';
import { priceWithDiscount } from '../services/discount-rules.js';
import { activeOfferSql } from '../services/offer-rules.js';

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
  offerStartsOn: string | null;
  offerEndsOn: string | null;
  imageUrl: string;
  active: boolean;
  createdAt: Date;
}

export interface ProductFilters {
  category?: string;
}

// Saved values, for the store that owns the product.
const productColumns = `p.id, p.store_id AS "storeId", p.name, p.category, p.description, p.price, p.offer_price AS "offerPrice",
  p.stock, p.expiration_date AS "expirationDate", p.discount_percent AS "discountPercent",
  p.offer_starts_on AS "offerStartsOn", p.offer_ends_on AS "offerEndsOn", p.image_url AS "imageUrl",
  p.active, p.created_at AS "createdAt"`;

// What customers see: the discount and its dates only while the offer is active today, otherwise the normal price.
const publicColumns = (todayParam: string) => {
  const active = activeOfferSql(todayParam);
  return `p.id, p.store_id AS "storeId", p.name, p.category, p.description, p.price,
  CASE WHEN ${active} THEN p.offer_price ELSE p.price END AS "offerPrice",
  p.stock, p.expiration_date AS "expirationDate",
  CASE WHEN ${active} THEN p.discount_percent ELSE 0 END AS "discountPercent",
  CASE WHEN ${active} THEN p.offer_starts_on END AS "offerStartsOn",
  CASE WHEN ${active} THEN p.offer_ends_on END AS "offerEndsOn",
  p.image_url AS "imageUrl", p.active, p.created_at AS "createdAt"`;
};

const parameters = (initial: unknown[] = []) => {
  const params = [...initial];
  const add = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };
  return { params, add };
};

// Catalog conditions: every active, not expired product of an active store, with or without an offer.
// $1 is always today's date.
export const buildProductFilters = (filters: ProductFilters, today: string) => {
  const { params, add } = parameters([today]);
  const conditions = ['p.active = true', 's.active = true', 'p.expiration_date >= $1::date'];
  if (filters.category) conditions.push(`lower(p.category) = lower(${add(filters.category)})`);
  return { where: conditions.join(' AND '), params };
};

export interface SearchRow extends ProductRecord {
  storeName: string;
  neighborhood: string;
  address: string;
}

export interface CatalogRow extends ProductRecord {
  storeName: string;
  neighborhood: string;
  address: string;
  phone: string;
}

// Lowercase and accent-free text of a product, so "lacteos" matches "Lácteos".
const searchableText = `translate(lower(p.name || ' ' || p.category || ' ' || p.description), 'áéíóúüñ', 'aeiouun')`;

export const productRepository = {
  // Products for the assistant: prices and discounts as customers see them today.
  search: async (terms: string[], options: { neighborhood?: string; category?: string; maxPrice?: number; onlyDiscounted?: boolean; matchAll: boolean; limit: number; today: string }) => {
    const { params, add } = parameters([options.today]);
    const termConditions = terms.map((term) => `${searchableText} LIKE ${add(`%${term}%`)}`);
    const conditions = ['p.active = true', 's.active = true', 'p.stock > 0', 'p.expiration_date >= $1::date'];
    if (termConditions.length) conditions.push(`(${termConditions.join(options.matchAll ? ' AND ' : ' OR ')})`);
    if (options.neighborhood) conditions.push(`lower(s.neighborhood) = lower(${add(options.neighborhood)})`);
    if (options.category) conditions.push(`lower(p.category) = lower(${add(options.category)})`);
    if (options.maxPrice) conditions.push(`(CASE WHEN ${activeOfferSql('$1')} THEN p.offer_price ELSE p.price END) <= ${add(options.maxPrice)}`);
    if (options.onlyDiscounted) conditions.push(activeOfferSql('$1'));
    const result = await database.query<SearchRow>(
      `SELECT ${publicColumns('$1')}, s.name AS "storeName", s.neighborhood, s.address
       FROM products p JOIN stores s ON s.id = p.store_id WHERE ${conditions.join(' AND ')}
       ORDER BY p.expiration_date ASC LIMIT ${add(options.limit)}`,
      params,
    );
    return result.rows;
  },
  // Catalog, grouped later by store (ordered here by store and product name). Offers show their price of today.
  list: async (filters: ProductFilters, today: string) => {
    const { where, params } = buildProductFilters(filters, today);
    const result = await database.query<CatalogRow>(
      `SELECT ${publicColumns('$1')}, s.neighborhood, s.name AS "storeName", s.address, s.phone
       FROM products p JOIN stores s ON s.id = p.store_id WHERE ${where}
       ORDER BY lower(s.name), s.id, lower(p.name), p.id`,
      params,
    );
    return result.rows;
  },
  // Products whose offer is active today, can be bought and are not expired (Bogota calendar).
  listOffers: async (filters: { neighborhood?: string; category?: string; search?: string; today: string; limit: number }) => {
    const { params, add } = parameters([filters.today]);
    const conditions = ['p.active = true', 's.active = true', 'p.stock > 0', activeOfferSql('$1')];
    if (filters.neighborhood) conditions.push(`lower(s.neighborhood) = lower(${add(filters.neighborhood)})`);
    if (filters.category) conditions.push(`lower(p.category) = lower(${add(filters.category)})`);
    if (filters.search) conditions.push(`${searchableText} LIKE ${add(`%${filters.search}%`)}`);
    const result = await database.query<SearchRow>(
      `SELECT ${productColumns}, s.name AS "storeName", s.neighborhood, s.address
       FROM products p JOIN stores s ON s.id = p.store_id WHERE ${conditions.join(' AND ')}
       ORDER BY p.discount_percent DESC, p.expiration_date ASC LIMIT ${add(filters.limit)}`,
      params,
    );
    return result.rows;
  },
  // Full inventory of a store, with the saved offer values (for its owner).
  listByStore: async (storeId: string) =>
    (
      await database.query<ProductRecord>(
        `SELECT ${productColumns} FROM products p JOIN stores s ON s.id = p.store_id
         WHERE p.store_id = $1 AND p.active = true AND s.active = true ORDER BY p.expiration_date ASC, lower(p.name)`,
        [storeId],
      )
    ).rows,
  // A product of a deleted store no longer exists for anybody, its owner included.
  getById: async (id: string) =>
    (await database.query<ProductRecord>(`SELECT ${productColumns} FROM products p JOIN stores s ON s.id = p.store_id WHERE p.id = $1 AND p.active = true AND s.active = true`, [id])).rows[0],
  upsert: async (
    product: Partial<ProductRecord> & { id?: string; storeId: string; name: string; price: number; stock: number; expirationDate: string; discountPercent: number; offerStartsOn: string | null; offerEndsOn: string | null },
  ) => {
    const id = product.id ?? crypto.randomUUID();
    const offerPrice = priceWithDiscount(product.price, product.discountPercent);
    const result = await database.query<ProductRecord>(
      `INSERT INTO products AS p (id, store_id, name, category, description, price, offer_price, stock, expiration_date, discount_percent, offer_starts_on, offer_ends_on, image_url, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,true)
       ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, category=EXCLUDED.category,
       description=EXCLUDED.description, price=EXCLUDED.price, offer_price=EXCLUDED.offer_price,
       stock=EXCLUDED.stock, expiration_date=EXCLUDED.expiration_date, discount_percent=EXCLUDED.discount_percent,
       offer_starts_on=EXCLUDED.offer_starts_on, offer_ends_on=EXCLUDED.offer_ends_on, image_url=EXCLUDED.image_url
       RETURNING ${productColumns}`,
      [
        id,
        product.storeId,
        product.name,
        product.category ?? 'Alimentación',
        product.description ?? '',
        product.price,
        offerPrice,
        product.stock,
        product.expirationDate,
        product.discountPercent,
        product.offerStartsOn,
        product.offerEndsOn,
        product.imageUrl ?? '',
      ],
    );
    return result.rows[0];
  },
  delete: async (id: string) => (await database.query('UPDATE products SET active = false WHERE id = $1 AND active = true', [id])).rowCount,
};
