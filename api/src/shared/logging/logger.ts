import { pino, type Logger } from 'pino';

import type { CommonEnvironment } from '../../config/environment.js';

export type { Logger };

/**
 * Campos que nunca deben aparecer en los logs. Pino los reemplaza por
 * "[REDACTED]" antes de escribir: protege contraseñas y tokens aunque un
 * desarrollador registre por error el objeto completo de la petición.
 */
const SENSITIVE_FIELDS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'password',
  '*.password',
  'passwordHash',
  '*.passwordHash',
  'token',
  '*.token',
];

/**
 * Crea el logger estructurado de la aplicación.
 *
 * - Producción: una línea JSON por evento. Es el formato que entienden los
 *   agregadores de logs para buscar y filtrar por campo (requestId, statusCode, etc.).
 * - Desarrollo: salida legible y con colores mediante pino-pretty.
 *
 * `serviceName` distingue en los logs a la API del worker de webhooks.
 */
export function createLogger(
  environment: Pick<CommonEnvironment, 'NODE_ENV' | 'LOG_LEVEL'>,
  serviceName = 'creditos-opa-api',
): Logger {
  const isDevelopment = environment.NODE_ENV === 'development';

  return pino({
    level: environment.LOG_LEVEL,
    base: { service: serviceName },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: SENSITIVE_FIELDS, censor: '[REDACTED]' },
    ...(isDevelopment && {
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname,service' },
      },
    }),
  });
}
