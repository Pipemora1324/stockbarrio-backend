import { Router } from 'express';
import { z } from 'zod';
import { findOffers, offerSorts } from '../services/offers.js';
import { latitudeSchema, longitudeSchema } from '../validation.js';

const router = Router();
// POST keeps the optional location in the body, out of URLs and access logs.
const schema = z
  .object({
    neighborhood: z.string().trim().min(2).max(80).optional(),
    category: z.string().trim().min(2).max(80).optional(),
    search: z.string().trim().min(2).max(80).optional(),
    latitude: latitudeSchema.optional(),
    longitude: longitudeSchema.optional(),
    radiusKm: z.coerce.number().min(0.5, 'El radio debe ser de al menos 0,5 km.').max(50, 'El radio debe ser de máximo 50 km.').optional(),
    sort: z.enum(offerSorts, { error: 'El orden debe ser discount, nearest o expiring.' }).default('discount'),
  })
  .refine((input) => (input.latitude === undefined) === (input.longitude === undefined), { message: 'Envía latitud y longitud juntas.', path: ['latitude'] })
  .refine((input) => input.sort !== 'nearest' || input.latitude !== undefined, { message: 'Para ordenar por cercanía comparte tu ubicación.', path: ['sort'] });

router.post('/search', async (request, response, next) => {
  try {
    const input = schema.parse(request.body ?? {});
    const location = input.latitude !== undefined && input.longitude !== undefined ? { latitude: input.latitude, longitude: input.longitude } : undefined;
    response.json(await findOffers({ ...input, location }));
  } catch (error) {
    next(error);
  }
});

export default router;
