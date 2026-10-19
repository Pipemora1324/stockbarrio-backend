import { Router } from 'express';
import { z } from 'zod';
import { badRequest } from '../errors.js';
import { isInColombia } from '../geo.js';
import { authenticate, requireStore, type AuthenticatedRequest } from '../middleware/auth.js';
import { storeRepository } from '../repositories/store.js';

const router = Router();
const querySchema = z.object({ neighborhood: z.string().trim().min(1).optional(), search: z.string().trim().min(1).optional() });
const locationSchema = z
  .object({
    latitude: z.coerce.number().min(-90).max(90).nullable(),
    longitude: z.coerce.number().min(-180).max(180).nullable(),
    address: z.string().trim().min(5).max(200).optional(),
    phone: z.string().trim().max(30).optional(),
  })
  .refine((input) => (input.latitude === null) === (input.longitude === null), { message: 'Envía latitud y longitud juntas, o ninguna de las dos.', path: ['latitude'] });

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
    if (input.latitude !== null && input.longitude !== null && !isInColombia({ latitude: input.latitude, longitude: input.longitude })) {
      throw badRequest('Las coordenadas quedan fuera de Colombia. Revisa que no estén invertidas (la latitud va primero).');
    }
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
