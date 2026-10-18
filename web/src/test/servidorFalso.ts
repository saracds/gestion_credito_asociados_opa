import { vi } from 'vitest';

/**
 * Permite probar la  interfaz contra el contrato real ({ success, data } / { success:false, error })
 * sin levantar el backend.
 */
export interface RespuestaFalsa {
  status?: number;
  body: unknown;
}

export type RutasFalsas = Record<string, RespuestaFalsa | ((init: RequestInit) => RespuestaFalsa)>;

export function instalarServidorFalso(rutas: RutasFalsas) {
  const fetchFalso = vi.fn(async (entrada: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(entrada), 'http://localhost');
    const clave = `${init.method ?? 'GET'} ${url.pathname}`;
    const definicion = rutas[clave];
    if (!definicion) throw new Error(`Ruta no simulada en la prueba: ${clave}`);
    const { status = 200, body } = typeof definicion === 'function' ? definicion(init) : definicion;
    return new Response(status === 204 ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchFalso);
  return fetchFalso;
}

export const ok = (data: unknown, meta?: unknown): RespuestaFalsa => ({
  body: { success: true, data, ...(meta !== undefined && { meta }) },
});

export const fallo = (
  status: number,
  code: string,
  message: string,
  details: { field?: string; message: string }[] = [],
): RespuestaFalsa => ({
  status,
  body: { success: false, error: { code, message, details, requestId: 'req-prueba' } },
});
