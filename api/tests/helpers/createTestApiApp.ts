import bcrypt from 'bcryptjs';
import { pino } from 'pino';

import { createApiRouter } from '../../src/apiRouter.js';
import { createApp } from '../../src/app.js';
import { createDocsRouter } from '../../src/docs/docs.router.js';
import type { UsuarioAutenticado } from '../../src/modules/auth/auth.types.js';
import { AuthService } from '../../src/modules/auth/AuthService.js';
import { TokenService } from '../../src/modules/auth/TokenService.js';
import { CreditoService } from '../../src/modules/creditos/CreditoService.js';
import { InMemoryDatabase } from '../fakes/InMemoryDatabase.js';
import {
  ADMIN,
  ANALISTA,
  CONSULTA,
  JWT_SECRET_PRUEBA,
  URL_WEBHOOK_PRUEBA,
} from '../fakes/fixtures.js';

export const CLAVE_PRUEBA = 'Clave123*';

export const TOKEN_CONFIG_PRUEBA = {
  secret: JWT_SECRET_PRUEBA,
  issuer: 'creditos-opa-api',
  audience: 'creditos-opa-web',
  expiresInMinutes: 60,
};

interface TestApiAppOptions {
  maxLoginAttempts?: number;
  trustProxyHops?: number;
}

/**
 * Arma la aplicación COMPLETA (rutas, autenticación, controladores, servicios)
 * reemplazando solo la base de datos por la versión en memoria.
 */
export async function createTestApiApp(options: TestApiAppOptions = {}) {
  const database = new InMemoryDatabase();
  // Costo 4 (el mínimo) para que las pruebas sean rápidas; en producción se usa 10.
  const passwordHash = await bcrypt.hash(CLAVE_PRUEBA, 4);
  database.usuarios.push(
    ...[ADMIN, ANALISTA, CONSULTA].map((usuario) => ({ ...usuario, passwordHash, activo: true })),
    {
      id: 99,
      email: 'inactivo@opa.local',
      nombre: 'Usuario Inactivo',
      rol: 'ANALISTA' as const,
      passwordHash,
      activo: false,
    },
  );

  const tokenService = new TokenService(TOKEN_CONFIG_PRUEBA);
  const authService = new AuthService(database.usuarioRepository, tokenService);
  const creditoService = new CreditoService({
    transactionRunner: database,
    creditoRepository: database.creditoRepository,
    asociadoRepository: database.asociadoRepository,
    historialRepository: database.historialRepository,
    catalogoRepository: database.catalogoRepository,
    webhookOutboxRepository: database.webhookOutboxRepository,
    webhookUrl: URL_WEBHOOK_PRUEBA,
  });

  const app = createApp({
    logger: pino({ level: 'silent' }),
    corsAllowedOrigins: ['http://localhost:5173'],
    checkDatabase: async () => undefined,
    version: '0.0.0-test',
    ...(options.trustProxyHops !== undefined && { trustProxyHops: options.trustProxyHops }),
    docsRouter: createDocsRouter('0.0.0-test'),
    apiRouter: createApiRouter({
      authService,
      tokenService,
      creditoService,
      catalogoRepository: database.catalogoRepository,
      webhookOutboxRepository: database.webhookOutboxRepository,
      ...(options.maxLoginAttempts !== undefined && { maxLoginAttempts: options.maxLoginAttempts }),
    }),
  });

  /** Cabecera Authorization lista para usar con el usuario indicado. */
  const authHeader = async (usuario: UsuarioAutenticado) => {
    const { accessToken } = await tokenService.emitir(usuario);
    return `Bearer ${accessToken}`;
  };

  return { app, database, authHeader };
}
