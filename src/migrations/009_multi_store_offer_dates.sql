-- 1) Several stores per seller. The only allowed non-additive change of the project: the UNIQUE constraint of
-- stores.user_id is removed (see CAMBIOS.md). No row or column is touched, and a plain index keeps the lookups fast.
DO $$
DECLARE
  unique_constraint text;
BEGIN
  FOR unique_constraint IN
    SELECT c.conname FROM pg_constraint c
    WHERE c.conrelid = 'stores'::regclass AND c.contype = 'u'
      AND c.conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'stores'::regclass AND attname = 'user_id')]::int2[]
  LOOP
    EXECUTE format('ALTER TABLE stores DROP CONSTRAINT %I', unique_constraint);
  END LOOP;
END $$;
CREATE INDEX IF NOT EXISTS idx_stores_user ON stores(user_id);

-- 2) Offers with a date range (Bogota calendar days). An offer is active only while today is between both dates.
ALTER TABLE products ADD COLUMN IF NOT EXISTS offer_starts_on DATE;
ALTER TABLE products ADD COLUMN IF NOT EXISTS offer_ends_on DATE;
ALTER TABLE products ADD CONSTRAINT products_offer_range_check CHECK (offer_starts_on IS NULL OR offer_ends_on IS NULL OR offer_ends_on >= offer_starts_on);

-- Offers that already exist keep showing exactly as before: from the day they were created until the expiration date.
UPDATE products
SET offer_starts_on = LEAST((created_at AT TIME ZONE 'America/Bogota')::date, expiration_date),
    offer_ends_on = expiration_date
WHERE discount_percent > 0 AND offer_starts_on IS NULL AND offer_ends_on IS NULL;

ALTER TABLE stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
