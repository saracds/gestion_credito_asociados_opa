import sql from 'mssql';

import type {
  DatabaseClient,
  DatabaseTransaction,
} from '../../infrastructure/database/DatabaseClient.js';
import type { PoliticaTipoCredito } from '../creditos/domain/politicaCredito.js';

export interface TipoCreditoCatalogo extends PoliticaTipoCredito {
  descripcion: string | null;
  activo: boolean;
}

export interface FormaPagoCatalogo {
  codigo: string;
  nombre: string;
  descripcion: string | null;
  activo: boolean;
}

export interface CatalogoRepository {
  buscarTipoCredito(
    codigo: string,
    transaction?: DatabaseTransaction,
  ): Promise<TipoCreditoCatalogo | null>;
  buscarFormaPago(
    codigo: string,
    transaction?: DatabaseTransaction,
  ): Promise<FormaPagoCatalogo | null>;
  listarTiposCreditoActivos(): Promise<TipoCreditoCatalogo[]>;
  listarFormasPagoActivas(): Promise<FormaPagoCatalogo[]>;
}

const COLUMNAS_TIPO_CREDITO = `
  codigo, nombre, descripcion, valorMinimo, valorMaximo, cuotasMaximas, tasaMaximaMensual, activo`;

/** Acceso a los catálogos dbo.TiposCredito y dbo.FormasPago. */
export class SqlServerCatalogoRepository implements CatalogoRepository {
  constructor(private readonly database: DatabaseClient) {}

  async buscarTipoCredito(
    codigo: string,
    transaction?: DatabaseTransaction,
  ): Promise<TipoCreditoCatalogo | null> {
    const result = await this.database
      .createRequest(transaction)
      .input('codigo', sql.VarChar(30), codigo)
      .query<TipoCreditoCatalogo>(
        `SELECT ${COLUMNAS_TIPO_CREDITO} FROM dbo.TiposCredito WHERE codigo = @codigo;`,
      );
    return result.recordset[0] ?? null;
  }

  async buscarFormaPago(
    codigo: string,
    transaction?: DatabaseTransaction,
  ): Promise<FormaPagoCatalogo | null> {
    const result = await this.database
      .createRequest(transaction)
      .input('codigo', sql.VarChar(30), codigo)
      .query<FormaPagoCatalogo>(
        'SELECT codigo, nombre, descripcion, activo FROM dbo.FormasPago WHERE codigo = @codigo;',
      );
    return result.recordset[0] ?? null;
  }

  async listarTiposCreditoActivos(): Promise<TipoCreditoCatalogo[]> {
    const result = await this.database
      .createRequest()
      .query<TipoCreditoCatalogo>(
        `SELECT ${COLUMNAS_TIPO_CREDITO} FROM dbo.TiposCredito WHERE activo = 1 ORDER BY nombre;`,
      );
    return result.recordset;
  }

  async listarFormasPagoActivas(): Promise<FormaPagoCatalogo[]> {
    const result = await this.database
      .createRequest()
      .query<FormaPagoCatalogo>(
        'SELECT codigo, nombre, descripcion, activo FROM dbo.FormasPago WHERE activo = 1 ORDER BY nombre;',
      );
    return result.recordset;
  }
}
