import { describe, expect, it } from 'vitest';

import { translateSqlServerError } from '../src/infrastructure/database/sqlServerErrors.js';

const sqlError = (number: number, message = 'mensaje de SQL Server') =>
  Object.assign(new Error(message), { number });

describe('Traducción de errores de SQL Server', () => {
  it.each([
    [2601, 409, 'CONFLICT'],
    [2627, 409, 'CONFLICT'],
    [547, 422, 'BUSINESS_RULE_VIOLATION'],
    [1205, 503, 'SERVICE_UNAVAILABLE'],
  ])('error %i -> HTTP %i %s', (errorNumber, expectedStatus, expectedCode) => {
    const appError = translateSqlServerError(sqlError(errorNumber));

    expect(appError?.httpStatus).toBe(expectedStatus);
    expect(appError?.code).toBe(expectedCode);
  });

  it('conserva el mensaje de los triggers de integridad (50001-50004)', () => {
    const message = 'Un crédito en estado final no puede cambiar de estado.';

    const appError = translateSqlServerError(sqlError(50003, message));

    expect(appError?.httpStatus).toBe(422);
    expect(appError?.message).toBe(message);
  });

  it('traduce la pérdida de conexión a 503', () => {
    const connectionError = Object.assign(new Error('socket hang up'), { code: 'ESOCKET' });

    expect(translateSqlServerError(connectionError)?.httpStatus).toBe(503);
  });

  it('devuelve null para errores no reconocidos', () => {
    expect(translateSqlServerError(sqlError(50010))).toBeNull();
    expect(translateSqlServerError(new Error('otro error'))).toBeNull();
  });
});
