import { randomUUID } from 'node:crypto';

import type {
  DatabaseTransaction,
  TransactionRunner,
} from '../../infrastructure/database/DatabaseClient.js';
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
  PreconditionFailedError,
} from '../../shared/errors/AppError.js';
import type { UsuarioAutenticado } from '../auth/auth.types.js';
import type { CatalogoRepository } from '../catalogos/CatalogoRepository.js';
import type {
  TrazaNotificacion,
  WebhookOutboxRepository,
} from '../webhooks/WebhookOutboxRepository.js';
import { limpiarNombre, nombresCoinciden, normalizarIdentificacion } from './domain/asociado.js';
import { calcularCambios } from './domain/cambiosCredito.js';
import { CreditoErrorCode } from './domain/creditoErrorCodes.js';
import type {
  CondicionesCredito,
  Credito,
  CreditoConAsociado,
  CreditoRegistro,
  CriteriosBusquedaCreditos,
  EventoHistorial,
  PaginaCreditos,
  ResumenCreditos,
  SolicitudCredito,
} from './domain/credito.types.js';
import {
  calcularAcciones,
  ESTADOS_CREDITO,
  esEditable,
  esEliminable,
  validarCambioDeEstado,
  type EstadoCredito,
} from './domain/estadoCredito.js';
import { construirEventoCreditoCreado } from './domain/eventosCredito.js';
import { evaluarPoliticaDeCredito } from './domain/politicaCredito.js';
import type {
  AsociadoRepository,
  CreditoRepository,
  HistorialCreditoRepository,
} from './repositories/creditoRepositories.js';

export interface CreditoServiceDependencies {
  transactionRunner: TransactionRunner;
  creditoRepository: CreditoRepository;
  asociadoRepository: AsociadoRepository;
  historialRepository: HistorialCreditoRepository;
  catalogoRepository: CatalogoRepository;
  webhookOutboxRepository: WebhookOutboxRepository;
  webhookUrl: string;
}

/**
 * CAPA DE SERVICIO — aquí viven las reglas de negocio.
 *
 * Por qué aquí y no en el controlador ni en la base de datos:
 *   - El controlador solo traduce HTTP; si mañana los créditos llegan por una
 *     cola de mensajes o un proceso batch, reutilizan este mismo servicio.
 *   - La base de datos protege la integridad (última barrera), pero no puede
 *     dar mensajes de negocio claros ni conocer al usuario o su rol.
 *   - El servicio no conoce HTTP ni SQL: se prueba de forma aislada.
 *
 * Toda operación de escritura sigue el mismo patrón dentro de UNA transacción:
 *   1. Leer y bloquear el estado actual.
 *   2. Validar reglas de negocio.
 *   3. Escribir el cambio.
 *   4. Registrar el historial (auditoría).
 *   5. (Solo en la creación) encolar el evento del webhook.
 * O se guarda todo, o no se guarda nada.
 */
export class CreditoService {
  constructor(private readonly dependencies: CreditoServiceDependencies) {}

  // ---------------------------------------------------------------------------
  // Consultas
  // ---------------------------------------------------------------------------

  async obtenerPorId(creditoId: number): Promise<Credito> {
    const credito = await this.dependencies.creditoRepository.buscarPorId(creditoId);
    if (!credito) throw this.creditoNoEncontrado(creditoId);
    return this.aVistaPublica(credito);
  }

  async buscar(criterios: CriteriosBusquedaCreditos): Promise<PaginaCreditos> {
    const pagina = await this.dependencies.creditoRepository.buscar(criterios);
    // El repositorio devuelve datos internos (asociadoId); se quitan antes de exponerlos.
    // Este filtro faltaba y lo detectó la prueba de contrato de OpenAPI.
    return { ...pagina, items: pagina.items.map((credito) => this.aVistaPublica(credito)) };
  }

  async obtenerHistorial(creditoId: number): Promise<EventoHistorial[]> {
    await this.obtenerPorId(creditoId); // 404 si no existe
    return this.dependencies.historialRepository.listarPorCredito(creditoId);
  }

  /** Traza de notificaciones del webhook del crédito (estado e intentos). */
  async obtenerNotificaciones(creditoId: number): Promise<TrazaNotificacion[]> {
    await this.obtenerPorId(creditoId); // 404 si no existe
    return this.dependencies.webhookOutboxRepository.listarPorCredito(creditoId);
  }

  /** Datos del dashboard. Incluye los estados sin créditos (cantidad 0) para que el gráfico sea estable. */
  async obtenerResumen(): Promise<ResumenCreditos> {
    const filas = await this.dependencies.creditoRepository.obtenerResumenPorEstado();
    const porEstado = ESTADOS_CREDITO.map((estado) => {
      const fila = filas.find((item) => item.estado === estado);
      return { estado, cantidad: fila?.cantidad ?? 0, valorTotal: fila?.valorTotal ?? 0 };
    });

    return {
      totalCreditos: porEstado.reduce((total, item) => total + item.cantidad, 0),
      valorTotalSolicitado: porEstado.reduce((total, item) => total + item.valorTotal, 0),
      porEstado,
    };
  }

  // ---------------------------------------------------------------------------
  // Creación  (POST /api/creditos)
  // ---------------------------------------------------------------------------

  /**
   * Registra una solicitud de crédito.
   *
   * Requisito clave del webhook: la notificación NO duplica esta lógica ni hace
   * un segundo INSERT del crédito. Este mismo método, dentro de la misma
   * transacción, deja el evento "credito.creado" en el outbox.
   */
  async crear(solicitud: SolicitudCredito, usuario: UsuarioAutenticado): Promise<Credito> {
    const identificacion = normalizarIdentificacion(solicitud.identificacionAsociado);
    const nombreAsociado = limpiarNombre(solicitud.nombreAsociado);
    const condiciones: CondicionesCredito = {
      tipoCredito: solicitud.tipoCredito,
      valorSolicitado: solicitud.valorSolicitado,
      tasaInteres: solicitud.tasaInteres,
      numeroCuotas: solicitud.numeroCuotas,
      formaPago: solicitud.formaPago,
    };

    const {
      transactionRunner,
      creditoRepository,
      historialRepository,
      webhookOutboxRepository,
      webhookUrl,
    } = this.dependencies;

    const creditoCreado = await transactionRunner.runInTransaction(async (transaction) => {
      await this.validarCondiciones(transaction, condiciones);

      const asociadoId = await this.obtenerOCrearAsociado(
        transaction,
        identificacion,
        nombreAsociado,
      );

      await this.validarQueNoExistaCreditoActivo(transaction, asociadoId, condiciones.tipoCredito);

      const creditoId = await creditoRepository.insertar(transaction, {
        asociadoId,
        condiciones,
        usuarioId: usuario.id,
      });

      await historialRepository.registrar(transaction, {
        creditoId,
        tipoEvento: 'CREACION',
        estadoAnterior: null,
        estadoNuevo: 'SOLICITADO',
        detalleCambios: { ...condiciones },
        observacion: 'Solicitud de crédito registrada.',
        usuarioId: usuario.id,
      });

      const credito = await this.leerDentroDeTransaccion(transaction, creditoId);
      const evento = construirEventoCreditoCreado(this.aVistaPublica(credito), randomUUID());

      await webhookOutboxRepository.encolar(transaction, {
        eventId: evento.eventId,
        tipoEvento: evento.event,
        creditoId,
        urlDestino: webhookUrl,
        payload: evento,
      });

      return credito;
    });

    return this.aVistaPublica(creditoCreado);
  }

  // ---------------------------------------------------------------------------
  // Actualización parcial  (PATCH /api/creditos/{id})
  // ---------------------------------------------------------------------------

  /**
   * Modifica condiciones financieras. Solo se permite en SOLICITADO o EN_ESTUDIO
   * y exige la versión vigente del crédito (concurrencia optimista).
   *
   * @param versionEsperada versión que el cliente leyó (cabecera If-Match).
   */
  async actualizar(
    creditoId: number,
    cambiosSolicitados: Partial<CondicionesCredito>,
    versionEsperada: string,
    usuario: UsuarioAutenticado,
    observacion?: string,
  ): Promise<Credito> {
    const { transactionRunner, creditoRepository, historialRepository } = this.dependencies;

    const creditoActualizado = await transactionRunner.runInTransaction(async (transaction) => {
      const actual = await this.leerYBloquear(transaction, creditoId);
      this.validarVersion(actual, versionEsperada);

      if (!esEditable(actual.estado)) {
        throw new BusinessRuleError(
          CreditoErrorCode.CREDITO_NO_EDITABLE,
          `Las condiciones de un crédito en estado ${actual.estado} no pueden modificarse. Solo se permiten cambios en SOLICITADO o EN_ESTUDIO.`,
        );
      }

      const cambios = calcularCambios(actual, cambiosSolicitados);
      if (Object.keys(cambios).length === 0) {
        return actual; // Nada cambió: no se escribe ni se registra historial.
      }

      const condicionesResultantes: CondicionesCredito = {
        tipoCredito: cambiosSolicitados.tipoCredito ?? actual.tipoCredito,
        valorSolicitado: cambiosSolicitados.valorSolicitado ?? actual.valorSolicitado,
        tasaInteres: cambiosSolicitados.tasaInteres ?? actual.tasaInteres,
        numeroCuotas: cambiosSolicitados.numeroCuotas ?? actual.numeroCuotas,
        formaPago: cambiosSolicitados.formaPago ?? actual.formaPago,
      };
      await this.validarCondiciones(transaction, condicionesResultantes);

      if (cambios.tipoCredito) {
        await this.validarQueNoExistaCreditoActivo(
          transaction,
          actual.asociadoId,
          condicionesResultantes.tipoCredito,
          creditoId,
        );
      }

      const valoresNuevos = Object.fromEntries(
        Object.entries(cambios).map(([campo, cambio]) => [campo, cambio.nuevo]),
      ) as Partial<CondicionesCredito>;

      await creditoRepository.actualizarCondiciones(
        transaction,
        creditoId,
        valoresNuevos,
        usuario.id,
      );

      await historialRepository.registrar(transaction, {
        creditoId,
        tipoEvento: 'ACTUALIZACION',
        estadoAnterior: actual.estado,
        estadoNuevo: actual.estado,
        detalleCambios: cambios,
        ...(observacion && { observacion }),
        usuarioId: usuario.id,
      });

      return this.leerDentroDeTransaccion(transaction, creditoId);
    });

    return this.aVistaPublica(creditoActualizado);
  }

  // ---------------------------------------------------------------------------
  // Cambio de estado  (PATCH /api/creditos/{id}/estado)
  // ---------------------------------------------------------------------------

  async cambiarEstado(
    creditoId: number,
    estadoNuevo: EstadoCredito,
    usuario: UsuarioAutenticado,
    observacion?: string,
  ): Promise<Credito> {
    const { transactionRunner, creditoRepository, historialRepository } = this.dependencies;

    const creditoActualizado = await transactionRunner.runInTransaction(async (transaction) => {
      // El bloqueo garantiza que la validación se haga sobre el estado vigente:
      // si dos analistas cambian el estado a la vez, el segundo ve el resultado
      // del primero y su transición se valida contra ese nuevo estado.
      const actual = await this.leerYBloquear(transaction, creditoId);

      validarCambioDeEstado(actual.estado, estadoNuevo, observacion);

      await creditoRepository.actualizarEstado(transaction, creditoId, estadoNuevo, usuario.id);

      await historialRepository.registrar(transaction, {
        creditoId,
        tipoEvento: 'CAMBIO_ESTADO',
        estadoAnterior: actual.estado,
        estadoNuevo,
        ...(observacion && { observacion }),
        usuarioId: usuario.id,
      });

      return this.leerDentroDeTransaccion(transaction, creditoId);
    });

    return this.aVistaPublica(creditoActualizado);
  }

  // ---------------------------------------------------------------------------
  // Borrado lógico  (DELETE /api/creditos/{id})
  // ---------------------------------------------------------------------------

  async eliminar(creditoId: number, usuario: UsuarioAutenticado): Promise<void> {
    const { transactionRunner, creditoRepository, historialRepository } = this.dependencies;

    await transactionRunner.runInTransaction(async (transaction) => {
      const actual = await this.leerYBloquear(transaction, creditoId);

      if (!esEliminable(actual.estado)) {
        throw new BusinessRuleError(
          CreditoErrorCode.CREDITO_NO_ELIMINABLE,
          `Solo se pueden eliminar créditos en estado SOLICITADO. Este crédito está en ${actual.estado}; si ya no aplica, cámbielo a CANCELADO.`,
        );
      }

      await creditoRepository.eliminarLogicamente(transaction, creditoId, usuario.id);

      await historialRepository.registrar(transaction, {
        creditoId,
        tipoEvento: 'ELIMINACION',
        estadoAnterior: actual.estado,
        estadoNuevo: actual.estado,
        observacion: 'Crédito eliminado (borrado lógico).',
        usuarioId: usuario.id,
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Reglas reutilizadas
  // ---------------------------------------------------------------------------

  /** Tipo y forma de pago deben existir y estar activos; valor, plazo y tasa dentro de la política. */
  private async validarCondiciones(
    transaction: DatabaseTransaction,
    condiciones: CondicionesCredito,
  ): Promise<void> {
    const { catalogoRepository } = this.dependencies;
    // Consultas secuenciales: una transacción usa UNA sola conexión, que no
    // admite consultas simultáneas.
    const tipoCredito = await catalogoRepository.buscarTipoCredito(
      condiciones.tipoCredito,
      transaction,
    );
    const formaPago = await catalogoRepository.buscarFormaPago(condiciones.formaPago, transaction);

    if (!tipoCredito?.activo) {
      throw new BusinessRuleError(
        CreditoErrorCode.TIPO_CREDITO_INVALIDO,
        `El tipo de crédito ${condiciones.tipoCredito} no existe o no está disponible.`,
        [{ field: 'tipoCredito', message: 'Consulte los tipos disponibles en GET /api/catalogos' }],
      );
    }

    if (!formaPago?.activo) {
      throw new BusinessRuleError(
        CreditoErrorCode.FORMA_PAGO_INVALIDA,
        `La forma de pago ${condiciones.formaPago} no existe o no está disponible.`,
        [{ field: 'formaPago', message: 'Consulte las formas de pago en GET /api/catalogos' }],
      );
    }

    const violaciones = evaluarPoliticaDeCredito(condiciones, tipoCredito);
    if (violaciones.length > 0) {
      throw new BusinessRuleError(
        CreditoErrorCode.CONDICIONES_FUERA_DE_POLITICA,
        `Las condiciones no cumplen la política del crédito de ${tipoCredito.nombre}.`,
        violaciones,
      );
    }
  }

  /**
   * Devuelve el id del asociado, creándolo si es nuevo.
   * Si la identificación existe con OTRO nombre, rechaza la solicitud (409).
   */
  private async obtenerOCrearAsociado(
    transaction: DatabaseTransaction,
    identificacion: string,
    nombreAsociado: string,
  ): Promise<number> {
    const { asociadoRepository } = this.dependencies;
    const existente = await asociadoRepository.buscarPorIdentificacionParaActualizar(
      transaction,
      identificacion,
    );

    if (!existente) {
      return asociadoRepository.insertar(transaction, {
        identificacion,
        nombreCompleto: nombreAsociado,
      });
    }

    if (!nombresCoinciden(existente.nombreCompleto, nombreAsociado)) {
      throw new ConflictError(
        CreditoErrorCode.ASOCIADO_NOMBRE_NO_COINCIDE,
        `La identificación ${identificacion} ya está registrada a nombre de otra persona. Verifique la identificación o el nombre del asociado.`,
      );
    }

    return existente.id;
  }

  private async validarQueNoExistaCreditoActivo(
    transaction: DatabaseTransaction,
    asociadoId: number,
    tipoCredito: string,
    excluirCreditoId?: number,
  ): Promise<void> {
    const existe = await this.dependencies.creditoRepository.existeCreditoActivo(
      transaction,
      asociadoId,
      tipoCredito,
      excluirCreditoId,
    );
    if (existe) {
      throw new ConflictError(
        CreditoErrorCode.CREDITO_DUPLICADO,
        `El asociado ya tiene un crédito de tipo ${tipoCredito} en curso (SOLICITADO, EN_ESTUDIO o APROBADO). Debe finalizarse antes de registrar otro del mismo tipo.`,
      );
    }
  }

  private validarVersion(credito: CreditoRegistro, versionEsperada: string): void {
    if (credito.version !== versionEsperada) {
      throw new PreconditionFailedError(
        'El crédito fue modificado por otro usuario después de que usted lo consultó. Recargue el crédito y vuelva a aplicar sus cambios.',
      );
    }
  }

  private async leerYBloquear(
    transaction: DatabaseTransaction,
    creditoId: number,
  ): Promise<CreditoConAsociado> {
    const credito = await this.dependencies.creditoRepository.buscarPorId(creditoId, {
      transaction,
      bloquearParaActualizar: true,
    });
    if (!credito) throw this.creditoNoEncontrado(creditoId);
    return credito;
  }

  private async leerDentroDeTransaccion(
    transaction: DatabaseTransaction,
    creditoId: number,
  ): Promise<CreditoConAsociado> {
    const credito = await this.dependencies.creditoRepository.buscarPorId(creditoId, {
      transaction,
    });
    if (!credito) throw this.creditoNoEncontrado(creditoId);
    return credito;
  }

  private creditoNoEncontrado(creditoId: number): NotFoundError {
    return new NotFoundError(
      CreditoErrorCode.CREDITO_NOT_FOUND,
      `El crédito ${creditoId} no existe.`,
    );
  }

  /**
   * Prepara el crédito para la API: quita los datos internos (asociadoId) y
   * agrega las acciones que permite su estado actual.
   */
  private aVistaPublica(credito: CreditoConAsociado): Credito {
    const { asociadoId: _asociadoId, ...registro } = credito;
    return { ...registro, ...calcularAcciones(credito.estado) };
  }
}
