import { z } from 'zod';
import { database } from '../database.js';
import { AppError, badRequest, conflict } from '../errors.js';
import { storeRepository } from '../repositories/store.js';
import { userRepository, type UserRecord } from '../repositories/user.js';
import { addressSchema, neighborhoodSchema, personNameSchema, phoneSchema, storeNameSchema } from '../validation.js';
import type { SupabaseClaims } from './supabase-token.js';

// Profiles created from Supabase have no local password: this value can never match a bcrypt hash.
export const noLocalPassword = '!supabase';

// Sign up data saved by the frontend in user_metadata. It only describes the profile: the role is decided here
// (store or customer, never admin) and an existing account always keeps the role it already has.
const customerSchema = z.object({ accountType: z.literal('customer').optional(), name: personNameSchema });
const storeSchema = z.object({
  accountType: z.literal('store'),
  name: personNameSchema,
  storeName: storeNameSchema,
  neighborhood: neighborhoodSchema,
  address: addressSchema,
  phone: phoneSchema.optional(),
});

export const emailNotVerified = () => new AppError(403, 'Confirma tu correo con el enlace que te enviamos antes de entrar.');

const userColumns = 'id, name, email, password_hash AS "passwordHash", role, store_id AS "storeId", token_version AS "tokenVersion", created_at AS "createdAt"';

const isUniqueViolation = (error: unknown) => typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505';

const createProfile = async (claims: SupabaseClaims): Promise<UserRecord> => {
  const data = claims.metadata;
  if (data.accountType === 'store') {
    const input = storeSchema.parse(data);
    if (await storeRepository.isNameTaken(input.storeName, input.neighborhood)) throw conflict('Ya existe una tienda con este nombre en ese barrio.');
    return database.withTransaction(async (client) => {
      const user = await client.query<{ id: string }>(`INSERT INTO users (name, email, password_hash, role, auth_id) VALUES ($1, $2, $3, 'store', $4) RETURNING id`, [input.name, claims.email, noLocalPassword, claims.sub]);
      const store = await client.query<{ id: string }>('INSERT INTO stores (user_id, name, neighborhood, address, phone) VALUES ($1,$2,$3,$4,$5) RETURNING id', [user.rows[0].id, input.storeName, input.neighborhood, input.address, input.phone ?? '']);
      await client.query('UPDATE users SET store_id = $1 WHERE id = $2', [store.rows[0].id, user.rows[0].id]);
      return (await client.query<UserRecord>(`SELECT ${userColumns} FROM users WHERE id = $1`, [user.rows[0].id])).rows[0];
    });
  }
  const input = customerSchema.parse(data);
  return (await database.query<UserRecord>(`INSERT INTO users (name, email, password_hash, role, auth_id) VALUES ($1, $2, $3, 'customer', $4) RETURNING ${userColumns}`, [input.name, claims.email, noLocalPassword, claims.sub])).rows[0];
};

// Keeps the local email equal to the confirmed one after the person changes it in Supabase.
const syncEmail = async (user: UserRecord, claims: SupabaseClaims) => {
  if (!claims.emailVerified || !claims.email || user.email.trim().toLowerCase() === claims.email) return user;
  const taken = await database.query('SELECT 1 FROM users WHERE lower(trim(email)) = $1 AND id <> $2', [claims.email, user.id]);
  if (taken.rowCount) return user;
  return (await database.query<UserRecord>(`UPDATE users SET email = $2 WHERE id = $1 RETURNING ${userColumns}`, [user.id, claims.email])).rows[0];
};

// The local profile for a verified Supabase token: already linked, an older account with the same confirmed
// email (it keeps its store, products and role), or a new store or customer created from the sign up data.
export const resolveSupabaseUser = async (claims: SupabaseClaims, attempt = 0): Promise<UserRecord> => {
  const linked = await userRepository.getByAuthId(claims.sub);
  if (linked) return syncEmail(linked, claims);
  if (!claims.emailVerified || !claims.email) throw emailNotVerified();
  try {
    const existing = await userRepository.getByEmail(claims.email);
    if (existing) {
      const updated = await database.query<UserRecord>(`UPDATE users SET auth_id = $2 WHERE id = $1 AND auth_id IS NULL RETURNING ${userColumns}`, [existing.id, claims.sub]);
      if (!updated.rows[0]) throw conflict('Este correo ya está vinculado a otra cuenta de StockBarrio. Escríbenos para revisarlo.');
      return updated.rows[0];
    }
    return await createProfile(claims);
  } catch (error) {
    // Two first requests at the same time: the other one linked or created the profile, so read it again.
    if (isUniqueViolation(error) && attempt === 0) return resolveSupabaseUser(claims, 1);
    if (error instanceof z.ZodError) throw badRequest(`No pudimos crear tu perfil: ${error.issues.map((issue) => issue.message).join(' ')}`);
    throw error;
  }
};
