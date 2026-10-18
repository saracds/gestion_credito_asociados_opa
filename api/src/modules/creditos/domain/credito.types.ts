import type { EstadoCredito } from './estadoCredito.js';

/**
 * Condiciones financieras del crédito: lo único editable (y solo antes de
 * la aprobación, ver ADR-009).
 */
export interface CondicionesCredito {
  tipoCredito: string;
  valorSolicitado: number;
  /** Tasa nominal MENSUAL en porcentaje: 1.5 = 1,5 % mensual (ADR-011). */
  tasaInteres: number;
  numeroCuotas: number;
  formaPago: string;
}

/** Datos para registrar una solicitud de crédito (cuerpo de POST /api/creditos). */
export interface SolicitudCredito extends CondicionesCredito {
  identificacionAsociado: string;
  nombreAsociado: string;
}

/**
 * Datos registrados del crédito. Los nombres de campo son los del enunciado
 * de la prueba (numeroCredito, identificacionAsociado, ...).
 */
export interface CreditoRegistro extends CondicionesCredito {
  id: number;
  numeroCredito: string;
  identificacionAsociado: string;
  nombreAsociado: string;
  tipoCreditoNombre: string;
  formaPagoNombre: string;
  estado: EstadoCredito;
  /** Fechas en ISO 8601 UTC, p. ej. "2026-09-07T18:00:00.000Z". */
  fechaSolicitud: string;
  fechaActualizacion: string;
  /** Versión para concurrencia optimista (ROWVERSION en hexadecimal). */
  version: string;
}

/**
 * Lo que el estado actual del crédito permite hacer. Lo calcula el dominio
 * para que el frontend no duplique la máquina de estados: solo muestra las
 * acciones que la API autoriza (los permisos por rol los aplica aparte).
 */
export interface AccionesCredito {
  transicionesPermitidas: EstadoCredito[];
  editable: boolean;
  eliminable: boolean;
}

/** Crédito tal como lo expone la API: datos registrados + acciones permitidas. */
export interface Credito extends CreditoRegistro, AccionesCredito {}

/** Registro más datos internos que el servicio necesita pero la API no expone. */
export interface CreditoConAsociado extends CreditoRegistro {
  asociadoId: number;
}

export type TipoEventoHistorial = 'CREACION' | 'ACTUALIZACION' | 'CAMBIO_ESTADO' | 'ELIMINACION';

/** Cambio de un campo: valor anterior y nuevo. */
export interface CambioDeCampo {
  anterior: unknown;
  nuevo: unknown;
}

export interface EventoHistorial {
  id: number;
  tipoEvento: TipoEventoHistorial;
  estadoAnterior: EstadoCredito | null;
  estadoNuevo: EstadoCredito;
  detalleCambios: Record<string, unknown> | null;
  observacion: string | null;
  usuario: { nombre: string; email: string };
  fechaEvento: string;
}

/** Criterios de consulta del listado (GET /api/creditos). */
export interface CriteriosBusquedaCreditos {
  page: number;
  pageSize: number;
  estado?: EstadoCredito | undefined;
  identificacionAsociado?: string | undefined;
  tipoCredito?: string | undefined;
  busqueda?: string | undefined;
  ordenarPor: CampoOrdenamiento;
  direccion: 'asc' | 'desc';
}

export const CAMPOS_ORDENAMIENTO = [
  'fechaSolicitud',
  'valorSolicitado',
  'numeroCredito',
  'estado',
  'nombreAsociado',
] as const;
export type CampoOrdenamiento = (typeof CAMPOS_ORDENAMIENTO)[number];

export interface PaginaCreditos {
  items: Credito[];
  totalItems: number;
}

export interface ResumenEstado {
  estado: EstadoCredito;
  cantidad: number;
  valorTotal: number;
}

/** Datos del dashboard: totales y distribución por estado. */
export interface ResumenCreditos {
  totalCreditos: number;
  valorTotalSolicitado: number;
  porEstado: ResumenEstado[];
}
