import { Router } from 'express';
import { z } from 'zod';
import { findOffers, offerSorts } from '../services/offers.js';

const router = Router();
// Nearness is by neighborhood only: the API no longer takes coordinates or a radius.
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
