import type { AppError } from '../../shared/errors/AppError.js';
import {
  BusinessRuleError,
  ConflictError,
  ServiceUnavailableError,
} from '../../shared/errors/AppError.js';
import { ErrorCode } from '../../shared/errors/errorCodes.js';

/**
 * Números de error de SQL Server que la aplicación sabe interpretar.
 * Referencia: sys.messages y los THROW definidos en database/scripts/001_esquema.sql.
 */
export const SqlServerErrorNumber = {
  /** Violación de índice único (p. ej. UX_Creditos_CreditoActivoPorTipo). */
  UNIQUE_INDEX_VIOLATION: 2601,
  /** Violación de restricción UNIQUE o PRIMARY KEY. */
  UNIQUE_CONSTRAINT_VIOLATION: 2627,
  /** Violación de restricción CHECK o FOREIGN KEY. */
  CONSTRAINT_VIOLATION: 547,
  /** La transacción fue elegida como víctima de un interbloqueo. */
  DEADLOCK_VICTIM: 1205,
  /** Rango de errores de los triggers de integridad de Creditos (50001-50004). */
  CREDITO_INTEGRITY_FIRST: 50001,
  CREDITO_INTEGRITY_LAST: 50004,
} as const;

/** Forma mínima de un error de consulta del driver mssql (RequestError). */
interface SqlServerRequestError {
  number: number;
  message: string;
}

/** Códigos del driver cuando no hay comunicación con el servidor. */
const CONNECTION_ERROR_CODES = new Set([
  'ESOCKET',
  'ECONNCLOSED',
  'ETIMEOUT',
  'ELOGIN',
  'EINSTLOOKUP',
]);

export function isSqlServerRequestError(error: unknown): error is SqlServerRequestError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'number' in error &&
    typeof error.number === 'number'
  );
}

function isSqlServerConnectionError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    CONNECTION_ERROR_CODES.has(error.code)
  );
}

/**
 * Traduce un error de SQL Server a un AppError con su código HTTP.
 *
 * Por qué existe: la API valida las reglas antes de llegar a la base de datos,
 * pero la base de datos es la última barrera (defensa en profundidad). Si una
 * restricción llega a dispararse (p. ej. dos solicitudes simultáneas que pasan
 * la validación de duplicados al mismo tiempo), el cliente debe recibir un
 * error claro y no un 500 genérico.
 *
 * @returns El AppError equivalente, o `null` si el error no es reconocido
 *          (el middleware lo tratará como error interno).
 */
export function translateSqlServerError(error: unknown): AppError | null {
  if (isSqlServerConnectionError(error)) {
    return new ServiceUnavailableError(
      'La base de datos no está disponible en este momento. Intente nuevamente.',
      error,
    );
  }

  if (!isSqlServerRequestError(error)) {
    return null;
  }

  const { number: errorNumber } = error;

  if (
    errorNumber === SqlServerErrorNumber.UNIQUE_INDEX_VIOLATION ||
    errorNumber === SqlServerErrorNumber.UNIQUE_CONSTRAINT_VIOLATION
  ) {
    return new ConflictError(
      ErrorCode.CONFLICT,
      'La operación genera un registro duplicado.',
      error,
    );
  }

  if (errorNumber === SqlServerErrorNumber.CONSTRAINT_VIOLATION) {
    return new BusinessRuleError(
      ErrorCode.BUSINESS_RULE_VIOLATION,
      'Los datos no cumplen las reglas de integridad del sistema.',
      undefined,
      error,
    );
  }

  if (
    errorNumber >= SqlServerErrorNumber.CREDITO_INTEGRITY_FIRST &&
    errorNumber <= SqlServerErrorNumber.CREDITO_INTEGRITY_LAST
  ) {
    // Los mensajes de estos THROW están escritos para el usuario final.
    return new BusinessRuleError(
      ErrorCode.BUSINESS_RULE_VIOLATION,
      error.message,
      undefined,
      error,
    );
  }

  if (errorNumber === SqlServerErrorNumber.DEADLOCK_VICTIM) {
    return new ServiceUnavailableError(
      'El sistema está procesando operaciones concurrentes. Intente nuevamente.',
      error,
    );
  }

  return null;
}
