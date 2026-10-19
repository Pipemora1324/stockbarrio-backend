CREATE TABLE IF NOT EXISTS alert_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  query VARCHAR(80),
  category VARCHAR(80),
  neighborhood VARCHAR(80),
  -- Approximate position (3 decimals, about 100 m), saved only with the customer's explicit consent.
  latitude NUMERIC(7,3),
  longitude NUMERIC(7,3),
  radius_km NUMERIC(4,1),
  min_discount INTEGER NOT NULL DEFAULT 0 CHECK (min_discount BETWEEN 0 AND 100),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (query IS NOT NULL OR category IS NOT NULL),
  CHECK ((latitude IS NULL) = (longitude IS NULL)),
  CHECK (radius_km IS NULL OR (latitude IS NOT NULL AND radius_km > 0 AND radius_km <= 50))
);

CREATE INDEX IF NOT EXISTS idx_alert_subscriptions_active ON alert_subscriptions(active, min_discount);
CREATE INDEX IF NOT EXISTS idx_alert_subscriptions_user ON alert_subscriptions(user_id);

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES alert_subscriptions(id) ON DELETE SET NULL,
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  title VARCHAR(120) NOT NULL,
  message VARCHAR(400) NOT NULL,
  channel VARCHAR(20) NOT NULL DEFAULT 'in_app',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  read_at TIMESTAMPTZ
);

-- One notice per product and subscription.
CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_subscription_product ON notifications(subscription_id, product_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC);
