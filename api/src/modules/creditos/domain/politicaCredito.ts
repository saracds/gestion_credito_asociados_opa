import type { ErrorDetail } from '../../../shared/errors/AppError.js';
import type { CondicionesCredito } from './credito.types.js';

/**
 * Política de un tipo de crédito, tomada del catálogo dbo.TiposCredito.
 * Es configurable por el negocio sin cambiar código (ADR-010).
 */
export interface PoliticaTipoCredito {
  codigo: string;
  nombre: string;
  valorMinimo: number;
  valorMaximo: number;
  cuotasMaximas: number;
  tasaMaximaMensual: number;
}

const formatoPesos = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
});

/**
 * Verifica que valor, plazo y tasa estén dentro de lo que permite el tipo de
 * crédito. Devuelve TODAS las violaciones (no solo la primera), para que el
 * usuario corrija el formulario de una sola vez.
 *
 * @returns Lista de violaciones; vacía si las condiciones cumplen la política.
 */
export function evaluarPoliticaDeCredito(
  condiciones: Pick<CondicionesCredito, 'valorSolicitado' | 'numeroCuotas' | 'tasaInteres'>,
  politica: PoliticaTipoCredito,
): ErrorDetail[] {
  const violaciones: ErrorDetail[] = [];

  if (
    condiciones.valorSolicitado < politica.valorMinimo ||
    condiciones.valorSolicitado > politica.valorMaximo
  ) {
    violaciones.push({
      field: 'valorSolicitado',
      message: `Para ${politica.nombre} el valor debe estar entre ${formatoPesos.format(politica.valorMinimo)} y ${formatoPesos.format(politica.valorMaximo)}`,
    });
  }

  if (condiciones.numeroCuotas > politica.cuotasMaximas) {
    violaciones.push({
      field: 'numeroCuotas',
      message: `Para ${politica.nombre} el plazo máximo es de ${politica.cuotasMaximas} cuotas`,
    });
  }

  if (condiciones.tasaInteres > politica.tasaMaximaMensual) {
    violaciones.push({
      field: 'tasaInteres',
      message: `Para ${politica.nombre} la tasa máxima es ${politica.tasaMaximaMensual} % mensual`,
    });
  }

  return violaciones;
}
