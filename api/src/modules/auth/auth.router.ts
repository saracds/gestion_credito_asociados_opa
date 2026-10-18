import { Router } from 'express';
import { z } from 'zod';

import { sendSuccess } from '../../shared/http/apiResponse.js';
import { createRateLimiter } from '../../shared/http/middlewares/rateLimiter.js';
import { parseOrThrow } from '../../shared/validation/parseOrThrow.js';
import { authenticate, getUsuarioAutenticado } from './auth.middleware.js';
import type { AuthService } from './AuthService.js';
import type { TokenService } from './TokenService.js';

export const loginSchema = z
  .object({
    email: z.string().trim().toLowerCase().pipe(z.email('Debe ser un correo electrónico válido')),
    password: z.string().min(1, 'La contraseña es obligatoria').max(128),
  })
  .strict();

export interface AuthRouterDependencies {
  authService: AuthService;
  tokenService: TokenService;
  /** Intentos de login permitidos por IP cada 15 minutos. */
  maxLoginAttempts?: number;
}

/**
 * POST /api/auth/login  Recibe correo y contraseña; devuelve el token de acceso.
 * GET  /api/auth/me     Devuelve el usuario dueño del token (útil para el frontend).
 */
export function createAuthRouter({
  authService,
  tokenService,
  maxLoginAttempts = 10,
}: AuthRouterDependencies): Router {
  const router = Router();

  const loginRateLimiter = createRateLimiter({
    windowMinutes: 15,
    maxRequests: maxLoginAttempts,
    message: 'Demasiados intentos de inicio de sesión. Intente nuevamente en 15 minutos.',
  });

  router.post('/login', loginRateLimiter, async (request, response) => {
    const { email, password } = parseOrThrow(loginSchema, request.body);
    const resultado = await authService.login(email, password);
    sendSuccess(response, resultado);
  });

  router.get('/me', authenticate(tokenService), (request, response) => {
    sendSuccess(response, getUsuarioAutenticado(request));
  });

  return router;
}
