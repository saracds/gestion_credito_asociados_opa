import { Router } from 'express';

import { authenticate, authorize } from './modules/auth/auth.middleware.js';
import { createAuthRouter } from './modules/auth/auth.router.js';
import { ROLES_LECTURA } from './modules/auth/auth.types.js';
import type { AuthService } from './modules/auth/AuthService.js';
import type { TokenService } from './modules/auth/TokenService.js';
import type { CatalogoRepository } from './modules/catalogos/CatalogoRepository.js';
import { createCatalogosRouter } from './modules/catalogos/catalogos.router.js';
import { CreditoController } from './modules/creditos/credito.controller.js';
import { createCreditoRouter } from './modules/creditos/credito.router.js';
import type { CreditoService } from './modules/creditos/CreditoService.js';
import type { WebhookOutboxRepository } from './modules/webhooks/WebhookOutboxRepository.js';
import { createWebhooksRouter } from './modules/webhooks/webhooks.router.js';
import { createRateLimiter } from './shared/http/middlewares/rateLimiter.js';

export interface ApiRouterDependencies {
  authService: AuthService;
  tokenService: TokenService;
  creditoService: CreditoService;
  catalogoRepository: CatalogoRepository;
  webhookOutboxRepository: WebhookOutboxRepository;
  /** Límites configurables para poder ajustarlos en pruebas. */
  maxLoginAttempts?: number;
  maxRequestsPerMinute?: number;
}

/**
 * Rutas de negocio bajo /api.
 *
 *   /api/auth/*       Pública (login). Tiene su propio límite de intentos.
 *   /api/catalogos    Requiere token.
 *   /api/creditos/*   Requiere token; cada ruta exige además un rol.
 *   /api/webhooks/*   Requiere token de ADMIN (reproceso de notificaciones).
 */
export function createApiRouter(dependencies: ApiRouterDependencies): Router {
  const {
    authService,
    tokenService,
    creditoService,
    catalogoRepository,
    webhookOutboxRepository,
    maxLoginAttempts,
    maxRequestsPerMinute = 300,
  } = dependencies;

  const router = Router();

  router.use(
    createRateLimiter({
      windowMinutes: 1,
      maxRequests: maxRequestsPerMinute,
      message: 'Se superó el límite de peticiones por minuto. Intente nuevamente en un momento.',
    }),
  );

  router.use(
    '/auth',
    createAuthRouter({
      authService,
      tokenService,
      ...(maxLoginAttempts !== undefined && { maxLoginAttempts }),
    }),
  );

  // A partir de aquí todas las rutas exigen un token válido.
  router.use(authenticate(tokenService));

  router.use('/catalogos', authorize(ROLES_LECTURA), createCatalogosRouter(catalogoRepository));
  router.use('/creditos', createCreditoRouter(new CreditoController(creditoService)));
  router.use('/webhooks', createWebhooksRouter(webhookOutboxRepository));

  return router;
}
