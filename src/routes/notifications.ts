import { Router } from 'express';
import { z } from 'zod';
import { notFound } from '../errors.js';
import { authenticate, requireCustomer, type AuthenticatedRequest } from '../middleware/auth.js';
import { notificationRepository } from '../repositories/alert.js';

const router = Router();

router.use(authenticate, requireCustomer);

router.get('/', async (request: AuthenticatedRequest, response, next) => {
  try {
    const [notifications, unread] = await Promise.all([notificationRepository.listByUser(request.user!.id), notificationRepository.unreadCount(request.user!.id)]);
    response.json({ data: notifications, unread });
  } catch (error) {
    next(error);
  }
});

router.get('/unread-count', async (request: AuthenticatedRequest, response, next) => {
  try {
    response.json({ unread: await notificationRepository.unreadCount(request.user!.id) });
  } catch (error) {
    next(error);
  }
});

router.post('/read-all', async (request: AuthenticatedRequest, response, next) => {
  try {
    await notificationRepository.markAllRead(request.user!.id);
    response.json({ unread: 0 });
  } catch (error) {
    next(error);
  }
});

router.post('/:id/read', async (request: AuthenticatedRequest, response, next) => {
  try {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    if (!(await notificationRepository.markRead(request.user!.id, id))) throw notFound('La notificación no existe.');
    response.json({ unread: await notificationRepository.unreadCount(request.user!.id) });
  } catch (error) {
    next(error);
  }
});

export default router;
