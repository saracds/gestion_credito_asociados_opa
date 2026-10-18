import type { UsuarioAutenticado } from '../../src/modules/auth/auth.types.js';
import type { SolicitudCredito } from '../../src/modules/creditos/domain/credito.types.js';

/** Solicitud válida: el ejemplo literal del enunciado de la prueba técnica. */
export function solicitudValida(cambios: Partial<SolicitudCredito> = {}): SolicitudCredito {
  return {
    identificacionAsociado: '1001234567',
    nombreAsociado: 'Juan Perez',
    tipoCredito: 'LIBRE_INVERSION',
    valorSolicitado: 15_000_000,
    tasaInteres: 1.5,
    numeroCuotas: 36,
    formaPago: 'NOMINA',
    ...cambios,
  };
}

export const ANALISTA: UsuarioAutenticado = {
  id: 2,
  email: 'analista@opa.local',
  nombre: 'Analista de Crédito',
  rol: 'ANALISTA',
};

export const ADMIN: UsuarioAutenticado = {
  id: 1,
  email: 'admin@opa.local',
  nombre: 'Administradora',
  rol: 'ADMIN',
};

export const CONSULTA: UsuarioAutenticado = {
  id: 3,
  email: 'consulta@opa.local',
  nombre: 'Usuario de Consulta',
  rol: 'CONSULTA',
};

export const URL_WEBHOOK_PRUEBA = 'https://sistema-externo.test/webhooks/creditos';
export const JWT_SECRET_PRUEBA = 'secreto-de-pruebas-con-mas-de-32-caracteres';
