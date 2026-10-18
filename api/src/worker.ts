import { loadWorkerEnvironment } from './config/environment.js';
import { DatabaseClient } from './infrastructure/database/DatabaseClient.js';
import { WebhookDispatcher } from './modules/webhooks/WebhookDispatcher.js';
import { SqlServerWebhookOutboxRepository } from './modules/webhooks/WebhookOutboxRepository.js';
import { WebhookWorker } from './modules/webhooks/WebhookWorker.js';
import { createLogger } from './shared/logging/logger.js';

const SHUTDOWN_TIMEOUT_MS = 20_000;

/**
 * Punto de entrada del WORKER DE WEBHOOKS (proceso independiente de la API).
 *
 * Usa la misma imagen Docker que la API, con otro comando (node dist/worker.js).
 * Ventajas de separarlo de la API:
 *   - Si el sistema externo está lento o caído, la API no se ve afectada.
 *   - Escalan por separado: más réplicas de API para tráfico de usuarios, más
 *     workers si crece el volumen de notificaciones.
 *   - Varios workers pueden correr a la vez sin enviar dos veces el mismo
 *     evento (UPDLOCK + READPAST al reclamar).
 */
async function main(): Promise<void> {
  const environment = loadWorkerEnvironment();
  const logger = createLogger(environment, 'creditos-opa-webhook-worker');

  const database = new DatabaseClient(environment, logger);
  await database.connect();

  const dispatcher = new WebhookDispatcher({
    outboxRepository: new SqlServerWebhookOutboxRepository(database),
    logger,
    config: {
      secreto: environment.WEBHOOK_SECRET,
      tamanoLote: environment.WEBHOOK_BATCH_SIZE,
      timeoutMs: environment.WEBHOOK_REQUEST_TIMEOUT_MS,
      reintentos: {
        esperaBaseSegundos: environment.WEBHOOK_RETRY_BASE_SECONDS,
        esperaMaximaSegundos: environment.WEBHOOK_RETRY_MAX_SECONDS,
      },
    },
  });

  const worker = new WebhookWorker(dispatcher, logger, {
    intervaloMs: environment.WEBHOOK_POLL_INTERVAL_MS,
    archivoLatido: environment.WORKER_HEARTBEAT_FILE,
  });
  worker.iniciar();

  let apagando = false;
  const apagar = async (signal: NodeJS.Signals) => {
    if (apagando) return;
    apagando = true;
    logger.info({ signal }, 'Señal de apagado recibida; terminando el lote en curso');

    setTimeout(() => {
      logger.error('El apagado excedió el tiempo límite; se fuerza la salida');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS).unref();

    await worker.detener();
    await database.close();
    process.exit(0);
  };

  process.on('SIGTERM', (signal) => void apagar(signal));
  process.on('SIGINT', (signal) => void apagar(signal));
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'Promesa rechazada sin manejar');
    process.exit(1);
  });
}

main().catch((error: unknown) => {
  process.stderr.write(
    `Error fatal al iniciar el worker de webhooks:\n${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exit(1);
});
