import sql from 'mssql';

import type {
  DatabaseClient,
  DatabaseTransaction,
} from '../../../infrastructure/database/DatabaseClient.js';
import type { EventoHistorial, TipoEventoHistorial } from '../domain/credito.types.js';
import type { EstadoCredito } from '../domain/estadoCredito.js';
import type { HistorialCreditoRepository, NuevoEventoHistorial } from './creditoRepositories.js';
import { bigintToNumber, dateToIso } from './sqlMappers.js';

interface EventoHistorialRow {
  id: string;
  tipoEvento: TipoEventoHistorial;
  estadoAnterior: EstadoCredito | null;
  estadoNuevo: EstadoCredito;
  detalleCambios: string | null;
  observacion: string | null;
  usuarioNombre: string;
  usuarioEmail: string;
  fechaEvento: Date;
}

/** Acceso a dbo.HistorialCredito (auditoría de solo inserción). */
export class SqlServerHistorialCreditoRepository implements HistorialCreditoRepository {
  constructor(private readonly database: DatabaseClient) {}

  async registrar(transaction: DatabaseTransaction, evento: NuevoEventoHistorial): Promise<void> {
    await this.database
      .createRequest(transaction)
      .input('creditoId', sql.BigInt, evento.creditoId)
      .input('tipoEvento', sql.VarChar(20), evento.tipoEvento)
      .input('estadoAnterior', sql.VarChar(20), evento.estadoAnterior)
      .input('estadoNuevo', sql.VarChar(20), evento.estadoNuevo)
      .input(
        'detalleCambios',
        sql.NVarChar(sql.MAX),
        evento.detalleCambios ? JSON.stringify(evento.detalleCambios) : null,
      )
      .input('observacion', sql.NVarChar(500), evento.observacion ?? null)
      .input('usuarioId', sql.Int, evento.usuarioId).query(`
        INSERT INTO dbo.HistorialCredito
          (creditoId, tipoEvento, estadoAnterior, estadoNuevo, detalleCambios, observacion, usuarioId)
        VALUES
          (@creditoId, @tipoEvento, @estadoAnterior, @estadoNuevo, @detalleCambios, @observacion, @usuarioId);
      `);
  }

  async listarPorCredito(creditoId: number): Promise<EventoHistorial[]> {
    const result = await this.database.createRequest().input('creditoId', sql.BigInt, creditoId)
      .query<EventoHistorialRow>(`
        SELECT h.id, h.tipoEvento, h.estadoAnterior, h.estadoNuevo, h.detalleCambios,
               h.observacion, u.nombreCompleto AS usuarioNombre, u.email AS usuarioEmail,
               h.fechaEvento
        FROM dbo.HistorialCredito AS h
        INNER JOIN dbo.Usuarios AS u ON u.id = h.usuarioId
        WHERE h.creditoId = @creditoId
        ORDER BY h.fechaEvento, h.id;
      `);

    return result.recordset.map((row) => ({
      id: bigintToNumber(row.id),
      tipoEvento: row.tipoEvento,
      estadoAnterior: row.estadoAnterior,
      estadoNuevo: row.estadoNuevo,
      detalleCambios: row.detalleCambios
        ? (JSON.parse(row.detalleCambios) as Record<string, unknown>)
        : null,
      observacion: row.observacion,
      usuario: { nombre: row.usuarioNombre, email: row.usuarioEmail },
      fechaEvento: dateToIso(row.fechaEvento),
    }));
  }
}
