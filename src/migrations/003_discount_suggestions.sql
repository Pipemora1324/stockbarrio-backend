CREATE TABLE IF NOT EXISTS discount_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  current_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  suggested_percent NUMERIC(5,2) NOT NULL CHECK (suggested_percent BETWEEN 0 AND 100),
  suggested_price NUMERIC(12,2) NOT NULL CHECK (suggested_price >= 0),
  days_to_expire INTEGER NOT NULL,
  reason VARCHAR(500) NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  source VARCHAR(20) NOT NULL DEFAULT 'local' CHECK (source IN ('local', 'ai')),
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_at TIMESTAMPTZ
);

-- At most one open suggestion per product.
CREATE UNIQUE INDEX IF NOT EXISTS uq_discount_suggestions_pending ON discount_suggestions(product_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_discount_suggestions_store_status ON discount_suggestions(store_id, status);
