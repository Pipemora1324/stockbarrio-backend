-- Widens the allowed roles with 'customer'. Existing rows already satisfy the new rule, so nothing is rewritten.
-- The migrator runs this file inside a transaction: if anything fails, the old constraint stays.
DO $$
DECLARE
  role_constraint text;
BEGIN
  FOR role_constraint IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'users'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%role%'
  LOOP
    EXECUTE format('ALTER TABLE users DROP CONSTRAINT %I', role_constraint);
  END LOOP;
  ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'store', 'customer'));
END $$;
