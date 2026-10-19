import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireStore, type AuthenticatedRequest } from '../middleware/auth.js';
import { approveAllSuggestions, approveSuggestion, refreshSuggestions, rejectSuggestion } from '../services/suggestions.js';

const router = Router();
const idSchema = z.object({ id: z.string().uuid() });

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
    response.json({
      data: applied,
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
    response.json({ data: applied, message: `Descuento del ${applied.discountPercent} % aplicado.` });
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
