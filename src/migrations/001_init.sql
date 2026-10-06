CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  email VARCHAR(160) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'store')),
  store_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS stores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  neighborhood VARCHAR(80) NOT NULL,
  address VARCHAR(200) NOT NULL,
  phone VARCHAR(30),
  latitude NUMERIC(9,6),
  longitude NUMERIC(9,6),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  category VARCHAR(80) NOT NULL DEFAULT 'Alimentación',
  description VARCHAR(500) NOT NULL DEFAULT '',
  price NUMERIC(12,2) NOT NULL CHECK (price >= 0),
  offer_price NUMERIC(12,2) NOT NULL CHECK (offer_price >= 0),
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  expiration_date DATE NOT NULL,
  discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (discount_percent BETWEEN 0 AND 100),
  image_url VARCHAR(300) NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_products_expiration ON products(expiration_date);
CREATE INDEX IF NOT EXISTS idx_products_store ON products(store_id);
CREATE INDEX IF NOT EXISTS idx_stores_neighborhood ON stores(neighborhood);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

INSERT INTO users (name, email, password_hash, role)
VALUES ('Administrador', 'admin@stockbarrios.local', '$2b$12$L4T2dQ1F2D2B4c3.WFzA0eO1pD0H3K7l8m9n1o2p', 'admin')
ON CONFLICT (email) DO NOTHING;
