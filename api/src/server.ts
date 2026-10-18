import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';

import { createApp } from './app.js';
import { buildApiRouter } from './compositionRoot.js';
import { createDocsRouter } from './docs/docs.router.js';
import { loadEnvironment } from './config/environment.js';
import { DatabaseClient } from './infrastructure/database/DatabaseClient.js';
import { createLogger, type Logger } from './shared/logging/logger.js';

/** Tiempo máximo para terminar las peticiones en curso antes de forzar la salida. */
const SHUTDOWN_TIMEOUT_MS = 10_000;

/** Versión tomada de package.json */
const APP_VERSION = readApplicationVersion();

function readApplicationVersion(): string {
  const packageJsonPath = new URL('../package.json', import.meta.url);
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as { version?: string };
  return packageJson.version ?? 'desconocida';
}

/**
 * Punto de entrada: compone las piezas de la aplicación).
 * Es el único lugar que conoce las implementaciones concretas; el resto del
 * código recibe sus dependencias por parámetro.
 */
async function main(): Promise<void> {
  const environment = loadEnvironment();
  const logger = createLogger(environment);

  const database = new DatabaseClient(environment, logger);
  await database.connect();

  const apiRouter = buildApiRouter(database, environment);

  const app = createApp({
    logger,
    corsAllowedOrigins: environment.CORS_ALLOWED_ORIGINS,
    checkDatabase: () => database.ping(),
    apiRouter,
    ...(environment.API_DOCS_ENABLED && { docsRouter: createDocsRouter(APP_VERSION) }),
    version: APP_VERSION,
    trustProxyHops: environment.TRUST_PROXY_HOPS,
  });

  const server = app.listen(environment.PORT, () => {
    logger.info({ port: environment.PORT, env: environment.NODE_ENV }, 'API de créditos iniciada');
  });

  registerGracefulShutdown({ server, database, logger });
}

/**
 * Apagado ordenado. Cuando Docker o Kubernetes detienen el contenedor envían
 * SIGTERM; en ese momento:
 *   1. Se dejan de aceptar conexiones nuevas.
 *   2. Se esperan las peticiones en curso (para no cortar una creación a medias).
 *   3. Se cierra el pool de base de datos y el proceso termina.
 * Si algo se bloquea, a los 10 s se fuerza la salida.
 */
function registerGracefulShutdown({
  server,
  database,
  logger,
}: {
  server: Server;
  database: DatabaseClient;
  logger: Logger;
}): void {
  let isShuttingDown = false;

  const shutdown = (signal: NodeJS.Signals) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.info({ signal }, 'Señal de apagado recibida; cerrando la API');

    const forceExitTimer = setTimeout(() => {
      logger.error('El apagado excedió el tiempo límite; se fuerza la salida');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExitTimer.unref();

    server.close(async () => {
      await database.close();
      logger.info('API detenida correctamente');
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // Un error no controlado deja el proceso en estado incierto: se registra y se
  // termina, para que el orquestador levante una instancia limpia.
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'Promesa rechazada sin manejar');
    process.exit(1);
  });
}

main().catch((error: unknown) => {
  // El logger puede no existir si falló la configuración: se usa stderr directamente.
  process.stderr.write(
    `Error fatal al iniciar la API:\n${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exit(1);
});
