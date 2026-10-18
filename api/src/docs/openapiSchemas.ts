import { z } from 'zod';

import { ROLES } from '../modules/auth/auth.types.js';
import { ESTADOS_CREDITO } from '../modules/creditos/domain/estadoCredito.js';

/**
 * ESQUEMAS DE RESPUESTA de la API, definidos con Zod.
 *
 * Cumplen dos funciones con una sola definición:
 *   1. Documentación: se convierten a JSON Schema para el documento OpenAPI.
 *   2. Contrato verificable: las pruebas validan las respuestas reales contra
 *      estos esquemas. Si la API cambia y la documentación no, fallan.
 *
 * Son ESTRICTOS (no admiten campos adicionales): si por error se expusiera un
 * dato interno (p. ej. asociadoId o passwordHash), la prueba de contrato lo
 * detecta.
 *
 * Los esquemas de ENTRADA no se repiten aquí: se reutilizan los mismos que
 * validan las peticiones (credito.schemas.ts, auth.router.ts).
 */

const fechaIso = z.iso.datetime().describe('Fecha y hora en UTC, formato ISO 8601');

export const usuarioSchema = z
  .strictObject({
    id: z.number().int(),
    email: z.string(),
    nombre: z.string(),
    rol: z.enum(ROLES),
  })
  .meta({ id: 'Usuario', description: 'Usuario autenticado (sin datos sensibles)' });

export const loginRespuestaSchema = z
  .strictObject({
    accessToken: z.string().describe('JWT para la cabecera Authorization: Bearer <token>'),
    tokenType: z.literal('Bearer'),
    expiresIn: z.number().int().describe('Vigencia del token en segundos'),
    usuario: usuarioSchema,
  })
  .meta({ id: 'LoginRespuesta' });

export const creditoSchema = z
  .strictObject({
    id: z.number().int(),
    numeroCredito: z.string().describe('Formato CR-AAAA-NNNNNN; inmutable'),
    identificacionAsociado: z.string(),
    nombreAsociado: z.string(),
    tipoCredito: z.string().describe('Código del catálogo de tipos de crédito'),
    tipoCreditoNombre: z.string(),
    valorSolicitado: z.number().describe('Valor en pesos, máximo 2 decimales'),
    tasaInteres: z.number().describe('Tasa nominal MENSUAL en porcentaje (1.5 = 1,5 %)'),
    numeroCuotas: z.number().int(),
    formaPago: z.string().describe('Código del catálogo de formas de pago'),
    formaPagoNombre: z.string(),
    estado: z.enum(ESTADOS_CREDITO),
    fechaSolicitud: fechaIso,
    fechaActualizacion: fechaIso,
    version: z
      .string()
      .regex(/^[0-9A-F]{16}$/)
      .describe('Versión para concurrencia optimista. Enviarla en If-Match al editar.'),
    transicionesPermitidas: z
      .array(z.enum(ESTADOS_CREDITO))
      .describe('Estados a los que puede pasar desde el estado actual (vacío = estado final)'),
    editable: z
      .boolean()
      .describe('Si sus condiciones pueden modificarse (SOLICITADO o EN_ESTUDIO)'),
    eliminable: z.boolean().describe('Si admite borrado lógico (solo SOLICITADO)'),
  })
  .meta({
    id: 'Credito',
    examples: [
      {
        id: 123,
        numeroCredito: 'CR-2026-000123',
        identificacionAsociado: '1001234567',
        nombreAsociado: 'Juan Perez',
        tipoCredito: 'LIBRE_INVERSION',
        tipoCreditoNombre: 'Libre inversión',
        valorSolicitado: 15000000,
        tasaInteres: 1.5,
        numeroCuotas: 36,
        formaPago: 'NOMINA',
        formaPagoNombre: 'Descuento por nómina',
        estado: 'SOLICITADO',
        fechaSolicitud: '2026-09-07T18:00:00.000Z',
        fechaActualizacion: '2026-09-07T18:00:00.000Z',
        version: '00000000000007D3',
        transicionesPermitidas: ['EN_ESTUDIO', 'CANCELADO'],
        editable: true,
        eliminable: true,
      },
    ],
  });

export const paginacionSchema = z
  .strictObject({
    page: z.number().int(),
    pageSize: z.number().int(),
    totalItems: z.number().int(),
    totalPages: z.number().int(),
  })
  .meta({ id: 'Paginacion' });

export const resumenCreditosSchema = z
  .strictObject({
    totalCreditos: z.number().int(),
    valorTotalSolicitado: z.number(),
    porEstado: z.array(
      z.strictObject({
        estado: z.enum(ESTADOS_CREDITO),
        cantidad: z.number().int(),
        valorTotal: z.number(),
      }),
    ),
  })
  .meta({ id: 'ResumenCreditos', description: 'Datos del dashboard; incluye los 6 estados.' });

export const eventoHistorialSchema = z
  .strictObject({
    id: z.number().int(),
    tipoEvento: z.enum(['CREACION', 'ACTUALIZACION', 'CAMBIO_ESTADO', 'ELIMINACION']),
    estadoAnterior: z.enum(ESTADOS_CREDITO).nullable(),
    estadoNuevo: z.enum(ESTADOS_CREDITO),
    detalleCambios: z
      .record(z.string(), z.unknown())
      .nullable()
      .describe(
        'En ACTUALIZACION: { campo: { anterior, nuevo } }. En CREACION: condiciones iniciales.',
      ),
    observacion: z.string().nullable(),
    usuario: z.strictObject({ nombre: z.string(), email: z.string() }),
    fechaEvento: fechaIso,
  })
  .meta({ id: 'EventoHistorial' });

export const trazaNotificacionSchema = z
  .strictObject({
    id: z.number().int(),
    eventId: z.string().describe('Identificador estable del evento (idempotencia)'),
    tipoEvento: z.string(),
    urlDestino: z.string(),
    estado: z.enum(['PENDIENTE', 'ENVIANDO', 'ENVIADO', 'FALLIDO']),
    intentos: z.number().int(),
    maxIntentos: z.number().int(),
    proximoIntento: fechaIso.nullable(),
    ultimoCodigoHttp: z.number().int().nullable(),
    ultimoError: z.string().nullable(),
    fechaCreacion: fechaIso,
    fechaEnvio: fechaIso.nullable(),
    detalleIntentos: z.array(
      z.strictObject({
        numeroIntento: z.number().int(),
        fechaIntento: fechaIso,
        exitoso: z.boolean(),
        codigoHttp: z.number().int().nullable(),
        duracionMs: z.number().int().nullable(),
        error: z.string().nullable(),
      }),
    ),
  })
  .meta({ id: 'TrazaNotificacion', description: 'Estado del webhook y cada intento de envío' });

export const catalogosSchema = z
  .strictObject({
    tiposCredito: z.array(
      z.strictObject({
        codigo: z.string(),
        nombre: z.string(),
        descripcion: z.string().nullable(),
        valorMinimo: z.number(),
        valorMaximo: z.number(),
        cuotasMaximas: z.number().int(),
        tasaMaximaMensual: z.number(),
        activo: z.boolean(),
      }),
    ),
    formasPago: z.array(
      z.strictObject({
        codigo: z.string(),
        nombre: z.string(),
        descripcion: z.string().nullable(),
        activo: z.boolean(),
      }),
    ),
  })
  .meta({ id: 'Catalogos' });

export const errorRespuestaSchema = z
  .strictObject({
    success: z.literal(false),
    error: z.strictObject({
      code: z.string().describe('Código estable para programas (p. ej. CREDITO_NOT_FOUND)'),
      message: z.string().describe('Mensaje para personas'),
      details: z
        .array(z.strictObject({ field: z.string().optional(), message: z.string() }))
        .optional()
        .describe('Detalle por campo (validaciones)'),
      requestId: z.string().describe('Identificador para buscar la petición en los logs'),
    }),
  })
  .meta({ id: 'ErrorRespuesta' });

/** Sobre estándar de éxito: { success: true, data, meta? }. */
export function respuestaExitosa<TData extends z.ZodType>(data: TData, conPaginacion = false) {
  return z.strictObject({
    success: z.literal(true),
    data,
    ...(conPaginacion ? { meta: paginacionSchema } : {}),
  });
}
