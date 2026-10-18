import { randomUUID } from 'node:crypto';

import { pinoHttp } from 'pino-http';

import type { Logger } from '../../logging/logger.js';

export const REQUEST_ID_HEADER = 'x-request-id';

/** Un identificador recibido se acepta solo si tiene un formato seguro y acotado. */
const SAFE_REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;

/**
 * Registra cada petición HTTP y le asigna un identificador de correlación.
 *
 * - Si el cliente o el balanceador envían `X-Request-Id`, se reutiliza; si no,
 *   se genera un UUID. El identificador se devuelve en la respuesta y aparece
 *   en todos los logs de esa petición y en el cuerpo de los errores.
 * - Así, cuando un usuario reporta un error, basta con su requestId para
 *   encontrar en los logs exactamente qué pasó.
 * - Los health checks no se registran, para no llenar los logs con el sondeo
 *   constante del orquestador.
 */
export function createRequestLogger(logger: Logger) {
  return pinoHttp({
    logger,
    genReqId: (request, response) => {
      const receivedId = request.headers[REQUEST_ID_HEADER];
      const requestId =
        typeof receivedId === 'string' && SAFE_REQUEST_ID_PATTERN.test(receivedId)
          ? receivedId
          : randomUUID();
      response.setHeader(REQUEST_ID_HEADER, requestId);
      return requestId;
    },
    autoLogging: {
      ignore: (request) => request.url?.startsWith('/health') ?? false,
    },
    customLogLevel: (_request, response, error) => {
      if (error || response.statusCode >= 500) return 'error';
      if (response.statusCode >= 400) return 'warn';
      return 'info';
    },
    // Solo los campos útiles: evita registrar cabeceras completas en cada línea.
    serializers: {
      req: (request: { id: unknown; method: string; url: string }) => ({
        id: request.id,
        method: request.method,
        url: request.url,
      }),
      res: (response: { statusCode: number }) => ({ statusCode: response.statusCode }),
    },
  });
}
