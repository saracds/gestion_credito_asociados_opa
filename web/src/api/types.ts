/**
 * Tipos del contrato de la API. Mantener el mismo vocabulario 
 * que el backend evita traducciones y confusiones.
 */

export const ESTADOS_CREDITO = [
  'SOLICITADO',
  'EN_ESTUDIO',
  'APROBADO',
  'RECHAZADO',
  'DESEMBOLSADO',
  'CANCELADO',
] as const;
export type EstadoCredito = (typeof ESTADOS_CREDITO)[number];

export type Rol = 'ADMIN' | 'ANALISTA' | 'CONSULTA';

export interface Usuario {
  id: number;
  email: string;
  nombre: string;
  rol: Rol;
}

export interface LoginRespuesta {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  usuario: Usuario;
}

export interface Credito {
  id: number;
  numeroCredito: string;
  identificacionAsociado: string;
  nombreAsociado: string;
  tipoCredito: string;
  tipoCreditoNombre: string;
  valorSolicitado: number;
  tasaInteres: number;
  numeroCuotas: number;
  formaPago: string;
  formaPagoNombre: string;
  estado: EstadoCredito;
  fechaSolicitud: string;
  fechaActualizacion: string;
  version: string;
  /** Calculados por el dominio del backend: el frontend no duplica la máquina de estados. */
  transicionesPermitidas: EstadoCredito[];
  editable: boolean;
  eliminable: boolean;
}

export interface SolicitudCredito {
  identificacionAsociado: string;
  nombreAsociado: string;
  tipoCredito: string;
  valorSolicitado: number;
  tasaInteres: number;
  numeroCuotas: number;
  formaPago: string;
}

export type CambiosCredito = Partial<
  Pick<
    SolicitudCredito,
    'tipoCredito' | 'valorSolicitado' | 'tasaInteres' | 'numeroCuotas' | 'formaPago'
  >
> & { observacion?: string };

export interface Paginacion {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export const CAMPOS_ORDENAMIENTO = [
  'fechaSolicitud',
  'valorSolicitado',
  'numeroCredito',
  'estado',
  'nombreAsociado',
] as const;
export type CampoOrdenamiento = (typeof CAMPOS_ORDENAMIENTO)[number];

export interface FiltrosCreditos {
  page: number;
  pageSize: number;
  estado?: EstadoCredito | undefined;
  tipoCredito?: string | undefined;
  busqueda?: string | undefined;
  ordenarPor: CampoOrdenamiento;
  direccion: 'asc' | 'desc';
}

export interface ResumenCreditos {
  totalCreditos: number;
  valorTotalSolicitado: number;
  porEstado: { estado: EstadoCredito; cantidad: number; valorTotal: number }[];
}

export interface EventoHistorial {
  id: number;
  tipoEvento: 'CREACION' | 'ACTUALIZACION' | 'CAMBIO_ESTADO' | 'ELIMINACION';
  estadoAnterior: EstadoCredito | null;
  estadoNuevo: EstadoCredito;
  detalleCambios: Record<string, unknown> | null;
  observacion: string | null;
  usuario: { nombre: string; email: string };
  fechaEvento: string;
}

export interface TrazaNotificacion {
  id: number;
  eventId: string;
  tipoEvento: string;
  urlDestino: string;
  estado: 'PENDIENTE' | 'ENVIANDO' | 'ENVIADO' | 'FALLIDO';
  intentos: number;
  maxIntentos: number;
  proximoIntento: string | null;
  ultimoCodigoHttp: number | null;
  ultimoError: string | null;
  fechaCreacion: string;
  fechaEnvio: string | null;
  detalleIntentos: {
    numeroIntento: number;
    fechaIntento: string;
    exitoso: boolean;
    codigoHttp: number | null;
    duracionMs: number | null;
    error: string | null;
  }[];
}

export interface TipoCreditoCatalogo {
  codigo: string;
  nombre: string;
  descripcion: string | null;
  valorMinimo: number;
  valorMaximo: number;
  cuotasMaximas: number;
  tasaMaximaMensual: number;
  activo: boolean;
}

export interface Catalogos {
  tiposCredito: TipoCreditoCatalogo[];
  formasPago: { codigo: string; nombre: string; descripcion: string | null; activo: boolean }[];
}
