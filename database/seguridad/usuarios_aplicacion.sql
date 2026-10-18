/* =============================================================================
   usuarios_aplicacion.sql
   -----------------------------------------------------------------------------
   Propósito : Crear los logins con los que se conectan la API y el worker de
               webhooks, cada uno con el MÍNIMO privilegio que su código usa.
               Así ninguno de los dos se conecta como "sa".
   Requiere  : 000, 001 y 002 aplicados.
   Ejecución : ejecutar-scripts.sh lo aplica en CADA arranque de db-init,
               después de las migraciones, con estas variables de sqlcmd:
                 CLAVE_API     contraseña de app_creditos_api
                 CLAVE_WORKER  contraseña de app_creditos_worker

   Por qué NO es una migración numerada :
   una migración se aplica una sola vez; los permisos son un ESTADO DESEADO.
   Este script se puede ejecutar siempre: crea lo que falta, actualiza las
   contraseñas (permite rotarlas cambiando el .env) y vuelve a otorgar
   exactamente los permisos de esta lista. El script es la única fuente de
   verdad de quién puede hacer qué.

   -------------------------------------------------------------------------
   Matriz de permisos (derivada de las consultas SQL de api/src)
   -------------------------------------------------------------------------
   Tabla                  rol_api_creditos               rol_worker_webhooks
   ---------------------  -----------------------------  ---------------------------
   Usuarios               SELECT                         -
   TiposCredito           SELECT                         -
   FormasPago             SELECT                         -
   Asociados              SELECT, INSERT                 -
   Creditos               SELECT, INSERT,                -
                          UPDATE solo en 11 columnas
   HistorialCredito       SELECT, INSERT                 -
   WebhookNotificaciones  SELECT, INSERT,                SELECT,
                          UPDATE (reprogramar)           UPDATE (resultado del envío)
   WebhookIntentos        SELECT                         INSERT
   VersionesEsquema       -                              -
   Todas                  DENY DELETE                    DENY DELETE
   ============================================================================= */

USE master;
GO
SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

/* ---------------------------------------------------------------------------
   1. Logins de servidor (crear o actualizar contraseña)
   ---------------------------------------------------------------------------
   CHECK_POLICY = ON   : SQL Server exige la política de complejidad.
   CHECK_EXPIRATION = OFF: son cuentas de servicio; la rotación se hace desde
                         el .env / gestor de secretos, no por vencimiento (un
                         vencimiento silencioso tumbaría la aplicación).
   Las contraseñas llegan como variables de sqlcmd; ejecutar-scripts.sh
   rechaza comillas para que no puedan romper la sentencia.
   --------------------------------------------------------------------------- */
DECLARE @logins TABLE (nombre SYSNAME, clave NVARCHAR(128));
INSERT INTO @logins (nombre, clave) VALUES
    (N'app_creditos_api',    N'$(CLAVE_API)'),
    (N'app_creditos_worker', N'$(CLAVE_WORKER)');

DECLARE @nombre SYSNAME, @clave NVARCHAR(128), @sentencia NVARCHAR(MAX);
DECLARE cursor_logins CURSOR LOCAL FAST_FORWARD FOR SELECT nombre, clave FROM @logins;
OPEN cursor_logins;
FETCH NEXT FROM cursor_logins INTO @nombre, @clave;
WHILE @@FETCH_STATUS = 0
BEGIN
    IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = @nombre)
    BEGIN
        SET @sentencia = N'CREATE LOGIN ' + QUOTENAME(@nombre)
                       + N' WITH PASSWORD = ' + QUOTENAME(@clave, '''')
                       + N', DEFAULT_DATABASE = [CreditosOPA], CHECK_POLICY = ON, CHECK_EXPIRATION = OFF;';
        EXEC sys.sp_executesql @sentencia;
        PRINT N'✔ Login creado: ' + @nombre;
    END
    ELSE
    BEGIN
        -- Ya existe: se actualiza la contraseña (rotación) y se asegura que esté habilitado.
        SET @sentencia = N'ALTER LOGIN ' + QUOTENAME(@nombre)
                       + N' WITH PASSWORD = ' + QUOTENAME(@clave, '''')
                       + N', CHECK_POLICY = ON, CHECK_EXPIRATION = OFF; ALTER LOGIN '
                       + QUOTENAME(@nombre) + N' ENABLE;';
        EXEC sys.sp_executesql @sentencia;
        PRINT N'✔ Login actualizado: ' + @nombre;
    END;
    FETCH NEXT FROM cursor_logins INTO @nombre, @clave;
END;
CLOSE cursor_logins;
DEALLOCATE cursor_logins;
GO

USE CreditosOPA;
GO

/* ---------------------------------------------------------------------------
   2. Usuarios de base de datos, roles y permisos (en una sola transacción)
   ---------------------------------------------------------------------------
   Los roles se eliminan y se vuelven a crear en cada ejecución: así un
   permiso que se quite de este archivo desaparece también de la base. La
   transacción evita que, si la API está corriendo, exista un instante sin
   permisos o con permisos a medias.
   --------------------------------------------------------------------------- */
SET XACT_ABORT ON;
BEGIN TRANSACTION;

-- Usuarios: se crean si faltan; ALTER USER ... WITH LOGIN los vuelve a enlazar
-- con su login si la base se restauró desde un respaldo de otro servidor
-- (usuarios "huérfanos", con un SID distinto al del login).
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'app_creditos_api')
    CREATE USER app_creditos_api FOR LOGIN app_creditos_api WITH DEFAULT_SCHEMA = dbo;
ALTER USER app_creditos_api WITH LOGIN = app_creditos_api;

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'app_creditos_worker')
    CREATE USER app_creditos_worker FOR LOGIN app_creditos_worker WITH DEFAULT_SCHEMA = dbo;
ALTER USER app_creditos_worker WITH LOGIN = app_creditos_worker;

-- Roles: se recrean desde cero. Antes se retiran TODOS sus miembros, incluido
-- cualquiera agregado a mano fuera de este script (estado deseado).
DECLARE @retirarMiembros NVARCHAR(MAX) = N'';
SELECT @retirarMiembros += N'ALTER ROLE ' + QUOTENAME(rol.name)
                         + N' DROP MEMBER ' + QUOTENAME(miembro.name) + N';'
FROM sys.database_role_members AS rm
JOIN sys.database_principals   AS rol     ON rol.principal_id     = rm.role_principal_id
JOIN sys.database_principals   AS miembro ON miembro.principal_id = rm.member_principal_id
WHERE rol.name IN (N'rol_api_creditos', N'rol_worker_webhooks');
EXEC sys.sp_executesql @retirarMiembros;

IF DATABASE_PRINCIPAL_ID(N'rol_api_creditos')    IS NOT NULL DROP ROLE rol_api_creditos;
IF DATABASE_PRINCIPAL_ID(N'rol_worker_webhooks') IS NOT NULL DROP ROLE rol_worker_webhooks;

CREATE ROLE rol_api_creditos AUTHORIZATION dbo;
CREATE ROLE rol_worker_webhooks AUTHORIZATION dbo;

/* ----- API ----------------------------------------------------------------- */
-- Autenticación y catálogos: solo lectura.
GRANT SELECT ON dbo.Usuarios     TO rol_api_creditos;
GRANT SELECT ON dbo.TiposCredito TO rol_api_creditos;
GRANT SELECT ON dbo.FormasPago   TO rol_api_creditos;

-- Asociados: se registran al crear su primer crédito; nunca se modifican.
GRANT SELECT, INSERT ON dbo.Asociados TO rol_api_creditos;

-- Créditos: UPDATE solo de lo que la API cambia de verdad.
GRANT SELECT, INSERT ON dbo.Creditos TO rol_api_creditos;
GRANT UPDATE ON dbo.Creditos (
    -- Condiciones editables (PATCH, solo en SOLICITADO / EN_ESTUDIO)
    tipoCreditoCodigo, formaPagoCodigo, valorSolicitado, tasaInteresMensual, numeroCuotas,
    -- Cambio de estado
    estado,
    -- Auditoría de la última modificación
    fechaActualizacion, actualizadoPorUsuarioId,
    -- Borrado lógico
    eliminado, fechaEliminacion, eliminadoPorUsuarioId
) TO rol_api_creditos;

-- Historial: se agrega y se consulta; jamás se modifica.
GRANT SELECT, INSERT ON dbo.HistorialCredito TO rol_api_creditos;
DENY  UPDATE         ON dbo.HistorialCredito TO rol_api_creditos;

-- Outbox: la API encola el evento en la misma transacción del crédito, consulta
-- la traza y un ADMIN puede reprogramar una notificación fallida.
GRANT SELECT, INSERT ON dbo.WebhookNotificaciones TO rol_api_creditos;
GRANT UPDATE ON dbo.WebhookNotificaciones (estado, maxIntentos, proximoIntento, bloqueadoHasta)
    TO rol_api_creditos;
GRANT SELECT ON dbo.WebhookIntentos TO rol_api_creditos;

/* ----- Worker de webhooks -------------------------------------------------- */
-- Toma eventos pendientes y registra el resultado de cada envío. No ve
-- créditos, asociados ni usuarios.
GRANT SELECT ON dbo.WebhookNotificaciones TO rol_worker_webhooks;
GRANT UPDATE ON dbo.WebhookNotificaciones (
    estado, intentos, proximoIntento, bloqueadoHasta,
    ultimoCodigoHttp, ultimoError, fechaEnvio
) TO rol_worker_webhooks;
GRANT INSERT ON dbo.WebhookIntentos TO rol_worker_webhooks;
DENY  UPDATE ON dbo.WebhookIntentos TO rol_worker_webhooks;

/* ----- Prohibiciones explícitas para ambos -------------------------------- */
DENY DELETE ON SCHEMA::dbo TO rol_api_creditos;
DENY DELETE ON SCHEMA::dbo TO rol_worker_webhooks;

ALTER ROLE rol_api_creditos    ADD MEMBER app_creditos_api;
ALTER ROLE rol_worker_webhooks ADD MEMBER app_creditos_worker;

COMMIT TRANSACTION;
GO

/* ---------------------------------------------------------------------------
   3. Resumen para el log de db-init
   --------------------------------------------------------------------------- */
SELECT r.name                                      AS rol,
       p.state_desc                                AS tipo,
       p.permission_name                           AS permiso,
       CASE p.class WHEN 3 THEN N'(esquema ' + SCHEMA_NAME(p.major_id) + N')'
                    ELSE OBJECT_NAME(p.major_id) END    AS objeto,
       COALESCE(c.name, N'')                       AS columna
FROM sys.database_permissions AS p
JOIN sys.database_principals  AS r ON r.principal_id = p.grantee_principal_id
LEFT JOIN sys.columns         AS c ON c.object_id = p.major_id AND c.column_id = p.minor_id
WHERE r.name IN (N'rol_api_creditos', N'rol_worker_webhooks')
ORDER BY r.name, objeto, permiso, columna;
GO

PRINT N'✔ Usuarios de aplicación configurados con mínimo privilegio.';
GO
