/**
 * Códigos de error del módulo de créditos. Son parte del contrato de la API:
 * el frontend los usa para decidir qué mensaje o acción mostrar.
 */
export const CreditoErrorCode = {
  /** 404 — El crédito no existe o fue eliminado. */
  CREDITO_NOT_FOUND: 'CREDITO_NOT_FOUND',
  /** 409 — El asociado ya tiene un crédito activo del mismo tipo. */
  CREDITO_DUPLICADO: 'CREDITO_DUPLICADO',
  /** 409 — La identificación existe con un nombre distinto. */
  ASOCIADO_NOMBRE_NO_COINCIDE: 'ASOCIADO_NOMBRE_NO_COINCIDE',
  /** 412 — La versión enviada en If-Match no es la vigente. */
  VERSION_DESACTUALIZADA: 'VERSION_DESACTUALIZADA',
  /** 422 — El tipo de crédito no existe o está inactivo. */
  TIPO_CREDITO_INVALIDO: 'TIPO_CREDITO_INVALIDO',
  /** 422 — La forma de pago no existe o está inactiva. */
  FORMA_PAGO_INVALIDA: 'FORMA_PAGO_INVALIDA',
  /** 422 — Valor, plazo o tasa por fuera de lo permitido para el tipo de crédito. */
  CONDICIONES_FUERA_DE_POLITICA: 'CONDICIONES_FUERA_DE_POLITICA',
  /** 422 — Se intentó modificar un campo inmutable. */
  CAMPO_INMUTABLE: 'CAMPO_INMUTABLE',
  /** 422 — El estado actual no permite editar las condiciones. */
  CREDITO_NO_EDITABLE: 'CREDITO_NO_EDITABLE',
  /** 422 — El estado actual no permite el borrado lógico. */
  CREDITO_NO_ELIMINABLE: 'CREDITO_NO_ELIMINABLE',
  /** 422 — La transición de estado no está permitida. */
  TRANSICION_ESTADO_INVALIDA: 'TRANSICION_ESTADO_INVALIDA',
  /** 422 — El cambio de estado exige una observación. */
  OBSERVACION_REQUERIDA: 'OBSERVACION_REQUERIDA',
} as const;
