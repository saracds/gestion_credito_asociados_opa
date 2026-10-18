import cors from 'cors';
import express, { type Express, type Router } from 'express';
import helmet from 'helmet';

import { createHealthRouter } from './modules/health/health.router.js';
import { createErrorHandler } from './shared/http/middlewares/errorHandler.js';
import { notFoundHandler } from './shared/http/middlewares/notFoundHandler.js';
import { createRequestLogger, REQUEST_ID_HEADER } from './shared/http/middlewares/requestLogger.js';
import type { Logger } from './shared/logging/logger.js';

export interface AppDependencies {
  logger: Logger;
  corsAllowedOrigins: string[];
  checkDatabase: () => Promise<void>;
  /** Rutas de negocio montadas bajo /api (créditos, autenticación, ...). */
  apiRouter: Router;
  /** Documentación Swagger (opcional); se monta en /api/docs, sin autenticación. */
  docsRouter?: Router;
  version: string;
  /** Proxies inversos de confianza (ver TRUST_PROXY_HOPS). Por defecto, ninguno. */
  trustProxyHops?: number;
}

/** Tamaño máximo del body JSON: un crédito ocupa menos de 1 KB. Limitarlo frena abusos. */
const MAX_JSON_BODY_SIZE = '100kb';

/**
 * Construye la aplicación Express SIN iniciar el servidor ni conectarse a nada.
 *
 * Todas las dependencias llegan por parámetro (inyección de dependencias).
 *
 * El ORDEN de los middlewares importa:
 *   1. Logger de peticiones  -> asigna el requestId antes que nada.
 *   2. Helmet y CORS         -> seguridad antes de procesar la petición.
 *   3. Lectura del body JSON.
 *   4. Rutas.
 *   5. 404 y manejador de errores, siempre al final.
 */
export function createApp(dependencies: AppDependencies): Express {
  const { logger, corsAllowedOrigins, checkDatabase, apiRouter, docsRouter, version } =
    dependencies;
  const app = express();

  // Detrás de Nginx, req.ip debe ser la del usuario y no la del proxy: de ella
  // dependen el límite de intentos y los logs.
  app.set('trust proxy', dependencies.trustProxyHops ?? 0);

  // Express genera ETags automáticos a partir del cuerpo. Se desactivan porque
  // la API publica su propio ETag: la versión del crédito en la base de datos.
  app.set('etag', false);

  app.use(createRequestLogger(logger));

  // Cabeceras de seguridad HTTP: evita sniffing de MIME, clickjacking, oculta
  // "X-Powered-By: Express", fuerza HTTPS en navegadores (HSTS), etc.
  app.use(helmet());

  // CORS: solo los frontends declarados pueden llamar a la API desde el navegador.
  app.use(
    cors({
      origin: corsAllowedOrigins,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization', 'If-Match', REQUEST_ID_HEADER],
      // Cabeceras que el JavaScript del navegador puede leer en la respuesta.
      exposedHeaders: ['ETag', 'Location', REQUEST_ID_HEADER],
    }),
  );

  app.use(express.json({ limit: MAX_JSON_BODY_SIZE }));

  app.use('/health', createHealthRouter({ checkDatabase, version }));
  // La documentación se registra antes de /api para que no exija token.
  if (docsRouter) {
    app.use('/api/docs', docsRouter);
  }
  app.use('/api', apiRouter);

  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));

  return app;
}
