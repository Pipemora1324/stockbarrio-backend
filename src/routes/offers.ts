import { Router } from 'express';
import { z } from 'zod';
import { findOffers, offerSorts } from '../services/offers.js';

const router = Router();
// La cercanía es solo por barrio: la API ya no recibe coordenadas ni radio.
const schema = z.object({
  neighborhood: z.string().trim().min(2).max(80).optional(),
  category: z.string().trim().min(2).max(80).optional(),
  search: z.string().trim().min(2).max(80).optional(),
  sort: z.enum(offerSorts, { error: 'El orden debe ser discount o expiring.' }).default('discount'),
});

router.post('/search', async (request, response, next) => {
  try {
    response.json(await findOffers(schema.parse(request.body ?? {})));
  } catch (error) {
    next(error);
  }
});

export default router;
