import { Router } from 'express';
import { z } from 'zod';
import { todayInBogota } from '../dates.js';
import { conflict, forbidden, notFound } from '../errors.js';
import { authenticate, requireStore, requireStoreRole, type AuthenticatedRequest } from '../middleware/auth.js';
import { maxStoresPerUser, storeRepository } from '../repositories/store.js';
import { addressSchema, neighborhoodSchema, phoneSchema, storeNameSchema } from '../validation.js';

const router = Router();
const querySchema = z.object({ neighborhood: z.string().trim().min(1).optional(), search: z.string().trim().min(1).optional() });
const idSchema = z.object({ id: z.string().uuid() });
const createSchema = z.object({ name: storeNameSchema, neighborhood: neighborhoodSchema, address: addressSchema, phone: phoneSchema.default('') });
const updateSchema = z
  .object({ name: storeNameSchema.optional(), neighborhood: neighborhoodSchema.optional(), address: addressSchema.optional(), phone: phoneSchema.optional() })
  .refine((input) => Object.values(input).some((value) => value !== undefined), 'Envía al menos un dato del local para actualizar.');

// The store must exist and belong to the signed-in seller.
const getOwnedStore = async (request: AuthenticatedRequest) => {
  const { id } = idSchema.parse(request.params);
  const store = await storeRepository.getOwned(id);
  if (!store) throw notFound('El local no existe.');
  if (store.userId !== request.user!.id) throw forbidden('Este local no pertenece a tu cuenta.');
  return store;
};

router.get('/', async (request, response, next) => {
  try {
    const filters = querySchema.parse(request.query);
    const stores = await storeRepository.list(filters.neighborhood, todayInBogota());
    response.json({ data: stores.filter((store) => !filters.search || `${store.name} ${store.neighborhood}`.toLowerCase().includes(filters.search.toLowerCase())) });
  } catch (error) {
    next(error);
  }
});

router.get('/neighborhoods', async (_request, response, next) => {
  try {
    response.json({ data: await storeRepository.listNeighborhoods() });
  } catch (error) {
    next(error);
  }
});

// Main store of the seller (older clients) or the one in ?storeId=.
router.get('/me', authenticate, requireStore, (request: AuthenticatedRequest, response) => {
  response.json({ data: request.store });
});

// Every store of the seller, the main one first. It can be empty.
router.get('/mine', authenticate, requireStoreRole, async (request: AuthenticatedRequest, response, next) => {
  try {
    response.json({ data: await storeRepository.listByUser(request.user!.id), max: maxStoresPerUser });
  } catch (error) {
    next(error);
  }
});

router.post('/', authenticate, requireStoreRole, async (request: AuthenticatedRequest, response, next) => {
  try {
    const input = createSchema.parse(request.body);
    const owned = await storeRepository.listByUser(request.user!.id);
    if (owned.length >= maxStoresPerUser) throw conflict(`Puedes tener como máximo ${maxStoresPerUser} locales.`);
    if (await storeRepository.isNameTaken(input.name, input.neighborhood)) throw conflict('Ya existe una tienda con este nombre en ese barrio.');
    const id = await storeRepository.create(request.user!.id, input);
    response.status(201).json({ data: (await storeRepository.listByUser(request.user!.id)).find((store) => store.id === id), message: 'El local se creó correctamente.' });
  } catch (error) {
    next(error);
  }
});

router.patch('/:id', authenticate, requireStoreRole, async (request: AuthenticatedRequest, response, next) => {
  try {
    const store = await getOwnedStore(request);
    const input = updateSchema.parse(request.body);
    const name = input.name ?? store.name;
    const neighborhood = input.neighborhood ?? store.neighborhood;
    if ((input.name || input.neighborhood) && (await storeRepository.isNameTaken(name, neighborhood, store.id))) throw conflict('Ya existe una tienda con este nombre en ese barrio.');
    response.json({ data: await storeRepository.update(store.id, input), message: 'El local se actualizó correctamente.' });
  } catch (error) {
    next(error);
  }
});

// Soft delete: the store and its products stop showing; the data stays in the database.
router.delete('/:id', authenticate, requireStoreRole, async (request: AuthenticatedRequest, response, next) => {
  try {
    const store = await getOwnedStore(request);
    await storeRepository.deactivate(store.id, request.user!.id);
    response.json({ message: `Se eliminó el local «${store.name}».` });
  } catch (error) {
    next(error);
  }
});

router.get('/:id', async (request, response, next) => {
  try {
    const { id } = idSchema.parse(request.params);
    const store = await storeRepository.getById(id);
    if (!store) return response.status(404).json({ message: 'La tienda no existe.' });
    response.json({ data: store });
  } catch (error) {
    next(error);
  }
});

export default router;
