import { peticion } from './client';
import type {
  CambiosCredito,
  Catalogos,
  Credito,
  EstadoCredito,
  EventoHistorial,
  FiltrosCreditos,
  LoginRespuesta,
  Paginacion,
  ResumenCreditos,
  SolicitudCredito,
  TrazaNotificacion,
} from './types';

/**
 * Funciones por endpoint. Cada una corresponde a una operación del documento
 * OpenAPI; los componentes nunca construyen URLs por su cuenta.
 */

export async function iniciarSesion(email: string, password: string): Promise<LoginRespuesta> {
  return (
    await peticion<LoginRespuesta>('/api/auth/login', { method: 'POST', body: { email, password } })
  ).data;
}

export async function obtenerCatalogos(): Promise<Catalogos> {
  return (await peticion<Catalogos>('/api/catalogos')).data;
}

export async function obtenerResumen(): Promise<ResumenCreditos> {
  return (await peticion<ResumenCreditos>('/api/creditos/resumen')).data;
}

export async function listarCreditos(
  filtros: FiltrosCreditos,
): Promise<{ items: Credito[]; paginacion: Paginacion }> {
  const respuesta = await peticion<Credito[]>('/api/creditos', { query: { ...filtros } });
  return { items: respuesta.data, paginacion: respuesta.meta as unknown as Paginacion };
}

export async function obtenerCredito(id: number): Promise<Credito> {
  return (await peticion<Credito>(`/api/creditos/${id}`)).data;
}

export async function crearCredito(solicitud: SolicitudCredito): Promise<Credito> {
  return (await peticion<Credito>('/api/creditos', { method: 'POST', body: solicitud })).data;
}

/**
 * Actualización parcial con concurrencia optimista: envía la versión que el
 * usuario vio en If-Match. Si otro usuario modificó el crédito, la API
 * responde 412 y la interfaz pide recargar.
 */
export async function actualizarCredito(
  id: number,
  version: string,
  cambios: CambiosCredito,
): Promise<Credito> {
  return (
    await peticion<Credito>(`/api/creditos/${id}`, {
      method: 'PATCH',
      body: cambios,
      headers: { 'If-Match': `"${version}"` },
    })
  ).data;
}

export async function cambiarEstado(
  id: number,
  estado: EstadoCredito,
  observacion?: string,
): Promise<Credito> {
  return (
    await peticion<Credito>(`/api/creditos/${id}/estado`, {
      method: 'PATCH',
      body: { estado, ...(observacion && { observacion }) },
    })
  ).data;
}

export async function eliminarCredito(id: number): Promise<void> {
  await peticion<undefined>(`/api/creditos/${id}`, { method: 'DELETE' });
}

export async function obtenerHistorial(id: number): Promise<EventoHistorial[]> {
  return (await peticion<EventoHistorial[]>(`/api/creditos/${id}/historial`)).data;
}

export async function obtenerNotificaciones(id: number): Promise<TrazaNotificacion[]> {
  return (await peticion<TrazaNotificacion[]>(`/api/creditos/${id}/notificaciones`)).data;
}

export async function reprogramarNotificacion(notificacionId: number): Promise<void> {
  await peticion(`/api/webhooks/notificaciones/${notificacionId}/reprogramar`, { method: 'POST' });
}
