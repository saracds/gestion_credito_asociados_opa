/* =============================================================================
   validar_restricciones.sql
   -----------------------------------------------------------------------------
   Propósito : Verificar que la base de datos rechaza los datos inválidos y
               protege los invariantes del dominio (defensa en profundidad).
   Requiere  : 000, 001, 002, 900_datos_demo.sql y
               seguridad/usuarios_aplicacion.sql aplicados.
   Seguridad : Cada caso se ejecuta dentro de una transacción que SIEMPRE se
               revierte: el script no modifica los datos.
   Salida    : Tabla con el resultado de cada caso (OK / FALLÓ).

   Códigos de error esperados:
     547   Violación de restricción CHECK o FOREIGN KEY
     2601  Violación de índice único (control de duplicados)
     271   Intento de modificar una columna calculada
     50001-50004  Triggers de integridad de Creditos
     50010 Trigger de inmutabilidad del historial
     229   Permiso denegado sobre el objeto (usuarios de la aplicación)
     230   Permiso denegado sobre la columna (usuarios de la aplicación)
     262   Permiso denegado para crear objetos (DDL)
   ============================================================================= */

USE CreditosOPA;
GO
SET NOCOUNT ON;
GO

IF OBJECT_ID('tempdb..#Resultados') IS NOT NULL DROP TABLE #Resultados;
CREATE TABLE #Resultados
(
    numero     INT IDENTITY(1,1),
    caso       NVARCHAR(200),
    resultado  NVARCHAR(400)
);
GO

/* Ejecuta @sentencia y verifica que falle con @errorEsperado. */
CREATE PROCEDURE #ProbarQueFalla
    @caso          NVARCHAR(200),
    @sentencia     NVARCHAR(MAX),
    @errorEsperado INT
AS
BEGIN
    BEGIN TRY
        BEGIN TRANSACTION;
        EXEC sp_executesql @sentencia;
        ROLLBACK TRANSACTION;
        INSERT INTO #Resultados (caso, resultado) VALUES (@caso, N'FALLÓ: la sentencia no produjo error');
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        INSERT INTO #Resultados (caso, resultado)
        VALUES (@caso,
                CASE WHEN ERROR_NUMBER() = @errorEsperado
                     THEN N'OK (error ' + CAST(ERROR_NUMBER() AS NVARCHAR(10)) + N')'
                     ELSE N'FALLÓ: error ' + CAST(ERROR_NUMBER() AS NVARCHAR(10)) + N' - ' + ERROR_MESSAGE()
                END);
    END CATCH
END;
GO

/* Ejecuta @sentencia y verifica que funcione (casos que SÍ deben permitirse). */
CREATE PROCEDURE #ProbarQueFunciona
    @caso       NVARCHAR(200),
    @sentencia  NVARCHAR(MAX)
AS
BEGIN
    BEGIN TRY
        BEGIN TRANSACTION;
        EXEC sp_executesql @sentencia;
        ROLLBACK TRANSACTION;
        INSERT INTO #Resultados (caso, resultado) VALUES (@caso, N'OK');
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        INSERT INTO #Resultados (caso, resultado)
        VALUES (@caso, N'FALLÓ: error ' + CAST(ERROR_NUMBER() AS NVARCHAR(10)) + N' - ' + ERROR_MESSAGE());
    END CATCH
END;
GO

/* Ejecuta @sentencia COMO el usuario de la aplicación indicado (EXECUTE AS
   USER) y verifica el resultado: @errorEsperado NULL = debe permitirse.
   Las sentencias usan WHERE 1 = 0: SQL Server valida los permisos antes de
   leer filas, así que la prueba no depende de los datos ni modifica nada. */
CREATE PROCEDURE #ProbarPermiso
    @usuario       SYSNAME,
    @caso          NVARCHAR(200),
    @sentencia     NVARCHAR(MAX),
    @errorEsperado INT = NULL
AS
BEGIN
    DECLARE @error INT = NULL, @mensaje NVARCHAR(2048) = NULL;
    BEGIN TRY
        BEGIN TRANSACTION;
        EXECUTE AS USER = @usuario;
        EXEC sp_executesql @sentencia;
        REVERT;
        ROLLBACK TRANSACTION;
    END TRY
    BEGIN CATCH
        SELECT @error = ERROR_NUMBER(), @mensaje = ERROR_MESSAGE();
        -- Volver a la identidad original antes de seguir (si el error ocurrió
        -- mientras se suplantaba al usuario).
        IF USER_NAME() <> N'dbo' REVERT;
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    END CATCH

    INSERT INTO #Resultados (caso, resultado)
    VALUES (@usuario + N': ' + @caso,
            CASE
                WHEN @errorEsperado IS NULL AND @error IS NULL THEN N'OK'
                WHEN @errorEsperado IS NULL THEN N'FALLÓ: error ' + CAST(@error AS NVARCHAR(10)) + N' - ' + @mensaje
                WHEN @error = @errorEsperado THEN N'OK (error ' + CAST(@error AS NVARCHAR(10)) + N')'
                WHEN @error IS NULL THEN N'FALLÓ: la sentencia se permitió'
                ELSE N'FALLÓ: error ' + CAST(@error AS NVARCHAR(10)) + N' - ' + @mensaje
            END);
END;
GO

/* Plantilla de INSERT válido; cada caso reemplaza los marcadores {...}. */
DECLARE @insertBase NVARCHAR(MAX) = N'
    INSERT INTO dbo.Creditos (asociadoId, tipoCreditoCodigo, formaPagoCodigo, valorSolicitado,
                              tasaInteresMensual, numeroCuotas, creadoPorUsuarioId)
    VALUES ((SELECT id FROM dbo.Asociados WHERE identificacion = ''{IDENTIFICACION}''),
            ''{TIPO}'', ''NOMINA'', {VALOR}, {TASA}, {CUOTAS},
            (SELECT id FROM dbo.Usuarios WHERE email = N''analista@opa.local''));';

DECLARE @sentencia NVARCHAR(MAX);

/* ---------- Reglas de negocio sobre valores ---------- */
SET @sentencia = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(@insertBase,
    '{IDENTIFICACION}', '71234567'), '{TIPO}', 'LIBRE_INVERSION'), '{VALOR}', '0'), '{TASA}', '1.5'), '{CUOTAS}', '12');
EXEC #ProbarQueFalla N'Rechaza valorSolicitado = 0', @sentencia, 547;

SET @sentencia = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(@insertBase,
    '{IDENTIFICACION}', '71234567'), '{TIPO}', 'LIBRE_INVERSION'), '{VALOR}', '1000000'), '{TASA}', '-0.5'), '{CUOTAS}', '12');
EXEC #ProbarQueFalla N'Rechaza tasaInteres negativa', @sentencia, 547;

SET @sentencia = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(@insertBase,
    '{IDENTIFICACION}', '71234567'), '{TIPO}', 'LIBRE_INVERSION'), '{VALOR}', '1000000'), '{TASA}', '1.5'), '{CUOTAS}', '0');
EXEC #ProbarQueFalla N'Rechaza numeroCuotas = 0', @sentencia, 547;

SET @sentencia = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(@insertBase,
    '{IDENTIFICACION}', '71234567'), '{TIPO}', 'NO_EXISTE'), '{VALOR}', '1000000'), '{TASA}', '1.5'), '{CUOTAS}', '12');
EXEC #ProbarQueFalla N'Rechaza tipo de crédito inexistente (FK)', @sentencia, 547;

/* ---------- Control de duplicados ---------- */
-- Carlos Restrepo no tiene LIBRE_INVERSION: el primero entra, el segundo se rechaza.
SET @sentencia = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(@insertBase,
    '{IDENTIFICACION}', '71234567'), '{TIPO}', 'LIBRE_INVERSION'), '{VALOR}', '5000000'), '{TASA}', '1.5'), '{CUOTAS}', '24');
SET @sentencia = @sentencia + @sentencia;
EXEC #ProbarQueFalla N'Rechaza segundo crédito activo del mismo tipo para el asociado', @sentencia, 2601;

-- Juan Pérez tiene LIBRE_INVERSION pero DESEMBOLSADO (no activo): debe permitirse.
SET @sentencia = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(@insertBase,
    '{IDENTIFICACION}', '1001234567'), '{TIPO}', 'LIBRE_INVERSION'), '{VALOR}', '5000000'), '{TASA}', '1.5'), '{CUOTAS}', '24');
EXEC #ProbarQueFunciona N'Permite nuevo crédito si el anterior del mismo tipo no está activo', @sentencia;

-- Carlos Restrepo tiene VEHICULO activo: debe permitir un tipo distinto.
SET @sentencia = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(@insertBase,
    '{IDENTIFICACION}', '71234567'), '{TIPO}', 'EDUCACION'), '{VALOR}', '2000000'), '{TASA}', '0.9'), '{CUOTAS}', '12');
EXEC #ProbarQueFunciona N'Permite crédito activo de un tipo diferente', @sentencia;

/* ---------- Número de crédito ---------- */
EXEC #ProbarQueFalla N'Rechaza modificar numeroCredito (columna calculada)',
    N'UPDATE dbo.Creditos SET numeroCredito = ''CR-0000-000000'' WHERE id = (SELECT MIN(id) FROM dbo.Creditos);', 271;

INSERT INTO #Resultados (caso, resultado)
SELECT N'Formato de numeroCredito CR-AAAA-NNNNNN',
       CASE WHEN COUNT(*) = 0 THEN N'OK' ELSE N'FALLÓ: ' + CAST(COUNT(*) AS NVARCHAR(10)) + N' números con formato inválido' END
FROM dbo.Creditos
WHERE numeroCredito NOT LIKE 'CR-[0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9]%';

/* ---------- Inmutabilidad (trigger de Creditos) ---------- */
EXEC #ProbarQueFalla N'Rechaza cambiar el asociado de un crédito',
    N'UPDATE dbo.Creditos SET asociadoId = (SELECT MAX(id) FROM dbo.Asociados)
      WHERE id = (SELECT TOP 1 id FROM dbo.Creditos WHERE tipoCreditoCodigo = ''VEHICULO'' AND estado = ''SOLICITADO'');', 50001;
-- Se usa el crédito VEHICULO porque el asociado destino no tiene uno activo de ese
-- tipo; así el caso prueba el trigger y no el índice de duplicados.

EXEC #ProbarQueFalla N'Rechaza cambiar condiciones de un crédito APROBADO',
    N'UPDATE dbo.Creditos SET valorSolicitado = valorSolicitado + 1
      WHERE id = (SELECT TOP 1 id FROM dbo.Creditos WHERE estado = ''APROBADO'');', 50002;

EXEC #ProbarQueFunciona N'Permite cambiar condiciones de un crédito EN_ESTUDIO',
    N'UPDATE dbo.Creditos SET valorSolicitado = valorSolicitado + 1
      WHERE id = (SELECT TOP 1 id FROM dbo.Creditos WHERE estado = ''EN_ESTUDIO'');';

EXEC #ProbarQueFalla N'Rechaza mover un crédito en estado final (DESEMBOLSADO)',
    N'UPDATE dbo.Creditos SET estado = ''EN_ESTUDIO''
      WHERE id = (SELECT TOP 1 id FROM dbo.Creditos WHERE estado = ''DESEMBOLSADO'');', 50003;

EXEC #ProbarQueFalla N'Rechaza borrado lógico de un crédito que no está en SOLICITADO',
    N'UPDATE dbo.Creditos SET eliminado = 1, fechaEliminacion = SYSUTCDATETIME(),
          eliminadoPorUsuarioId = (SELECT id FROM dbo.Usuarios WHERE email = N''admin@opa.local'')
      WHERE id = (SELECT TOP 1 id FROM dbo.Creditos WHERE estado = ''EN_ESTUDIO'');', 547;

/* ---------- Auditoría inmutable ---------- */
EXEC #ProbarQueFalla N'Rechaza modificar el historial',
    N'UPDATE dbo.HistorialCredito SET observacion = N''alterado'' WHERE id = (SELECT MIN(id) FROM dbo.HistorialCredito);', 50010;

EXEC #ProbarQueFalla N'Rechaza eliminar el historial',
    N'DELETE FROM dbo.HistorialCredito WHERE id = (SELECT MIN(id) FROM dbo.HistorialCredito);', 50010;

/* ---------- Webhook ---------- */
EXEC #ProbarQueFalla N'Rechaza payload de webhook que no es JSON',
    N'INSERT INTO dbo.WebhookNotificaciones (tipoEvento, creditoId, urlDestino, payload)
      VALUES (''credito.creado'', (SELECT MIN(id) FROM dbo.Creditos), N''https://x.test'', N''no-es-json'');', 547;

/* ---------- Mínimo privilegio: login de la API ---------- */
-- Lo que su código necesita
EXEC #ProbarPermiso N'app_creditos_api', N'Lee créditos con asociado y catálogos',
    N'SELECT c.id FROM dbo.Creditos c JOIN dbo.Asociados a ON a.id = c.asociadoId
      JOIN dbo.TiposCredito t ON t.codigo = c.tipoCreditoCodigo WHERE 1 = 0;';
EXEC #ProbarPermiso N'app_creditos_api', N'Lee usuarios para autenticar',
    N'SELECT passwordHash FROM dbo.Usuarios WHERE 1 = 0;';
EXEC #ProbarPermiso N'app_creditos_api', N'Actualiza condiciones, estado y borrado lógico',
    N'UPDATE dbo.Creditos SET valorSolicitado = valorSolicitado, estado = estado, eliminado = eliminado,
          fechaActualizacion = fechaActualizacion, actualizadoPorUsuarioId = actualizadoPorUsuarioId WHERE 1 = 0;';
EXEC #ProbarPermiso N'app_creditos_api', N'Registra historial',
    N'INSERT INTO dbo.HistorialCredito (creditoId, tipoEvento, estadoNuevo, usuarioId)
      SELECT creditoId, tipoEvento, estadoNuevo, usuarioId FROM dbo.HistorialCredito WHERE 1 = 0;';
EXEC #ProbarPermiso N'app_creditos_api', N'Reprograma una notificación fallida',
    N'UPDATE dbo.WebhookNotificaciones SET estado = estado, maxIntentos = maxIntentos WHERE 1 = 0;';

-- Lo que NO debe poder hacer
EXEC #ProbarPermiso N'app_creditos_api', N'No puede cambiar el asociado de un crédito',
    N'UPDATE dbo.Creditos SET asociadoId = asociadoId WHERE 1 = 0;', 230;
EXEC #ProbarPermiso N'app_creditos_api', N'No puede cambiar la fecha de solicitud',
    N'UPDATE dbo.Creditos SET fechaSolicitud = fechaSolicitud WHERE 1 = 0;', 230;
EXEC #ProbarPermiso N'app_creditos_api', N'No puede borrar créditos físicamente',
    N'DELETE FROM dbo.Creditos WHERE 1 = 0;', 229;
EXEC #ProbarPermiso N'app_creditos_api', N'No puede borrar asociados',
    N'DELETE FROM dbo.Asociados WHERE 1 = 0;', 229;
EXEC #ProbarPermiso N'app_creditos_api', N'No puede modificar el historial',
    N'UPDATE dbo.HistorialCredito SET observacion = observacion WHERE 1 = 0;', 229;
EXEC #ProbarPermiso N'app_creditos_api', N'No puede cambiar roles de usuarios',
    N'UPDATE dbo.Usuarios SET rol = rol WHERE 1 = 0;', 229;
EXEC #ProbarPermiso N'app_creditos_api', N'No puede crear usuarios',
    N'INSERT INTO dbo.Usuarios (email, nombreCompleto, passwordHash, rol) SELECT email, nombreCompleto, passwordHash, rol FROM dbo.Usuarios WHERE 1 = 0;', 229;
EXEC #ProbarPermiso N'app_creditos_api', N'No puede cambiar el destino de un webhook',
    N'UPDATE dbo.WebhookNotificaciones SET urlDestino = urlDestino WHERE 1 = 0;', 230;
EXEC #ProbarPermiso N'app_creditos_api', N'No puede falsificar intentos de envío',
    N'INSERT INTO dbo.WebhookIntentos (notificacionId, numeroIntento, exitoso) SELECT id, 1, 1 FROM dbo.WebhookNotificaciones WHERE 1 = 0;', 229;
EXEC #ProbarPermiso N'app_creditos_api', N'No puede leer el control de versiones del esquema',
    N'SELECT * FROM dbo.VersionesEsquema WHERE 1 = 0;', 229;
EXEC #ProbarPermiso N'app_creditos_api', N'No puede crear tablas',
    N'CREATE TABLE dbo.TablaIntrusa (id INT);', 262;

/* ---------- Mínimo privilegio: login del worker ---------- */
-- Misma forma que WebhookOutboxRepository.reclamarPendientes (UPDATE directo).
EXEC #ProbarPermiso N'app_creditos_worker', N'Toma eventos pendientes (UPDATE directo, como el worker)',
    N'UPDATE dbo.WebhookNotificaciones WITH (ROWLOCK, READPAST)
      SET estado = ''ENVIANDO'', bloqueadoHasta = DATEADD(SECOND, 60, SYSUTCDATETIME())
      OUTPUT INSERTED.id, INSERTED.eventId, INSERTED.tipoEvento, INSERTED.urlDestino,
             INSERTED.payload, INSERTED.intentos, INSERTED.maxIntentos
      WHERE id IN (SELECT TOP (10) id FROM dbo.WebhookNotificaciones WITH (UPDLOCK, READPAST, ROWLOCK)
                   WHERE 1 = 0 ORDER BY proximoIntento);';
-- Documenta por qué el worker NO actualiza a través de una CTE: con permisos
-- por columna, SQL Server exige UPDATE sobre la tabla completa (error 229).
EXEC #ProbarPermiso N'app_creditos_worker', N'UPDATE a través de una CTE exige permiso sobre toda la tabla',
    N'WITH candidatos AS (SELECT TOP (10) * FROM dbo.WebhookNotificaciones WHERE 1 = 0 ORDER BY proximoIntento)
      UPDATE candidatos SET estado = ''ENVIANDO'';', 229;
EXEC #ProbarPermiso N'app_creditos_worker', N'Registra el resultado del envío',
    N'UPDATE dbo.WebhookNotificaciones SET intentos = intentos, ultimoCodigoHttp = ultimoCodigoHttp,
          ultimoError = ultimoError, fechaEnvio = fechaEnvio, proximoIntento = proximoIntento WHERE 1 = 0;';
EXEC #ProbarPermiso N'app_creditos_worker', N'Registra intentos',
    N'INSERT INTO dbo.WebhookIntentos (notificacionId, numeroIntento, exitoso) SELECT id, 1, 1 FROM dbo.WebhookNotificaciones WHERE 1 = 0;';
EXEC #ProbarPermiso N'app_creditos_worker', N'No puede leer créditos',
    N'SELECT id FROM dbo.Creditos WHERE 1 = 0;', 229;
EXEC #ProbarPermiso N'app_creditos_worker', N'No puede leer usuarios ni sus claves',
    N'SELECT passwordHash FROM dbo.Usuarios WHERE 1 = 0;', 229;
EXEC #ProbarPermiso N'app_creditos_worker', N'No puede redirigir notificaciones a otro servidor',
    N'UPDATE dbo.WebhookNotificaciones SET urlDestino = urlDestino WHERE 1 = 0;', 230;
EXEC #ProbarPermiso N'app_creditos_worker', N'No puede alterar el contenido de la notificación',
    N'UPDATE dbo.WebhookNotificaciones SET payload = payload WHERE 1 = 0;', 230;
EXEC #ProbarPermiso N'app_creditos_worker', N'No puede ampliar sus propios reintentos',
    N'UPDATE dbo.WebhookNotificaciones SET maxIntentos = maxIntentos WHERE 1 = 0;', 230;
EXEC #ProbarPermiso N'app_creditos_worker', N'No puede borrar notificaciones',
    N'DELETE FROM dbo.WebhookNotificaciones WHERE 1 = 0;', 229;

/* ---------- Resultado ---------- */
SELECT numero, caso, resultado FROM #Resultados ORDER BY numero;

SELECT
    SUM(CASE WHEN resultado LIKE N'OK%' THEN 1 ELSE 0 END) AS casosOk,
    SUM(CASE WHEN resultado LIKE N'FALLÓ%' THEN 1 ELSE 0 END) AS casosFallidos
FROM #Resultados;
GO

DROP PROCEDURE #ProbarQueFalla;
DROP PROCEDURE #ProbarQueFunciona;
DROP PROCEDURE #ProbarPermiso;
GO
