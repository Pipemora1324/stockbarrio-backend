import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { authenticate, type AuthenticatedRequest } from '../middleware/auth.js';
import { changePassword, confirmEmailChange, getProfile, requestEmailChange, updateName } from '../services/account.js';
import { emailSchema, passwordSchema, personNameSchema } from '../validation.js';

const router = Router();
const sensitiveLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { message: 'Hiciste demasiados intentos. Espera unos minutos e inténtalo de nuevo.' } });
const currentPasswordSchema = z.string({ error: 'Escribe tu contraseña actual.' }).min(1, 'Escribe tu contraseña actual.').max(200);

router.get('/', authenticate, async (request: AuthenticatedRequest, response, next) => {
  try {
    response.json({ data: await getProfile(request.user!.id) });
  } catch (error) {
    next(error);
  }
});

router.patch('/name', authenticate, async (request: AuthenticatedRequest, response, next) => {
  try {
    const { name } = z.object({ name: personNameSchema }).parse(request.body);
    response.json({ ...(await updateName(request.user!.id, name)), message: 'Tu nombre se actualizó.' });
  } catch (error) {
    next(error);
  }
});

router.post('/password', authenticate, sensitiveLimit, async (request: AuthenticatedRequest, response, next) => {
  try {
    const input = z.object({ currentPassword: currentPasswordSchema, newPassword: passwordSchema }).parse(request.body);
    response.json({ ...(await changePassword(request.user!.id, input.currentPassword, input.newPassword)), message: 'Tu contraseña se cambió. Cerramos las demás sesiones abiertas.' });
  } catch (error) {
    next(error);
  }
});

router.post('/email', authenticate, sensitiveLimit, async (request: AuthenticatedRequest, response, next) => {
  try {
    const input = z.object({ newEmail: emailSchema, currentPassword: currentPasswordSchema }).parse(request.body);
    await requestEmailChange(request.user!.id, input.newEmail, input.currentPassword);
    response.json({ message: `Te enviamos un enlace a ${input.newEmail}. El correo cambiará cuando lo abras.` });
  } catch (error) {
    next(error);
  }
});

// Opened from the email link, possibly in another browser, so it does not need a session.
router.post('/email/confirm', sensitiveLimit, async (request, response, next) => {
  try {
    const { token } = z.object({ token: z.string().trim().min(20, 'El enlace no es válido.').max(200, 'El enlace no es válido.') }).parse(request.body);
    await confirmEmailChange(token);
    response.json({ message: 'Tu correo se actualizó. Inicia sesión con el correo nuevo.' });
  } catch (error) {
    next(error);
  }
});

export default router;
