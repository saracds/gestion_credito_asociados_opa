import sql from 'mssql';

import type {
  DatabaseClient,
  DatabaseTransaction,
} from '../../../infrastructure/database/DatabaseClient.js';
import type {
  CampoOrdenamiento,
  CondicionesCredito,
  CreditoConAsociado,
  CriteriosBusquedaCreditos,
  ResumenEstado,
} from '../domain/credito.types.js';
import { ESTADOS_ACTIVOS, type EstadoCredito } from '../domain/estadoCredito.js';
import type { CreditoRepository, NuevoCredito, OpcionesLectura } from './creditoRepositories.js';
import { bigintToNumber, dateToIso, escapeLikePattern, rowversionToHex } from './sqlMappers.js';

interface CreditoRow {
  id: string;
  numeroCredito: string;
  asociadoId: string;
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
  fechaSolicitud: Date;
  fechaActualizacion: Date;
  versionFila: Buffer;
}

/** Columnas comunes a todas las lecturas de créditos, con los nombres de la API. */
const COLUMNAS_CREDITO = `
  c.id,
  c.numeroCredito,
  c.asociadoId,
  a.identificacion          AS identificacionAsociado,
  a.nombreCompleto          AS nombreAsociado,
  c.tipoCreditoCodigo       AS tipoCredito,
  tc.nombre                 AS tipoCreditoNombre,
  c.valorSolicitado,
  c.tasaInteresMensual      AS tasaInteres,
  c.numeroCuotas,
  c.formaPagoCodigo         AS formaPago,
  fp.nombre                 AS formaPagoNombre,
  c.estado,
  c.fechaSolicitud,
  c.fechaActualizacion,
  c.versionFila`;

const JOINS_CREDITO = `
  INNER JOIN dbo.Asociados    AS a  ON a.id      = c.asociadoId
  INNER JOIN dbo.TiposCredito AS tc ON tc.codigo = c.tipoCreditoCodigo
  INNER JOIN dbo.FormasPago   AS fp ON fp.codigo = c.formaPagoCodigo`;

/**
 * Lista blanca de columnas para ORDER BY. El nombre de columna no puede ir
 * como parámetro en SQL, así que se elige de este mapa: el texto del usuario
 * nunca llega a la consulta (previene inyección SQL).
 */
const COLUMNAS_ORDENAMIENTO: Readonly<Record<CampoOrdenamiento, string>> = {
  fechaSolicitud: 'c.fechaSolicitud',
  valorSolicitado: 'c.valorSolicitado',
  numeroCredito: 'c.id', // el número se deriva del id: mismo orden, usando la PK
  estado: 'c.estado',
  nombreAsociado: 'a.nombreCompleto',
};

/**
 * Campos editables -> columna y tipo SQL. Solo lo que está aquí puede
 * actualizarse; cualquier otro campo es imposible de modificar por esta vía.
 */
const COLUMNAS_EDITABLES: Readonly<
  Record<keyof CondicionesCredito, { columna: string; tipo: sql.ISqlType | (() => sql.ISqlType) }>
> = {
  tipoCredito: { columna: 'tipoCreditoCodigo', tipo: sql.VarChar(30) },
  valorSolicitado: { columna: 'valorSolicitado', tipo: sql.Decimal(18, 2) },
  tasaInteres: { columna: 'tasaInteresMensual', tipo: sql.Decimal(7, 4) },
  numeroCuotas: { columna: 'numeroCuotas', tipo: sql.SmallInt },
  formaPago: { columna: 'formaPagoCodigo', tipo: sql.VarChar(30) },
};

function mapearCredito(row: CreditoRow): CreditoConAsociado {
  return {
    id: bigintToNumber(row.id),
    numeroCredito: row.numeroCredito,
    asociadoId: bigintToNumber(row.asociadoId),
    identificacionAsociado: row.identificacionAsociado,
    nombreAsociado: row.nombreAsociado,
    tipoCredito: row.tipoCredito,
    tipoCreditoNombre: row.tipoCreditoNombre,
    valorSolicitado: row.valorSolicitado,
    tasaInteres: row.tasaInteres,
    numeroCuotas: row.numeroCuotas,
    formaPago: row.formaPago,
    formaPagoNombre: row.formaPagoNombre,
    estado: row.estado,
    fechaSolicitud: dateToIso(row.fechaSolicitud),
    fechaActualizacion: dateToIso(row.fechaActualizacion),
    version: rowversionToHex(row.versionFila),
  };
}

/** Implementación del repositorio de créditos sobre SQL Server. */
export class SqlServerCreditoRepository implements CreditoRepository {
  constructor(private readonly database: DatabaseClient) {}

  async buscarPorId(
    id: number,
    { transaction, bloquearParaActualizar = false }: OpcionesLectura = {},
  ): Promise<CreditoConAsociado | null> {
    const lockHint = bloquearParaActualizar ? 'WITH (UPDLOCK, ROWLOCK)' : '';

    const result = await this.database.createRequest(transaction).input('id', sql.BigInt, id)
      .query<CreditoRow>(`
        SELECT ${COLUMNAS_CREDITO}
        FROM dbo.Creditos AS c ${lockHint}
        ${JOINS_CREDITO}
        WHERE c.id = @id
          AND c.eliminado = 0;
      `);

    const row = result.recordset[0];
    return row ? mapearCredito(row) : null;
  }

  /**
   * Listado con filtros, búsqueda, ordenamiento y paginación.
   * Se ejecutan dos consultas en paralelo: el conteo total (para calcular las
   * páginas) y la página solicitada (OFFSET / FETCH).
   */
  async buscar(
    criterios: CriteriosBusquedaCreditos,
  ): Promise<{ items: CreditoConAsociado[]; totalItems: number }> {
    const countRequest = this.database.createRequest();
    const pageRequest = this.database.createRequest();
    const whereClause = this.aplicarFiltros(countRequest, criterios);
    this.aplicarFiltros(pageRequest, criterios);

    const columnaOrden = COLUMNAS_ORDENAMIENTO[criterios.ordenarPor];
    const direccion = criterios.direccion === 'asc' ? 'ASC' : 'DESC';

    pageRequest
      .input('offset', sql.Int, (criterios.page - 1) * criterios.pageSize)
      .input('pageSize', sql.Int, criterios.pageSize);

    const [countResult, pageResult] = await Promise.all([
      countRequest.query<{ totalItems: number }>(`
        SELECT COUNT(*) AS totalItems
        FROM dbo.Creditos AS c
        INNER JOIN dbo.Asociados AS a ON a.id = c.asociadoId
        ${whereClause};
      `),
      pageRequest.query<CreditoRow>(`
        SELECT ${COLUMNAS_CREDITO}
        FROM dbo.Creditos AS c
        ${JOINS_CREDITO}
        ${whereClause}
        ORDER BY ${columnaOrden} ${direccion}, c.id ${direccion}
        OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;
      `),
    ]);

    return {
      items: pageResult.recordset.map(mapearCredito),
      totalItems: countResult.recordset[0]?.totalItems ?? 0,
    };
  }

  async obtenerResumenPorEstado(): Promise<ResumenEstado[]> {
    const result = await this.database.createRequest().query<ResumenEstado>(`
      SELECT estado, COUNT(*) AS cantidad, SUM(valorSolicitado) AS valorTotal
      FROM dbo.Creditos
      WHERE eliminado = 0
      GROUP BY estado;
    `);
    return result.recordset;
  }

  /**
   * ¿El asociado ya tiene un crédito activo de este tipo?
   * UPDLOCK + HOLDLOCK bloquea también el "rango" consultado: si dos
   * solicitudes iguales llegan al mismo tiempo, la segunda espera a que la
   * primera termine y entonces sí encuentra el crédito (evita la condición de
   * carrera). El índice único filtrado es la última barrera.
   */
  async existeCreditoActivo(
    transaction: DatabaseTransaction,
    asociadoId: number,
    tipoCredito: string,
    excluirCreditoId?: number,
  ): Promise<boolean> {
    const request = this.database
      .createRequest(transaction)
      .input('asociadoId', sql.BigInt, asociadoId)
      .input('tipoCredito', sql.VarChar(30), tipoCredito);

    const estadosActivos = ESTADOS_ACTIVOS.map((estado, index) => {
      request.input(`estadoActivo${index}`, sql.VarChar(20), estado);
      return `@estadoActivo${index}`;
    }).join(', ');

    let exclusion = '';
    if (excluirCreditoId !== undefined) {
      request.input('excluirCreditoId', sql.BigInt, excluirCreditoId);
      exclusion = 'AND id <> @excluirCreditoId';
    }

    const result = await request.query<{ existe: number }>(`
      SELECT TOP (1) 1 AS existe
      FROM dbo.Creditos WITH (UPDLOCK, HOLDLOCK)
      WHERE asociadoId = @asociadoId
        AND tipoCreditoCodigo = @tipoCredito
        AND estado IN (${estadosActivos})
        AND eliminado = 0
        ${exclusion};
    `);

    return result.recordset.length > 0;
  }

  async insertar(transaction: DatabaseTransaction, nuevoCredito: NuevoCredito): Promise<number> {
    const { asociadoId, condiciones, usuarioId } = nuevoCredito;

    // OUTPUT devuelve el id generado en el mismo INSERT (sin una segunda consulta).
    // Se usa una variable de tabla porque OUTPUT directo no se permite en tablas con triggers.
    const result = await this.database
      .createRequest(transaction)
      .input('asociadoId', sql.BigInt, asociadoId)
      .input('tipoCredito', sql.VarChar(30), condiciones.tipoCredito)
      .input('formaPago', sql.VarChar(30), condiciones.formaPago)
      .input('valorSolicitado', sql.Decimal(18, 2), condiciones.valorSolicitado)
      .input('tasaInteres', sql.Decimal(7, 4), condiciones.tasaInteres)
      .input('numeroCuotas', sql.SmallInt, condiciones.numeroCuotas)
      .input('usuarioId', sql.Int, usuarioId).query<{ id: string }>(`
        DECLARE @insertado TABLE (id BIGINT);

        INSERT INTO dbo.Creditos
          (asociadoId, tipoCreditoCodigo, formaPagoCodigo, valorSolicitado,
           tasaInteresMensual, numeroCuotas, creadoPorUsuarioId)
        OUTPUT INSERTED.id INTO @insertado
        VALUES
          (@asociadoId, @tipoCredito, @formaPago, @valorSolicitado,
           @tasaInteres, @numeroCuotas, @usuarioId);

        SELECT id FROM @insertado;
      `);

    const insertado = result.recordset[0];
    if (!insertado) {
      throw new Error('SQL Server no devolvió el id del crédito insertado.');
    }
    return bigintToNumber(insertado.id);
  }

  async actualizarCondiciones(
    transaction: DatabaseTransaction,
    creditoId: number,
    cambios: Partial<CondicionesCredito>,
    usuarioId: number,
  ): Promise<void> {
    const request = this.database
      .createRequest(transaction)
      .input('id', sql.BigInt, creditoId)
      .input('usuarioId', sql.Int, usuarioId);

    const asignaciones: string[] = [];
    for (const campo of Object.keys(COLUMNAS_EDITABLES) as (keyof CondicionesCredito)[]) {
      const valor = cambios[campo];
      if (valor === undefined) continue;
      const { columna, tipo } = COLUMNAS_EDITABLES[campo];
      request.input(campo, tipo, valor);
      asignaciones.push(`${columna} = @${campo}`);
    }

    if (asignaciones.length === 0) return;

    await request.query(`
      UPDATE dbo.Creditos
      SET ${asignaciones.join(', ')},
          fechaActualizacion      = SYSUTCDATETIME(),
          actualizadoPorUsuarioId = @usuarioId
      WHERE id = @id;
    `);
  }

  async actualizarEstado(
    transaction: DatabaseTransaction,
    creditoId: number,
    estadoNuevo: EstadoCredito,
    usuarioId: number,
  ): Promise<void> {
    await this.database
      .createRequest(transaction)
      .input('id', sql.BigInt, creditoId)
      .input('estado', sql.VarChar(20), estadoNuevo)
      .input('usuarioId', sql.Int, usuarioId).query(`
        UPDATE dbo.Creditos
        SET estado                  = @estado,
            fechaActualizacion      = SYSUTCDATETIME(),
            actualizadoPorUsuarioId = @usuarioId
        WHERE id = @id;
      `);
  }

  async eliminarLogicamente(
    transaction: DatabaseTransaction,
    creditoId: number,
    usuarioId: number,
  ): Promise<void> {
    await this.database
      .createRequest(transaction)
      .input('id', sql.BigInt, creditoId)
      .input('usuarioId', sql.Int, usuarioId).query(`
        UPDATE dbo.Creditos
        SET eliminado             = 1,
            fechaEliminacion      = SYSUTCDATETIME(),
            eliminadoPorUsuarioId = @usuarioId,
            fechaActualizacion    = SYSUTCDATETIME()
        WHERE id = @id;
      `);
  }

  /** Construye el WHERE con parámetros. Devuelve el texto y registra los valores en la consulta. */
  private aplicarFiltros(request: sql.Request, criterios: CriteriosBusquedaCreditos): string {
    const condiciones = ['c.eliminado = 0'];

    if (criterios.estado) {
      request.input('estado', sql.VarChar(20), criterios.estado);
      condiciones.push('c.estado = @estado');
    }

    if (criterios.identificacionAsociado) {
      request.input('identificacion', sql.VarChar(20), criterios.identificacionAsociado);
      condiciones.push('a.identificacion = @identificacion');
    }

    if (criterios.tipoCredito) {
      request.input('tipoCredito', sql.VarChar(30), criterios.tipoCredito);
      condiciones.push('c.tipoCreditoCodigo = @tipoCredito');
    }

    if (criterios.busqueda) {
      const textoEscapado = escapeLikePattern(criterios.busqueda);
      // Parámetro VARCHAR para columnas VARCHAR: si fuera NVARCHAR, SQL Server
      // convertiría la columna en cada fila y no podría usar el índice.
      request
        .input('busquedaPrefijo', sql.VarChar(110), `${textoEscapado.toUpperCase()}%`)
        .input('busquedaContiene', sql.NVarChar(110), `%${textoEscapado}%`);
      // - Número de crédito e identificación: por prefijo (aprovecha índices).
      // - Nombre: por contenido e insensible a tildes (COLLATE ..._CI_AI), así
      //   "perez" encuentra "Pérez". La base es sensible a tildes (_AS) para
      //   distinguir nombres; solo esta búsqueda las ignora.
      condiciones.push(`(
        c.numeroCredito  LIKE @busquedaPrefijo ESCAPE '\\'
        OR a.identificacion LIKE @busquedaPrefijo ESCAPE '\\'
        OR a.nombreCompleto COLLATE Modern_Spanish_CI_AI LIKE @busquedaContiene ESCAPE '\\'
      )`);
    }

    return `WHERE ${condiciones.join(' AND ')}`;
  }
}
