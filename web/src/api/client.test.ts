import { afterEach, describe, expect, it, vi } from 'vitest';

import { fallo, instalarServidorFalso, ok } from '@/test/servidorFalso';

import { ApiError, configurarSesion, peticion } from './client';

describe('cliente HTTP', () => {
  afterEach(() => {
    configurarSesion(null, null);
    vi.unstubAllGlobals();
  });

  it('desempaqueta { success, data, meta } y envía el token en memoria', async () => {
    const fetchFalso = instalarServidorFalso({ 'GET /api/creditos': ok([{ id: 1 }], { page: 1 }) });
    configurarSesion('token-de-prueba', null);

    const respuesta = await peticion<{ id: number }[]>('/api/creditos', {
      query: { page: 1, busqueda: '' },
    });

    expect(respuesta.data).toEqual([{ id: 1 }]);
    expect(respuesta.meta).toEqual({ page: 1 });
    const [url, init] = fetchFalso.mock.calls[0]!;
    // Los filtros vacíos no viajan en la URL.
    expect(url).toBe('/api/creditos?page=1');
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer token-de-prueba');
  });

  it('convierte el error estándar de la API en ApiError con detalle por campo', async () => {
    instalarServidorFalso({
      'POST /api/creditos': fallo(422, 'VALIDACION', 'Datos inválidos', [
        { field: 'valorSolicitado', message: 'Debe ser mayor que 0' },
      ]),
    });

    const error = await peticion('/api/creditos', { method: 'POST', body: {} }).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 422,
      code: 'VALIDACION',
      requestId: 'req-prueba',
      details: [{ field: 'valorSolicitado', message: 'Debe ser mayor que 0' }],
    });
  });

  it('cierra la sesión cuando la API responde 401 con un token vencido', async () => {
    instalarServidorFalso({ 'GET /api/creditos': fallo(401, 'NO_AUTENTICADO', 'Token vencido') });
    const alExpirar = vi.fn();
    configurarSesion('token-vencido', alExpirar);

    await expect(peticion('/api/creditos')).rejects.toBeInstanceOf(ApiError);
    expect(alExpirar).toHaveBeenCalledOnce();
  });

  it('no cierra sesión por un 401 del propio login (son credenciales incorrectas)', async () => {
    instalarServidorFalso({
      'POST /api/auth/login': fallo(401, 'CREDENCIALES_INVALIDAS', 'Correo o clave incorrectos'),
    });
    const alExpirar = vi.fn();
    configurarSesion('token-anterior', alExpirar);

    await expect(peticion('/api/auth/login', { method: 'POST', body: {} })).rejects.toThrow(
      'Correo o clave incorrectos',
    );
    expect(alExpirar).not.toHaveBeenCalled();
  });

  it('traduce una falla de red en un mensaje comprensible', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(peticion('/api/creditos')).rejects.toMatchObject({
      status: 0,
      code: 'SIN_CONEXION',
    });
  });

  it('responde sin datos ante un 204', async () => {
    instalarServidorFalso({ 'DELETE /api/creditos/1': { status: 204, body: null } });

    await expect(peticion('/api/creditos/1', { method: 'DELETE' })).resolves.toMatchObject({
      data: undefined,
    });
  });
});
