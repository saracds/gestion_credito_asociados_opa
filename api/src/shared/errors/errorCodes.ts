/**
 * Catálogo de códigos de error transversales de la API.
 *
 * El código es un identificador ESTABLE pensado para máquinas: el frontend o
 * un sistema integrador decide qué hacer según el código, nunca interpretando
 * el texto del mensaje (que puede cambiar o traducirse).
 *
 * Criterio para elegir el código HTTP:
 *   400 Bad Request           La petición está mal formada o no cumple el esquema
 *                             (falta un campo, tipo incorrecto, JSON inválido).
 *   401 Unauthorized          No hay credenciales válidas (token ausente o vencido).
 *   403 Forbidden             Hay credenciales, pero el rol no tiene permiso.
 *   404 Not Found             El recurso o la ruta no existe.
 *   409 Conflict              La operación choca con el estado actual de los datos
 *                             (crédito duplicado, asociado con otro nombre).
 *   412 Precondition Failed   La versión enviada en If-Match ya no es la vigente
 *                             (concurrencia optimista, RFC 9110).
 *   422 Unprocessable Entity  La petición es válida en forma, pero viola una regla
 *                             de negocio (transición de estado no permitida).
 *   428 Precondition Required La operación exige If-Match y no se envió (RFC 6585).
 *   429 Too Many Requests     Se superó el límite de peticiones.
 *   500 Internal Server Error Error inesperado; el detalle solo va al log.
 *   503 Service Unavailable   Una dependencia (base de datos) no está disponible.
 *
 * Los módulos de negocio definen sus códigos específicos (p. ej.
 * CREDITO_NOT_FOUND en modules/creditos/domain/creditoErrorCodes.ts).
 */
export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_JSON: 'INVALID_JSON',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  ROUTE_NOT_FOUND: 'ROUTE_NOT_FOUND',
  CONFLICT: 'CONFLICT',
  PRECONDITION_FAILED: 'PRECONDITION_FAILED',
  PRECONDITION_REQUIRED: 'PRECONDITION_REQUIRED',
  BUSINESS_RULE_VIOLATION: 'BUSINESS_RULE_VIOLATION',
  TOO_MANY_REQUESTS: 'TOO_MANY_REQUESTS',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
} as const;

/**
 * Los módulos de dominio pueden definir códigos más específicos
 * (p. ej. CREDITO_NOT_FOUND), por eso el tipo acepta cualquier texto.
 */
export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode] | (string & {});
