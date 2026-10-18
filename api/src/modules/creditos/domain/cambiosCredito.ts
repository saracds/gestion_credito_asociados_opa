import type { CambioDeCampo, CondicionesCredito } from './credito.types.js';

export const CAMPOS_EDITABLES = [
  'tipoCredito',
  'valorSolicitado',
  'tasaInteres',
  'numeroCuotas',
  'formaPago',
] as const satisfies readonly (keyof CondicionesCredito)[];

/** Campos que nunca pueden modificarse (ADR-009). */
export const CAMPOS_INMUTABLES = [
  'id',
  'numeroCredito',
  'identificacionAsociado',
  'nombreAsociado',
  'fechaSolicitud',
  'fechaActualizacion',
  'estado',
  'version',
] as const;

/**
 * Compara las condiciones actuales con las solicitadas y devuelve SOLO los
 * campos que realmente cambian. Es la ventaja de PATCH sobre PUT: el historial
 * registra exactamente qué se modificó, y si nada cambia no se escribe nada.
 */
export function calcularCambios(
  actuales: CondicionesCredito,
  solicitados: Partial<CondicionesCredito>,
): Partial<Record<keyof CondicionesCredito, CambioDeCampo>> {
  const cambios: Partial<Record<keyof CondicionesCredito, CambioDeCampo>> = {};

  for (const campo of CAMPOS_EDITABLES) {
    const valorNuevo = solicitados[campo];
    if (valorNuevo !== undefined && valorNuevo !== actuales[campo]) {
      cambios[campo] = { anterior: actuales[campo], nuevo: valorNuevo };
    }
  }

  return cambios;
}
