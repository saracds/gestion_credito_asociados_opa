import { Router } from 'express';
import { z } from 'zod';

import { BusinessRuleError } from '../../shared/errors/AppError.js';
import { sendSuccess } from '../../shared/http/apiResponse.js';
import { parseOrThrow } from '../../shared/validation/parseOrThrow.js';
import { authorize } from '../auth/auth.middleware.js';
import { ROLES_ADMINISTRACION } from '../auth/auth.types.js';
import type { WebhookOutboxRepository } from './WebhookOutboxRepository.js';

const INTENTOS_ADICIONALES_POR_DEFECTO = 3;

const paramsSchema = z.object({
  id: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});

export const reprogramarNotificacionSchema = z
  .strictObject({
    intentosAdicionales: z.number().int().min(1).max(10).optional(),
  })
  .optional();

/**
 * POST /api/webhooks/notificaciones/{id}/reprogramar   (solo ADMIN)
 *
 * Reproceso manual de una notificación FALLIDA: cuando el sistema externo se
 * recupera, un administrador le concede intentos adicionales y el worker la
 * vuelve a enviar. La traza de los intentos anteriores se conserva completa.
 */
export function createWebhooksRouter(outboxRepository: WebhookOutboxRepository): Router {
  const router = Router();

  router.post(
    '/notificaciones/:id/reprogramar',
    authorize(ROLES_ADMINISTRACION),
    async (request, response) => {
      const { id } = parseOrThrow(paramsSchema, request.params);
      const cuerpo = parseOrThrow(reprogramarNotificacionSchema, request.body);
      const intentosAdicionales = cuerpo?.intentosAdicionales ?? INTENTOS_ADICIONALES_POR_DEFECTO;

      const reprogramada = await outboxRepository.reprogramarFallido(id, intentosAdicionales);
      if (!reprogramada) {
        throw new BusinessRuleError(
          'NOTIFICACION_NO_REPROGRAMABLE',
          `La notificación ${id} no existe o no está en estado FALLIDO.`,
        );
      }

      sendSuccess(response, { id, estado: 'PENDIENTE', intentosAdicionales });
    },
  );

  return router;
}
