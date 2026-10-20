import { createPublicKey, type JsonWebKeyInput, type KeyObject } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export interface SupabaseClaims {
  sub: string;
  email: string;
  emailVerified: boolean;
  // user_metadata: lo escribe la persona al registrarse, así que solo se usa para los datos del perfil, nunca para los roles.
  metadata: Record<string, unknown>;
}

export class SupabaseTokenError extends Error {
  constructor(readonly reason: 'expired' | 'invalid' | 'unavailable') {
    super(`Token de Supabase ${reason}`);
    this.name = 'SupabaseTokenError';
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Supabase firma sus tokens con iss = <url del proyecto>/auth/v1. Sin SUPABASE_URL se toma de la URL del JWKS.
export const supabaseIssuer = () => {
  const base = config.supabaseUrl || config.supabaseJwksUrl.replace(/\/auth\/v1\/.*$/, '').replace(/\/+$/, '');
  return base ? `${base}/auth/v1` : '';
};

// Lo que falta para el modo supabase, en español (vacío cuando está listo).
export const supabaseAuthProblems = () => [
  ...(config.supabaseJwksUrl || config.supabaseJwtSecret ? [] : ['falta SUPABASE_JWKS_URL (o SUPABASE_JWT_SECRET si el proyecto usa el secreto compartido)']),
  ...(supabaseIssuer() ? [] : ['falta SUPABASE_URL para validar el emisor de los tokens']),
];

// Claves públicas del endpoint JWKS, en caché y renovadas cuando aparece un id de clave desconocido (rotación de claves).
const jwksTtlMs = 10 * 60 * 1000;
const minRefreshMs = 30 * 1000;
const jwksTimeoutMs = 5000;
let jwks: { keys: Map<string, KeyObject>; fetchedAt: number } | null = null;

export const resetJwksCache = () => {
  jwks = null;
};

const loadJwks = async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), jwksTimeoutMs);
  try {
    const response = await fetch(config.supabaseJwksUrl, { signal: controller.signal, headers: { accept: 'application/json' } });
    if (!response.ok) throw new SupabaseTokenError('unavailable');
    const body = (await response.json()) as { keys?: Array<JsonWebKeyInput['key'] & { kid?: string }> };
    const keys = new Map<string, KeyObject>();
    for (const key of body.keys ?? []) {
      if (!key.kid) continue;
      try {
        keys.set(key.kid, createPublicKey({ key, format: 'jwk' }));
      } catch {
        // Se salta una clave que esta versión de Node no puede leer.
      }
    }
    jwks = { keys, fetchedAt: Date.now() };
  } catch (error) {
    if (error instanceof SupabaseTokenError) throw error;
    throw new SupabaseTokenError('unavailable');
  } finally {
    clearTimeout(timer);
  }
};

const publicKeyFor = async (kid: string) => {
  if (!jwks || Date.now() - jwks.fetchedAt > jwksTtlMs) await loadJwks();
  let key = jwks!.keys.get(kid);
  if (!key && Date.now() - jwks!.fetchedAt > minRefreshMs) {
    await loadJwks();
    key = jwks!.keys.get(kid);
  }
  if (!key) throw new SupabaseTokenError('invalid');
  return key;
};

// Verifica la firma, el emisor, la audiencia y el vencimiento. HS256 solo se acepta con SUPABASE_JWT_SECRET y
// RS256/ES256 solo con las claves del JWKS, para que un tipo de clave nunca sirva para falsificar el otro.
export const verifySupabaseToken = async (token: string): Promise<SupabaseClaims> => {
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded || typeof decoded.payload === 'string') throw new SupabaseTokenError('invalid');
  const { alg, kid } = decoded.header;
  let key: string | KeyObject;
  if (alg === 'HS256' && config.supabaseJwtSecret) key = config.supabaseJwtSecret;
  else if ((alg === 'RS256' || alg === 'ES256') && config.supabaseJwksUrl && kid) key = await publicKeyFor(kid);
  else throw new SupabaseTokenError('invalid');

  let payload: jwt.JwtPayload;
  try {
    payload = jwt.verify(token, key, { algorithms: [alg], issuer: supabaseIssuer(), audience: config.supabaseJwtAudience }) as jwt.JwtPayload;
  } catch (error) {
    throw new SupabaseTokenError(error instanceof jwt.TokenExpiredError ? 'expired' : 'invalid');
  }
  if (payload.role !== 'authenticated' || payload.is_anonymous === true || typeof payload.sub !== 'string' || !uuidPattern.test(payload.sub)) throw new SupabaseTokenError('invalid');
  const metadata = typeof payload.user_metadata === 'object' && payload.user_metadata !== null ? (payload.user_metadata as Record<string, unknown>) : {};
  return {
    sub: payload.sub.toLowerCase(),
    email: typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '',
    // Supabase marca user_metadata.email_verified cuando se confirma la dirección.
    emailVerified: metadata.email_verified === true,
    metadata,
  };
};
