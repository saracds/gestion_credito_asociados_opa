/**
 * Cliente HTTP de la API.
 *
 * Responsabilidades:
 *  - Adjuntar el token (guardado SOLO en memoria, ver auth/AuthContext.tsx).
 *  - Desempaquetar el contrato estándar { success, data, meta }.
 *  - Convertir cualquier error en un ApiError con código, mensaje, detalle por
 *    campo y requestId, para que la interfaz muestre mensajes claros.
 *  - Avisar cuando la sesión deja de ser válida (401) para cerrar sesión.
 *
 * Las URL son relativas (/api/...): el frontend y la API se publican en el
 * mismo origen. Así no se depende de CORS.
 */

export interface DetalleError {
  field?: string;
  message: string;
}

/** Error de la API con la información necesaria para mostrarlo bien. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: DetalleError[] = [],
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RespuestaExitosa<TData> {
  success: true;
  data: TData;
  meta?: Record<string, unknown>;
}

interface RespuestaError {
  success: false;
  error: { code: string; message: string; details?: DetalleError[]; requestId?: string };
}

/** Resultado completo cuando además de los datos se necesitan meta o cabeceras. */
export interface RespuestaApi<TData> {
  data: TData;
  meta?: Record<string, unknown>;
  headers: Headers;
}

// ----- Estado de sesión compartido con el AuthContext -------------------------
let tokenActual: string | null = null;
let alExpirarSesion: (() => void) | null = null;

export function configurarSesion(token: string | null, onExpira: (() => void) | null): void {
  tokenActual = token;
  alExpirarSesion = onExpira;
}

// ----- Petición -----------------------------------------------------------------
export interface OpcionesPeticion {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  query?: Record<string, string | number | undefined>;
  signal?: AbortSignal;
}

function construirUrl(ruta: string, query?: OpcionesPeticion['query']): string {
  const parametros = new URLSearchParams();
  for (const [clave, valor] of Object.entries(query ?? {})) {
    if (valor !== undefined && valor !== '') parametros.set(clave, String(valor));
  }
  const cadena = parametros.toString();
  return cadena ? `${ruta}?${cadena}` : ruta;
}

export async function peticion<TData>(
  ruta: string,
  opciones: OpcionesPeticion = {},
): Promise<RespuestaApi<TData>> {
  const headers: Record<string, string> = { Accept: 'application/json', ...opciones.headers };
  if (opciones.body !== undefined) headers['Content-Type'] = 'application/json';
  if (tokenActual) headers.Authorization = `Bearer ${tokenActual}`;

  let respuesta: Response;
  try {
    respuesta = await fetch(construirUrl(ruta, opciones.query), {
      method: opciones.method ?? 'GET',
      headers,
      body: opciones.body === undefined ? undefined : JSON.stringify(opciones.body),
      signal: opciones.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(
      0,
      'SIN_CONEXION',
      'No hay conexión con el servidor. Verifique su red e intente de nuevo.',
    );
  }

  if (respuesta.status === 204) {
    return { data: undefined as TData, headers: respuesta.headers };
  }

  const cuerpo = (await respuesta.json().catch(() => null)) as
    RespuestaExitosa<TData> | RespuestaError | null;

  if (!respuesta.ok || !cuerpo || cuerpo.success === false) {
    const error =
      cuerpo && cuerpo.success === false
        ? new ApiError(
            respuesta.status,
            cuerpo.error.code,
            cuerpo.error.message,
            cuerpo.error.details,
            cuerpo.error.requestId,
          )
        : new ApiError(
            respuesta.status,
            'RESPUESTA_INVALIDA',
            'El servidor respondió de forma inesperada.',
          );

    // Token vencido o inválido: se cierra la sesión (excepto en el propio login).
    if (respuesta.status === 401 && tokenActual && !ruta.endsWith('/auth/login')) {
      alExpirarSesion?.();
    }
    throw error;
  }

  return {
    data: cuerpo.data,
    ...(cuerpo.meta && { meta: cuerpo.meta }),
    headers: respuesta.headers,
  };
}
