/**
 * Formatos de presentación en español de Colombia. La API trabaja en UTC; la
 * conversión a hora de Bogotá ocurre solo aquí, al mostrar.
 */

const ZONA_HORARIA = 'America/Bogota';

const pesos = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
});

/**
 * En español los números de 4 cifras no llevan separador por defecto (1002);
 * en montos de cartera se fuerza siempre ("1.002").
 */
const millones = new Intl.NumberFormat('es-CO', {
  maximumFractionDigits: 1,
  useGrouping: 'always',
});
const decimal = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 4 });

const fecha = new Intl.DateTimeFormat('es-CO', {
  timeZone: ZONA_HORARIA,
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

const fechaHora = new Intl.DateTimeFormat('es-CO', {
  timeZone: ZONA_HORARIA,
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export const formatearPesos = (valor: number) => pesos.format(valor);
/** Montos grandes en millones: 1.002.100.000 → "$1.002,1 M". */
export const formatearPesosCompacto = (valor: number) => `$${millones.format(valor / 1_000_000)} M`;
/** Número con coma decimal (1,5), como se escribe en Colombia. */
export const formatearDecimal = (valor: number) => decimal.format(valor);
export const formatearFecha = (iso: string) => fecha.format(new Date(iso));
export const formatearFechaHora = (iso: string) => fechaHora.format(new Date(iso));
export const formatearTasa = (tasa: number) => `${decimal.format(tasa)} % mensual`;
