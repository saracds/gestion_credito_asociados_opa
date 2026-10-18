import { rateLimit } from 'express-rate-limit';

import { TooManyRequestsError } from '../../errors/AppError.js';

interface RateLimiterOptions {
  windowMinutes: number;
  maxRequests: number;
  message: string;
}

/**
 * Limita la cantidad de peticiones por dirección IP en una ventana de tiempo.
 *
 * Responde con el formato estándar de error (429) y publica las cabeceras
 * `RateLimit-*` para que el cliente sepa cuándo puede reintentar.
 *
 * Limitación conocida: el contador vive en memoria de cada instancia. Con
 * varias réplicas de la API se debe usar un almacén compartido (Redis); ver
 * el documento de escalabilidad.
 */
export function createRateLimiter({ windowMinutes, maxRequests, message }: RateLimiterOptions) {
  return rateLimit({
    windowMs: windowMinutes * 60_000,
    limit: maxRequests,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_request, _response, next) => next(new TooManyRequestsError(message)),
  });
}
