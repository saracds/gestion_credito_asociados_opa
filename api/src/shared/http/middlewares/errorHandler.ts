import type { ErrorRequestHandler } from 'express';

import { translateSqlServerError } from '../../../infrastructure/database/sqlServerErrors.js';
import { AppError } from '../../errors/AppError.js';
import { ErrorCode } from '../../errors/errorCodes.js';
import type { Logger } from '../../logging/logger.js';
import type { ApiErrorResponse } from '../apiResponse.js';

/**
 * Errores que genera el propio Express al leer el body (paquete body-parser).
 * Se reconocen por su propiedad `type`.
 */
function getBodyParserErrorType(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'type' in error) {
    return typeof error.type === 'string' ? error.type : undefined;
  }
  return undefined;
}

/**
 * Convierte cualquier error en un AppError, para responder siempre igual.
 * Orden de evaluación: errores propios -> errores de lectura del body ->
 * errores de SQL Server -> error inesperado (500).
 */
function normalizeError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  const bodyParserErrorType = getBodyParserErrorType(error);
  if (bodyParserErrorType === 'entity.parse.failed') {
    return new AppError({
      httpStatus: 400,
      code: ErrorCode.INVALID_JSON,
      message: 'El cuerpo de la petición no es un JSON válido.',
      cause: error,
    });
  }
  if (bodyParserErrorType === 'entity.too.large') {
    return new AppError({
      httpStatus: 413,
      code: ErrorCode.PAYLOAD_TOO_LARGE,
      message: 'El cuerpo de la petición supera el tamaño permitido.',
      cause: error,
    });
  }

  const translatedSqlError = translateSqlServerError(error);
  if (translatedSqlError) {
    return translatedSqlError;
  }

  // Mensaje genérico a propósito: el detalle real nunca se expone al cliente.
  return new AppError({
    httpStatus: 500,
    code: ErrorCode.INTERNAL_ERROR,
    message: 'Ocurrió un error inesperado. Si persiste, reporte el identificador de la petición.',
    cause: error,
  });
}

/**
 * Middleware final de manejo de errores (debe registrarse de último).
 *
 * En Express 5 los errores de funciones `async` llegan aquí automáticamente,
 * sin necesidad de envolver cada controlador en try/catch.
 *
 * Registro en logs según gravedad:
 *   5xx -> error (falla nuestra: requiere atención, incluye la causa completa)
 *   4xx -> warn  (error del cliente: útil para detectar abusos o malos usos)
 */
export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, request, response, _next) => {
    const appError = normalizeError(error);
    const requestId = String(request.id);

    const logContext = {
      requestId,
      method: request.method,
      path: request.originalUrl,
      statusCode: appError.httpStatus,
      code: appError.code,
    };

    if (appError.httpStatus >= 500) {
      logger.error({ ...logContext, err: appError.cause ?? appError }, appError.message);
    } else {
      logger.warn(logContext, appError.message);
    }

    const body: ApiErrorResponse = {
      success: false,
      error: {
        code: appError.code,
        message: appError.message,
        ...(appError.details && { details: appError.details }),
        requestId,
      },
    };

    response.status(appError.httpStatus).json(body);
  };
}
