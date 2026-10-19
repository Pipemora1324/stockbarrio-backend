import { Router } from 'express';
import { z } from 'zod';
import { badRequest, conflict, notFound } from '../errors.js';
import { authenticate, requireCustomer, type AuthenticatedRequest } from '../middleware/auth.js';
import { alertRepository } from '../repositories/alert.js';

const router = Router();
export const maxAlertsPerCustomer = 20;

const optionalText = (max: number) => z.string().trim().max(max).optional().transform((value) => (value ? value : null));
const alertSchema = z
  .object({
    query: optionalText(80),
    category: optionalText(80),
    neighborhood: optionalText(80),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    radiusKm: z.number().min(0.5).max(50).optional(),
    minDiscount: z.coerce.number().int().min(0).max(90).default(0),
    // The position is saved only if the customer explicitly agrees to it.
    locationConsent: z.boolean().default(false),
  })
  .refine((input) => input.query || input.category, { message: 'Escribe un producto o una categoría para la alerta.', path: ['query'] })
  .refine((input) => (input.latitude === undefined) === (input.longitude === undefined), { message: 'Envía latitud y longitud juntas.', path: ['latitude'] })
  .refine((input) => input.radiusKm === undefined || input.latitude !== undefined, { message: 'Para alertas por radio necesitamos tu ubicación aproximada.', path: ['radiusKm'] });

const roundCoordinate = (value: number) => Math.round(value * 1000) / 1000;

router.use(authenticate, requireCustomer);

router.get('/', async (request: AuthenticatedRequest, response, next) => {
  try {
    response.json({ data: await alertRepository.listByUser(request.user!.id) });
  } catch (error) {
    next(error);
  }
});

router.post('/', async (request: AuthenticatedRequest, response, next) => {
  try {
    const input = alertSchema.parse(request.body);
    const usesLocation = input.latitude !== undefined && input.longitude !== undefined;
    if (usesLocation && !input.locationConsent) throw badRequest('Para guardar una alerta por cercanía debes aceptar que guardemos tu ubicación aproximada.');
    if ((await alertRepository.countActiveByUser(request.user!.id)) >= maxAlertsPerCustomer) throw conflict(`Puedes tener como máximo ${maxAlertsPerCustomer} alertas activas.`);
    const alert = await alertRepository.create(request.user!.id, {
      query: input.query,
      category: input.category,
      neighborhood: input.neighborhood,
      latitude: usesLocation ? roundCoordinate(input.latitude!) : null,
      longitude: usesLocation ? roundCoordinate(input.longitude!) : null,
      radiusKm: usesLocation ? (input.radiusKm ?? 2) : null,
      minDiscount: input.minDiscount,
    });
    response.status(201).json({ data: alert, message: 'Listo, te avisaremos cuando haya un descuento que coincida.' });
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', async (request: AuthenticatedRequest, response, next) => {
  try {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    if (!(await alertRepository.deactivate(request.user!.id, id))) throw notFound('La alerta no existe.');
    response.json({ message: 'La alerta se eliminó.' });
  } catch (error) {
    next(error);
  }
});

export default router;
