import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { searchAssistant } from '../services/assistant.js';

const router = Router();
const schema = z
  .object({
    message: z.string().trim().min(2).max(300),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    neighborhood: z.string().trim().min(2).max(80).optional(),
  })
  .refine((input) => (input.latitude === undefined) === (input.longitude === undefined), { message: 'Envía latitud y longitud juntas.', path: ['latitude'] });

router.post('/search', rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { message: 'Hiciste muchas búsquedas seguidas. Espera un minuto e inténtalo de nuevo.' } }), async (request, response, next) => {
  try {
    const input = schema.parse(request.body);
    const location = input.latitude !== undefined && input.longitude !== undefined ? { latitude: input.latitude, longitude: input.longitude } : undefined;
    response.json({ data: await searchAssistant({ message: input.message, location, neighborhood: input.neighborhood }) });
  } catch (error) {
    next(error);
  }
});

export default router;
