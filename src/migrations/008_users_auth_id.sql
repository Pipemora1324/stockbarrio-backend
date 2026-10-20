-- Supabase Auth user (auth.users.id) linked to the local profile. Null for accounts that still use the legacy login.
-- Additive: existing rows keep working; RLS is already enabled on users (migration 002).
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_id UUID;
CREATE UNIQUE INDEX IF NOT EXISTS users_auth_id_key ON users (auth_id) WHERE auth_id IS NOT NULL;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
