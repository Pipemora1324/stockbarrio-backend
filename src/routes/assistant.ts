import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config.js';
import { optionalAuthenticate, type AuthenticatedRequest } from '../middleware/auth.js';
import { chat, maxHistoryTurns } from '../services/chat.js';
import { neighborhoodSchema } from '../validation.js';

const router = Router();
const chatSchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().trim().min(1, 'El mensaje no puede estar vacío.').max(500, 'Cada mensaje puede tener como máximo 500 caracteres.') }))
    .min(1, 'Escribe un mensaje.')
    .max(50)
      // Solo se usan los últimos turnos, para que las conversaciones largas sigan siendo baratas.
    .transform((messages) => messages.slice(-maxHistoryTurns))
    .refine((messages) => messages.at(-1)?.role === 'user', 'El último mensaje debe ser del cliente.'),
  neighborhood: neighborhoodSchema.optional(),
});

const limitMessage = (period: string) => ({ message: `Llegaste al límite de mensajes ${period}. Espera un poco e inténtalo de nuevo.` });
const minuteWindow = 60 * 1000;
const dayWindow = 24 * 60 * 60 * 1000;
// Límites por IP para todos, y por cuenta cuando la persona inició sesión (así compartir una red no se castiga dos veces).
const chatLimits = [
  rateLimit({ windowMs: minuteWindow, limit: () => config.chatRatePerMinute, standardHeaders: true, legacyHeaders: false, message: limitMessage('por minuto') }),
  rateLimit({ windowMs: dayWindow, limit: () => config.chatRatePerDay, standardHeaders: true, legacyHeaders: false, message: limitMessage('del día') }),
  rateLimit({ windowMs: minuteWindow, limit: () => config.chatRatePerMinute, skip: (request: AuthenticatedRequest) => !request.user, keyGenerator: (request: AuthenticatedRequest) => `user:${request.user!.id}`, standardHeaders: true, legacyHeaders: false, message: limitMessage('por minuto') }),
  rateLimit({ windowMs: dayWindow, limit: () => config.chatRatePerDay, skip: (request: AuthenticatedRequest) => !request.user, keyGenerator: (request: AuthenticatedRequest) => `user:${request.user!.id}`, standardHeaders: true, legacyHeaders: false, message: limitMessage('del día') }),
];

router.post('/chat', optionalAuthenticate, ...chatLimits, async (request, response, next) => {
  try {
    const input = chatSchema.parse(request.body);
    const user = (request as AuthenticatedRequest).user;
    const requester = user ? `user:${user.id}` : `ip:${request.ip}`;
    response.json({ data: await chat({ messages: input.messages, neighborhood: input.neighborhood, requester }) });
  } catch (error) {
    next(error);
  }
});

export default router;
