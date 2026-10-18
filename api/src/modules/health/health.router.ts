import { Router } from 'express';

import { sendSuccess } from '../../shared/http/apiResponse.js';
import { ServiceUnavailableError } from '../../shared/errors/AppError.js';

export interface HealthRouterDependencies {
  /** Lanza un error si la base de datos no responde. */
  checkDatabase: () => Promise<void>;
  version: string;
}

/**
 * Health checks, separados en dos según el estándar de los orquestadores
 * (Kubernetes, Azure Container Apps, AWS ECS):
 *
 *   GET /health/live   "¿El proceso está vivo?" No consulta dependencias.
 *                      Si falla, el orquestador REINICIA el contenedor.
 *
 *   GET /health/ready  "¿Puede atender tráfico?" Verifica la base de datos.
 *                      Si falla, el orquestador deja de enviarle peticiones
 *                      pero NO lo reinicia (reiniciar no arregla una BD caída).
 */
export function createHealthRouter({ checkDatabase, version }: HealthRouterDependencies): Router {
  const router = Router();

  router.get('/live', (_request, response) => {
    sendSuccess(response, { status: 'UP', version, uptimeSeconds: Math.round(process.uptime()) });
  });

  router.get('/ready', async (_request, response) => {
    try {
      await checkDatabase();
    } catch (error) {
      throw new ServiceUnavailableError(
        'La API no está lista: la base de datos no responde.',
        error,
      );
    }
    sendSuccess(response, { status: 'UP', version, checks: { database: 'UP' } });
  });

  return router;
}
