import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'store';
  storeId?: string;
}

export const hashPassword = (password: string) => bcrypt.hash(password, 12);
export const verifyPassword = (password: string, hashedPassword: string) => bcrypt.compare(password, hashedPassword);
export const createToken = (user: AuthUser) => jwt.sign(user, config.jwtSecret, { expiresIn: config.jwtExpiresIn as jwt.SignOptions['expiresIn'] });
