import { ErrorCode, type ErrorCodeValue } from './errorCodes.js';

/** Detalle de un error puntual, p. ej. un campo inválido del formulario. */
export interface ErrorDetail {
  field?: string;
  message: string;
}

interface AppErrorOptions {
  httpStatus: number;
  code: ErrorCodeValue;
  message: string;
  details?: ErrorDetail[];
  cause?: unknown;
}

/**
 * Error controlado de la aplicación.
 *
 * Todo error que la API quiera comunicar al cliente se lanza como AppError (o
 * una de sus subclases). El middleware de errores lo convierte en la respuesta
 * estándar. Cualquier otro error se trata como inesperado: se registra completo
 * en el log y al cliente solo se le responde un 500 genérico, para no filtrar
 * detalles internos (rutas, consultas SQL, trazas).
 */
export class AppError extends Error {
  readonly httpStatus: number;
  readonly code: ErrorCodeValue;
  readonly details: ErrorDetail[] | undefined;

  constructor({ httpStatus, code, message, details, cause }: AppErrorOptions) {
    super(message, { cause });
    this.name = new.target.name;
    this.httpStatus = httpStatus;
    this.code = code;
    this.details = details;
  }
}

/* Subclases por tipo de error: hacen que el código que las lanza sea
   autoexplicativo, p. ej. `throw new NotFoundError('CREDITO_NOT_FOUND', ...)`. */

export class ValidationError extends AppError {
  constructor(message: string, details?: ErrorDetail[]) {
    super({ httpStatus: 400, code: ErrorCode.VALIDATION_ERROR, message, details });
  }
}

export class UnauthorizedError extends AppError {
  constructor(
    message = 'Se requiere autenticación.',
    code: ErrorCodeValue = ErrorCode.UNAUTHORIZED,
  ) {
    super({ httpStatus: 401, code, message });
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'No tiene permisos para realizar esta operación.') {
    super({ httpStatus: 403, code: ErrorCode.FORBIDDEN, message });
  }
}

export class NotFoundError extends AppError {
  constructor(code: ErrorCodeValue, message: string) {
    super({ httpStatus: 404, code, message });
  }
}

export class ConflictError extends AppError {
  constructor(code: ErrorCodeValue, message: string, cause?: unknown) {
    super({ httpStatus: 409, code, message, cause });
  }
}

export class BusinessRuleError extends AppError {
  constructor(code: ErrorCodeValue, message: string, details?: ErrorDetail[], cause?: unknown) {
    super({ httpStatus: 422, code, message, details, cause });
  }
}

/** 412: la versión enviada en If-Match ya no es la vigente (otro usuario modificó el recurso). */
export class PreconditionFailedError extends AppError {
  constructor(message: string) {
    super({ httpStatus: 412, code: ErrorCode.PRECONDITION_FAILED, message });
  }
}

/** 428: la operación exige la cabecera If-Match y no se envió. */
export class PreconditionRequiredError extends AppError {
  constructor(message: string) {
    super({ httpStatus: 428, code: ErrorCode.PRECONDITION_REQUIRED, message });
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message: string) {
    super({ httpStatus: 429, code: ErrorCode.TOO_MANY_REQUESTS, message });
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message: string, cause?: unknown) {
    super({ httpStatus: 503, code: ErrorCode.SERVICE_UNAVAILABLE, message, cause });
  }
}
