import { Router } from 'express';
import { z } from 'zod';
import { storeRepository } from '../repositories/store.js';

const router = Router();
const querySchema = z.object({ neighborhood: z.string().trim().min(1).optional(), search: z.string().trim().min(1).optional() });

router.get('/', async (request, response, next) => {
  try {
    const filters = querySchema.parse(request.query);
    const stores = await storeRepository.list(filters.neighborhood);
    response.json({ data: stores.filter((store) => !filters.search || `${store.name} ${store.neighborhood}`.toLowerCase().includes(filters.search.toLowerCase())) });
  } catch (error) {
    next(error);
  }
});

router.get('/:id', async (request, response, next) => {
  try {
    const store = await storeRepository.getById(request.params.id);
    if (!store) return response.status(404).json({ message: 'La tienda no existe.' });
    response.json({ data: store });
  } catch (error) {
    next(error);
  }
});

export default router;
