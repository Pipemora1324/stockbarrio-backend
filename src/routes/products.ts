import { Router } from 'express';
import { z } from 'zod';
import { forbidden, notFound } from '../errors.js';
import { authenticate, requireStore, type AuthenticatedRequest } from '../middleware/auth.js';
import { productRepository } from '../repositories/product.js';
import { dateOnlySchema } from '../validation.js';

const router = Router();
const productSchema = z.object({
  name: z.string().trim().min(2).max(120),
  category: z.string().trim().min(2).max(80).default('Alimentación'),
  description: z.string().trim().max(500).default(''),
  price: z.coerce.number().positive(),
  stock: z.coerce.number().int().nonnegative(),
  expirationDate: dateOnlySchema,
  discountPercent: z.coerce.number().min(0).max(100),
  imageUrl: z.string().max(300).optional().default(''),
});
const updateSchema = productSchema.partial().extend({ category: z.string().trim().min(2).max(80).optional(), description: z.string().trim().max(500).optional(), imageUrl: z.string().max(300).optional() });
const idSchema = z.object({ id: z.string().uuid() });
const storeIdSchema = z.object({ storeId: z.string().uuid() });

const getOwnedProduct = async (request: AuthenticatedRequest) => {
  const { id } = idSchema.parse(request.params);
  const product = await productRepository.getById(id);
  if (!product) throw notFound('El producto no existe.');
  if (product.storeId !== request.store!.id) throw forbidden('Este producto no pertenece a tu tienda.');
  return product;
};

router.get('/', async (request, response, next) => {
  try {
    const filters = z.object({ neighborhood: z.string().optional(), category: z.string().optional(), search: z.string().optional() }).parse(request.query);
    response.json({ data: await productRepository.list(filters) });
  } catch (error) {
    next(error);
  }
});

router.get('/mine', authenticate, requireStore, async (request: AuthenticatedRequest, response, next) => {
  try {
    response.json({ data: await productRepository.listByStore(request.store!.id), store: request.store });
  } catch (error) {
    next(error);
  }
});

router.get('/store/:storeId', async (request, response, next) => {
  try {
    const { storeId } = storeIdSchema.parse(request.params);
    response.json({ data: await productRepository.listByStore(storeId) });
  } catch (error) {
    next(error);
  }
});

router.post('/', authenticate, requireStore, async (request: AuthenticatedRequest, response, next) => {
  try {
    const input = productSchema.parse(request.body);
    const product = await productRepository.upsert({ ...input, storeId: request.store!.id });
    response.status(201).json({ data: product, message: 'El producto se ha guardado correctamente.' });
  } catch (error) {
    next(error);
  }
});

router.put('/:id', authenticate, requireStore, async (request: AuthenticatedRequest, response, next) => {
  try {
    const current = await getOwnedProduct(request);
    const input = updateSchema.parse(request.body);
    const product = await productRepository.upsert({ ...current, ...input, id: current.id, storeId: current.storeId });
    response.json({ data: product, message: 'El producto se ha actualizado correctamente.' });
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', authenticate, requireStore, async (request: AuthenticatedRequest, response, next) => {
  try {
    const current = await getOwnedProduct(request);
    await productRepository.delete(current.id);
    response.json({ message: 'El producto se ha eliminado correctamente.' });
  } catch (error) {
    next(error);
  }
});

export default router;
