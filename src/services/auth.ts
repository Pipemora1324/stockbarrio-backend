import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'store' | 'customer';
  storeId?: string;
}

export const hashPassword = (password: string) => bcrypt.hash(password, 12);
// Un hash guardado dañado cuenta como login fallido, nunca como error del servidor.
export const verifyPassword = async (password: string, hashedPassword: string) => {
  try {
    return await bcrypt.compare(password, hashedPassword);
  } catch {
    return false;
  }
};
// "tv" es la versión del token de la cuenta: las sesiones firmadas con una versión vieja se rechazan.
export const createToken = (user: AuthUser, tokenVersion = 0) =>
  jwt.sign({ ...user, tv: tokenVersion }, config.jwtSecret, { expiresIn: config.jwtExpiresIn as jwt.SignOptions['expiresIn'] });
