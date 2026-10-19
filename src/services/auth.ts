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
// A malformed stored hash must count as a failed login, never as a server error.
export const verifyPassword = async (password: string, hashedPassword: string) => {
  try {
    return await bcrypt.compare(password, hashedPassword);
  } catch {
    return false;
  }
};
// "tv" is the account's token version: sessions signed with an older version are rejected.
export const createToken = (user: AuthUser, tokenVersion = 0) =>
  jwt.sign({ ...user, tv: tokenVersion }, config.jwtSecret, { expiresIn: config.jwtExpiresIn as jwt.SignOptions['expiresIn'] });
