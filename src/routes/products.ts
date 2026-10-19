import { Router } from 'express';
import { z } from 'zod';
import { badRequest, forbidden, notFound } from '../errors.js';
import { authenticate, requireStore, type AuthenticatedRequest } from '../middleware/auth.js';
import { productRepository } from '../repositories/product.js';
import { canonicalCategory, categorySchema, dateOnlySchema, discountSchema, futureDateSchema, priceSchema, productCategories, productNameSchema, stockSchema } from '../validation.js';

const router = Router();
const productSchema = z.object({
  name: productNameSchema,
  category: categorySchema.default('Alimentación'),
  description: z.string().trim().max(500, 'La descripción debe tener como máximo 500 caracteres.').default(''),
  price: priceSchema,
  stock: stockSchema,
  expirationDate: futureDateSchema,
  discountPercent: discountSchema.default(0),
  imageUrl: z.string().trim().max(300).default(''),
});
// On edit the date may already be in the past (the store is fixing an old product) and the category may be a legacy one.
const updateSchema = z.object({
  name: productNameSchema.optional(),
  category: z.string().trim().min(2).max(80).optional(),
  description: z.string().trim().max(500, 'La descripción debe tener como máximo 500 caracteres.').optional(),
  price: priceSchema.optional(),
  stock: stockSchema.optional(),
  expirationDate: dateOnlySchema.optional(),
  discountPercent: discountSchema.optional(),
  imageUrl: z.string().trim().max(300).optional(),
});
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

router.get('/categories', (_request, response) => {
  response.json({ data: productCategories });
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
    if (input.category !== undefined && input.category !== current.category) {
      const category = canonicalCategory(input.category);
      if (!category) throw badRequest('Elige una categoría de la lista.');
      input.category = category;
    }
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
