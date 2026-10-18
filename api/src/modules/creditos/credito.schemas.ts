import { z } from 'zod';

import { CAMPOS_EDITABLES, CAMPOS_INMUTABLES } from './domain/cambiosCredito.js';
import { CAMPOS_ORDENAMIENTO } from './domain/credito.types.js';
import { ESTADOS_CREDITO } from './domain/estadoCredito.js';

/**
 * Esquemas de validación de ENTRADA (forma y tipos de los datos).
 *
 * Aquí se valida lo que puede comprobarse sin consultar la base de datos
 * (tipos, rangos, formatos). Lo que depende del estado del sistema
 * (duplicados, políticas del tipo de crédito, transiciones) lo valida el
 * servicio. 
 *
 * Los objetos son ESTRICTOS: un campo no esperado (p. ej. "estado" al crear)
 * se rechaza. Evita la "asignación masiva": que un cliente cree un crédito
 * directamente APROBADO enviando un campo extra.
 */

/** ¿El número tiene como máximo `decimales` cifras decimales? */
const tieneMaximoDecimales = (decimales: number) => (valor: number) => {
  const escalado = valor * 10 ** decimales;
  return Math.abs(Math.round(escalado) - escalado) < 1e-6;
};

/** En los filtros de un formulario, un campo vacío ("?estado=") significa "sin filtro". */
const vacioComoIndefinido = <TSchema extends z.ZodType>(schema: TSchema) =>
  z.preprocess((valor) => (valor === '' ? undefined : valor), schema.optional());

const identificacionSchema = z
  .string({ error: 'Debe ser un texto' })
  .trim()
  .toUpperCase()
  .regex(/^[0-9A-Z]{5,20}$/, 'Debe tener entre 5 y 20 letras o números, sin espacios ni símbolos');

const nombreAsociadoSchema = z
  .string({ error: 'Debe ser un texto' })
  .trim()
  .min(3, 'Debe tener al menos 3 caracteres')
  .max(150, 'Debe tener máximo 150 caracteres');

const codigoCatalogoSchema = z
  .string({ error: 'Debe ser un texto' })
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9_]{1,30}$/, 'Código inválido (letras mayúsculas, números y guion bajo)');

/**
 * Valores monetarios: número positivo con máximo 2 decimales.
 * Tope de 999.999.999.999,99: con 14 cifras significativas el número es exacto
 * en JavaScript (que representa con precisión hasta ~15-16 cifras). En la base
 * de datos se guarda como DECIMAL(18,2), nunca como FLOAT.
 */
const valorSolicitadoSchema = z
  .number({ error: 'Debe ser un número' })
  .positive('Debe ser mayor que 0')
  .max(999_999_999_999.99, 'Excede el valor máximo permitido')
  .refine(tieneMaximoDecimales(2), 'Máximo 2 decimales');

/** Tasa nominal MENSUAL en porcentaje (1.5 = 1,5 %). */
const tasaInteresSchema = z
  .number({ error: 'Debe ser un número' })
  .min(0, 'No puede ser negativa')
  .max(100, 'No puede superar 100 %')
  .refine(tieneMaximoDecimales(4), 'Máximo 4 decimales');

const numeroCuotasSchema = z
  .number({ error: 'Debe ser un número' })
  .int('Debe ser un número entero')
  .positive('Debe ser mayor que 0')
  .max(360, 'Máximo 360 cuotas');

const observacionSchema = z
  .string({ error: 'Debe ser un texto' })
  .trim()
  .min(1, 'No puede estar vacía')
  .max(500, 'Máximo 500 caracteres');

/** Cuerpo de POST /api/creditos (ejemplo del enunciado de la prueba). */
export const crearCreditoSchema = z.strictObject({
  identificacionAsociado: identificacionSchema,
  nombreAsociado: nombreAsociadoSchema,
  tipoCredito: codigoCatalogoSchema,
  valorSolicitado: valorSolicitadoSchema,
  tasaInteres: tasaInteresSchema,
  numeroCuotas: numeroCuotasSchema,
  formaPago: codigoCatalogoSchema,
});

/** Cuerpo de PATCH /api/creditos/{id}: solo los campos que cambian. */
export const actualizarCreditoSchema = z
  .strictObject({
    tipoCredito: codigoCatalogoSchema.optional(),
    valorSolicitado: valorSolicitadoSchema.optional(),
    tasaInteres: tasaInteresSchema.optional(),
    numeroCuotas: numeroCuotasSchema.optional(),
    formaPago: codigoCatalogoSchema.optional(),
    observacion: observacionSchema.optional(),
  })
  .refine((datos) => CAMPOS_EDITABLES.some((campo) => datos[campo] !== undefined), {
    message: `Debe enviar al menos uno de estos campos: ${CAMPOS_EDITABLES.join(', ')}`,
  });

/** Cuerpo de PATCH /api/creditos/{id}/estado. */
export const cambiarEstadoSchema = z.strictObject({
  estado: z.enum(ESTADOS_CREDITO, {
    error: `Estado inválido. Valores permitidos: ${ESTADOS_CREDITO.join(', ')}`,
  }),
  observacion: observacionSchema.optional(),
});

/** Parámetros de GET /api/creditos. */
export const listarCreditosQuerySchema = z.object({
  page: z.coerce.number().int().min(1, 'Debe ser 1 o mayor').default(1),
  pageSize: z.coerce.number().int().min(1).max(100, 'Máximo 100 registros por página').default(10),
  estado: vacioComoIndefinido(z.enum(ESTADOS_CREDITO)),
  identificacionAsociado: vacioComoIndefinido(identificacionSchema),
  tipoCredito: vacioComoIndefinido(codigoCatalogoSchema),
  busqueda: vacioComoIndefinido(z.string().trim().min(1).max(100)),
  ordenarPor: z.enum(CAMPOS_ORDENAMIENTO).default('fechaSolicitud'),
  direccion: z.enum(['asc', 'desc']).default('desc'),
});

export const creditoIdParamsSchema = z.object({
  id: z.coerce
    .number({ error: 'El id debe ser un número' })
    .int('El id debe ser un entero')
    .positive('El id debe ser mayor que 0')
    .max(Number.MAX_SAFE_INTEGER),
});

/**
 * Detecta en el cuerpo de un PATCH los campos que nunca pueden modificarse.
 * Permite responder con un mensaje de negocio claro ("el campo X es
 * inmutable") en vez del genérico "campo no reconocido".
 */
export function detectarCamposInmutables(cuerpo: unknown): string[] {
  if (typeof cuerpo !== 'object' || cuerpo === null) return [];
  return CAMPOS_INMUTABLES.filter((campo) => campo in cuerpo);
}
