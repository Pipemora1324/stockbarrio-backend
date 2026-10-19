import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { storeRepository, type StoreRecord } from '../repositories/store.js';

export type UserRole = 'admin' | 'store';

export interface AuthenticatedRequest extends Request {
  user?: { id: string; role: UserRole; name: string; email?: string; storeId?: string };
  store?: StoreRecord;
}

export const authenticate = (request: AuthenticatedRequest, response: Response, next: NextFunction) => {
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) {
    response.status(401).json({ message: 'Se requiere un token de autenticación.' });
    return;
  }
  try {
    request.user = jwt.verify(token, config.jwtSecret) as AuthenticatedRequest['user'];
    next();
  } catch {
    response.status(401).json({ message: 'El token de autenticación es inválido o caducó.' });
  }
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
