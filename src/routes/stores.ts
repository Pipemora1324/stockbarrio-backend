import { Router } from 'express';
import { z } from 'zod';
import { isInColombia } from '../geo.js';
import { authenticate, requireStore, type AuthenticatedRequest } from '../middleware/auth.js';
import { storeRepository } from '../repositories/store.js';
import { addressSchema, colombiaCoordinatesMessage, latitudeSchema, longitudeSchema, phoneSchema } from '../validation.js';

const router = Router();
const querySchema = z.object({ neighborhood: z.string().trim().min(1).optional(), search: z.string().trim().min(1).optional() });
const locationSchema = z
  .object({
    latitude: latitudeSchema.nullable(),
    longitude: longitudeSchema.nullable(),
    address: addressSchema.optional(),
    phone: phoneSchema.optional(),
  })
  .refine((input) => (input.latitude === null) === (input.longitude === null), { message: 'Envía latitud y longitud juntas, o ninguna de las dos.', path: ['latitude'] })
  .refine((input) => input.latitude === null || input.longitude === null || isInColombia({ latitude: input.latitude, longitude: input.longitude }), { message: colombiaCoordinatesMessage, path: ['latitude'] });

router.get('/', async (request, response, next) => {
  try {
    const filters = querySchema.parse(request.query);
    const stores = await storeRepository.list(filters.neighborhood);
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

router.get('/me', authenticate, requireStore, (request: AuthenticatedRequest, response) => {
  response.json({ data: request.store });
});

router.put('/me', authenticate, requireStore, async (request: AuthenticatedRequest, response, next) => {
  try {
    const input = locationSchema.parse(request.body);
    const store = await storeRepository.updateLocation(request.store!.id, input);
    response.json({ data: store, message: 'La ubicación de la tienda se guardó correctamente.' });
  } catch (error) {
    next(error);
  }
});

router.get('/:id', async (request, response, next) => {
  try {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const store = await storeRepository.getById(id);
    if (!store) return response.status(404).json({ message: 'La tienda no existe.' });
    response.json({ data: store });
  } catch (error) {
    next(error);
  }
});

export default router;
