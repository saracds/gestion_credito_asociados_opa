import type {
  DatabaseTransaction,
  TransactionRunner,
} from '../../src/infrastructure/database/DatabaseClient.js';
import type { UsuarioRegistrado } from '../../src/modules/auth/auth.types.js';
import type { UsuarioRepository } from '../../src/modules/auth/UsuarioRepository.js';
import type {
  CatalogoRepository,
  FormaPagoCatalogo,
  TipoCreditoCatalogo,
} from '../../src/modules/catalogos/CatalogoRepository.js';
import type {
  CondicionesCredito,
  CreditoConAsociado,
  CriteriosBusquedaCreditos,
  EventoHistorial,
  ResumenEstado,
} from '../../src/modules/creditos/domain/credito.types.js';
import {
  ESTADOS_ACTIVOS,
  type EstadoCredito,
} from '../../src/modules/creditos/domain/estadoCredito.js';
import type {
  AsociadoRegistrado,
  AsociadoRepository,
  CreditoRepository,
  HistorialCreditoRepository,
  NuevoCredito,
  NuevoEventoHistorial,
} from '../../src/modules/creditos/repositories/creditoRepositories.js';
import type {
  EventoParaNotificar,
  WebhookOutboxRepository,
} from '../../src/modules/webhooks/WebhookOutboxRepository.js';

interface CreditoAlmacenado {
  id: number;
  asociadoId: number;
  condiciones: CondicionesCredito;
  estado: EstadoCredito;
  fechaSolicitud: string;
  fechaActualizacion: string;
  version: number;
  eliminado: boolean;
}

interface EstadoBaseDeDatos {
  creditos: CreditoAlmacenado[];
  asociados: AsociadoRegistrado[];
  historial: (NuevoEventoHistorial & { id: number; fechaEvento: string })[];
  outbox: EventoParaNotificar[];
  secuencia: number;
}

export const TIPOS_CREDITO_PRUEBA: TipoCreditoCatalogo[] = [
  {
    codigo: 'LIBRE_INVERSION',
    nombre: 'Libre inversión',
    descripcion: null,
    valorMinimo: 500_000,
    valorMaximo: 100_000_000,
    cuotasMaximas: 72,
    tasaMaximaMensual: 2,
    activo: true,
  },
  {
    codigo: 'EDUCACION',
    nombre: 'Educación',
    descripcion: null,
    valorMinimo: 300_000,
    valorMaximo: 50_000_000,
    cuotasMaximas: 60,
    tasaMaximaMensual: 1,
    activo: true,
  },
  {
    codigo: 'DESCONTINUADO',
    nombre: 'Línea descontinuada',
    descripcion: null,
    valorMinimo: 1,
    valorMaximo: 1_000_000,
    cuotasMaximas: 12,
    tasaMaximaMensual: 2,
    activo: false,
  },
];

export const FORMAS_PAGO_PRUEBA: FormaPagoCatalogo[] = [
  { codigo: 'NOMINA', nombre: 'Descuento por nómina', descripcion: null, activo: true },
  { codigo: 'CAJA', nombre: 'Pago en caja', descripcion: null, activo: true },
];

/** La transacción en memoria no necesita un objeto real; se usa un marcador. */
const TRANSACCION_FALSA = {} as DatabaseTransaction;

/**
 * Doble de prueba de la base de datos, en memoria.
 *
 * Implementa todas las interfaces de repositorio y, lo más importante, imita
 * la ATOMICIDAD: si la función de la transacción lanza un error, el estado
 * vuelve a como estaba antes (ROLLBACK). Esto permite verificar que crédito,
 * historial y evento del webhook se guardan juntos o no se guarda nada.
 */
export class InMemoryDatabase implements TransactionRunner {
  private estado: EstadoBaseDeDatos = {
    creditos: [],
    asociados: [],
    historial: [],
    outbox: [],
    secuencia: 0,
  };

  /** Permite simular un fallo al encolar el webhook (para probar el rollback). */
  fallarAlEncolarWebhook = false;

  readonly usuarios: UsuarioRegistrado[] = [];

  // ----- Inspección desde las pruebas -----
  get creditos() {
    return this.estado.creditos;
  }
  get asociados() {
    return this.estado.asociados;
  }
  get historial() {
    return this.estado.historial;
  }
  get outbox() {
    return this.estado.outbox;
  }

  async runInTransaction<TResult>(
    work: (transaction: DatabaseTransaction) => Promise<TResult>,
  ): Promise<TResult> {
    const copiaDeSeguridad = structuredClone(this.estado);
    try {
      return await work(TRANSACCION_FALSA);
    } catch (error) {
      this.estado = copiaDeSeguridad; // ROLLBACK
      throw error;
    }
  }

  // ----- Repositorios -----

  readonly creditoRepository: CreditoRepository = {
    buscarPorId: async (id) => {
      const credito = this.estado.creditos.find((item) => item.id === id && !item.eliminado);
      return credito ? this.aCredito(credito) : null;
    },

    buscar: async (criterios: CriteriosBusquedaCreditos) => {
      const filtrados = this.estado.creditos
        .filter((credito) => !credito.eliminado)
        .map((credito) => this.aCredito(credito))
        .filter((credito) => !criterios.estado || credito.estado === criterios.estado)
        .filter(
          (credito) =>
            !criterios.identificacionAsociado ||
            credito.identificacionAsociado === criterios.identificacionAsociado,
        );
      const inicio = (criterios.page - 1) * criterios.pageSize;
      return {
        items: filtrados.slice(inicio, inicio + criterios.pageSize),
        totalItems: filtrados.length,
      };
    },

    obtenerResumenPorEstado: async (): Promise<ResumenEstado[]> => {
      const resumen = new Map<EstadoCredito, ResumenEstado>();
      for (const credito of this.estado.creditos.filter((item) => !item.eliminado)) {
        const actual = resumen.get(credito.estado) ?? {
          estado: credito.estado,
          cantidad: 0,
          valorTotal: 0,
        };
        actual.cantidad += 1;
        actual.valorTotal += credito.condiciones.valorSolicitado;
        resumen.set(credito.estado, actual);
      }
      return [...resumen.values()];
    },

    existeCreditoActivo: async (_transaction, asociadoId, tipoCredito, excluirCreditoId) =>
      this.estado.creditos.some(
        (credito) =>
          credito.asociadoId === asociadoId &&
          credito.condiciones.tipoCredito === tipoCredito &&
          ESTADOS_ACTIVOS.includes(credito.estado) &&
          !credito.eliminado &&
          credito.id !== excluirCreditoId,
      ),

    insertar: async (_transaction, nuevoCredito: NuevoCredito) => {
      const ahora = new Date().toISOString();
      const id = this.siguienteId();
      this.estado.creditos.push({
        id,
        asociadoId: nuevoCredito.asociadoId,
        condiciones: { ...nuevoCredito.condiciones },
        estado: 'SOLICITADO',
        fechaSolicitud: ahora,
        fechaActualizacion: ahora,
        version: 1,
        eliminado: false,
      });
      return id;
    },

    actualizarCondiciones: async (_transaction, creditoId, cambios) => {
      const credito = this.buscarAlmacenado(creditoId);
      credito.condiciones = { ...credito.condiciones, ...cambios };
      this.marcarActualizado(credito);
    },

    actualizarEstado: async (_transaction, creditoId, estadoNuevo) => {
      const credito = this.buscarAlmacenado(creditoId);
      credito.estado = estadoNuevo;
      this.marcarActualizado(credito);
    },

    eliminarLogicamente: async (_transaction, creditoId) => {
      const credito = this.buscarAlmacenado(creditoId);
      credito.eliminado = true;
      this.marcarActualizado(credito);
    },
  };

  readonly asociadoRepository: AsociadoRepository = {
    buscarPorIdentificacionParaActualizar: async (_transaction, identificacion) =>
      this.estado.asociados.find((asociado) => asociado.identificacion === identificacion) ?? null,

    insertar: async (_transaction, asociado) => {
      const id = this.siguienteId();
      this.estado.asociados.push({ id, ...asociado });
      return id;
    },
  };

  readonly historialRepository: HistorialCreditoRepository = {
    registrar: async (_transaction, evento) => {
      this.estado.historial.push({
        ...evento,
        id: this.siguienteId(),
        fechaEvento: new Date().toISOString(),
      });
    },

    listarPorCredito: async (creditoId): Promise<EventoHistorial[]> =>
      this.estado.historial
        .filter((evento) => evento.creditoId === creditoId)
        .map((evento) => ({
          id: evento.id,
          tipoEvento: evento.tipoEvento,
          estadoAnterior: evento.estadoAnterior,
          estadoNuevo: evento.estadoNuevo,
          detalleCambios: evento.detalleCambios ?? null,
          observacion: evento.observacion ?? null,
          usuario: { nombre: 'Usuario de prueba', email: 'prueba@opa.local' },
          fechaEvento: evento.fechaEvento,
        })),
  };

  readonly catalogoRepository: CatalogoRepository = {
    buscarTipoCredito: async (codigo) =>
      TIPOS_CREDITO_PRUEBA.find((tipo) => tipo.codigo === codigo) ?? null,
    buscarFormaPago: async (codigo) =>
      FORMAS_PAGO_PRUEBA.find((forma) => forma.codigo === codigo) ?? null,
    listarTiposCreditoActivos: async () => TIPOS_CREDITO_PRUEBA.filter((tipo) => tipo.activo),
    listarFormasPagoActivas: async () => FORMAS_PAGO_PRUEBA.filter((forma) => forma.activo),
  };

  /** Solo implementa lo que usa la API; el worker se prueba con su propio doble. */
  readonly webhookOutboxRepository: WebhookOutboxRepository = {
    encolar: async (_transaction, evento) => {
      if (this.fallarAlEncolarWebhook) {
        throw new Error('Fallo simulado al escribir en el outbox');
      }
      this.estado.outbox.push(structuredClone(evento));
    },
    listarPorCredito: async (creditoId) =>
      this.estado.outbox
        .filter((evento) => evento.creditoId === creditoId)
        .map((evento, indice) => ({
          id: indice + 1,
          eventId: evento.eventId,
          tipoEvento: evento.tipoEvento,
          urlDestino: evento.urlDestino,
          estado: 'PENDIENTE' as const,
          intentos: 0,
          maxIntentos: 6,
          proximoIntento: new Date().toISOString(),
          ultimoCodigoHttp: null,
          ultimoError: null,
          fechaCreacion: new Date().toISOString(),
          fechaEnvio: null,
          detalleIntentos: [],
        })),
    reprogramarFallido: async () => false,
    reclamarPendientes: async () => {
      throw new Error('No implementado en el doble de la API');
    },
    registrarExito: async () => {
      throw new Error('No implementado en el doble de la API');
    },
    registrarFallo: async () => {
      throw new Error('No implementado en el doble de la API');
    },
  };

  readonly usuarioRepository: UsuarioRepository = {
    findByEmail: async (email) => this.usuarios.find((usuario) => usuario.email === email) ?? null,
  };

  // ----- Utilidades internas -----

  private siguienteId(): number {
    this.estado.secuencia += 1;
    return this.estado.secuencia;
  }

  private buscarAlmacenado(creditoId: number): CreditoAlmacenado {
    const credito = this.estado.creditos.find((item) => item.id === creditoId);
    if (!credito) throw new Error(`Crédito ${creditoId} inexistente en la BD en memoria`);
    return credito;
  }

  private marcarActualizado(credito: CreditoAlmacenado): void {
    credito.version += 1;
    credito.fechaActualizacion = new Date().toISOString();
  }

  private aCredito(credito: CreditoAlmacenado): CreditoConAsociado {
    const asociado = this.estado.asociados.find((item) => item.id === credito.asociadoId);
    const tipo = TIPOS_CREDITO_PRUEBA.find(
      (item) => item.codigo === credito.condiciones.tipoCredito,
    );
    const forma = FORMAS_PAGO_PRUEBA.find((item) => item.codigo === credito.condiciones.formaPago);
    return {
      id: credito.id,
      numeroCredito: `CR-2026-${String(credito.id).padStart(6, '0')}`,
      asociadoId: credito.asociadoId,
      identificacionAsociado: asociado?.identificacion ?? '',
      nombreAsociado: asociado?.nombreCompleto ?? '',
      ...credito.condiciones,
      tipoCreditoNombre: tipo?.nombre ?? '',
      formaPagoNombre: forma?.nombre ?? '',
      estado: credito.estado,
      fechaSolicitud: credito.fechaSolicitud,
      fechaActualizacion: credito.fechaActualizacion,
      version: credito.version.toString(16).toUpperCase().padStart(16, '0'),
    };
  }
}
