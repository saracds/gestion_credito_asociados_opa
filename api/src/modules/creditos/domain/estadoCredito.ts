import { BusinessRuleError } from '../../../shared/errors/AppError.js';
import { CreditoErrorCode } from './creditoErrorCodes.js';

/**
 * MÁQUINA DE ESTADOS DEL CRÉDITO (ADR-006)
 *
 *   SOLICITADO ──► EN_ESTUDIO ──► APROBADO ──► DESEMBOLSADO
 *       │              │  │           │
 *       │              │  └─► RECHAZADO
 *       └──────────────┴──────────────┴──► CANCELADO
 *
 * Es la ÚNICA fuente de verdad de las transiciones. La base de datos solo
 * garantiza que el estado sea válido y que un estado final no cambie.
 */
export const ESTADOS_CREDITO = [
  'SOLICITADO',
  'EN_ESTUDIO',
  'APROBADO',
  'RECHAZADO',
  'DESEMBOLSADO',
  'CANCELADO',
] as const;

export type EstadoCredito = (typeof ESTADOS_CREDITO)[number];

/** Transiciones permitidas desde cada estado. Un arreglo vacío = estado final. */
const TRANSICIONES_PERMITIDAS: Readonly<Record<EstadoCredito, readonly EstadoCredito[]>> = {
  SOLICITADO: ['EN_ESTUDIO', 'CANCELADO'],
  EN_ESTUDIO: ['APROBADO', 'RECHAZADO', 'CANCELADO'],
  APROBADO: ['DESEMBOLSADO', 'CANCELADO'],
  RECHAZADO: [],
  DESEMBOLSADO: [],
  CANCELADO: [],
};

/** Estados en los que el crédito sigue "vivo": cuentan para la regla de duplicados. */
export const ESTADOS_ACTIVOS: readonly EstadoCredito[] = ['SOLICITADO', 'EN_ESTUDIO', 'APROBADO'];

/** Estados en los que aún se pueden modificar las condiciones financieras (ADR-009). */
const ESTADOS_EDITABLES: readonly EstadoCredito[] = ['SOLICITADO', 'EN_ESTUDIO'];

/** Único estado desde el que se permite el borrado lógico (ADR-008). */
const ESTADO_ELIMINABLE: EstadoCredito = 'SOLICITADO';

/** Transiciones que exigen justificar el cambio en el campo observacion. */
const ESTADOS_QUE_REQUIEREN_OBSERVACION: readonly EstadoCredito[] = ['RECHAZADO', 'CANCELADO'];

export function obtenerTransicionesPermitidas(
  estadoActual: EstadoCredito,
): readonly EstadoCredito[] {
  return TRANSICIONES_PERMITIDAS[estadoActual];
}

/** Acciones que habilita un estado (se exponen en cada crédito de la API). */
export function calcularAcciones(estado: EstadoCredito): {
  transicionesPermitidas: EstadoCredito[];
  editable: boolean;
  eliminable: boolean;
} {
  return {
    transicionesPermitidas: [...TRANSICIONES_PERMITIDAS[estado]],
    editable: ESTADOS_EDITABLES.includes(estado),
    eliminable: estado === ESTADO_ELIMINABLE,
  };
}

export function esEstadoFinal(estado: EstadoCredito): boolean {
  return TRANSICIONES_PERMITIDAS[estado].length === 0;
}

export function esEditable(estado: EstadoCredito): boolean {
  return ESTADOS_EDITABLES.includes(estado);
}

export function esEliminable(estado: EstadoCredito): boolean {
  return estado === ESTADO_ELIMINABLE;
}

/**
 * Valida un cambio de estado completo: que la transición exista y que, si el
 * nuevo estado lo exige, venga la observación que lo justifica.
 *
 * @throws BusinessRuleError (422) con un mensaje que indica qué SÍ está permitido.
 */
export function validarCambioDeEstado(
  estadoActual: EstadoCredito,
  estadoNuevo: EstadoCredito,
  observacion: string | undefined,
): void {
  if (estadoActual === estadoNuevo) {
    throw new BusinessRuleError(
      CreditoErrorCode.TRANSICION_ESTADO_INVALIDA,
      `El crédito ya se encuentra en estado ${estadoActual}.`,
    );
  }

  const permitidas = TRANSICIONES_PERMITIDAS[estadoActual];

  if (!permitidas.includes(estadoNuevo)) {
    const alternativas =
      permitidas.length > 0
        ? `Desde ${estadoActual} solo se permite pasar a: ${permitidas.join(', ')}.`
        : `${estadoActual} es un estado final y no admite cambios.`;
    throw new BusinessRuleError(
      CreditoErrorCode.TRANSICION_ESTADO_INVALIDA,
      `No se permite cambiar el crédito de ${estadoActual} a ${estadoNuevo}. ${alternativas}`,
    );
  }

  if (ESTADOS_QUE_REQUIEREN_OBSERVACION.includes(estadoNuevo) && !observacion?.trim()) {
    throw new BusinessRuleError(
      CreditoErrorCode.OBSERVACION_REQUERIDA,
      `Para pasar el crédito a ${estadoNuevo} debe registrar una observación que justifique la decisión.`,
      [{ field: 'observacion', message: 'Es obligatoria para este cambio de estado' }],
    );
  }
}
