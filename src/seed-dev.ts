import { fileURLToPath } from 'node:url';
import type { PoolClient } from 'pg';
import { config } from './config.js';
import { database, pool } from './database.js';
import { addDays, todayInBogota } from './dates.js';
import { migrate } from './migrate.js';
import { hashPassword } from './services/auth.js';

// Sample stores and products ONLY for local development and manual tests. It never runs on startup and refuses to run
// with NODE_ENV=production (there is no flag to skip that). Production starts empty: the administrator is created
// with npm run admin:create. Usage: npm run seed:dev

interface SeedProduct {
  name: string;
  category: string;
  description: string;
  price: number;
  stock: number;
  expiresInDays: number;
  // The offer runs from today until the expiration date, or starts some days later.
  discountPercent?: number;
  offerStartsInDays?: number;
}

interface SeedStore {
  email: string;
  owner: string;
  name: string;
  neighborhood: string;
  address: string;
  phone: string;
  products: SeedProduct[];
  // More stores of the same seller.
  branches?: Array<Omit<SeedStore, 'email' | 'owner' | 'branches'>>;
}

const seedStores: SeedStore[] = [
  {
    email: 'tienda.donaluz@stockbarrio.test', owner: 'Luz Marina Rodríguez', name: 'Tienda Doña Luz', neighborhood: 'Chapinero',
    address: 'Calle 57 # 9-23, Bogotá', phone: '3101234567',
    products: [
      { name: 'Leche entera 1 L', category: 'Lácteos', description: 'Bolsa de leche entera pasteurizada.', price: 4900, stock: 24, expiresInDays: 2 },
      { name: 'Huevos AA x 30', category: 'Huevos', description: 'Panal de huevos rojos AA.', price: 18500, stock: 10, expiresInDays: 9 },
      { name: 'Pan tajado integral', category: 'Panadería', description: 'Pan tajado de 500 g.', price: 6200, stock: 15, expiresInDays: 1 },
      { name: 'Queso campesino 500 g', category: 'Lácteos', description: 'Queso fresco campesino.', price: 9500, stock: 6, expiresInDays: 4 },
      { name: 'Arroz 1 kg', category: 'Granos', description: 'Arroz blanco de grano largo.', price: 4300, stock: 40, expiresInDays: 240 },
      { name: 'Pollo asado entero', category: 'Comidas preparadas', description: 'Pollo asado al carbón con papa y arepa.', price: 32000, stock: 6, expiresInDays: 1 },
      { name: 'Atún en lata 170 g', category: 'Despensa', description: 'Atún en aceite.', price: 7900, stock: 30, expiresInDays: 500, discountPercent: 15 },
    ],
    branches: [
      {
        name: 'Doña Luz Express', neighborhood: 'Teusaquillo', address: 'Calle 45 # 16-20, Bogotá', phone: '3101234568',
        products: [
          { name: 'Yogur natural 1 L', category: 'Lácteos', description: 'Yogur sin azúcar.', price: 8200, stock: 12, expiresInDays: 4, discountPercent: 20 },
          { name: 'Gaseosa 1,5 L', category: 'Bebidas', description: 'Gaseosa sabor cola.', price: 5500, stock: 40, expiresInDays: 120, discountPercent: 10, offerStartsInDays: 2 },
        ],
      },
    ],
  },
  {
    email: 'mercado.elporvenir@stockbarrio.test', owner: 'Jorge Enrique Pardo', name: 'Mercado El Porvenir', neighborhood: 'Teusaquillo',
    address: 'Carrera 19 # 39-15, Bogotá', phone: '3157654321',
    products: [
      { name: 'Leche deslactosada 1 L', category: 'Lácteos', description: 'Leche deslactosada en caja.', price: 5600, stock: 18, expiresInDays: 5 },
      { name: 'Huevos AA x 12', category: 'Huevos', description: 'Docena de huevos AA.', price: 7800, stock: 30, expiresInDays: 12 },
      { name: 'Yogur de fresa 1 L', category: 'Lácteos', description: 'Yogur bebible sabor fresa.', price: 8900, stock: 9, expiresInDays: 3 },
      { name: 'Arepas de maíz x 5', category: 'Panadería', description: 'Arepas blancas listas para asar.', price: 3800, stock: 20, expiresInDays: 2, discountPercent: 10 },
      { name: 'Café molido 250 g', category: 'Despensa', description: 'Café tostado y molido.', price: 11900, stock: 14, expiresInDays: 180 },
    ],
  },
  {
    email: 'autoservicio.lacolina@stockbarrio.test', owner: 'Claudia Patricia Gómez', name: 'Autoservicio La Colina', neighborhood: 'Suba',
    address: 'Calle 138 # 58-40, Bogotá', phone: '3204567890',
    products: [
      { name: 'Leche entera 1,1 L', category: 'Lácteos', description: 'Leche entera en bolsa familiar.', price: 4700, stock: 50, expiresInDays: 6 },
      { name: 'Huevos A x 30', category: 'Huevos', description: 'Panal de huevos A.', price: 16900, stock: 4, expiresInDays: 3 },
      { name: 'Jamón de cerdo 250 g', category: 'Carnes frías', description: 'Jamón tajado.', price: 7400, stock: 12, expiresInDays: 2 },
      { name: 'Banano x libra', category: 'Frutas y verduras', description: 'Banano criollo maduro.', price: 1800, stock: 35, expiresInDays: 3 },
      { name: 'Panela 500 g', category: 'Despensa', description: 'Panela redonda.', price: 3200, stock: 25, expiresInDays: 300 },
      { name: 'Pollo asado medio', category: 'Comidas preparadas', description: 'Medio pollo asado con papa salada.', price: 18000, stock: 8, expiresInDays: 1, discountPercent: 10 },
    ],
  },
  {
    email: 'granero.sanjose@stockbarrio.test', owner: 'Luis Fernando Ospina', name: 'Granero San José', neighborhood: 'Laureles',
    address: 'Circular 4 # 70-12, Medellín', phone: '3009876543',
    products: [
      { name: 'Leche entera 1 L', category: 'Lácteos', description: 'Leche entera pasteurizada.', price: 4600, stock: 22, expiresInDays: 1 },
      { name: 'Huevos AA x 30', category: 'Huevos', description: 'Panal de huevos AA de granja.', price: 17900, stock: 8, expiresInDays: 7 },
      { name: 'Arepa paisa x 10', category: 'Panadería', description: 'Arepas delgadas de maíz blanco.', price: 5200, stock: 16, expiresInDays: 4 },
      { name: 'Quesito antioqueño 400 g', category: 'Lácteos', description: 'Quesito fresco.', price: 8200, stock: 7, expiresInDays: 3 },
      { name: 'Fríjol cargamanto 500 g', category: 'Granos', description: 'Fríjol rojo seco.', price: 6900, stock: 30, expiresInDays: 365 },
      { name: 'Pollo asado entero', category: 'Comidas preparadas', description: 'Pollo asado con arepa y ají.', price: 29900, stock: 4, expiresInDays: 0, discountPercent: 15 },
    ],
  },
  {
    email: 'minimercado.elprado@stockbarrio.test', owner: 'Ana Milena Castro', name: 'Minimercado El Prado', neighborhood: 'El Prado',
    address: 'Carrera 54 # 64-30, Barranquilla', phone: '3012223344',
    products: [
      { name: 'Suero costeño 250 g', category: 'Lácteos', description: 'Suero atollabuey.', price: 5400, stock: 10, expiresInDays: 2 },
      { name: 'Queso costeño 500 g', category: 'Lácteos', description: 'Queso duro salado.', price: 12500, stock: 5, expiresInDays: 8 },
      { name: 'Bollo de yuca x 3', category: 'Panadería', description: 'Bollos de yuca envueltos.', price: 4500, stock: 12, expiresInDays: 1 },
      { name: 'Huevos AA x 12', category: 'Huevos', description: 'Docena de huevos AA.', price: 8100, stock: 18, expiresInDays: 10 },
      { name: 'Aceite 1 L', category: 'Despensa', description: 'Aceite vegetal.', price: 10900, stock: 20, expiresInDays: 400 },
    ],
  },
];

const insertProduct = async (client: PoolClient, storeId: string, product: SeedProduct, today: string) => {
  const discount = product.discountPercent ?? 0;
  const expirationDate = addDays(today, product.expiresInDays);
  const startsOn = discount ? addDays(today, Math.min(product.offerStartsInDays ?? 0, product.expiresInDays)) : null;
  await client.query(
    `INSERT INTO products (store_id, name, category, description, price, offer_price, stock, expiration_date, discount_percent, offer_starts_on, offer_ends_on)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [storeId, product.name, product.category, product.description, product.price, Math.round(product.price * (1 - discount / 100)), product.stock, expirationDate, discount, startsOn, discount ? expirationDate : null],
  );
};

const insertStore = async (client: PoolClient, userId: string, store: Omit<SeedStore, 'email' | 'owner' | 'branches'>, today: string) => {
  const created = await client.query<{ id: string }>('INSERT INTO stores (user_id, name, neighborhood, address, phone) VALUES ($1,$2,$3,$4,$5) RETURNING id', [
    userId,
    store.name,
    store.neighborhood,
    store.address,
    store.phone,
  ]);
  for (const product of store.products) await insertProduct(client, created.rows[0].id, product, today);
  return created.rows[0].id;
};

const seedStore = async (client: PoolClient, store: SeedStore, passwordHash: string, today: string) => {
  const existing = await client.query<{ storeId: string | null }>('SELECT store_id AS "storeId" FROM users WHERE email = $1', [store.email]);
  if (existing.rowCount) {
    // The store already exists: only add the sample products it does not have yet.
    const storeId = existing.rows[0].storeId;
    let added = 0;
    for (const product of storeId ? store.products : []) {
      const found = await client.query('SELECT 1 FROM products WHERE store_id = $1 AND name = $2', [storeId, product.name]);
      if (!found.rowCount) {
        await insertProduct(client, storeId!, product, today);
        added++;
      }
    }
    const addedText = added === 1 ? ', se agregó 1 producto nuevo' : `, se agregaron ${added} productos nuevos`;
    console.info(`${store.name}: ya existe${added ? addedText : ', se omite'}.`);
    return;
  }
  const user = await client.query<{ id: string }>(`INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'store') RETURNING id`, [store.owner, store.email, passwordHash]);
  const storeId = await insertStore(client, user.rows[0].id, store, today);
  await client.query('UPDATE users SET store_id = $1 WHERE id = $2', [storeId, user.rows[0].id]);
  for (const branch of store.branches ?? []) await insertStore(client, user.rows[0].id, branch, today);
  const count = 1 + (store.branches?.length ?? 0);
  console.info(`${store.name}: creada con ${store.products.length} productos${count > 1 ? ` y ${count - 1} local más` : ''}.`);
};

const demoCustomer = { email: 'cliente.demo@stockbarrio.test', name: 'Cliente de prueba', alerts: [{ query: 'huevos', neighborhood: null }, { query: 'leche', neighborhood: 'Chapinero' }] };

const seedCustomer = async (client: PoolClient, passwordHash: string) => {
  if ((await client.query('SELECT 1 FROM users WHERE email = $1', [demoCustomer.email])).rowCount) {
    console.info('Cliente de prueba: ya existe, se omite.');
    return;
  }
  const user = await client.query<{ id: string }>(`INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'customer') RETURNING id`, [demoCustomer.name, demoCustomer.email, passwordHash]);
  for (const alert of demoCustomer.alerts) {
    await client.query('INSERT INTO alert_subscriptions (user_id, query, neighborhood) VALUES ($1, $2, $3)', [user.rows[0].id, alert.query, alert.neighborhood]);
  }
  console.info(`Cliente de prueba creado con ${demoCustomer.alerts.length} alertas.`);
};

// The sample data never reaches production: the check reads NODE_ENV and has no override.
export const assertDevelopmentOnly = (nodeEnv = config.nodeEnv) => {
  if (nodeEnv === 'production') throw new Error('seed:dev solo es para desarrollo local y pruebas: no se ejecuta con NODE_ENV=production.');
};

export const seed = async () => {
  assertDevelopmentOnly();
  await migrate();
  const storePassword = process.env.SEED_STORE_PASSWORD ?? 'tienda12345';
  if (storePassword.length < 8) throw new Error('SEED_STORE_PASSWORD debe tener al menos 8 caracteres.');
  const passwordHash = await hashPassword(storePassword);
  const today = todayInBogota();
  await database.withTransaction(async (client) => {
    for (const store of seedStores) await seedStore(client, store, passwordHash, today);
    await seedCustomer(client, passwordHash);
  });
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seed()
    .then(() => pool.end())
    .catch(async (error) => {
      console.error('No se pudo ejecutar el seed.', error instanceof Error ? error.message : error);
      await pool.end();
      process.exitCode = 1;
    });
}
