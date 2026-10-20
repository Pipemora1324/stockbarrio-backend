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
  // El local con el que trabaja la petición (el de storeId o el principal del vendedor) y todos los locales del vendedor.
  store?: OwnedStoreRecord;
  stores?: OwnedStoreRecord[];
}

const tokenErrors: Record<SupabaseTokenError['reason'], { status: number; message: string }> = {
  expired: { status: 401, message: 'Tu sesión expiró. Vuelve a iniciar sesión.' },
  invalid: { status: 401, message: 'El token de autenticación es inválido o caducó.' },
  unavailable: { status: 503, message: 'No pudimos validar tu sesión en este momento. Inténtalo de nuevo en unos segundos.' },
};

// Modo supabase: el token viene de Supabase Auth; el rol, el local y el perfil salen de public.users.
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
    // Los tokens emitidos antes del último cambio de contraseña o de correo (o de cuentas borradas) ya no sirven.
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

// Lee el token si lo hay, pero deja pasar a los visitantes anónimos (sirve para los límites por persona).
export const optionalAuthenticate = async (request: AuthenticatedRequest, _response: Response, next: NextFunction) => {
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (token && config.authProvider === 'supabase') {
    // Solo un id para los límites: aquí no se crea el perfil, y un token inválido es simplemente un visitante anónimo.
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

// Endpoints del login propio. Con AUTH_PROVIDER=supabase siguen en el código, pero responden 404 con un mensaje claro.
export const legacyAuthOnly = (_request: Request, response: Response, next: NextFunction) => {
  if (config.authProvider !== 'supabase') return next();
  response.status(404).json({ message: 'Esta opción ya no está disponible aquí: el registro, el inicio de sesión y la recuperación de contraseña se hacen con Supabase Auth desde la app.' });
};

const storeOnlyMessage = 'Solo las tiendas pueden gestionar productos.';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Solo el rol: un vendedor puede no tener locales todavía (por ejemplo, después de eliminarlos todos).
export const requireStoreRole = (request: AuthenticatedRequest, response: Response, next: NextFunction) => {
  if (request.user?.role !== 'store') {
    response.status(403).json({ message: storeOnlyMessage });
    return;
  }
  next();
};

// storeId puede venir en la query (?storeId=) o en el cuerpo. Los clientes viejos no lo envían.
const requestedStoreId = (request: Request): string | undefined => {
  const value = (request.query as Record<string, unknown> | undefined)?.storeId ?? (request.body as Record<string, unknown> | undefined)?.storeId;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
};

// Carga el local con el que trabaja la petición: el de storeId (debe ser del vendedor, si no 403) o el principal.
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
