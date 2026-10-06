import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireAdmin, type AuthenticatedRequest } from '../middleware/auth.js';
import { productRepository } from '../repositories/product.js';
import { database } from '../database.js';

const router = Router();
const productSchema = z.object({
  name: z.string().trim().min(2).max(120),
  category: z.string().trim().min(2).max(80).default('Alimentación'),
  description: z.string().trim().max(500).default(''),
  price: z.coerce.number().positive(),
  stock: z.coerce.number().int().nonnegative(),
  expirationDate: z.coerce.date(),
  discountPercent: z.coerce.number().min(0).max(100),
  imageUrl: z.string().max(300).optional().default(''),
});

router.get('/', async (request, response, next) => {
  try {
    const filters = z.object({ neighborhood: z.string().optional(), category: z.string().optional(), search: z.string().optional() }).parse(request.query);
    response.json({ data: await productRepository.list(filters) });
  } catch (error) {
    next(error);
  }
});

router.get('/store/:storeId', async (request, response, next) => {
  try {
    response.json({ data: await productRepository.listByStore(request.params.storeId) });
  } catch (error) {
    next(error);
  }
});

router.post('/', authenticate, requireAdmin, async (request: AuthenticatedRequest, response, next) => {
  try {
    const input = productSchema.parse(request.body);
    const store = await database.query('SELECT id FROM stores WHERE id = $1 AND user_id = $2', [request.user!.storeId, request.user!.id]);
    if (!store.rows.length) return response.status(404).json({ message: 'La tienda no existe.' });
    const product = await productRepository.upsert({ ...input, storeId: store.rows[0].id, expirationDate: input.expirationDate });
    response.status(201).json({ data: product, message: 'El producto se ha guardado correctamente.' });
  } catch (error) {
    next(error);
  }
});

router.put('/:id', authenticate, requireAdmin, async (request: AuthenticatedRequest, response, next) => {
  try {
    const input = productSchema.partial().parse(request.body);
    const productId = String(request.params.id);
    const current = await productRepository.getById(productId);
    if (!current) return response.status(404).json({ message: 'El producto no existe.' });
    const product = await productRepository.upsert({ ...current, ...input, id: current.id, storeId: current.storeId });
    response.json({ data: product, message: 'El producto se ha actualizado correctamente.' });
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', authenticate, requireAdmin, async (request, response, next) => {
  try {
    const productId = String(request.params.id);
    const deleted = await productRepository.delete(productId);
    if (!deleted) return response.status(404).json({ message: 'El producto no existe.' });
    response.json({ message: 'El producto se ha eliminado correctamente.' });
  } catch (error) {
    next(error);
  }
});

export default router;
