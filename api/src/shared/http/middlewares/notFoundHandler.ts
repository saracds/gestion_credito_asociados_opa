import type { RequestHandler } from 'express';

import { NotFoundError } from '../../errors/AppError.js';
import { ErrorCode } from '../../errors/errorCodes.js';

/**
 * Se registra después de todas las rutas: si una petición llega aquí es porque
 * ninguna ruta la atendió. Delega en el manejador de errores para conservar el
 * formato estándar de respuesta.
 */
export const notFoundHandler: RequestHandler = (request, _response, next) => {
  next(
    new NotFoundError(
      ErrorCode.ROUTE_NOT_FOUND,
      `La ruta ${request.method} ${request.originalUrl} no existe.`,
    ),
  );
};
