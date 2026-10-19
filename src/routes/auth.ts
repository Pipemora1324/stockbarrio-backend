import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { genericResetMessage, requestPasswordReset, resetPassword, toAuthUser } from '../services/account.js';
import { createToken, hashPassword, verifyPassword } from '../services/auth.js';
import { userRepository } from '../repositories/user.js';
import { database } from '../database.js';
import { authenticate, type AuthenticatedRequest } from '../middleware/auth.js';
import { addressSchema, emailSchema, neighborhoodSchema, passwordDiffersFromEmail, passwordEqualsEmailMessage, passwordSchema, personNameSchema, phoneSchema, storeNameSchema } from '../validation.js';

const router = Router();
// Public registration creates store or customer accounts, never admins (those come from the seed script).
const accountSchema = {
  name: personNameSchema,
  email: emailSchema,
  password: passwordSchema,
};
const passwordNotEmail = <T extends { email: string; password: string }>(schema: z.ZodType<T>) =>
  schema.refine((input) => passwordDiffersFromEmail(input.password, input.email), { message: passwordEqualsEmailMessage, path: ['password'] });
const customerRegisterSchema = passwordNotEmail(z.object({ accountType: z.literal('customer'), ...accountSchema }));
// accountType is optional for stores so older clients keep working.
const registerSchema = passwordNotEmail(
  z.object({
    accountType: z.literal('store').optional(),
    ...accountSchema,
    storeName: storeNameSchema,
    neighborhood: neighborhoodSchema,
    address: addressSchema,
    phone: phoneSchema.optional(),
  }),
);
// Login stays lenient with the format so older accounts can always sign in.
const loginSchema = z.object({ email: z.string().trim().toLowerCase().min(3).max(254), password: z.string().min(1).max(200) });

router.post('/register', async (request, response, next) => {
  try {
    if (request.body?.accountType === 'customer') {
      const input = customerRegisterSchema.parse(request.body);
      if (await userRepository.getByEmail(input.email)) return response.status(409).json({ message: 'Este correo electrónico ya está registrado.' });
      const created = await userRepository.create({ name: input.name, email: input.email, passwordHash: await hashPassword(input.password), role: 'customer' });
      const user = toAuthUser(created);
      return response.status(201).json({ message: 'La cuenta se ha creado correctamente.', token: createToken(user), user });
    }
    const input = registerSchema.parse(request.body);
    if (await userRepository.getByEmail(input.email)) return response.status(409).json({ message: 'Este correo electrónico ya está registrado.' });
    const stores = await database.query('SELECT id FROM stores WHERE lower(name) = lower($1) AND lower(neighborhood) = lower($2)', [input.storeName, input.neighborhood]);
    if (stores.rows.length) return response.status(409).json({ message: 'Ya existe una tienda con este nombre en ese barrio.' });
    const passwordHash = await hashPassword(input.password);
    const user = await database.withTransaction(async (client) => {
      const createdUser = await client.query<{ id: string; name: string; email: string }>(
        'INSERT INTO users (name, email, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING id, name, email',
        [input.name, input.email.toLowerCase(), passwordHash, 'store'],
      );
      const createdStore = await client.query<{ id: string }>(
        'INSERT INTO stores (user_id, name, neighborhood, address, phone) VALUES ($1,$2,$3,$4,$5) RETURNING id',
        [createdUser.rows[0].id, input.storeName, input.neighborhood, input.address, input.phone ?? ''],
      );
      await client.query('UPDATE users SET store_id = $1 WHERE id = $2', [createdStore.rows[0].id, createdUser.rows[0].id]);
      return toAuthUser({ ...createdUser.rows[0], role: 'store', storeId: createdStore.rows[0].id });
    });
    response.status(201).json({ message: 'La cuenta se ha creado correctamente.', token: createToken(user), user });
  } catch (error) {
    next(error);
  }
});

router.post('/login', async (request, response, next) => {
  try {
    const input = loginSchema.parse(request.body);
    const user = await userRepository.getByEmail(input.email);
    if (!user || !(await verifyPassword(input.password, user.passwordHash))) return response.status(401).json({ message: 'El correo o la contraseña son incorrectos.' });
    const safeUser = toAuthUser(user);
    response.json({ message: 'Inicio de sesión correcto.', token: createToken(safeUser, user.tokenVersion), user: safeUser });
  } catch (error) {
    next(error);
  }
});

router.get('/me', authenticate, async (request: AuthenticatedRequest, response, next) => {
  try {
    const user = await userRepository.getById(request.user!.id);
    if (!user) return response.status(401).json({ message: 'La sesión ya no es válida.' });
    response.json({ user: toAuthUser(user) });
  } catch (error) {
    next(error);
  }
});

const forgotSchema = z.object({ email: emailSchema });
const resetSchema = z.object({ token: z.string().trim().min(20, 'El enlace no es válido.').max(200, 'El enlace no es válido.'), password: passwordSchema });
const accountLimitMessage = { message: 'Hiciste demasiadas solicitudes. Espera unos minutos e inténtalo de nuevo.' };
// Per IP, and per email so nobody can flood a single inbox from many addresses.
const forgotLimits = [
  rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false, message: accountLimitMessage }),
  rateLimit({ windowMs: 60 * 60 * 1000, limit: 3, keyGenerator: (request) => `email:${String(request.body?.email ?? '').trim().toLowerCase()}`, standardHeaders: true, legacyHeaders: false, message: accountLimitMessage }),
];

router.post('/forgot-password', ...forgotLimits, async (request, response, next) => {
  try {
    const { email } = forgotSchema.parse(request.body);
    await requestPasswordReset(email);
    response.json({ message: genericResetMessage });
  } catch (error) {
    next(error);
  }
});

router.post('/reset-password', rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false, message: accountLimitMessage }), async (request, response, next) => {
  try {
    const { token, password } = resetSchema.parse(request.body);
    await resetPassword(token, password);
    response.json({ message: 'Tu contraseña se cambió. Inicia sesión con la nueva; las sesiones anteriores se cerraron.' });
  } catch (error) {
    next(error);
  }
});

export default router;
