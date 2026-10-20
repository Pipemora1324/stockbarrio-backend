import { Router } from 'express';
import { z } from 'zod';
import { todayInBogota } from '../dates.js';
import { badRequest, forbidden, notFound } from '../errors.js';
import { authenticate, requireStore, type AuthenticatedRequest } from '../middleware/auth.js';
import { productRepository, type ProductRecord } from '../repositories/product.js';
import { groupByStore } from '../services/catalog.js';
import { offerStatus, resolveOfferRange } from '../services/offer-rules.js';
import { canonicalCategory, categorySchema, dateOnlySchema, discountSchema, futureDateSchema, priceSchema, productCategories, productNameSchema, stockSchema } from '../validation.js';

const router = Router();
// Optional offer dates. Older clients do not send them; null means "not sent".
const offerDateSchema = dateOnlySchema.nullish();
const productSchema = z.object({
  name: productNameSchema,
  category: categorySchema.default('Alimentación'),
  description: z.string().trim().max(500, 'La descripción debe tener como máximo 500 caracteres.').default(''),
  price: priceSchema,
  stock: stockSchema,
  expirationDate: futureDateSchema,
  discountPercent: discountSchema.default(0),
  offerStartsOn: offerDateSchema,
  offerEndsOn: offerDateSchema,
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
  offerStartsOn: offerDateSchema,
  offerEndsOn: offerDateSchema,
  imageUrl: z.string().trim().max(300).optional(),
});
const idSchema = z.object({ id: z.string().uuid() });
const storeIdSchema = z.object({ storeId: z.string().uuid() });
// Customers filter the catalog by category only; neighborhood and search stay for older clients.
const catalogQuerySchema = z.object({
  category: z.string().trim().min(2).max(80).optional(),
  neighborhood: z.string().trim().max(80).optional(),
  search: z.string().trim().max(80).optional(),
});

// For the owner: the saved values plus the state of the offer today and whether the product already expired.
const withOfferState = (product: ProductRecord, today: string) => ({ ...product, offerStatus: offerStatus(product, today), expired: product.expirationDate < today });

// The product must belong to one of the seller's stores (not only the one selected in the request).
const getOwnedProduct = async (request: AuthenticatedRequest) => {
  const { id } = idSchema.parse(request.params);
  const product = await productRepository.getById(id);
  if (!product) throw notFound('El producto no existe.');
  if (!request.stores!.some((store) => store.id === product.storeId)) throw forbidden('Este producto no pertenece a tu tienda.');
  return product;
};

// Flat list of the catalog (older clients). Products with an active offer come with their discounted price.
router.get('/', async (request, response, next) => {
  try {
    response.json({ data: await productRepository.list(catalogQuerySchema.parse(request.query), todayInBogota()) });
  } catch (error) {
    next(error);
  }
});

// Catalog grouped by store, with a single category filter.
router.get('/catalog', async (request, response, next) => {
  try {
    const { category } = catalogQuerySchema.parse(request.query);
    const rows = await productRepository.list({ category }, todayInBogota());
    response.json({ data: groupByStore(rows), total: rows.length });
  } catch (error) {
    next(error);
  }
});

router.get('/categories', (_request, response) => {
  response.json({ data: productCategories });
});

// Inventory of one store of the seller (?storeId=), or of the main one for older clients.
router.get('/mine', authenticate, requireStore, async (request: AuthenticatedRequest, response, next) => {
  try {
    const today = todayInBogota();
    const products = await productRepository.listByStore(request.store!.id);
    response.json({ data: products.map((product) => withOfferState(product, today)), store: request.store, stores: request.stores, today });
  } catch (error) {
    next(error);
  }
});

router.get('/store/:storeId', async (request, response, next) => {
  try {
    const { storeId } = storeIdSchema.parse(request.params);
    response.json({ data: await productRepository.listPublicByStore(storeId, todayInBogota()) });
  } catch (error) {
    next(error);
  }
});

router.post('/', authenticate, requireStore, async (request: AuthenticatedRequest, response, next) => {
  try {
    const today = todayInBogota();
    const input = productSchema.parse(request.body);
    const range = resolveOfferRange(input, today);
    const product = await productRepository.upsert({ ...input, ...range, storeId: request.store!.id });
    response.status(201).json({ data: withOfferState(product, today), message: 'El producto se ha guardado correctamente.' });
  } catch (error) {
    next(error);
  }
});

router.put('/:id', authenticate, requireStore, async (request: AuthenticatedRequest, response, next) => {
  try {
    const today = todayInBogota();
    const current = await getOwnedProduct(request);
    const input = updateSchema.parse(request.body);
    if (input.category !== undefined && input.category !== current.category) {
      const category = canonicalCategory(input.category);
      if (!category) throw badRequest('Elige una categoría de la lista.');
      input.category = category;
    }
    const merged = { ...current, ...input, offerStartsOn: input.offerStartsOn ?? null, offerEndsOn: input.offerEndsOn ?? null };
    // Edits that do not touch the offer (name, stock, price...) keep its saved range as it is.
    const range = resolveOfferRange(merged, today, current);
    const product = await productRepository.upsert({ ...merged, ...range, id: current.id, storeId: current.storeId });
    response.json({ data: withOfferState(product, today), message: 'El producto se ha actualizado correctamente.' });
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
