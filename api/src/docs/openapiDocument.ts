import { z } from 'zod';

import { loginSchema } from '../modules/auth/auth.router.js';
import {
  actualizarCreditoSchema,
  cambiarEstadoSchema,
  crearCreditoSchema,
} from '../modules/creditos/credito.schemas.js';
import { CAMPOS_ORDENAMIENTO } from '../modules/creditos/domain/credito.types.js';
import { ESTADOS_CREDITO } from '../modules/creditos/domain/estadoCredito.js';
import { WEBHOOK_HEADERS } from '../modules/webhooks/webhookSignature.js';
import { reprogramarNotificacionSchema } from '../modules/webhooks/webhooks.router.js';
import {
  catalogosSchema,
  creditoSchema,
  errorRespuestaSchema,
  eventoHistorialSchema,
  loginRespuestaSchema,
  paginacionSchema,
  resumenCreditosSchema,
  trazaNotificacionSchema,
  usuarioSchema,
} from './openapiSchemas.js';

/**
 * DOCUMENTO OPENAPI 3.1 de la API.
 *
 * Los esquemas se GENERAN desde Zod (no se escriben a mano):
 *   - Entradas: los mismos esquemas que validan las peticiones.
 *   - Salidas: los esquemas de openapiSchemas.ts, verificados por las pruebas
 *     de contrato contra las respuestas reales.
 * Así la documentación no puede quedar desactualizada respecto al código.
 *   - Se documentan los errores que puede devolver cada operación, con ejemplos.
 */

// ---------------------------------------------------------------------------
// Registro de los esquemas de entrada con nombre y ejemplos (solo documentación)
// ---------------------------------------------------------------------------
crearCreditoSchema.meta({
  id: 'SolicitudCredito',
  description: 'Cuerpo de creación. Los campos no listados se rechazan (400).',
  examples: [
    {
      identificacionAsociado: '1001234567',
      nombreAsociado: 'Juan Perez',
      tipoCredito: 'LIBRE_INVERSION',
      valorSolicitado: 15000000,
      tasaInteres: 1.5,
      numeroCuotas: 36,
      formaPago: 'NOMINA',
    },
  ],
});
actualizarCreditoSchema.meta({
  id: 'ActualizacionCredito',
  description:
    'Actualización PARCIAL: envíe solo los campos que cambian. Solo en SOLICITADO o EN_ESTUDIO.',
  examples: [{ valorSolicitado: 12000000, observacion: 'Ajuste por capacidad de pago' }],
});
cambiarEstadoSchema.meta({
  id: 'CambioEstado',
  description: 'RECHAZADO y CANCELADO exigen observación.',
  examples: [{ estado: 'EN_ESTUDIO', observacion: 'Se inicia el estudio del crédito' }],
});
loginSchema.meta({
  id: 'Login',
  examples: [{ email: 'analista@opa.local', password: 'Analista123*' }],
});
reprogramarNotificacionSchema.unwrap().meta({
  id: 'ReprogramacionNotificacion',
  examples: [{ intentosAdicionales: 3 }],
});

// Referencia al uso de los esquemas de salida para que queden registrados.
const ESQUEMAS_RESPUESTA = [
  usuarioSchema,
  loginRespuestaSchema,
  creditoSchema,
  paginacionSchema,
  resumenCreditosSchema,
  eventoHistorialSchema,
  trazaNotificacionSchema,
  catalogosSchema,
  errorRespuestaSchema,
];

/** Elimina metadatos de JSON Schema que no aportan en la documentación. */
function limpiarEsquema(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(limpiarEsquema);
  if (typeof valor !== 'object' || valor === null) return valor;

  const resultado: Record<string, unknown> = {};
  for (const [clave, contenido] of Object.entries(valor)) {
    if (clave === '$schema' || clave === '$id') continue;
    // El patrón de fecha ISO que genera Zod es extenso; "format: date-time" ya lo describe.
    if (clave === 'pattern' && (valor as Record<string, unknown>).format === 'date-time') continue;
    resultado[clave] = limpiarEsquema(contenido);
  }
  return resultado;
}

function generarComponentes(): Record<string, unknown> {
  void ESQUEMAS_RESPUESTA;
  const { schemas } = z.toJSONSchema(z.globalRegistry, {
    uri: (id) => `#/components/schemas/${id}`,
    io: 'input',
  });
  return limpiarEsquema(schemas) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Utilidades para escribir las operaciones de forma compacta
// ---------------------------------------------------------------------------
const ref = (nombre: string) => ({ $ref: `#/components/schemas/${nombre}` });

const exito = (data: object, opciones: { paginado?: boolean; descripcion?: string } = {}) => ({
  description: opciones.descripcion ?? 'Operación exitosa',
  content: {
    'application/json': {
      schema: {
        type: 'object',
        required: ['success', 'data'],
        properties: {
          success: { const: true },
          data,
          ...(opciones.paginado && { meta: ref('Paginacion') }),
        },
      },
    },
  },
});

const respuestaError = (nombre: string) => ({ $ref: `#/components/responses/${nombre}` });

const cuerpoJson = (esquema: string, requerido = true) => ({
  required: requerido,
  content: { 'application/json': { schema: ref(esquema) } },
});

const parametroId = (descripcion = 'Id del crédito') => ({
  name: 'id',
  in: 'path',
  required: true,
  description: descripcion,
  schema: { type: 'integer', minimum: 1 },
});

const cabeceraEtag = {
  ETag: {
    description: 'Versión del crédito entre comillas. Enviarla en If-Match para editar.',
    schema: { type: 'string', example: '"00000000000007D3"' },
  },
};

/** Ejemplo de error con el formato estándar. */
const ejemploError = (code: string, message: string, details?: object[]) => ({
  success: false,
  error: { code, message, ...(details && { details }), requestId: '5f2b8c1e-...' },
});

const RESPUESTAS_ERROR = {
  Validacion: [
    '400',
    'Datos mal formados o que no cumplen el esquema',
    ejemploError('VALIDATION_ERROR', 'La petición contiene datos inválidos.', [
      { field: 'valorSolicitado', message: 'Debe ser mayor que 0' },
    ]),
  ],
  NoAutenticado: [
    '401',
    'Token ausente, inválido o vencido',
    ejemploError(
      'TOKEN_REQUERIDO',
      'Debe enviar el token de acceso en la cabecera Authorization: Bearer <token>.',
    ),
  ],
  SinPermiso: [
    '403',
    'El rol del usuario no permite la operación',
    ejemploError('FORBIDDEN', 'Su rol (CONSULTA) no tiene permiso para esta operación.'),
  ],
  NoEncontrado: [
    '404',
    'El crédito no existe o fue eliminado',
    ejemploError('CREDITO_NOT_FOUND', 'El crédito 999 no existe.'),
  ],
  Conflicto: [
    '409',
    'Crédito activo duplicado o identificación registrada con otro nombre',
    ejemploError(
      'CREDITO_DUPLICADO',
      'El asociado ya tiene un crédito de tipo LIBRE_INVERSION en curso.',
    ),
  ],
  VersionDesactualizada: [
    '412',
    'Otro usuario modificó el crédito; recárguelo',
    ejemploError(
      'PRECONDITION_FAILED',
      'El crédito fue modificado por otro usuario después de que usted lo consultó.',
    ),
  ],
  ReglaNegocio: [
    '422',
    'Regla de negocio violada',
    ejemploError(
      'TRANSICION_ESTADO_INVALIDA',
      'No se permite cambiar el crédito de RECHAZADO a DESEMBOLSADO. RECHAZADO es un estado final y no admite cambios.',
    ),
  ],
  VersionRequerida: [
    '428',
    'Falta la cabecera If-Match',
    ejemploError(
      'PRECONDITION_REQUIRED',
      'Debe enviar la cabecera If-Match con la versión del crédito.',
    ),
  ],
  DemasiadasPeticiones: [
    '429',
    'Se superó el límite de peticiones',
    ejemploError(
      'TOO_MANY_REQUESTS',
      'Demasiados intentos de inicio de sesión. Intente nuevamente en 15 minutos.',
    ),
  ],
  NoDisponible: [
    '503',
    'La base de datos no está disponible',
    ejemploError('SERVICE_UNAVAILABLE', 'La API no está lista: la base de datos no responde.'),
  ],
} as const;

function generarRespuestasComunes() {
  return Object.fromEntries(
    Object.entries(RESPUESTAS_ERROR).map(([nombre, [, descripcion, ejemplo]]) => [
      nombre,
      {
        description: descripcion,
        content: { 'application/json': { schema: ref('ErrorRespuesta'), example: ejemplo } },
      },
    ]),
  );
}

/** Errores que puede devolver cualquier operación autenticada. */
const erroresAutenticados = {
  '401': respuestaError('NoAutenticado'),
  '429': respuestaError('DemasiadasPeticiones'),
};

// ---------------------------------------------------------------------------
// Descripción general (se muestra en la cabecera de Swagger UI)
// ---------------------------------------------------------------------------
const DESCRIPCION_GENERAL = `
API REST para administrar las solicitudes de crédito de los asociados de una entidad del sector solidario.

## Cómo probar desde esta página

1. Ejecute **POST /api/auth/login** (botón *Try it out*) con un usuario de demostración.
2. Copie el valor de \`accessToken\` de la respuesta.
3. Pulse **Authorize** (arriba a la derecha), pegue el token y confirme.

| Usuario | Contraseña | Rol | Puede |
|---|---|---|---|
| admin@opa.local | Admin123* | ADMIN | Todo, incluido eliminar y reprogramar webhooks |
| analista@opa.local | Analista123* | ANALISTA | Crear, editar y cambiar estado |
| consulta@opa.local | Consulta123* | CONSULTA | Solo lectura |

## Convenciones

- **Éxito:** \`{ "success": true, "data": ..., "meta": ... }\`. **Error:** \`{ "success": false, "error": { "code", "message", "details", "requestId" } }\`.
- **400** datos mal formados · **401** sin token · **403** rol sin permiso · **404** no existe · **409** conflicto · **412/428** versión · **422** regla de negocio · **429** límite.
- **Concurrencia optimista:** cada crédito trae su \`version\` (y la cabecera \`ETag\`). Para editarlo con PATCH envíe esa versión en \`If-Match\`.
- **Webhook:** al crear un crédito se notifica \`credito.creado\` al sistema externo. Vea la sección **Webhooks** al final de esta página.
- Fechas en UTC (ISO 8601). Valores monetarios con máximo 2 decimales.
`;

/** Construye el documento OpenAPI completo. */
export function construirDocumentoOpenApi(version: string): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: {
      title: 'API de Créditos — Prueba técnica OPA SAS',
      version,
      description: DESCRIPCION_GENERAL,
    },
    servers: [{ url: '/', description: 'Servidor actual' }],
    tags: [
      { name: 'Autenticación', description: 'Inicio de sesión con JWT' },
      { name: 'Créditos', description: 'Registro, consulta, edición y ciclo de vida' },
      { name: 'Catálogos', description: 'Tipos de crédito y formas de pago' },
      {
        name: 'Webhooks',
        description: 'Traza y reproceso de las notificaciones al sistema externo',
      },
      { name: 'Salud', description: 'Health checks para orquestadores' },
    ],
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Token obtenido en POST /api/auth/login',
        },
      },
      schemas: generarComponentes(),
      responses: generarRespuestasComunes(),
    },
    paths: {
      '/api/auth/login': {
        post: {
          tags: ['Autenticación'],
          summary: 'Iniciar sesión',
          description: 'Límite de 10 intentos por IP cada 15 minutos.',
          security: [],
          requestBody: cuerpoJson('Login'),
          responses: {
            '200': exito(ref('LoginRespuesta')),
            '400': respuestaError('Validacion'),
            '401': {
              description: 'Credenciales inválidas (mensaje genérico, sin revelar qué dato falló)',
              content: {
                'application/json': {
                  schema: ref('ErrorRespuesta'),
                  example: ejemploError(
                    'CREDENCIALES_INVALIDAS',
                    'Correo o contraseña incorrectos.',
                  ),
                },
              },
            },
            '429': respuestaError('DemasiadasPeticiones'),
          },
        },
      },
      '/api/auth/me': {
        get: {
          tags: ['Autenticación'],
          summary: 'Usuario del token actual',
          responses: { '200': exito(ref('Usuario')), ...erroresAutenticados },
        },
      },
      '/api/catalogos': {
        get: {
          tags: ['Catálogos'],
          summary: 'Tipos de crédito (con su política) y formas de pago activos',
          responses: { '200': exito(ref('Catalogos')), ...erroresAutenticados },
        },
      },
      '/api/creditos': {
        get: {
          tags: ['Créditos'],
          summary: 'Listar créditos (paginación, filtros, búsqueda y orden)',
          parameters: [
            { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
            {
              name: 'pageSize',
              in: 'query',
              schema: { type: 'integer', minimum: 1, maximum: 100, default: 10 },
            },
            { name: 'estado', in: 'query', schema: { type: 'string', enum: [...ESTADOS_CREDITO] } },
            {
              name: 'identificacionAsociado',
              in: 'query',
              schema: { type: 'string' },
              description: 'Coincidencia exacta',
            },
            {
              name: 'tipoCredito',
              in: 'query',
              schema: { type: 'string' },
              example: 'LIBRE_INVERSION',
            },
            {
              name: 'busqueda',
              in: 'query',
              schema: { type: 'string', maxLength: 100 },
              description:
                'Número de crédito o identificación (por prefijo) y nombre (contenido, sin distinguir tildes)',
            },
            {
              name: 'ordenarPor',
              in: 'query',
              schema: { type: 'string', enum: [...CAMPOS_ORDENAMIENTO], default: 'fechaSolicitud' },
            },
            {
              name: 'direccion',
              in: 'query',
              schema: { type: 'string', enum: ['asc', 'desc'], default: 'desc' },
            },
          ],
          responses: {
            '200': exito({ type: 'array', items: ref('Credito') }, { paginado: true }),
            '400': respuestaError('Validacion'),
            ...erroresAutenticados,
          },
        },
        post: {
          tags: ['Créditos'],
          summary: 'Crear crédito',
          description:
            'Crea el crédito en estado SOLICITADO, registra el historial y deja el evento `credito.creado` en el outbox, todo en una sola transacción. El webhook lo envía después el worker. Roles: ADMIN, ANALISTA.',
          requestBody: cuerpoJson('SolicitudCredito'),
          responses: {
            '201': {
              ...exito(ref('Credito'), { descripcion: 'Crédito creado' }),
              headers: {
                ...cabeceraEtag,
                Location: {
                  description: 'URL del crédito creado',
                  schema: { type: 'string', example: '/api/creditos/123' },
                },
              },
            },
            '400': respuestaError('Validacion'),
            '403': respuestaError('SinPermiso'),
            '409': respuestaError('Conflicto'),
            '422': respuestaError('ReglaNegocio'),
            ...erroresAutenticados,
          },
        },
      },
      '/api/creditos/resumen': {
        get: {
          tags: ['Créditos'],
          summary: 'Resumen para el dashboard (total y cantidad por estado)',
          responses: { '200': exito(ref('ResumenCreditos')), ...erroresAutenticados },
        },
      },
      '/api/creditos/{id}': {
        get: {
          tags: ['Créditos'],
          summary: 'Consultar un crédito',
          parameters: [parametroId()],
          responses: {
            '200': { ...exito(ref('Credito')), headers: cabeceraEtag },
            '400': respuestaError('Validacion'),
            '404': respuestaError('NoEncontrado'),
            ...erroresAutenticados,
          },
        },
        patch: {
          tags: ['Créditos'],
          summary: 'Actualizar condiciones (parcial, con control de concurrencia)',
          description:
            'Solo en SOLICITADO o EN_ESTUDIO. Exige `If-Match` con la versión del crédito (campo `version` de la consulta). Enviar un campo inmutable responde 422 CAMPO_INMUTABLE. Roles: ADMIN, ANALISTA.',
          parameters: [
            parametroId(),
            {
              name: 'If-Match',
              in: 'header',
              required: true,
              description: 'Versión vigente del crédito, p. ej. "00000000000007D3"',
              schema: { type: 'string' },
            },
          ],
          requestBody: cuerpoJson('ActualizacionCredito'),
          responses: {
            '200': { ...exito(ref('Credito')), headers: cabeceraEtag },
            '400': respuestaError('Validacion'),
            '403': respuestaError('SinPermiso'),
            '404': respuestaError('NoEncontrado'),
            '409': respuestaError('Conflicto'),
            '412': respuestaError('VersionDesactualizada'),
            '422': respuestaError('ReglaNegocio'),
            '428': respuestaError('VersionRequerida'),
            ...erroresAutenticados,
          },
        },
        delete: {
          tags: ['Créditos'],
          summary: 'Eliminar crédito (borrado lógico)',
          description:
            'Solo créditos en SOLICITADO. El registro se conserva en la base de datos con traza en el historial. Rol: ADMIN.',
          parameters: [parametroId()],
          responses: {
            '204': { description: 'Crédito eliminado' },
            '403': respuestaError('SinPermiso'),
            '404': respuestaError('NoEncontrado'),
            '422': respuestaError('ReglaNegocio'),
            ...erroresAutenticados,
          },
        },
      },
      '/api/creditos/{id}/estado': {
        patch: {
          tags: ['Créditos'],
          summary: 'Cambiar el estado del crédito',
          description:
            'Transiciones permitidas: SOLICITADO → EN_ESTUDIO | CANCELADO; EN_ESTUDIO → APROBADO | RECHAZADO | CANCELADO; APROBADO → DESEMBOLSADO | CANCELADO. RECHAZADO, DESEMBOLSADO y CANCELADO son finales. Roles: ADMIN, ANALISTA.',
          parameters: [parametroId()],
          requestBody: cuerpoJson('CambioEstado'),
          responses: {
            '200': { ...exito(ref('Credito')), headers: cabeceraEtag },
            '400': respuestaError('Validacion'),
            '403': respuestaError('SinPermiso'),
            '404': respuestaError('NoEncontrado'),
            '422': respuestaError('ReglaNegocio'),
            ...erroresAutenticados,
          },
        },
      },
      '/api/creditos/{id}/historial': {
        get: {
          tags: ['Créditos'],
          summary: 'Historial de cambios del crédito (auditoría)',
          parameters: [parametroId()],
          responses: {
            '200': exito({ type: 'array', items: ref('EventoHistorial') }),
            '404': respuestaError('NoEncontrado'),
            ...erroresAutenticados,
          },
        },
      },
      '/api/creditos/{id}/notificaciones': {
        get: {
          tags: ['Webhooks'],
          summary: 'Traza del webhook del crédito (estado y cada intento)',
          parameters: [parametroId()],
          responses: {
            '200': exito({ type: 'array', items: ref('TrazaNotificacion') }),
            '404': respuestaError('NoEncontrado'),
            ...erroresAutenticados,
          },
        },
      },
      '/api/webhooks/notificaciones/{id}/reprogramar': {
        post: {
          tags: ['Webhooks'],
          summary: 'Reprogramar una notificación FALLIDA (reproceso manual)',
          description:
            'Concede intentos adicionales (3 por defecto) conservando la traza anterior. Rol: ADMIN.',
          parameters: [parametroId('Id de la notificación (campo id de la traza)')],
          requestBody: cuerpoJson('ReprogramacionNotificacion', false),
          responses: {
            '200': exito({
              type: 'object',
              properties: {
                id: { type: 'integer' },
                estado: { const: 'PENDIENTE' },
                intentosAdicionales: { type: 'integer' },
              },
            }),
            '403': respuestaError('SinPermiso'),
            '422': respuestaError('ReglaNegocio'),
            ...erroresAutenticados,
          },
        },
      },
      '/health/live': {
        get: {
          tags: ['Salud'],
          summary: 'Liveness: el proceso está vivo',
          security: [],
          responses: { '200': { description: 'Proceso activo' } },
        },
      },
      '/health/ready': {
        get: {
          tags: ['Salud'],
          summary: 'Readiness: puede atender tráfico (verifica la base de datos)',
          security: [],
          responses: {
            '200': { description: 'Listo para recibir tráfico' },
            '503': respuestaError('NoDisponible'),
          },
        },
      },
    },
    webhooks: {
      'credito.creado': {
        post: {
          summary: 'Notificación de crédito creado (la envía esta API al sistema externo)',
          description: `Se envía cuando un crédito se crea con éxito.

**Seguridad:** cuerpo firmado con HMAC-SHA256 sobre \`"<${WEBHOOK_HEADERS.TIMESTAMP}>.<cuerpo exacto>"\` usando un secreto compartido. El receptor debe recalcular la firma, compararla en tiempo constante y rechazar timestamps con más de 5 minutos de antigüedad.

**Entrega:** al menos una vez. Use \`eventId\` para descartar duplicados.

**Respuesta esperada:**
- **2xx:** entregado.
- **5xx, 408, 429 o sin respuesta en 10 s:** se reintenta a los 10 s, 20 s, 40 s..., hasta 6 intentos.
- **Otro 4xx:** fallo permanente, sin reintentos.`,
          parameters: [
            {
              name: WEBHOOK_HEADERS.EVENT_ID,
              in: 'header',
              required: true,
              schema: { type: 'string', format: 'uuid' },
            },
            {
              name: WEBHOOK_HEADERS.EVENT_TYPE,
              in: 'header',
              required: true,
              schema: { const: 'credito.creado' },
            },
            {
              name: WEBHOOK_HEADERS.TIMESTAMP,
              in: 'header',
              required: true,
              description: 'Segundos desde epoch (UTC)',
              schema: { type: 'string' },
            },
            {
              name: WEBHOOK_HEADERS.SIGNATURE,
              in: 'header',
              required: true,
              schema: { type: 'string', example: 'sha256=5d41402abc4b2a76b9719d911017c592...' },
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['event', 'eventId', 'timestamp', 'data'],
                  properties: {
                    event: { const: 'credito.creado' },
                    eventId: { type: 'string', format: 'uuid' },
                    timestamp: { type: 'string', format: 'date-time' },
                    data: {
                      type: 'object',
                      properties: {
                        id: { type: 'integer' },
                        numeroCredito: { type: 'string' },
                        identificacionAsociado: { type: 'string' },
                        valorSolicitado: { type: 'number' },
                        estado: { const: 'SOLICITADO' },
                      },
                    },
                  },
                },
                example: {
                  event: 'credito.creado',
                  eventId: '8f7d2c1e-4b5a-4c3d-9e8f-1a2b3c4d5e6f',
                  timestamp: '2026-09-07T18:00:00.000Z',
                  data: {
                    id: 123,
                    numeroCredito: 'CR-2026-000123',
                    identificacionAsociado: '1001234567',
                    valorSolicitado: 15000000,
                    estado: 'SOLICITADO',
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: 'Recibido (también para duplicados ya procesados)' },
            '401': { description: 'Firma inválida: el emisor NO reintenta' },
            '503': { description: 'No disponible: el emisor reintenta con backoff' },
          },
        },
      },
    },
  };
}
