import sql from 'mssql';

import type {
  DatabaseClient,
  DatabaseTransaction,
} from '../../../infrastructure/database/DatabaseClient.js';
import type { AsociadoRegistrado, AsociadoRepository } from './creditoRepositories.js';
import { bigintToNumber } from './sqlMappers.js';

/** Acceso a dbo.Asociados. */
export class SqlServerAsociadoRepository implements AsociadoRepository {
  constructor(private readonly database: DatabaseClient) {}

  /**
   * UPDLOCK + HOLDLOCK: si el asociado no existe, bloquea el "hueco" de esa
   * identificación en el índice único. Dos solicitudes simultáneas del mismo
   * asociado nuevo no pueden crearlo dos veces: la segunda espera y luego lo
   * encuentra ya creado.
   */
  async buscarPorIdentificacionParaActualizar(
    transaction: DatabaseTransaction,
    identificacion: string,
  ): Promise<AsociadoRegistrado | null> {
    const result = await this.database
      .createRequest(transaction)
      .input('identificacion', sql.VarChar(20), identificacion).query<{
      id: string;
      identificacion: string;
      nombreCompleto: string;
    }>(`
        SELECT id, identificacion, nombreCompleto
        FROM dbo.Asociados WITH (UPDLOCK, HOLDLOCK)
        WHERE identificacion = @identificacion;
      `);

    const row = result.recordset[0];
    return row
      ? {
          id: bigintToNumber(row.id),
          identificacion: row.identificacion,
          nombreCompleto: row.nombreCompleto,
        }
      : null;
  }

  async insertar(
    transaction: DatabaseTransaction,
    asociado: { identificacion: string; nombreCompleto: string },
  ): Promise<number> {
    const result = await this.database
      .createRequest(transaction)
      .input('identificacion', sql.VarChar(20), asociado.identificacion)
      .input('nombreCompleto', sql.NVarChar(150), asociado.nombreCompleto).query<{ id: string }>(`
        INSERT INTO dbo.Asociados (identificacion, nombreCompleto)
        OUTPUT INSERTED.id
        VALUES (@identificacion, @nombreCompleto);
      `);

    const insertado = result.recordset[0];
    if (!insertado) {
      throw new Error('SQL Server no devolvió el id del asociado insertado.');
    }
    return bigintToNumber(insertado.id);
  }
}
