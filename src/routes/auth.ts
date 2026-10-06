import { Router } from 'express';
import { z } from 'zod';
import { createToken, hashPassword, verifyPassword } from '../services/auth.js';
import { userRepository } from '../repositories/user.js';
import { database } from '../database.js';

const router = Router();
const registerSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().email().max(160),
  password: z.string().min(8).max(128),
  storeName: z.string().trim().min(2).max(120).optional(),
  neighborhood: z.string().trim().min(2).max(80).optional(),
  address: z.string().trim().min(5).max(200).optional(),
  phone: z.string().trim().max(30).optional(),
});
const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

router.post('/register', async (request, response, next) => {
  try {
    const input = registerSchema.parse(request.body);
    if (await userRepository.getByEmail(input.email)) return response.status(409).json({ message: 'Este correo electrónico ya está registrado.' });
    const passwordHash = await hashPassword(input.password);
    let storeId: string | undefined;
    let user: Awaited<ReturnType<typeof userRepository.create>>;
    if (input.storeName) {
      const stores = await database.query('SELECT id FROM stores WHERE name = $1 AND neighborhood = $2', [input.storeName, input.neighborhood ?? '']);
      if (stores.rows.length) return response.status(409).json({ message: 'Ya existe una tienda con este nombre.' });
      user = await database.withTransaction(async (client) => {
        const createdUser = await client.query('INSERT INTO users (name, email, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING *', [input.name, input.email.toLowerCase(), passwordHash, 'store']);
        const createdStore = await client.query('INSERT INTO stores (user_id, name, neighborhood, address, phone) VALUES ($1,$2,$3,$4,$5) RETURNING id', [createdUser.rows[0].id, input.storeName, input.neighborhood ?? '', input.address ?? '', input.phone ?? '']);
        await client.query('UPDATE users SET store_id = $1 WHERE id = $2', [createdStore.rows[0].id, createdUser.rows[0].id]);
        return { ...createdUser.rows[0], storeId: createdStore.rows[0].id };
      });
      storeId = user.storeId;
    } else {
      user = await userRepository.create({ name: input.name, email: input.email, passwordHash, role: 'admin' });
    }
    response.status(201).json({ message: 'La cuenta se ha creado correctamente.', token: createToken(user), user: { id: user.id, name: user.name, role: user.role, storeId } });
  } catch (error) {
    next(error);
  }
});

router.post('/login', async (request, response, next) => {
  try {
    const input = loginSchema.parse(request.body);
    const user = await userRepository.getByEmail(input.email);
    if (!user || !(await verifyPassword(input.password, user.passwordHash))) return response.status(401).json({ message: 'El correo o la contraseña son incorrectos.' });
    const safeUser = { id: user.id, name: user.name, email: user.email, role: user.role, storeId: user.storeId };
    response.json({ message: 'Inicio de sesión correcto.', token: createToken(safeUser), user: safeUser });
  } catch (error) {
    next(error);
  }
});

export default router;
