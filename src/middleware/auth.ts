import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { storeRepository, type StoreRecord } from '../repositories/store.js';
import { userRepository } from '../repositories/user.js';

export type UserRole = 'admin' | 'store' | 'customer';

export interface AuthenticatedRequest extends Request {
  user?: { id: string; role: UserRole; name: string; email?: string; storeId?: string; tv?: number };
  store?: StoreRecord;
}

export const authenticate = async (request: AuthenticatedRequest, response: Response, next: NextFunction) => {
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) {
    response.status(401).json({ message: 'Se requiere un token de autenticación.' });
    return;
  }
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
export const optionalAuthenticate = (request: AuthenticatedRequest, _response: Response, next: NextFunction) => {
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (token) {
    try {
      request.user = jwt.verify(token, config.jwtSecret) as AuthenticatedRequest['user'];
    } catch {
      request.user = undefined;
    }
  }
  next();
};

export const requireAdmin = (request: AuthenticatedRequest, response: Response, next: NextFunction) => {
  if (request.user?.role !== 'admin') {
    response.status(403).json({ message: 'Solo los administradores pueden realizar esta operación.' });
    return;
  }
  next();
};

export const requireStore = async (request: AuthenticatedRequest, response: Response, next: NextFunction) => {
  if (request.user?.role !== 'store') {
    response.status(403).json({ message: 'Solo las tiendas pueden gestionar productos.' });
    return;
  }
  try {
    const store = await storeRepository.getByUserId(request.user.id);
    if (!store) {
      response.status(403).json({ message: 'Tu cuenta no tiene una tienda asociada.' });
      return;
    }
    request.store = store;
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
