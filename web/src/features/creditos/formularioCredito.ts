import { z } from 'zod';

import type { TipoCreditoCatalogo } from '@/api/types';
import { formatearPesos, formatearTasa } from '@/lib/formato';

/**
 * Validación del formulario en el navegador.
 *
 * Por qué validar dos veces (aquí y en la API): aquí es para la EXPERIENCIA
 * (el usuario ve el error al instante, sin esperar al servidor); la API es la
 * AUTORIDAD (nadie puede saltarse sus reglas enviando peticiones a mano). Si
 * alguna vez difieren, gana la API y su error se muestra en el mismo campo.
 *
 * Las reglas que dependen de datos (montos, plazos y tasa máxima por tipo de
 * crédito) no se copian: se leen del catálogo que entrega la API.
 */

const tieneMaximoDecimales = (decimales: number) => (valor: number) => {
  const escalado = valor * 10 ** decimales;
  return Math.abs(Math.round(escalado) - escalado) < 1e-6;
};

const numero = (mensaje: string) =>
  z.preprocess(
    (valor) => (valor === '' || valor === null || valor === undefined ? undefined : Number(valor)),
    z.number({ error: mensaje }),
  );

export const condicionesBase = {
  tipoCredito: z.string().min(1, 'Seleccione el tipo de crédito'),
  formaPago: z.string().min(1, 'Seleccione la forma de pago'),
  valorSolicitado: numero('Escriba el valor solicitado').pipe(
    z
      .number()
      .positive('Debe ser mayor que 0')
      .refine(tieneMaximoDecimales(2), 'Máximo 2 decimales'),
  ),
  tasaInteres: numero('Escriba la tasa de interés').pipe(
    z
      .number()
      .min(0, 'No puede ser negativa')
      .max(100)
      .refine(tieneMaximoDecimales(4), 'Máximo 4 decimales'),
  ),
  numeroCuotas: numero('Escriba el número de cuotas').pipe(
    z
      .number()
      .int('Debe ser un número entero')
      .positive('Debe ser mayor que 0')
      .max(360, 'Máximo 360 cuotas'),
  ),
};

/** Agrega la validación contra la política del tipo de crédito elegido. */
export function validarPolitica(
  datos: {
    tipoCredito: string;
    valorSolicitado: number;
    tasaInteres: number;
    numeroCuotas: number;
  },
  contexto: z.RefinementCtx,
  tiposCredito: TipoCreditoCatalogo[],
): void {
  const politica = tiposCredito.find((tipo) => tipo.codigo === datos.tipoCredito);
  if (!politica) return;

  if (
    datos.valorSolicitado < politica.valorMinimo ||
    datos.valorSolicitado > politica.valorMaximo
  ) {
    contexto.addIssue({
      code: 'custom',
      path: ['valorSolicitado'],
      message: `Para ${politica.nombre.toLowerCase()} debe estar entre ${formatearPesos(politica.valorMinimo)} y ${formatearPesos(politica.valorMaximo)}`,
    });
  }
  if (datos.numeroCuotas > politica.cuotasMaximas) {
    contexto.addIssue({
      code: 'custom',
      path: ['numeroCuotas'],
      message: `Para ${politica.nombre.toLowerCase()} el máximo es ${politica.cuotasMaximas} cuotas`,
    });
  }
  if (datos.tasaInteres > politica.tasaMaximaMensual) {
    contexto.addIssue({
      code: 'custom',
      path: ['tasaInteres'],
      message: `Para ${politica.nombre.toLowerCase()} la tasa máxima es ${formatearTasa(politica.tasaMaximaMensual)}`,
    });
  }
}

export function crearEsquemaSolicitud(tiposCredito: TipoCreditoCatalogo[]) {
  return z
    .object({
      identificacionAsociado: z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[0-9A-Z]{5,20}$/, 'Entre 5 y 20 letras o números, sin espacios ni puntos'),
      nombreAsociado: z.string().trim().min(3, 'Escriba el nombre completo').max(150),
      ...condicionesBase,
    })
    .superRefine((datos, contexto) => validarPolitica(datos, contexto, tiposCredito));
}

export type DatosSolicitud = z.output<ReturnType<typeof crearEsquemaSolicitud>>;
export type DatosSolicitudEntrada = z.input<ReturnType<typeof crearEsquemaSolicitud>>;

export const CAMPOS_SOLICITUD = [
  'identificacionAsociado',
  'nombreAsociado',
  'tipoCredito',
  'formaPago',
  'valorSolicitado',
  'tasaInteres',
  'numeroCuotas',
] as const;

/**
 * Cuota mensual estimada (cuota fija):
 *   cuota = P · i / (1 − (1 + i)^−n)
 */
export function calcularCuotaEstimada(
  valor: number,
  tasaMensualPorcentaje: number,
  cuotas: number,
): number | null {
  if (!(valor > 0) || !(cuotas > 0) || tasaMensualPorcentaje < 0) return null;
  const tasa = tasaMensualPorcentaje / 100;
  if (tasa === 0) return valor / cuotas;
  return (valor * tasa) / (1 - (1 + tasa) ** -cuotas);
}

/** Texto de ayuda con las condiciones del tipo de crédito. */
export function describirPolitica(politica: TipoCreditoCatalogo | undefined): string | undefined {
  if (!politica) return undefined;
  return `De ${formatearPesos(politica.valorMinimo)} a ${formatearPesos(politica.valorMaximo)}, hasta ${politica.cuotasMaximas} cuotas y tasa máxima de ${formatearTasa(politica.tasaMaximaMensual)}.`;
}
