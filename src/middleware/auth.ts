import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export interface AuthenticatedRequest extends Request {
  user?: { id: string; role: 'admin' | 'store'; name: string; storeId?: string };
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
