import type { Credito } from './credito.types.js';

export const TIPO_EVENTO_CREDITO_CREADO = 'credito.creado';

/** Cuerpo del webhook, con la estructura exacta pedida en la prueba técnica. */
export interface EventoCreditoCreado {
  event: typeof TIPO_EVENTO_CREDITO_CREADO;
  eventId: string;
  timestamp: string;
  data: {
    id: number;
    numeroCredito: string;
    identificacionAsociado: string;
    valorSolicitado: number;
    estado: Credito['estado'];
  };
}

/**
 * Construye el evento "credito.creado" que se guardará en el outbox.
 *
 * - `eventId` (UUID) lo genera la API: el receptor lo usa para descartar
 *   notificaciones repetidas, porque el envío garantiza "al menos una vez"
 *   (un reintento puede llegar después de un envío que sí se procesó).
 * - `timestamp` es el momento en que ocurrió el hecho de negocio, no el del
 *   envío: si hay reintentos, el evento sigue diciendo cuándo se creó el crédito.
 */
export function construirEventoCreditoCreado(
  credito: Credito,
  eventId: string,
): EventoCreditoCreado {
  return {
    event: TIPO_EVENTO_CREDITO_CREADO,
    eventId,
    timestamp: credito.fechaSolicitud,
    data: {
      id: credito.id,
      numeroCredito: credito.numeroCredito,
      identificacionAsociado: credito.identificacionAsociado,
      valorSolicitado: credito.valorSolicitado,
      estado: credito.estado,
    },
  };
}
