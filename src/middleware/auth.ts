import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { storeRepository, type OwnedStoreRecord } from '../repositories/store.js';
import { userRepository } from '../repositories/user.js';
import { AppError } from '../errors.js';
import { resolveSupabaseUser } from '../services/supabase-profile.js';
import { SupabaseTokenError, supabaseAuthProblems, verifySupabaseToken } from '../services/supabase-token.js';

export type UserRole = 'admin' | 'store' | 'customer';

export interface AuthenticatedRequest extends Request {
  user?: { id: string; role: UserRole; name: string; email?: string; storeId?: string; tv?: number };
  // The store the request works on (the one in storeId, or the seller's main store) and all the seller's stores.
  store?: OwnedStoreRecord;
  stores?: OwnedStoreRecord[];
}

const tokenErrors: Record<SupabaseTokenError['reason'], { status: number; message: string }> = {
  expired: { status: 401, message: 'Tu sesión expiró. Vuelve a iniciar sesión.' },
  invalid: { status: 401, message: 'El token de autenticación es inválido o caducó.' },
  unavailable: { status: 503, message: 'No pudimos validar tu sesión en este momento. Inténtalo de nuevo en unos segundos.' },
};

// Supabase mode: the token comes from Supabase Auth; the role, the store and the profile come from public.users.
const authenticateWithSupabase = async (token: string, request: AuthenticatedRequest, response: Response, next: NextFunction) => {
  if (supabaseAuthProblems().length) {
    response.status(503).json({ message: 'El inicio de sesión todavía no está configurado en el servidor. Inténtalo más tarde.' });
    return;
  }
  try {
    const user = await resolveSupabaseUser(await verifySupabaseToken(token));
    request.user = { id: user.id, role: user.role, name: user.name, email: user.email, storeId: user.storeId ?? undefined };
    next();
  } catch (error) {
    if (error instanceof SupabaseTokenError) {
      const { status, message } = tokenErrors[error.reason];
      response.status(status).json({ message });
      return;
    }
    if (error instanceof AppError) {
      response.status(error.status).json({ message: error.message });
      return;
    }
    next(error);
  }
};

export const authenticate = async (request: AuthenticatedRequest, response: Response, next: NextFunction) => {
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) {
    response.status(401).json({ message: 'Se requiere un token de autenticación.' });
    return;
  }
  if (config.authProvider === 'supabase') return authenticateWithSupabase(token, request, response, next);
  let user: AuthenticatedRequest['user'];
  try {
    user = jwt.verify(token, config.jwtSecret) as AuthenticatedRequest['user'];
  } catch {
    response.status(401).json({ message: 'El token de autenticación es inválido o caducó.' });
    return;
  }
  try {
    // Tokens issued before the last password or email change (or for deleted accounts) are no longer valid.
    const currentVersion = await userRepository.getTokenVersion(user!.id);
    if (currentVersion === undefined || currentVersion !== (user!.tv ?? 0)) {
      response.status(401).json({ message: 'Tu sesión ya no es válida. Vuelve a iniciar sesión.' });
      return;
    }
    request.user = user;
    next();
  } catch (error) {
    next(error);
  }
};

// Reads the token when there is one, but lets anonymous visitors through (used for per-user limits).
export const optionalAuthenticate = async (request: AuthenticatedRequest, _response: Response, next: NextFunction) => {
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (token && config.authProvider === 'supabase') {
    // Only an id for the limits: the profile is not created here, and an invalid token is just an anonymous visitor.
    try {
      const claims = await verifySupabaseToken(token);
      const user = await userRepository.getByAuthId(claims.sub);
      request.user = user ? { id: user.id, role: user.role, name: user.name } : { id: `auth:${claims.sub}`, role: 'customer', name: '' };
    } catch {
      request.user = undefined;
    }
  } else if (token) {
    try {
      request.user = jwt.verify(token, config.jwtSecret) as AuthenticatedRequest['user'];
    } catch {
      request.user = undefined;
    }
  }
  next();
};

// Endpoints of the own login. With AUTH_PROVIDER=supabase they stay in the code but answer 404 with a clear message.
export const legacyAuthOnly = (_request: Request, response: Response, next: NextFunction) => {
  if (config.authProvider !== 'supabase') return next();
  response.status(404).json({ message: 'Esta opción ya no está disponible aquí: el registro, el inicio de sesión y la recuperación de contraseña se hacen con Supabase Auth desde la app.' });
};

const storeOnlyMessage = 'Solo las tiendas pueden gestionar productos.';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Only the role: a seller may have no store yet (for example after deleting all of them).
export const requireStoreRole = (request: AuthenticatedRequest, response: Response, next: NextFunction) => {
  if (request.user?.role !== 'store') {
    response.status(403).json({ message: storeOnlyMessage });
    return;
  }
  next();
};

// storeId can come in the query (?storeId=) or in the body. Older clients do not send it.
const requestedStoreId = (request: Request): string | undefined => {
  const value = (request.query as Record<string, unknown> | undefined)?.storeId ?? (request.body as Record<string, unknown> | undefined)?.storeId;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
};

// Loads the store the request works on: the one in storeId (it must belong to the seller, 403 if not) or the main one.
export const requireStore = async (request: AuthenticatedRequest, response: Response, next: NextFunction) => {
  if (request.user?.role !== 'store') {
    response.status(403).json({ message: storeOnlyMessage });
    return;
  }
  try {
    const stores = await storeRepository.listByUser(request.user.id);
    const wanted = requestedStoreId(request);
    if (wanted && !uuidPattern.test(wanted)) {
      response.status(400).json({ message: 'El local elegido no es válido.' });
      return;
    }
    const store = wanted ? stores.find((candidate) => candidate.id === wanted) : stores[0];
    if (wanted && !store) {
      response.status(403).json({ message: 'Este local no pertenece a tu cuenta.' });
      return;
    }
    if (!store) {
      response.status(403).json({ message: 'Tu cuenta no tiene una tienda asociada. Crea un local para empezar.' });
      return;
    }
    request.store = store;
    request.stores = stores;
    next();
  } catch (error) {
    next(error);
  }
};

export const requireCustomer = (request: AuthenticatedRequest, response: Response, next: NextFunction) => {
  if (request.user?.role !== 'customer') {
    response.status(403).json({ message: 'Esta sección es solo para cuentas de cliente.' });
    return;
  }
  next();
};
