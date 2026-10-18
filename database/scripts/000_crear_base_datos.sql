/* =============================================================================
   000_crear_base_datos.sql
   -----------------------------------------------------------------------------
   Propósito : Crear la base de datos del módulo de créditos y configurar
               opciones de concurrencia.
   Idempotente: Sí. Puede ejecutarse varias veces sin efectos secundarios.
   Ejecución : Se conecta a [master]. Compatible con SSMS, Azure Data Studio
               y sqlcmd (no usa directivas exclusivas de SQLCMD).
   ============================================================================= */

USE master;
GO

IF DB_ID(N'CreditosOPA') IS NULL
BEGIN
    /*
       Intercalación (collation) Modern_Spanish_CI_AS:
         - CI (Case Insensitive): 'juan perez' = 'JUAN PEREZ' en búsquedas.
         - AS (Accent Sensitive): conserva la diferencia entre 'Perez' y 'Pérez',
           importante para no confundir nombres de asociados.
         - Ordena correctamente la 'ñ' según reglas del español.
    */
    CREATE DATABASE CreditosOPA COLLATE Modern_Spanish_CI_AS;
END;
GO

/*
   READ_COMMITTED_SNAPSHOT ON
   --------------------------
   Por defecto en SQL Server, una lectura (SELECT) se bloquea mientras otra
   transacción modifica la misma fila. Con esta opción, las lecturas ven la
   última versión confirmada (row versioning en tempdb) y no bloquean ni son
   bloqueadas por escrituras.
*/
IF EXISTS (
    SELECT 1
    FROM sys.databases
    WHERE name = N'CreditosOPA'
      AND is_read_committed_snapshot_on = 0
)
BEGIN
    ALTER DATABASE CreditosOPA SET READ_COMMITTED_SNAPSHOT ON WITH ROLLBACK IMMEDIATE;
END;
GO

USE CreditosOPA;
GO

/*
   Tabla de control de versiones del esquema
   -----------------------------------------
   Cada script versionado (001, 002, ...) registra aquí su ejecución.
   Así cada script sabe si ya fue aplicado y no se ejecuta dos veces.
*/
IF OBJECT_ID(N'dbo.VersionesEsquema', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.VersionesEsquema
    (
        version          VARCHAR(10)   NOT NULL,
        descripcion      NVARCHAR(200) NOT NULL,
        fechaAplicacion  DATETIME2(3)  NOT NULL
            CONSTRAINT DF_VersionesEsquema_fechaAplicacion DEFAULT (SYSUTCDATETIME()),

        CONSTRAINT PK_VersionesEsquema PRIMARY KEY (version)
    );
END;
GO
