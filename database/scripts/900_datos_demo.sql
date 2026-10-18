/* =============================================================================
   900_datos_demo.sql
   -----------------------------------------------------------------------------
   Propósito : Cargar usuarios y datos de DEMOSTRACIÓN para evaluar la prueba:
               asociados, créditos en todos los estados, su historial y la
               traza de notificaciones del webhook.

   ⚠ SOLO PARA DESARROLLO / EVALUACIÓN. NUNCA EN PRODUCCIÓN.
     - Crea usuarios con contraseñas conocidas (documentadas en el README).
     - Por eso NO usa la numeración 00X de las migraciones: el ejecutor de
       scripts solo lo corre cuando la variable SEED_DEMO=true.
     - En producción el primer usuario ADMIN se crea con un proceso de
       aprovisionamiento seguro, con contraseña generada y entregada por
       un canal seguro.

   Usuarios de demostración (hash bcrypt, costo 10):
     admin@opa.local     / Admin123*     -> ADMIN
     analista@opa.local  / Analista123*  -> ANALISTA
     consulta@opa.local  / Consulta123*  -> CONSULTA

   Requiere  : 001_esquema.sql y 002_catalogos.sql
   Idempotente: Sí (control por dbo.VersionesEsquema, versión 'DEMO').
   Estrategia: inserciones basadas en conjuntos (set-based) con variables
               de tabla y MERGE ... OUTPUT para mapear claves de demo a ids
               reales, en lugar de recorrer fila por fila.
   ============================================================================= */

USE CreditosOPA;
GO

IF EXISTS (SELECT 1 FROM dbo.VersionesEsquema WHERE version = 'DEMO')
BEGIN
    RAISERROR(N'Los datos de demostración ya fueron cargados. Se omite la ejecución.', 0, 1) WITH NOWAIT;
    SET NOEXEC ON;
END;
GO

SET XACT_ABORT ON;   -- Ante cualquier error se revierte toda la transacción.
BEGIN TRANSACTION;

/* -----------------------------------------------------------------------------
   1. Usuarios
   ----------------------------------------------------------------------------- */
INSERT INTO dbo.Usuarios (email, nombreCompleto, passwordHash, rol)
VALUES
    (N'admin@opa.local',    N'Administradora del Sistema', '$2b$10$/OXBjJh2b558X500jlzwv.TDGdrgg6xI7gVgIKapMIVpZdKZQP6n.', 'ADMIN'),
    (N'analista@opa.local', N'Analista de Crédito',        '$2b$10$obhL0tTnG0i64sDIMFacWOxmBeuYT.JU3penfNpp1pFP3LBB6OtDe', 'ANALISTA'),
    (N'consulta@opa.local', N'Usuario de Consulta',        '$2b$10$R3rDrvzJ0.Usp8GXqX6uv.V6wGXOYGiV9ggqUgmKkSnIMeeRF7t.W', 'CONSULTA');

DECLARE @idAdmin    INT = (SELECT id FROM dbo.Usuarios WHERE email = N'admin@opa.local');
DECLARE @idAnalista INT = (SELECT id FROM dbo.Usuarios WHERE email = N'analista@opa.local');
DECLARE @ahora      DATETIME2(3) = SYSUTCDATETIME();
DECLARE @urlWebhook NVARCHAR(500) = N'https://sistema-externo.com/webhooks/creditos';

/* -----------------------------------------------------------------------------
   2. Asociados
   ----------------------------------------------------------------------------- */
INSERT INTO dbo.Asociados (identificacion, nombreCompleto)
VALUES
    ('1001234567', N'Juan Pérez'),
    ('43567890',   N'María Fernanda Gómez'),
    ('71234567',   N'Carlos Andrés Restrepo'),
    ('1036789012', N'Luisa Fernanda Ospina'),
    ('98765432',   N'Jorge Iván Martínez');

/* -----------------------------------------------------------------------------
   3. Créditos de demostración
   Se cubren todos los estados. Casos que vale la pena mostrar en la evaluación:
     * Juan Pérez (clave 1 y 2): tiene un LIBRE_INVERSION ya DESEMBOLSADO y un
       EDUCACION activo -> la regla de duplicados permite tipos distintos.
     * Luisa Ospina (clave 6 y 7): su LIBRE_INVERSION fue CANCELADO, por eso
       pudo solicitar otro LIBRE_INVERSION -> la regla solo aplica a activos.
   ----------------------------------------------------------------------------- */
DECLARE @CreditosDemo TABLE
(
    clave              INT           NOT NULL PRIMARY KEY,
    identificacion     VARCHAR(20)   NOT NULL,
    tipoCreditoCodigo  VARCHAR(30)   NOT NULL,
    formaPagoCodigo    VARCHAR(30)   NOT NULL,
    valorSolicitado    DECIMAL(18,2) NOT NULL,
    tasaInteresMensual DECIMAL(7,4)  NOT NULL,
    numeroCuotas       SMALLINT      NOT NULL,
    estadoFinal        VARCHAR(20)   NOT NULL,
    diasAtras          INT           NOT NULL,
    horasUltimoCambio  INT           NOT NULL DEFAULT (0)
);

INSERT INTO @CreditosDemo
    (clave, identificacion, tipoCreditoCodigo, formaPagoCodigo,     valorSolicitado, tasaInteresMensual, numeroCuotas, estadoFinal,    diasAtras)
VALUES
    (1,     '1001234567',   'LIBRE_INVERSION', 'NOMINA',             15000000.00,     1.5000,             36,           'DESEMBOLSADO', 60),
    (2,     '1001234567',   'EDUCACION',       'CAJA',                4000000.00,     0.9000,             12,           'EN_ESTUDIO',    5),
    (3,     '43567890',     'VIVIENDA',        'NOMINA',            180000000.00,     1.1000,            180,           'APROBADO',     20),
    (4,     '43567890',     'CALAMIDAD',       'NOMINA',              3000000.00,     0.8000,             12,           'RECHAZADO',    40),
    (5,     '71234567',     'VEHICULO',        'DEBITO_AUTOMATICO',  65000000.00,     1.4500,             60,           'SOLICITADO',    2),
    (6,     '1036789012',   'LIBRE_INVERSION', 'TRANSFERENCIA',       8000000.00,     1.7000,             24,           'CANCELADO',    30),
    (7,     '1036789012',   'LIBRE_INVERSION', 'NOMINA',             10000000.00,     1.6000,             36,           'SOLICITADO',    1),
    (8,     '98765432',     'EDUCACION',       'NOMINA',             12000000.00,     0.9500,             24,           'DESEMBOLSADO', 90),
    (9,     '98765432',     'LIBRE_INVERSION', 'CAJA',               20000000.00,     1.8000,             48,           'EN_ESTUDIO',    7);

/* Transiciones de estado que recorrió cada crédito (respetan la máquina de
   estados del ADR-006). horasDespues = horas desde la fecha de solicitud. */
DECLARE @Transiciones TABLE
(
    clave          INT           NOT NULL,
    paso           TINYINT       NOT NULL,
    estadoAnterior VARCHAR(20)   NOT NULL,
    estadoNuevo    VARCHAR(20)   NOT NULL,
    horasDespues   INT           NOT NULL,
    observacion    NVARCHAR(500) NOT NULL,
    usuarioId      INT           NOT NULL,
    PRIMARY KEY (clave, paso)
);

INSERT INTO @Transiciones (clave, paso, estadoAnterior, estadoNuevo, horasDespues, observacion, usuarioId)
VALUES
    (1, 1, 'SOLICITADO', 'EN_ESTUDIO',   24, N'Se inicia el estudio del crédito.',                          @idAnalista),
    (1, 2, 'EN_ESTUDIO', 'APROBADO',     72, N'Capacidad de pago verificada con desprendibles de nómina.',  @idAnalista),
    (1, 3, 'APROBADO',   'DESEMBOLSADO',120, N'Desembolso a la cuenta de ahorros del asociado.',            @idAdmin),
    (2, 1, 'SOLICITADO', 'EN_ESTUDIO',   24, N'Se inicia el estudio del crédito.',                          @idAnalista),
    (3, 1, 'SOLICITADO', 'EN_ESTUDIO',   24, N'Se solicita avalúo del inmueble.',                           @idAnalista),
    (3, 2, 'EN_ESTUDIO', 'APROBADO',     96, N'Avalúo y estudio de títulos aprobados.',                     @idAnalista),
    (4, 1, 'SOLICITADO', 'EN_ESTUDIO',   24, N'Se inicia el estudio del crédito.',                          @idAnalista),
    (4, 2, 'EN_ESTUDIO', 'RECHAZADO',    48, N'Capacidad de pago insuficiente por endeudamiento vigente.',  @idAnalista),
    (6, 1, 'SOLICITADO', 'CANCELADO',    48, N'Cancelado a solicitud del asociado.',                        @idAnalista),
    (8, 1, 'SOLICITADO', 'EN_ESTUDIO',   24, N'Se inicia el estudio del crédito.',                          @idAnalista),
    (8, 2, 'EN_ESTUDIO', 'APROBADO',     48, N'Aprobado por comité de crédito.',                            @idAnalista),
    (8, 3, 'APROBADO',   'DESEMBOLSADO', 96, N'Giro directo a la institución educativa.',                   @idAdmin),
    (9, 1, 'SOLICITADO', 'EN_ESTUDIO',   24, N'Se inicia el estudio del crédito.',                          @idAnalista);

-- La fecha de actualización de cada crédito es la de su último cambio de estado.
UPDATE demo
SET horasUltimoCambio = ultimo.maxHoras
FROM @CreditosDemo AS demo
INNER JOIN (
    SELECT clave, MAX(horasDespues) AS maxHoras
    FROM @Transiciones
    GROUP BY clave
) AS ultimo ON ultimo.clave = demo.clave;

/* MERGE con condición siempre falsa (ON 1 = 0) = INSERT masivo que, a
   diferencia de INSERT ... SELECT, permite devolver en OUTPUT columnas del
   origen (la clave de demo) junto al id generado. */
DECLARE @MapaCreditos TABLE (clave INT NOT NULL PRIMARY KEY, creditoId BIGINT NOT NULL);

MERGE INTO dbo.Creditos AS destino
USING (
    SELECT
        demo.clave,
        asociado.id                                          AS asociadoId,
        demo.tipoCreditoCodigo,
        demo.formaPagoCodigo,
        demo.valorSolicitado,
        demo.tasaInteresMensual,
        demo.numeroCuotas,
        demo.estadoFinal,
        DATEADD(DAY, -demo.diasAtras, @ahora)                AS fechaSolicitud,
        DATEADD(HOUR, demo.horasUltimoCambio,
                DATEADD(DAY, -demo.diasAtras, @ahora))       AS fechaActualizacion
    FROM @CreditosDemo AS demo
    INNER JOIN dbo.Asociados AS asociado ON asociado.identificacion = demo.identificacion
) AS origen
ON 1 = 0
WHEN NOT MATCHED THEN
    INSERT (fechaSolicitud, asociadoId, tipoCreditoCodigo, formaPagoCodigo, valorSolicitado,
            tasaInteresMensual, numeroCuotas, estado, fechaActualizacion,
            creadoPorUsuarioId, actualizadoPorUsuarioId)
    VALUES (origen.fechaSolicitud, origen.asociadoId, origen.tipoCreditoCodigo, origen.formaPagoCodigo,
            origen.valorSolicitado, origen.tasaInteresMensual, origen.numeroCuotas, origen.estadoFinal,
            origen.fechaActualizacion, @idAnalista,
            CASE WHEN origen.fechaActualizacion > origen.fechaSolicitud THEN @idAnalista END)
OUTPUT origen.clave, inserted.id INTO @MapaCreditos (clave, creditoId);

/* -----------------------------------------------------------------------------
   4. Historial
   ----------------------------------------------------------------------------- */
-- 4.1 Evento de creación con la fotografía de las condiciones iniciales.
INSERT INTO dbo.HistorialCredito
    (creditoId, tipoEvento, estadoAnterior, estadoNuevo, detalleCambios, observacion, usuarioId, fechaEvento)
SELECT
    credito.id,
    'CREACION',
    NULL,
    'SOLICITADO',
    (
        SELECT
            credito.valorSolicitado    AS valorSolicitado,
            credito.tasaInteresMensual AS tasaInteres,
            credito.numeroCuotas       AS numeroCuotas,
            credito.tipoCreditoCodigo  AS tipoCredito,
            credito.formaPagoCodigo    AS formaPago
        FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
    ),
    N'Solicitud de crédito registrada.',
    credito.creadoPorUsuarioId,
    credito.fechaSolicitud
FROM @MapaCreditos AS mapa
INNER JOIN dbo.Creditos AS credito ON credito.id = mapa.creditoId;

-- 4.2 Cambios de estado.
INSERT INTO dbo.HistorialCredito
    (creditoId, tipoEvento, estadoAnterior, estadoNuevo, observacion, usuarioId, fechaEvento)
SELECT
    mapa.creditoId,
    'CAMBIO_ESTADO',
    transicion.estadoAnterior,
    transicion.estadoNuevo,
    transicion.observacion,
    transicion.usuarioId,
    DATEADD(HOUR, transicion.horasDespues, credito.fechaSolicitud)
FROM @Transiciones AS transicion
INNER JOIN @MapaCreditos AS mapa    ON mapa.clave = transicion.clave
INNER JOIN dbo.Creditos  AS credito ON credito.id = mapa.creditoId
ORDER BY transicion.clave, transicion.paso;

/* -----------------------------------------------------------------------------
   5. Traza del webhook (evento credito.creado de cada crédito)
   Todos quedaron ENVIADOS. El crédito clave 3 muestra un reintento: el primer
   intento recibió 503 (servicio no disponible) y el segundo fue exitoso.
   ----------------------------------------------------------------------------- */
DECLARE @Eventos TABLE (clave INT NOT NULL PRIMARY KEY, creditoId BIGINT NOT NULL, eventId UNIQUEIDENTIFIER NOT NULL DEFAULT (NEWID()));

INSERT INTO @Eventos (clave, creditoId)
SELECT clave, creditoId FROM @MapaCreditos;

INSERT INTO dbo.WebhookNotificaciones
    (eventId, tipoEvento, creditoId, urlDestino, payload, estado, intentos,
     proximoIntento, ultimoCodigoHttp, fechaCreacion, fechaEnvio)
SELECT
    evento.eventId,
    'credito.creado',
    credito.id,
    @urlWebhook,
    (
        SELECT
            'credito.creado'                                          AS [event],
            LOWER(CAST(evento.eventId AS VARCHAR(36)))                AS [eventId],
            CONVERT(VARCHAR(23), credito.fechaSolicitud, 126) + 'Z'   AS [timestamp],
            credito.id                                                AS [data.id],
            credito.numeroCredito                                     AS [data.numeroCredito],
            asociado.identificacion                                   AS [data.identificacionAsociado],
            credito.valorSolicitado                                   AS [data.valorSolicitado],
            'SOLICITADO'                                              AS [data.estado]
        FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
    ),
    'ENVIADO',
    CASE WHEN evento.clave = 3 THEN 2 ELSE 1 END,
    credito.fechaSolicitud,
    200,
    credito.fechaSolicitud,
    DATEADD(SECOND, CASE WHEN evento.clave = 3 THEN 31 ELSE 1 END, credito.fechaSolicitud)
FROM @Eventos AS evento
INNER JOIN dbo.Creditos  AS credito  ON credito.id  = evento.creditoId
INNER JOIN dbo.Asociados AS asociado ON asociado.id = credito.asociadoId;

-- Intento fallido del crédito clave 3.
INSERT INTO dbo.WebhookIntentos (notificacionId, numeroIntento, fechaIntento, exitoso, codigoHttp, duracionMs, error)
SELECT notificacion.id, 1, DATEADD(SECOND, 1, notificacion.fechaCreacion), 0, 503, 2150,
       N'El sistema externo respondió 503 Service Unavailable.'
FROM dbo.WebhookNotificaciones AS notificacion
INNER JOIN @Eventos AS evento ON evento.eventId = notificacion.eventId
WHERE evento.clave = 3;

-- Intento exitoso de cada notificación (el último intento).
INSERT INTO dbo.WebhookIntentos (notificacionId, numeroIntento, fechaIntento, exitoso, codigoHttp, duracionMs, error)
SELECT notificacion.id, notificacion.intentos, notificacion.fechaEnvio, 1, 200, 180, NULL
FROM dbo.WebhookNotificaciones AS notificacion
INNER JOIN @Eventos AS evento ON evento.eventId = notificacion.eventId;

INSERT INTO dbo.VersionesEsquema (version, descripcion)
VALUES ('DEMO', N'Datos de demostración: usuarios, asociados, créditos, historial y traza de webhook');

COMMIT TRANSACTION;
GO

SET NOEXEC OFF;
GO
