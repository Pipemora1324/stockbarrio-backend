import { Router } from 'express';
import { config } from '../config.js';
import { z } from 'zod';
import { authenticate, requireStore, type AuthenticatedRequest } from '../middleware/auth.js';
import { notifyDiscountApplied } from '../services/notifications.js';
import { approveAllSuggestions, approveSuggestion, refreshSuggestions, rejectSuggestion, type AppliedDiscount } from '../services/suggestions.js';

const router = Router();
const idSchema = z.object({ id: z.string().uuid() });

// A failure while notifying customers must never undo or hide an approved discount.
// With ENABLE_ALERTS off (the default) no notifications are created.
const notifyCustomers = async (applied: AppliedDiscount[]) => {
  if (!config.enableAlerts) return 0;
  return notifyDiscountApplied(applied).catch((error: unknown) => {
    console.error('No se pudieron generar las notificaciones del descuento.', error instanceof Error ? error.message : error);
    return 0;
  });
};

router.use(authenticate, requireStore);

router.get('/', async (request: AuthenticatedRequest, response, next) => {
  try {
    response.json({ data: await refreshSuggestions(request.store!.id) });
  } catch (error) {
    next(error);
  }
});

router.post('/approve-all', async (request: AuthenticatedRequest, response, next) => {
  try {
    const applied = await approveAllSuggestions(request.store!.id);
    const notified = await notifyCustomers(applied);
    response.json({
      data: applied,
      notified,
      message: applied.length ? `Se aplicaron ${applied.length} ${applied.length === 1 ? 'descuento' : 'descuentos'}.` : 'No había sugerencias pendientes.',
    });
  } catch (error) {
    next(error);
  }
});

router.post('/:id/approve', async (request: AuthenticatedRequest, response, next) => {
  try {
    const { id } = idSchema.parse(request.params);
    const applied = await approveSuggestion(request.store!.id, id);
    const notified = await notifyCustomers([applied]);
    response.json({ data: applied, notified, message: `Descuento del ${applied.discountPercent} % aplicado.` });
  } catch (error) {
    next(error);
  }
});

router.post('/:id/reject', async (request: AuthenticatedRequest, response, next) => {
  try {
    const { id } = idSchema.parse(request.params);
    await rejectSuggestion(request.store!.id, id);
    response.json({ message: 'Sugerencia descartada.' });
  } catch (error) {
    next(error);
  }
});

export default router;
