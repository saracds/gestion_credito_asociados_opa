import sql from 'mssql';

import type {
  DatabaseClient,
  DatabaseTransaction,
} from '../../infrastructure/database/DatabaseClient.js';
import { bigintToNumber } from '../creditos/repositories/sqlMappers.js';

export interface EventoParaNotificar {
  eventId: string;
  tipoEvento: string;
  creditoId: number;
  urlDestino: string;
  payload: object;
}

/** Evento tomado por el worker para enviarlo. */
export interface NotificacionReclamada {
  id: number;
  eventId: string;
  tipoEvento: string;
  urlDestino: string;
  /** Cuerpo EXACTO a enviar: la firma se calcula sobre este texto. */
  payload: string;
  intentos: number;
  maxIntentos: number;
}

export interface ResultadoIntento {
  notificacionId: number;
  numeroIntento: number;
  codigoHttp: number | null;
  duracionMs: number;
}

export interface ResultadoIntentoFallido extends ResultadoIntento {
  error: string;
  /** Fecha del próximo intento; `null` = no se reintenta (pasa a FALLIDO). */
  proximoIntento: Date | null;
}

export type EstadoNotificacion = 'PENDIENTE' | 'ENVIANDO' | 'ENVIADO' | 'FALLIDO';

/** Traza de notificación de un crédito, para la API y el frontend. */
export interface TrazaNotificacion {
  id: number;
  eventId: string;
  tipoEvento: string;
  urlDestino: string;
  estado: EstadoNotificacion;
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

/**
 * Bandeja de salida (outbox) de eventos del webhook.
 *
 * - `encolar` lo usa la API, DENTRO de la transacción que crea el crédito: no
 *   hace ninguna llamada HTTP, solo deja el evento PENDIENTE.
 * - El resto lo usa el worker: tomar eventos, registrar cada intento y su
 *   resultado.
 */
export interface WebhookOutboxRepository {
  encolar(transaction: DatabaseTransaction, evento: EventoParaNotificar): Promise<void>;
  reclamarPendientes(limite: number, segundosBloqueo: number): Promise<NotificacionReclamada[]>;
  registrarExito(resultado: ResultadoIntento): Promise<void>;
  registrarFallo(resultado: ResultadoIntentoFallido): Promise<void>;
  listarPorCredito(creditoId: number): Promise<TrazaNotificacion[]>;
  /** Reprograma un evento FALLIDO concediéndole intentos adicionales. */
  reprogramarFallido(notificacionId: number, intentosAdicionales: number): Promise<boolean>;
}

const MAX_LONGITUD_ERROR = 1000;

export class SqlServerWebhookOutboxRepository implements WebhookOutboxRepository {
  constructor(private readonly database: DatabaseClient) {}

  async encolar(transaction: DatabaseTransaction, evento: EventoParaNotificar): Promise<void> {
    await this.database
      .createRequest(transaction)
      .input('eventId', sql.UniqueIdentifier, evento.eventId)
      .input('tipoEvento', sql.VarChar(50), evento.tipoEvento)
      .input('creditoId', sql.BigInt, evento.creditoId)
      .input('urlDestino', sql.NVarChar(500), evento.urlDestino)
      .input('payload', sql.NVarChar(sql.MAX), JSON.stringify(evento.payload)).query(`
        INSERT INTO dbo.WebhookNotificaciones (eventId, tipoEvento, creditoId, urlDestino, payload)
        VALUES (@eventId, @tipoEvento, @creditoId, @urlDestino, @payload);
      `);
  }

  /**
   * Toma hasta `limite` eventos listos para enviar y los marca ENVIANDO, en
   * una sola sentencia atómica.
   *
   * Patrón "competing consumers" (varios workers en paralelo sin duplicar envíos):
   *   - UPDLOCK: bloquea las filas elegidas hasta terminar la sentencia.
   *   - READPAST: salta las filas que otro worker ya bloqueó, en lugar de esperar.
   *   Resultado: cada evento lo toma un solo worker, sin colas de espera.
   *
   * También recupera eventos ENVIANDO cuyo `bloqueadoHasta` venció: significa
   * que el worker que los tomó se cayó a mitad del envío.
   *
   * Por qué UPDATE directo con `id IN (SELECT TOP ...)` y no `UPDATE` sobre una
   * CTE: el worker tiene permiso de UPDATE solo en algunas columnas (mínimo
   * privilegio, database/seguridad/usuarios_aplicacion.sql). Al actualizar a
   * través de una CTE, SQL Server exige UPDATE sobre la tabla completa y
   * responde 229. El UPDATE directo valida solo las columnas del SET.
   * READPAST también en la tabla destino, para que el UPDATE nunca espere por
   * filas que otro worker está procesando.
   */
  async reclamarPendientes(
    limite: number,
    segundosBloqueo: number,
  ): Promise<NotificacionReclamada[]> {
    const result = await this.database
      .createRequest()
      .input('limite', sql.Int, limite)
      .input('segundosBloqueo', sql.Int, segundosBloqueo).query<{
      id: string;
      eventId: string;
      tipoEvento: string;
      urlDestino: string;
      payload: string;
      intentos: number;
      maxIntentos: number;
    }>(`
        UPDATE dbo.WebhookNotificaciones WITH (ROWLOCK, READPAST)
        SET estado = 'ENVIANDO',
            bloqueadoHasta = DATEADD(SECOND, @segundosBloqueo, SYSUTCDATETIME())
        OUTPUT INSERTED.id, INSERTED.eventId, INSERTED.tipoEvento, INSERTED.urlDestino,
               INSERTED.payload, INSERTED.intentos, INSERTED.maxIntentos
        WHERE id IN (
          SELECT TOP (@limite) id
          FROM dbo.WebhookNotificaciones WITH (UPDLOCK, READPAST, ROWLOCK)
          WHERE (estado = 'PENDIENTE' AND proximoIntento <= SYSUTCDATETIME())
             OR (estado = 'ENVIANDO'  AND bloqueadoHasta < SYSUTCDATETIME())
          ORDER BY proximoIntento
        );
      `);

    return result.recordset.map((row) => ({
      id: bigintToNumber(row.id),
      eventId: row.eventId.toLowerCase(),
      tipoEvento: row.tipoEvento,
      urlDestino: row.urlDestino,
      payload: row.payload,
      intentos: row.intentos,
      maxIntentos: row.maxIntentos,
    }));
  }

  /** Marca ENVIADO y registra el intento, en una sola transacción. */
  async registrarExito(resultado: ResultadoIntento): Promise<void> {
    await this.database.runInTransaction(async (transaction) => {
      await this.insertarIntento(transaction, { ...resultado, exitoso: true, error: null });
      await this.database
        .createRequest(transaction)
        .input('id', sql.BigInt, resultado.notificacionId)
        .input('intentos', sql.SmallInt, resultado.numeroIntento)
        .input('codigoHttp', sql.SmallInt, resultado.codigoHttp).query(`
          UPDATE dbo.WebhookNotificaciones
          SET estado = 'ENVIADO', intentos = @intentos, ultimoCodigoHttp = @codigoHttp,
              ultimoError = NULL, fechaEnvio = SYSUTCDATETIME(), bloqueadoHasta = NULL
          WHERE id = @id;
        `);
    });
  }

  /** Registra el intento fallido y deja el evento PENDIENTE (con fecha de reintento) o FALLIDO. */
  async registrarFallo(resultado: ResultadoIntentoFallido): Promise<void> {
    const error = resultado.error.slice(0, MAX_LONGITUD_ERROR);

    await this.database.runInTransaction(async (transaction) => {
      await this.insertarIntento(transaction, { ...resultado, error, exitoso: false });
      await this.database
        .createRequest(transaction)
        .input('id', sql.BigInt, resultado.notificacionId)
        .input('intentos', sql.SmallInt, resultado.numeroIntento)
        .input('codigoHttp', sql.SmallInt, resultado.codigoHttp)
        .input('error', sql.NVarChar(MAX_LONGITUD_ERROR), error)
        .input('estado', sql.VarChar(15), resultado.proximoIntento ? 'PENDIENTE' : 'FALLIDO')
        .input('proximoIntento', sql.DateTime2(3), resultado.proximoIntento).query(`
          UPDATE dbo.WebhookNotificaciones
          SET estado = @estado, intentos = @intentos, ultimoCodigoHttp = @codigoHttp,
              ultimoError = @error, bloqueadoHasta = NULL,
              proximoIntento = COALESCE(@proximoIntento, proximoIntento)
          WHERE id = @id;
        `);
    });
  }

  async listarPorCredito(creditoId: number): Promise<TrazaNotificacion[]> {
    const result = await this.database.createRequest().input('creditoId', sql.BigInt, creditoId)
      .query<{
      id: string;
      eventId: string;
      tipoEvento: string;
      urlDestino: string;
      estado: EstadoNotificacion;
      intentos: number;
      maxIntentos: number;
      proximoIntento: Date;
      ultimoCodigoHttp: number | null;
      ultimoError: string | null;
      fechaCreacion: Date;
      fechaEnvio: Date | null;
      detalleIntentos: string | null;
    }>(`
        SELECT n.id, n.eventId, n.tipoEvento, n.urlDestino, n.estado, n.intentos, n.maxIntentos,
               n.proximoIntento, n.ultimoCodigoHttp, n.ultimoError, n.fechaCreacion, n.fechaEnvio,
               (
                 SELECT i.numeroIntento, i.fechaIntento, i.exitoso, i.codigoHttp, i.duracionMs, i.error
                 FROM dbo.WebhookIntentos AS i
                 WHERE i.notificacionId = n.id
                 ORDER BY i.numeroIntento
                 FOR JSON PATH, INCLUDE_NULL_VALUES
               ) AS detalleIntentos
        FROM dbo.WebhookNotificaciones AS n
        WHERE n.creditoId = @creditoId
        ORDER BY n.fechaCreacion;
      `);

    return result.recordset.map((row) => ({
      id: bigintToNumber(row.id),
      eventId: row.eventId.toLowerCase(),
      tipoEvento: row.tipoEvento,
      urlDestino: row.urlDestino,
      estado: row.estado,
      intentos: row.intentos,
      maxIntentos: row.maxIntentos,
      proximoIntento: row.estado === 'PENDIENTE' ? row.proximoIntento.toISOString() : null,
      ultimoCodigoHttp: row.ultimoCodigoHttp,
      ultimoError: row.ultimoError,
      fechaCreacion: row.fechaCreacion.toISOString(),
      fechaEnvio: row.fechaEnvio?.toISOString() ?? null,
      detalleIntentos: row.detalleIntentos
        ? (
            JSON.parse(row.detalleIntentos) as {
              numeroIntento: number;
              fechaIntento: string;
              exitoso: boolean;
              codigoHttp: number | null;
              duracionMs: number | null;
              error: string | null;
            }[]
          ).map((intento) => ({
            ...intento,
            exitoso: Boolean(intento.exitoso),
            // FOR JSON entrega DATETIME2 sin zona horaria; se marca como UTC.
            fechaIntento: new Date(`${intento.fechaIntento}Z`).toISOString(),
          }))
        : [],
    }));
  }

  /**
   * Reproceso manual: amplía `maxIntentos` (en lugar de reiniciar `intentos`)
   * para conservar la numeración de la traza ya registrada.
   */
  async reprogramarFallido(notificacionId: number, intentosAdicionales: number): Promise<boolean> {
    const result = await this.database
      .createRequest()
      .input('id', sql.BigInt, notificacionId)
      .input('adicionales', sql.SmallInt, intentosAdicionales).query(`
        UPDATE dbo.WebhookNotificaciones
        SET estado = 'PENDIENTE', maxIntentos = intentos + @adicionales,
            proximoIntento = SYSUTCDATETIME(), bloqueadoHasta = NULL
        WHERE id = @id AND estado = 'FALLIDO';
      `);
    return (result.rowsAffected[0] ?? 0) > 0;
  }

  private async insertarIntento(
    transaction: DatabaseTransaction,
    intento: ResultadoIntento & { exitoso: boolean; error: string | null },
  ): Promise<void> {
    await this.database
      .createRequest(transaction)
      .input('notificacionId', sql.BigInt, intento.notificacionId)
      .input('numeroIntento', sql.SmallInt, intento.numeroIntento)
      .input('exitoso', sql.Bit, intento.exitoso)
      .input('codigoHttp', sql.SmallInt, intento.codigoHttp)
      .input('duracionMs', sql.Int, intento.duracionMs)
      .input('error', sql.NVarChar(MAX_LONGITUD_ERROR), intento.error).query(`
        INSERT INTO dbo.WebhookIntentos
          (notificacionId, numeroIntento, exitoso, codigoHttp, duracionMs, error)
        VALUES
          (@notificacionId, @numeroIntento, @exitoso, @codigoHttp, @duracionMs, @error);
      `);
  }
}
