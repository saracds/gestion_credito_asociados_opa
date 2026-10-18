import type { Router } from 'express';

import { createApiRouter } from './apiRouter.js';
import type { Environment } from './config/environment.js';
import type { DatabaseClient } from './infrastructure/database/DatabaseClient.js';
import { AuthService } from './modules/auth/AuthService.js';
import { TokenService } from './modules/auth/TokenService.js';
import { SqlServerUsuarioRepository } from './modules/auth/UsuarioRepository.js';
import { SqlServerCatalogoRepository } from './modules/catalogos/CatalogoRepository.js';
import { CreditoService } from './modules/creditos/CreditoService.js';
import { SqlServerAsociadoRepository } from './modules/creditos/repositories/SqlServerAsociadoRepository.js';
import { SqlServerCreditoRepository } from './modules/creditos/repositories/SqlServerCreditoRepository.js';
import { SqlServerHistorialCreditoRepository } from './modules/creditos/repositories/SqlServerHistorialCreditoRepository.js';
import { SqlServerWebhookOutboxRepository } from './modules/webhooks/WebhookOutboxRepository.js';

/**
 * RAÍZ DE COMPOSICIÓN: el único lugar donde se crean las implementaciones
 * concretas (repositorios SQL Server, servicios) y se conectan entre sí.
 *
 * El resto del código solo conoce interfaces. 
 */
export function buildApiRouter(database: DatabaseClient, environment: Environment): Router {
  const tokenService = new TokenService({
    secret: environment.JWT_SECRET,
    issuer: environment.JWT_ISSUER,
    audience: environment.JWT_AUDIENCE,
    expiresInMinutes: environment.JWT_EXPIRES_IN_MINUTES,
  });

  const catalogoRepository = new SqlServerCatalogoRepository(database);
  const webhookOutboxRepository = new SqlServerWebhookOutboxRepository(database);

  const authService = new AuthService(new SqlServerUsuarioRepository(database), tokenService);

  const creditoService = new CreditoService({
    transactionRunner: database,
    creditoRepository: new SqlServerCreditoRepository(database),
    asociadoRepository: new SqlServerAsociadoRepository(database),
    historialRepository: new SqlServerHistorialCreditoRepository(database),
    catalogoRepository,
    webhookOutboxRepository,
    webhookUrl: environment.WEBHOOK_URL,
  });

  return createApiRouter({
    authService,
    tokenService,
    creditoService,
    catalogoRepository,
    webhookOutboxRepository,
  });
}
