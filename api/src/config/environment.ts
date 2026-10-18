import { z } from 'zod';

/**
 * Configuración a partir de variables de entorno.
 *
 * Principio "fallar rápido": si falta una variable obligatoria o tiene un
 * formato inválido, el proceso NO arranca y muestra exactamente qué está mal.
 * Es preferible a descubrir el error en producción con la primera petición.
 *
 * Hay dos procesos con configuraciones distintas que comparten una parte:
 *   - API (server.ts):              común + HTTP + JWT + destino del webhook.
 *   - Worker de webhooks (worker.ts): común + parámetros de envío y reintentos.
 * Cada proceso exige SOLO lo que usa (el worker no necesita el secreto JWT).
 */

/** Convierte "true"/"false" en booleano. Rechaza cualquier otro valor. */
const booleanFromText = z.enum(['true', 'false']).transform((value) => value === 'true');

/** Convierte "a, b, c" en ["a", "b", "c"] descartando elementos vacíos. */
const listFromCommaSeparatedText = z.string().transform((value) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0),
);

/** Secretos HMAC: mínimo 32 caracteres (RFC 7518, sección 3.2). */
const hmacSecret = z.string().min(32, 'Debe tener al menos 32 caracteres');

/** Variables comunes a la API y al worker: entorno, logs y base de datos. */
const commonSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().min(1).max(65535).default(1433),
  DB_NAME: z.string().min(1).default('CreditosOPA'),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().min(1),
  /** Cifrado TLS de la conexión con SQL Server. Debe ser true en producción. */
  DB_ENCRYPT: booleanFromText.default(true),
  /** Acepta certificados autofirmados. Solo para desarrollo con Docker. */
  DB_TRUST_SERVER_CERTIFICATE: booleanFromText.default(false),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
});

/**
 * En producción la aplicación se niega a conectarse como administrador.
 * Debe usar su login de mínimo privilegio (app_creditos_api / app_creditos_worker,
 * creados por database/seguridad/usuarios_aplicacion.sql). Así un .env mal
 * copiado falla al arrancar, y no queda funcionando en silencio con todos los
 * permisos del servidor.
 */
const USUARIOS_ADMINISTRADORES = new Set(['sa']);

function rechazarAdministradorEnProduccion(
  variables: { NODE_ENV: string; DB_USER: string },
  contexto: z.RefinementCtx,
): void {
  if (
    variables.NODE_ENV === 'production' &&
    USUARIOS_ADMINISTRADORES.has(variables.DB_USER.toLowerCase())
  ) {
    contexto.addIssue({
      code: 'custom',
      path: ['DB_USER'],
      message:
        'En producción no se permite conectarse como administrador; use el login de la aplicación',
    });
  }
}

const apiEnvironmentSchema = commonSchema
  .extend({
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),

    /** Orígenes (frontends) autorizados a consumir la API desde el navegador. */
    CORS_ALLOWED_ORIGINS: listFromCommaSeparatedText.default(['http://localhost:5173']),

    /**
     * Secreto para firmar los JWT (HMAC-SHA256).
     * En producción debe venir de un gestor de secretos, nunca del repositorio.
     */
    JWT_SECRET: hmacSecret,
    JWT_EXPIRES_IN_MINUTES: z.coerce.number().int().min(5).max(1440).default(60),
    JWT_ISSUER: z.string().min(1).default('creditos-opa-api'),
    JWT_AUDIENCE: z.string().min(1).default('creditos-opa-web'),

    /**
     * Destino del webhook. La API lo guarda en cada evento al crear el crédito,
     * de modo que un cambio de URL no altera los eventos ya registrados.
     */
    WEBHOOK_URL: z.url().default('https://sistema-externo.com/webhooks/creditos'),

    /**
     * Publica Swagger UI en /api/docs. Activa por defecto para la evaluación; en un
     * ambiente productivo real conviene desactivarla o exponerla solo internamente.
     */
    API_DOCS_ENABLED: booleanFromText.default(true),

    /**
     * Cantidad de proxies inversos de confianza delante de la API (Nginx del
     * frontend = 1). Con 0 se usa la IP de la conexión; con 1, la que el proxy
     * informa en X-Forwarded-For. Sin esto, detrás de Nginx todos los usuarios
     * comparten la IP del proxy y el límite de intentos de login sería común a
     * todos (un atacante bloquearía a cualquiera). No debe ser mayor que los
     * proxies reales: permitiría falsificar la IP enviando esa cabecera.
     */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  })
  .superRefine(rechazarAdministradorEnProduccion);

const workerEnvironmentSchema = commonSchema
  .extend({
    /** Secreto compartido con el sistema externo para firmar cada notificación. */
    WEBHOOK_SECRET: hmacSecret,
    /** Cada cuánto busca eventos pendientes. */
    WEBHOOK_POLL_INTERVAL_MS: z.coerce.number().int().min(200).max(60_000).default(2_000),
    /** Eventos que toma en cada ciclo. */
    WEBHOOK_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(10),
    /** Tiempo máximo de espera de la respuesta del sistema externo. */
    WEBHOOK_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(500).max(60_000).default(10_000),
    /** Espera antes del primer reintento; se duplica en cada intento (backoff exponencial). */
    WEBHOOK_RETRY_BASE_SECONDS: z.coerce.number().int().min(1).max(3_600).default(10),
    /** Tope de la espera entre reintentos. */
    WEBHOOK_RETRY_MAX_SECONDS: z.coerce.number().int().min(1).max(86_400).default(3_600),
    /** Archivo que el worker actualiza en cada ciclo; el healthcheck verifica que sea reciente. */
    WORKER_HEARTBEAT_FILE: z.string().min(1).default('/tmp/webhook-worker.heartbeat'),
  })
  .superRefine(rechazarAdministradorEnProduccion);

export type CommonEnvironment = z.infer<typeof commonSchema>;
export type Environment = z.infer<typeof apiEnvironmentSchema>;
export type WorkerEnvironment = z.infer<typeof workerEnvironmentSchema>;

function parseEnvironment<TSchema extends z.ZodType>(
  schema: TSchema,
  source: NodeJS.ProcessEnv,
): z.output<TSchema> {
  const result = schema.safeParse(source);

  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Configuración inválida. Revise las variables de entorno:\n${problems}`);
  }

  return result.data;
}

/**
 * Configuración de la API.
 * @param source Por defecto `process.env`; las pruebas envían un objeto propio.
 * @throws Error con el detalle de cada variable inválida.
 */
export function loadEnvironment(source: NodeJS.ProcessEnv = process.env): Environment {
  return parseEnvironment(apiEnvironmentSchema, source);
}

/** Configuración del worker de webhooks. */
export function loadWorkerEnvironment(source: NodeJS.ProcessEnv = process.env): WorkerEnvironment {
  return parseEnvironment(workerEnvironmentSchema, source);
}
