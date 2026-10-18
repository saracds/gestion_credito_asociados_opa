import sql from 'mssql';

import type { CommonEnvironment } from '../../config/environment.js';
import type { Logger } from '../../shared/logging/logger.js';

export type DatabaseConfig = Pick<
  CommonEnvironment,
  | 'DB_HOST'
  | 'DB_PORT'
  | 'DB_NAME'
  | 'DB_USER'
  | 'DB_PASSWORD'
  | 'DB_ENCRYPT'
  | 'DB_TRUST_SERVER_CERTIFICATE'
  | 'DB_POOL_MAX'
>;

/** Una transacción en curso. Los repositorios crean sus consultas a partir de ella. */
export type DatabaseTransaction = sql.Transaction;

/**
 * Lo único que los servicios necesitan saber de la base de datos: cómo agrupar
 * operaciones en una transacción. Depender de esta interfaz (y no de
 * DatabaseClient) permite probar los servicios con una implementación falsa.
 */
export interface TransactionRunner {
  runInTransaction<TResult>(
    work: (transaction: DatabaseTransaction) => Promise<TResult>,
  ): Promise<TResult>;
}

const CONNECTION_RETRY = {
  maxAttempts: 10,
  initialDelayMs: 1_000,
  maxDelayMs: 10_000,
} as const;

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

/**
 * Punto único de acceso a SQL Server.
 *
 * Responsabilidades:
 *  1. Mantener un POOL de conexiones: abrir una conexión TCP + TLS + login por
 *     cada petición sería lento; el pool las reutiliza.
 *  2. Conectarse con reintentos al arrancar, porque en Docker o Kubernetes la
 *     base de datos puede tardar unos segundos más que la API en estar lista.
 *  3. Ofrecer `runInTransaction`, que garantiza COMMIT si todo sale bien y
 *     ROLLBACK ante cualquier error. Es la base del outbox del webhook: crédito,
 *     historial y evento se guardan juntos o no se guarda ninguno.
 *
 * Todas las consultas de los repositorios deben ser parametrizadas
 * (`request.input(...)`), nunca concatenando texto: así se evita la inyección SQL.
 */
export class DatabaseClient implements TransactionRunner {
  private connectionPool: sql.ConnectionPool | null = null;

  constructor(
    private readonly config: DatabaseConfig,
    private readonly logger: Logger,
  ) {}

  /** Abre el pool reintentando con espera exponencial: 1 s, 2 s, 4 s, ... hasta 10 s. */
  async connect(): Promise<void> {
    for (let attempt = 1; attempt <= CONNECTION_RETRY.maxAttempts; attempt++) {
      try {
        const pool = new sql.ConnectionPool(this.buildDriverConfig());
        pool.on('error', (error: unknown) =>
          this.logger.error({ err: error }, 'Error en el pool de conexiones'),
        );
        this.connectionPool = await pool.connect();
        this.logger.info(
          { host: this.config.DB_HOST, database: this.config.DB_NAME },
          'Conectado a SQL Server',
        );
        return;
      } catch (error) {
        if (attempt === CONNECTION_RETRY.maxAttempts) {
          throw new Error(`No fue posible conectar a SQL Server tras ${attempt} intentos.`, {
            cause: error,
          });
        }
        const delayMs = Math.min(
          CONNECTION_RETRY.initialDelayMs * 2 ** (attempt - 1),
          CONNECTION_RETRY.maxDelayMs,
        );
        this.logger.warn(
          { attempt, nextRetryInMs: delayMs, err: error },
          'SQL Server aún no está disponible; se reintentará',
        );
        await wait(delayMs);
      }
    }
  }

  /** Pool activo. Falla de forma explícita si se usa antes de `connect()`. */
  get pool(): sql.ConnectionPool {
    if (!this.connectionPool) {
      throw new Error(
        'DatabaseClient no está conectado. Llame a connect() al iniciar la aplicación.',
      );
    }
    return this.connectionPool;
  }

  /**
   * Crea una consulta parametrizable.
   * - Con `transaction`: la consulta participa de esa transacción.
   * - Sin ella: usa una conexión libre del pool (lecturas independientes).
   */
  createRequest(transaction?: DatabaseTransaction): sql.Request {
    return transaction ? new sql.Request(transaction) : this.pool.request();
  }

  /**
   * Ejecuta `work` dentro de una transacción.
   *
   * @example
   *   await database.runInTransaction(async (transaction) => {
   *     const creditoId = await creditoRepository.insert(transaction, datos);
   *     await historialRepository.insert(transaction, creditoId, evento);
   *   });
   */
  async runInTransaction<TResult>(
    work: (transaction: DatabaseTransaction) => Promise<TResult>,
  ): Promise<TResult> {
    const transaction = new sql.Transaction(this.pool);

    // SQL Server aborta la transacción por sí mismo ante ciertos errores (p. ej.
    // un THROW dentro de un trigger). En ese caso no se debe pedir otro ROLLBACK.
    let abortedByServer = false;
    transaction.on('rollback', (aborted: boolean) => {
      abortedByServer = aborted;
    });

    await transaction.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);

    try {
      const result = await work(transaction);
      await transaction.commit();
      return result;
    } catch (error) {
      if (!abortedByServer) {
        await this.rollbackSafely(transaction);
      }
      throw error;
    }
  }

  /** Verifica que la base de datos responde. Usado por el health check de disponibilidad. */
  async ping(): Promise<void> {
    await this.pool.request().query('SELECT 1 AS disponible');
  }

  /** Cierra el pool. Se llama en el apagado ordenado de la aplicación. */
  async close(): Promise<void> {
    if (this.connectionPool) {
      await this.connectionPool.close();
      this.connectionPool = null;
      this.logger.info('Conexión con SQL Server cerrada');
    }
  }

  private buildDriverConfig(): sql.config {
    return {
      server: this.config.DB_HOST,
      port: this.config.DB_PORT,
      database: this.config.DB_NAME,
      user: this.config.DB_USER,
      password: this.config.DB_PASSWORD,
      pool: {
        min: 0,
        max: this.config.DB_POOL_MAX,
        idleTimeoutMillis: 30_000,
      },
      connectionTimeout: 15_000,
      requestTimeout: 30_000,
      options: {
        encrypt: this.config.DB_ENCRYPT,
        trustServerCertificate: this.config.DB_TRUST_SERVER_CERTIFICATE,
        // Requerido por SQL Server para operar sobre índices filtrados y columnas calculadas.
        enableArithAbort: true,
        appName: 'creditos-opa-api',
      },
    };
  }

  /** Si el ROLLBACK falla (p. ej. conexión perdida) se registra sin ocultar el error original. */
  private async rollbackSafely(transaction: sql.Transaction): Promise<void> {
    try {
      await transaction.rollback();
    } catch (rollbackError) {
      this.logger.error({ err: rollbackError }, 'No fue posible revertir la transacción');
    }
  }
}
