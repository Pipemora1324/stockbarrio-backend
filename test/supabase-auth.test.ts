import { integrationSkip, useTestApi } from './helpers/api.js';
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import jwt from 'jsonwebtoken';
import { config } from '../src/config.js';
import { addDays, todayInBogota } from '../src/dates.js';
import { resetJwksCache, SupabaseTokenError, supabaseIssuer, verifySupabaseToken } from '../src/services/supabase-token.js';

const projectUrl = 'https://proyecto-prueba.supabase.co';
const jwksUrl = `${projectUrl}/auth/v1/.well-known/jwks.json`;
const issuer = `${projectUrl}/auth/v1`;
const sharedSecret = 'secreto-hs256-de-prueba-con-mas-de-32-caracteres';

// Test keys made on the fly: the ES256 one is published in a simulated JWKS, the other one is an impostor.
const signing = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const impostor = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const publicJwk = { ...signing.publicKey.export({ format: 'jwk' }), kid: 'clave-1', alg: 'ES256', use: 'sig' };

interface TokenOptions {
  sub?: string;
  email?: string;
  verified?: boolean;
  metadata?: Record<string, unknown>;
  audience?: string;
  issuer?: string;
  expiresIn?: number;
  key?: 'es256' | 'impostor' | 'hs256';
  role?: string;
  kid?: string;
}

const tokenFor = ({ sub = randomUUID(), email = 'ana@correo.co', verified = true, metadata = {}, audience = 'authenticated', issuer: iss = issuer, expiresIn = 3600, key = 'es256', role = 'authenticated', kid = 'clave-1' }: TokenOptions = {}) => {
  const payload = { sub, email, role, aal: 'aal1', is_anonymous: false, user_metadata: { ...metadata, email_verified: verified } };
  const options = { audience, issuer: iss, expiresIn };
  if (key === 'hs256') return jwt.sign(payload, sharedSecret, { ...options, algorithm: 'HS256' });
  return jwt.sign(payload, (key === 'es256' ? signing : impostor).privateKey, { ...options, algorithm: 'ES256', keyid: kid });
};

// The JWKS endpoint answers from memory; every other request (the API under test) goes through.
const simulateJwks = (answer: () => Response = () => new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 })) => {
  const calls: string[] = [];
  const realFetch = globalThis.fetch;
  mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url !== jwksUrl) return realFetch(input, init);
    calls.push(url);
    return answer();
  });
  return calls;
};

const useSupabase = () => Object.assign(config, { authProvider: 'supabase', supabaseUrl: projectUrl, supabaseJwksUrl: jwksUrl, supabaseJwtSecret: '' });

describe('Supabase token verification', () => {
  const original = { ...config };
  beforeEach(() => {
    useSupabase();
    resetJwksCache();
  });
  afterEach(() => {
    Object.assign(config, original);
    mock.restoreAll();
    resetJwksCache();
  });

  const reasonOf = (token: string) => verifySupabaseToken(token).then(() => 'ok', (error: unknown) => (error instanceof SupabaseTokenError ? error.reason : String(error)));

  it('accepts a valid ES256 token from the JWKS and caches the keys', async () => {
    const calls = simulateJwks();
    const sub = randomUUID();
    const claims = await verifySupabaseToken(tokenFor({ sub, email: ' Ana@Correo.CO ', metadata: { name: 'Ana' } }));
    assert.deepEqual([claims.sub, claims.email, claims.emailVerified, claims.metadata.name], [sub, 'ana@correo.co', true, 'Ana']);
    await verifySupabaseToken(tokenFor());
    assert.equal(calls.length, 1, 'the keys are fetched once');
  });

  it('rejects expired tokens, forged signatures, other audiences or issuers and non-authenticated roles', async () => {
    simulateJwks();
    assert.equal(await reasonOf(tokenFor({ expiresIn: -60 })), 'expired');
    assert.equal(await reasonOf(tokenFor({ key: 'impostor' })), 'invalid', 'signed with another key under the same kid');
    assert.equal(await reasonOf(tokenFor({ audience: 'otra-app' })), 'invalid');
    assert.equal(await reasonOf(tokenFor({ issuer: 'https://otro.supabase.co/auth/v1' })), 'invalid');
    assert.equal(await reasonOf(tokenFor({ role: 'anon' })), 'invalid');
    assert.equal(await reasonOf(tokenFor({ sub: 'no-es-un-uuid' })), 'invalid');
    assert.equal(await reasonOf('no.es.un-token'), 'invalid');
  });

  it('never accepts HS256 when only the JWKS is configured, and accepts it with SUPABASE_JWT_SECRET', async () => {
    simulateJwks();
    assert.equal(await reasonOf(tokenFor({ key: 'hs256' })), 'invalid');
    Object.assign(config, { supabaseJwksUrl: '', supabaseJwtSecret: sharedSecret });
    assert.equal(await reasonOf(tokenFor({ key: 'hs256' })), 'ok');
    assert.equal(await reasonOf(tokenFor()), 'invalid', 'ES256 without JWKS');
  });

  it('refreshes the keys for an unknown kid only after a pause, and reports an unreachable JWKS', async () => {
    const calls = simulateJwks();
    assert.equal(await reasonOf(tokenFor({ kid: 'clave-rotada' })), 'invalid');
    assert.equal(calls.length, 1, 'right after a fetch an unknown kid does not fetch again');
    mock.restoreAll();
    resetJwksCache();
    simulateJwks(() => new Response('caído', { status: 502 }));
    assert.equal(await reasonOf(tokenFor()), 'unavailable');
  });

  it('takes the issuer from the JWKS URL when SUPABASE_URL is empty', () => {
    config.supabaseUrl = '';
    assert.equal(supabaseIssuer(), issuer);
  });
});

describe('API with AUTH_PROVIDER=supabase', { skip: integrationSkip }, () => {
  const context = useTestApi();
  const { call, registerStore } = context;
  const original = { ...config };
  let visitor = 0;
  beforeEach(() => {
    context.clientIp = `10.7.0.${++visitor}`;
    useSupabase();
    resetJwksCache();
    simulateJwks();
  });
  afterEach(() => {
    Object.assign(config, original);
    mock.restoreAll();
    resetJwksCache();
  });

  const storeMetadata = { accountType: 'store', name: 'Luz Marina', storeName: 'Tienda Supa', neighborhood: 'Chapinero', address: 'Calle 1 # 2-3', phone: '3101234567' };
  const product = { name: 'Leche entera', category: 'Lácteos', price: 4900, stock: 5, expirationDate: addDays(todayInBogota(), 3) };

  it('creates a customer profile on the first request, ignoring any role written in the metadata', async () => {
    const token = tokenFor({ email: 'nueva.cliente@stockbarrio.test', metadata: { name: 'Ana Pérez', role: 'admin', app_role: 'admin' } });
    const me = await call('GET', '/api/auth/me', undefined, token);
    assert.equal(me.status, 200);
    assert.deepEqual([me.body.user.role, me.body.user.email, me.body.user.name], ['customer', 'nueva.cliente@stockbarrio.test', 'Ana Pérez']);
    const again = await call('GET', '/api/auth/me', undefined, token);
    assert.equal(again.body.user.id, me.body.user.id, 'the second request reuses the profile');
    assert.equal((await context.pool.query(`SELECT 1 FROM users WHERE role = 'admin'`)).rowCount, 0);
  });

  it('never creates an admin and validates the sign up data with the same rules', async () => {
    const admin = await call('GET', '/api/auth/me', undefined, tokenFor({ email: 'colado@stockbarrio.test', metadata: { accountType: 'admin', name: 'Colado' } }));
    assert.equal(admin.status, 400);
    const badStore = await call('GET', '/api/auth/me', undefined, tokenFor({ email: 'mala@stockbarrio.test', metadata: { ...storeMetadata, name: 'Ana 2', phone: '123' } }));
    assert.equal(badStore.status, 400);
    assert.match(badStore.body.message, /^No pudimos crear tu perfil: /);
    assert.match(badStore.body.message, /teléfono/);
    assert.equal((await context.pool.query(`SELECT 1 FROM users WHERE email IN ('colado@stockbarrio.test', 'mala@stockbarrio.test')`)).rowCount, 0);
  });

  it('creates a store with its data and lets it manage its products', async () => {
    const token = tokenFor({ email: 'tienda.supa@stockbarrio.test', metadata: storeMetadata });
    const me = await call('GET', '/api/auth/me', undefined, token);
    assert.equal(me.body.user.role, 'store');
    const store = await call('GET', '/api/stores/me', undefined, token);
    assert.deepEqual([store.body.data.name, store.body.data.neighborhood, store.body.data.phone], ['Tienda Supa', 'Chapinero', '3101234567']);
    assert.equal((await call('POST', '/api/products', product, token)).status, 201);
    const repeated = await call('GET', '/api/auth/me', undefined, tokenFor({ email: 'otra.tienda@stockbarrio.test', metadata: { ...storeMetadata, storeName: 'tienda supa' } }));
    assert.equal(repeated.status, 409);
  });

  it('links an older account by its confirmed email: same store, products and role', async () => {
    config.authProvider = 'legacy';
    const legacy = await registerStore('vieja-supa');
    const created = await call('POST', '/api/products', product, legacy.token);
    useSupabase();
    const token = tokenFor({ email: 'TIENDA-VIEJA-SUPA@stockbarrio.test', metadata: { accountType: 'customer', name: 'Otra Persona' } });
    const me = await call('GET', '/api/auth/me', undefined, token);
    assert.equal(me.status, 200);
    assert.deepEqual([me.body.user.id, me.body.user.role, me.body.user.storeId], [legacy.user.id, 'store', legacy.user.storeId], 'the metadata never changes an existing account');
    const mine = await call('GET', '/api/products/mine', undefined, token);
    assert.deepEqual(mine.body.data.map((item: { id: string }) => item.id), [created.body.data.id]);
    assert.equal((await call('GET', '/api/auth/me', undefined, legacy.token)).status, 401, 'the old JWT is not accepted in this mode');
  });

  it('does not link a second Supabase user to an account that is already linked', async () => {
    const email = 'una.sola@stockbarrio.test';
    assert.equal((await call('GET', '/api/auth/me', undefined, tokenFor({ email, metadata: { name: 'Una Sola' } }))).status, 200);
    const other = await call('GET', '/api/auth/me', undefined, tokenFor({ email, metadata: { name: 'Una Sola' } }));
    assert.equal(other.status, 409);
    assert.match(other.body.message, /ya está vinculado/);
  });

  it('answers 403 when the email is not confirmed, and links nothing', async () => {
    config.authProvider = 'legacy';
    const legacy = await registerStore('sin-confirmar');
    useSupabase();
    const result = await call('GET', '/api/auth/me', undefined, tokenFor({ email: 'tienda-sin-confirmar@stockbarrio.test', verified: false }));
    assert.equal(result.status, 403);
    assert.match(result.body.message, /Confirma tu correo/);
    const row = await context.pool.query('SELECT auth_id FROM users WHERE id = $1', [legacy.user.id]);
    assert.equal(row.rows[0].auth_id, null);
  });

  it('answers 401 for expired, forged or foreign tokens, and 503 when the keys cannot be read', async () => {
    const expired = await call('GET', '/api/auth/me', undefined, tokenFor({ expiresIn: -10 }));
    assert.deepEqual([expired.status, expired.body.message], [401, 'Tu sesión expiró. Vuelve a iniciar sesión.']);
    assert.equal((await call('GET', '/api/auth/me', undefined, tokenFor({ key: 'impostor' }))).status, 401);
    assert.equal((await call('GET', '/api/auth/me', undefined, tokenFor({ audience: 'otra-app' }))).status, 401);
    mock.restoreAll();
    resetJwksCache();
    simulateJwks(() => new Response('caído', { status: 503 }));
    assert.equal((await call('GET', '/api/auth/me', undefined, tokenFor())).status, 503);
  });

  it('answers 503 when the supabase mode has no keys configured', async () => {
    Object.assign(config, { supabaseJwksUrl: '', supabaseJwtSecret: '' });
    const result = await call('GET', '/api/auth/me', undefined, tokenFor());
    assert.equal(result.status, 503);
    assert.match(result.body.message, /no está configurado/);
  });

  it('keeps the legacy endpoints with a clear 404', async () => {
    for (const [method, path] of [['POST', '/api/auth/login'], ['POST', '/api/auth/register'], ['POST', '/api/auth/forgot-password'], ['POST', '/api/auth/reset-password'], ['POST', '/api/account/email/confirm']]) {
      const result = await call(method, path, { email: 'ana@correo.co', password: 'cliente12345', token: 'x'.repeat(30) });
      assert.equal(result.status, 404, path);
      assert.match(result.body.message, /se hacen con Supabase Auth/, path);
    }
    const token = tokenFor({ email: 'perfil.supa@stockbarrio.test', metadata: { name: 'Perfil Supa' } });
    assert.equal((await call('POST', '/api/account/password', { currentPassword: 'a', newPassword: 'b' }, token)).status, 404);
    assert.equal((await call('POST', '/api/account/email', { newEmail: 'x@y.co', currentPassword: 'a' }, token)).status, 404);
  });

  it('changes the name in public.users without issuing an own token', async () => {
    const token = tokenFor({ email: 'nombre.supa@stockbarrio.test', metadata: { name: 'Nombre Viejo' } });
    await call('GET', '/api/auth/me', undefined, token);
    const result = await call('PATCH', '/api/account/name', { name: 'Nombre Nuevo' }, token);
    assert.equal(result.status, 200);
    assert.equal(result.body.user.name, 'Nombre Nuevo');
    assert.equal(result.body.token, undefined);
    assert.equal((await call('PATCH', '/api/account/name', { name: 'Nombre 2' }, token)).status, 400);
  });

  it('follows the email confirmed in Supabase after a change', async () => {
    const sub = randomUUID();
    await call('GET', '/api/auth/me', undefined, tokenFor({ sub, email: 'antes.supa@stockbarrio.test', metadata: { name: 'Cambia Correo' } }));
    const me = await call('GET', '/api/auth/me', undefined, tokenFor({ sub, email: 'despues.supa@stockbarrio.test' }));
    assert.equal(me.body.user.email, 'despues.supa@stockbarrio.test');
  });

  it('uses the Supabase token only as an id for the chat limits', async () => {
    const result = await call('POST', '/api/assistant/chat', { messages: [{ role: 'user', content: 'hola' }] }, tokenFor({ email: 'chat.supa@stockbarrio.test' }));
    assert.equal(result.status, 200);
    assert.equal((await context.pool.query(`SELECT 1 FROM users WHERE email = 'chat.supa@stockbarrio.test'`)).rowCount, 0, 'the chat does not create profiles');
  });
});
