import { Router } from 'express';
import { z } from 'zod';
import { conflict, notFound } from '../errors.js';
import { authenticate, requireCustomer, type AuthenticatedRequest } from '../middleware/auth.js';
import { alertRepository } from '../repositories/alert.js';
import { discountSchema } from '../validation.js';

const router = Router();
export const maxAlertsPerCustomer = 20;

const optionalText = (max: number) => z.string().trim().max(max).optional().transform((value) => (value ? value : null));
const alertSchema = z
  .object({
    query: optionalText(80),
    category: optionalText(80),
    // Place is by neighborhood only; the customer's position is never asked nor saved.
    neighborhood: optionalText(80),
    minDiscount: discountSchema.default(0),
  })
  .refine((input) => input.query || input.category, { message: 'Escribe un producto o una categoría para la alerta.', path: ['query'] });

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
    if ((await alertRepository.countActiveByUser(request.user!.id)) >= maxAlertsPerCustomer) throw conflict(`Puedes tener como máximo ${maxAlertsPerCustomer} alertas activas.`);
    const alert = await alertRepository.create(request.user!.id, input);
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
