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
// A malformed stored hash must count as a failed login, never as a server error.
export const verifyPassword = async (password: string, hashedPassword: string) => {
  try {
    return await bcrypt.compare(password, hashedPassword);
  } catch {
    return false;
  }
};
export const createToken = (user: AuthUser) => jwt.sign(user, config.jwtSecret, { expiresIn: config.jwtExpiresIn as jwt.SignOptions['expiresIn'] });
