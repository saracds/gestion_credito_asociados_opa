import type { DatabaseTransaction } from '../../../infrastructure/database/DatabaseClient.js';
import type {
  CondicionesCredito,
  CreditoConAsociado,
  CriteriosBusquedaCreditos,
  EventoHistorial,
  ResumenEstado,
  TipoEventoHistorial,
} from '../domain/credito.types.js';
import type { EstadoCredito } from '../domain/estadoCredito.js';

/**
 * CONTRATOS de acceso a datos del módulo de créditos.
 *
 * El servicio depende de estas interfaces, no de SQL Server (principio de
 * inversión de dependencias). Beneficios:
 *   - Las reglas de negocio se prueban con implementaciones en memoria, en
 *     milisegundos y sin base de datos.
 *   - Cambiar el motor o la forma de consultar no toca las reglas de negocio.
 *
 * Los métodos de escritura reciben la transacción de forma explícita: el
 * servicio decide qué operaciones forman una unidad atómica.
 */

export interface OpcionesLectura {
  transaction?: DatabaseTransaction;
  /**
   * Bloquea la fila hasta que termine la transacción (UPDLOCK). Se usa antes
   * de modificar un crédito: dos cambios simultáneos sobre el mismo crédito se
   * ejecutan uno después del otro, y el segundo ve el estado ya actualizado.
   */
  bloquearParaActualizar?: boolean;
}

export interface NuevoCredito {
  asociadoId: number;
  condiciones: CondicionesCredito;
  usuarioId: number;
}

export interface CreditoRepository {
  buscarPorId(id: number, opciones?: OpcionesLectura): Promise<CreditoConAsociado | null>;
  /** Devuelve los créditos con datos internos; el servicio decide qué expone. */
  buscar(
    criterios: CriteriosBusquedaCreditos,
  ): Promise<{ items: CreditoConAsociado[]; totalItems: number }>;
  obtenerResumenPorEstado(): Promise<ResumenEstado[]>;
  existeCreditoActivo(
    transaction: DatabaseTransaction,
    asociadoId: number,
    tipoCredito: string,
    excluirCreditoId?: number,
  ): Promise<boolean>;
  insertar(transaction: DatabaseTransaction, nuevoCredito: NuevoCredito): Promise<number>;
  actualizarCondiciones(
    transaction: DatabaseTransaction,
    creditoId: number,
    cambios: Partial<CondicionesCredito>,
    usuarioId: number,
  ): Promise<void>;
  actualizarEstado(
    transaction: DatabaseTransaction,
    creditoId: number,
    estadoNuevo: EstadoCredito,
    usuarioId: number,
  ): Promise<void>;
  eliminarLogicamente(
    transaction: DatabaseTransaction,
    creditoId: number,
    usuarioId: number,
  ): Promise<void>;
}

export interface NuevoEventoHistorial {
  creditoId: number;
  tipoEvento: TipoEventoHistorial;
  estadoAnterior: EstadoCredito | null;
  estadoNuevo: EstadoCredito;
  detalleCambios?: Record<string, unknown>;
  observacion?: string;
  usuarioId: number;
}

export interface HistorialCreditoRepository {
  registrar(transaction: DatabaseTransaction, evento: NuevoEventoHistorial): Promise<void>;
  listarPorCredito(creditoId: number): Promise<EventoHistorial[]>;
}

export interface AsociadoRegistrado {
  id: number;
  identificacion: string;
  nombreCompleto: string;
}

export interface AsociadoRepository {
  /** Busca y bloquea el asociado (o el "hueco" de su identificación si aún no existe). */
  buscarPorIdentificacionParaActualizar(
    transaction: DatabaseTransaction,
    identificacion: string,
  ): Promise<AsociadoRegistrado | null>;
  insertar(
    transaction: DatabaseTransaction,
    asociado: { identificacion: string; nombreCompleto: string },
  ): Promise<number>;
}
