/* =============================================================================
   001_esquema.sql
   -----------------------------------------------------------------------------
   Propósito : Crear el esquema del módulo de créditos: catálogos, usuarios,
               asociados, créditos, historial (auditoría) y outbox del webhook.
   Requiere  : 000_crear_base_datos.sql
   Idempotente: Sí. Si la versión '001' ya está en dbo.VersionesEsquema,
               el script entero se compila pero NO se ejecuta (SET NOEXEC ON).

   Convenciones de nombres
   -----------------------
     PK_<Tabla>                 Llave primaria
     FK_<Tabla>_<Referencia>    Llave foránea
     UQ_<Tabla>_<Columna>       Restricción de unicidad
     CK_<Tabla>_<Regla>         Restricción CHECK
     DF_<Tabla>_<Columna>       Valor por defecto
     IX_<Tabla>_<Columnas>      Índice no único
     UX_<Tabla>_<Regla>         Índice único (filtrado)
     TR_<Tabla>_<Regla>         Trigger

   Criterios transversales
   -----------------------
     * Dinero      : DECIMAL(18,2). Nunca FLOAT/REAL: son binarios aproximados
                     (0.1 + 0.2 <> 0.3) y generan descuadres contables.
     * Fechas      : DATETIME2(3) en UTC con SYSUTCDATETIME(). Precisión de
                     milisegundos y sin ambigüedad de zona horaria; la
                     conversión a hora de Colombia la hace el frontend.
     * Textos      : NVARCHAR para datos de personas (tildes, ñ).
                     VARCHAR para códigos técnicos ASCII (menos espacio).
     * Llaves      : Sustitutas IDENTITY para entidades transaccionales;
                     naturales (código) para catálogos pequeños y estables.
     * Borrado     : Nunca físico sobre créditos (información financiera).
   ============================================================================= */

USE CreditosOPA;
GO

IF EXISTS (SELECT 1 FROM dbo.VersionesEsquema WHERE version = '001')
BEGIN
    RAISERROR(N'La versión 001 ya fue aplicada. Se omite la ejecución.', 0, 1) WITH NOWAIT;
    SET NOEXEC ON;
END;
GO

/* =============================================================================
   1. CATÁLOGOS
   -----------------------------------------------------------------------------
   Decisión: tablas catálogo con FK (y no CHECK con lista fija) para tipo de
   crédito y forma de pago, porque son datos que el NEGOCIO amplía con el
   tiempo (nuevas líneas de crédito, nuevos convenios de pago) sin que eso deba
   implicar un cambio de esquema ni un despliegue.

   Llave natural (codigo):
     - Son catálogos pequeños cuyo código es estable e inmutable.
     - El código es lo que viaja en la API ("LIBRE_INVERSION"), así que la
       llave natural evita traducir código <-> id en cada operación.
     - Hace legibles las consultas y los datos sin necesidad de JOIN.
   ============================================================================= */

CREATE TABLE dbo.TiposCredito
(
    codigo              VARCHAR(30)    NOT NULL,
    nombre              NVARCHAR(100)  NOT NULL,
    descripcion         NVARCHAR(300)  NULL,

    /* Políticas del producto. Se validan en la capa de servicio porque son
       reglas de negocio configurables, no invariantes del dato. */
    valorMinimo         DECIMAL(18,2)  NOT NULL,
    valorMaximo         DECIMAL(18,2)  NOT NULL,
    cuotasMaximas       SMALLINT       NOT NULL,
    tasaMaximaMensual   DECIMAL(7,4)   NOT NULL,   -- % mensual, p. ej. 2.0000

    activo              BIT            NOT NULL CONSTRAINT DF_TiposCredito_activo DEFAULT (1),
    fechaCreacion       DATETIME2(3)   NOT NULL CONSTRAINT DF_TiposCredito_fechaCreacion DEFAULT (SYSUTCDATETIME()),

    CONSTRAINT PK_TiposCredito PRIMARY KEY (codigo),
    -- Códigos en MAYÚSCULAS_CON_GUION_BAJO. Se usa intercalación binaria para
    -- que el rango [A-Z] no acepte minúsculas (la BD es Case Insensitive).
    CONSTRAINT CK_TiposCredito_codigoFormato CHECK (codigo COLLATE Latin1_General_BIN NOT LIKE '%[^A-Z0-9_]%'),
    CONSTRAINT CK_TiposCredito_valorMinimo   CHECK (valorMinimo > 0),
    CONSTRAINT CK_TiposCredito_rangoValor    CHECK (valorMaximo >= valorMinimo),
    CONSTRAINT CK_TiposCredito_cuotasMaximas CHECK (cuotasMaximas > 0),
    CONSTRAINT CK_TiposCredito_tasaMaxima    CHECK (tasaMaximaMensual >= 0 AND tasaMaximaMensual <= 100)
);
GO

CREATE TABLE dbo.FormasPago
(
    codigo          VARCHAR(30)    NOT NULL,
    nombre          NVARCHAR(100)  NOT NULL,
    descripcion     NVARCHAR(300)  NULL,
    activo          BIT            NOT NULL CONSTRAINT DF_FormasPago_activo DEFAULT (1),
    fechaCreacion   DATETIME2(3)   NOT NULL CONSTRAINT DF_FormasPago_fechaCreacion DEFAULT (SYSUTCDATETIME()),

    CONSTRAINT PK_FormasPago PRIMARY KEY (codigo),
    CONSTRAINT CK_FormasPago_codigoFormato CHECK (codigo COLLATE Latin1_General_BIN NOT LIKE '%[^A-Z0-9_]%')
);
GO

/* =============================================================================
   2. USUARIOS
   -----------------------------------------------------------------------------
   Usuarios internos de la cooperativa que operan el sistema.
   El rol se modela con CHECK y NO como catálogo: a diferencia de los tipos de
   crédito, cada rol tiene comportamiento programado en el código
   (autorización), por lo que agregar un rol siempre implica un despliegue.
     ADMIN    : todo, incluido eliminar.
     ANALISTA : crear, editar y cambiar estado de créditos.
     CONSULTA : solo lectura.
   ============================================================================= */

CREATE TABLE dbo.Usuarios
(
    id              INT            IDENTITY(1,1) NOT NULL,
    email           NVARCHAR(254)  NOT NULL,   
    nombreCompleto  NVARCHAR(150)  NOT NULL,
    passwordHash    VARCHAR(100)   NOT NULL,    -- Hash bcrypt (60 caracteres). Nunca la clave en claro.
    rol             VARCHAR(20)    NOT NULL,
    activo          BIT            NOT NULL CONSTRAINT DF_Usuarios_activo DEFAULT (1),
    fechaCreacion   DATETIME2(3)   NOT NULL CONSTRAINT DF_Usuarios_fechaCreacion DEFAULT (SYSUTCDATETIME()),

    CONSTRAINT PK_Usuarios PRIMARY KEY (id),
    CONSTRAINT UQ_Usuarios_email UNIQUE (email),
    CONSTRAINT CK_Usuarios_rol   CHECK (rol IN ('ADMIN', 'ANALISTA', 'CONSULTA'))
);
GO

/* =============================================================================
   3. ASOCIADOS
   -----------------------------------------------------------------------------
   Se separa del crédito (normalización 3FN): un asociado puede tener muchos
   créditos y su nombre no debe repetirse ni divergir entre registros.
   La API sigue recibiendo identificacionAsociado/nombreAsociado; el servicio
   localiza o crea el asociado dentro de la misma transacción del crédito.
   ============================================================================= */

CREATE TABLE dbo.Asociados
(
    id                  BIGINT         IDENTITY(1,1) NOT NULL,
    identificacion      VARCHAR(20)    NOT NULL,   -- VARCHAR y no numérico: puede tener ceros a la izquierda o letras (pasaporte, CE)
    nombreCompleto      NVARCHAR(150)  NOT NULL,
    fechaCreacion       DATETIME2(3)   NOT NULL CONSTRAINT DF_Asociados_fechaCreacion      DEFAULT (SYSUTCDATETIME()),
    fechaActualizacion  DATETIME2(3)   NOT NULL CONSTRAINT DF_Asociados_fechaActualizacion DEFAULT (SYSUTCDATETIME()),

    CONSTRAINT PK_Asociados PRIMARY KEY (id),
    -- Un asociado = una identificación. Esta restricción crea además el índice
    -- que usa el filtro por identificación del listado de créditos.
    CONSTRAINT UQ_Asociados_identificacion UNIQUE (identificacion),
    CONSTRAINT CK_Asociados_identificacionFormato CHECK (
        LEN(identificacion) BETWEEN 5 AND 20
        AND identificacion COLLATE Latin1_General_BIN NOT LIKE '%[^0-9A-Z]%'
    ),
    CONSTRAINT CK_Asociados_nombreCompleto CHECK (LEN(LTRIM(RTRIM(nombreCompleto))) >= 3)
);
GO

-- Apoya la búsqueda por nombre cuando es por prefijo (LIKE 'Juan%').
CREATE INDEX IX_Asociados_nombreCompleto ON dbo.Asociados (nombreCompleto);
GO

/* =============================================================================
   4. CRÉDITOS
   ============================================================================= */

CREATE TABLE dbo.Creditos
(
    id                      BIGINT         IDENTITY(1,1) NOT NULL,
    -- BIGINT: con 500.000 créditos/mes, INT (2.147 millones) alcanza ~350 años,
    -- pero BIGINT elimina el riesgo en escenario multi-entidad por solo 4 bytes más.

    fechaSolicitud          DATETIME2(3)   NOT NULL CONSTRAINT DF_Creditos_fechaSolicitud DEFAULT (SYSUTCDATETIME()),

    /*
       numeroCredito: columna calculada PERSISTIDA a partir del id y del año de
       solicitud. Formato CR-AAAA-NNNNNN (p. ej. id 123 -> CR-2026-000123).
       Ventajas frente a generarlo en la aplicación o con un SEQUENCE aparte:
         * Se obtiene en el mismo INSERT, sin consulta adicional ni condiciones
           de carrera entre instancias de la API.
         * Es inmutable por construcción: una columna calculada no admite UPDATE.
         * Es único porque el id es único (además se declara UNIQUE).
       El consecutivo es global (no reinicia por año); el año es informativo.
       Si supera 999.999 se muestran todos los dígitos sin truncar.
    */
    numeroCredito AS (
        CAST(
            'CR-' + CAST(YEAR(fechaSolicitud) AS CHAR(4)) + '-' +
            CASE
                WHEN id < 1000000 THEN RIGHT('000000' + CAST(id AS VARCHAR(19)), 6)
                ELSE CAST(id AS VARCHAR(19))
            END
        AS VARCHAR(30))
    ) PERSISTED NOT NULL,

    asociadoId              BIGINT         NOT NULL,
    tipoCreditoCodigo       VARCHAR(30)    NOT NULL,
    formaPagoCodigo         VARCHAR(30)    NOT NULL,

    valorSolicitado         DECIMAL(18,2)  NOT NULL,
    -- Tasa nominal MENSUAL expresada en porcentaje: 1.5000 = 1,5 % mensual.
    -- DECIMAL(7,4) permite hasta 999,9999 con 4 decimales (precisión típica de tasas).
    tasaInteresMensual      DECIMAL(7,4)   NOT NULL,
    numeroCuotas            SMALLINT       NOT NULL,

    estado                  VARCHAR(20)    NOT NULL CONSTRAINT DF_Creditos_estado DEFAULT ('SOLICITADO'),

    -- Auditoría básica en la propia fila (el detalle completo está en HistorialCredito)
    fechaActualizacion      DATETIME2(3)   NOT NULL CONSTRAINT DF_Creditos_fechaActualizacion DEFAULT (SYSUTCDATETIME()),
    creadoPorUsuarioId      INT            NOT NULL,
    actualizadoPorUsuarioId INT            NULL,

    -- Borrado lógico (ADR-008): solo permitido en estado SOLICITADO.
    eliminado               BIT            NOT NULL CONSTRAINT DF_Creditos_eliminado DEFAULT (0),
    fechaEliminacion        DATETIME2(3)   NULL,
    eliminadoPorUsuarioId   INT            NULL,

    /*
       versionFila: ROWVERSION cambia automáticamente en cada UPDATE.
       Permite CONCURRENCIA OPTIMISTA: si dos analistas editan el mismo crédito,
       el segundo en guardar recibe un conflicto (409) en lugar de sobrescribir
       sin saberlo el cambio del primero (problema de la "actualización perdida").
    */
    versionFila             ROWVERSION     NOT NULL,

    CONSTRAINT PK_Creditos PRIMARY KEY (id),
    CONSTRAINT UQ_Creditos_numeroCredito UNIQUE (numeroCredito),

    CONSTRAINT FK_Creditos_Asociados        FOREIGN KEY (asociadoId)              REFERENCES dbo.Asociados (id),
    CONSTRAINT FK_Creditos_TiposCredito     FOREIGN KEY (tipoCreditoCodigo)       REFERENCES dbo.TiposCredito (codigo),
    CONSTRAINT FK_Creditos_FormasPago       FOREIGN KEY (formaPagoCodigo)         REFERENCES dbo.FormasPago (codigo),
    CONSTRAINT FK_Creditos_UsuarioCreador   FOREIGN KEY (creadoPorUsuarioId)      REFERENCES dbo.Usuarios (id),
    CONSTRAINT FK_Creditos_UsuarioEditor    FOREIGN KEY (actualizadoPorUsuarioId) REFERENCES dbo.Usuarios (id),
    CONSTRAINT FK_Creditos_UsuarioEliminador FOREIGN KEY (eliminadoPorUsuarioId)  REFERENCES dbo.Usuarios (id),
    -- Sin ON DELETE CASCADE: nada asociado a un crédito debe desaparecer en cascada.

    -- Reglas de negocio de la prueba, garantizadas también a nivel de dato:
    CONSTRAINT CK_Creditos_valorSolicitado CHECK (valorSolicitado > 0),
    CONSTRAINT CK_Creditos_tasaInteres     CHECK (tasaInteresMensual >= 0 AND tasaInteresMensual <= 100),
    CONSTRAINT CK_Creditos_numeroCuotas    CHECK (numeroCuotas > 0 AND numeroCuotas <= 360),
    CONSTRAINT CK_Creditos_estado          CHECK (estado IN ('SOLICITADO', 'EN_ESTUDIO', 'APROBADO', 'RECHAZADO', 'DESEMBOLSADO', 'CANCELADO')),
    CONSTRAINT CK_Creditos_fechas          CHECK (fechaActualizacion >= fechaSolicitud),

    -- Coherencia del borrado lógico: los tres campos se llenan juntos o ninguno,
    -- y solo un crédito SOLICITADO puede estar eliminado.
    CONSTRAINT CK_Creditos_borradoLogico CHECK (
        (eliminado = 0 AND fechaEliminacion IS NULL     AND eliminadoPorUsuarioId IS NULL)
     OR (eliminado = 1 AND fechaEliminacion IS NOT NULL AND eliminadoPorUsuarioId IS NOT NULL AND estado = 'SOLICITADO')
    )
);
GO

/*
   UX_Creditos_CreditoActivoPorTipo  —  Control de duplicados (ADR-007)
   --------------------------------------------------------------------
   Índice ÚNICO FILTRADO: solo indexa créditos activos y no eliminados.
   Resultado: un asociado no puede tener dos créditos ACTIVOS del mismo tipo,
   pero sí puede tener muchos históricos (rechazados, desembolsados, etc.).

   La API valida primero esta regla y responde 409 con un mensaje claro.
   Este índice es la segunda barrera: si dos peticiones simultáneas pasan la
   validación al mismo tiempo, solo una logra insertar (la otra recibe el error
   2601 de SQL Server, que la API traduce también a 409).
*/
CREATE UNIQUE INDEX UX_Creditos_CreditoActivoPorTipo
    ON dbo.Creditos (asociadoId, tipoCreditoCodigo)
    WHERE estado IN ('SOLICITADO', 'EN_ESTUDIO', 'APROBADO') AND eliminado = 0;
GO

-- Listado principal ordenado por fecha (consulta por defecto del frontend).
-- INCLUDE evita ir a la tabla base para las columnas que muestra la grilla.
CREATE INDEX IX_Creditos_FechaSolicitud
    ON dbo.Creditos (fechaSolicitud DESC)
    INCLUDE (asociadoId, tipoCreditoCodigo, valorSolicitado, estado)
    WHERE eliminado = 0;
GO

-- Filtro por estado + orden por fecha, y conteos por estado del dashboard.
CREATE INDEX IX_Creditos_Estado_FechaSolicitud
    ON dbo.Creditos (estado, fechaSolicitud DESC)
    INCLUDE (asociadoId, tipoCreditoCodigo, valorSolicitado)
    WHERE eliminado = 0;
GO

-- Filtro por asociado (identificación -> asociadoId) y soporte de la FK.
CREATE INDEX IX_Creditos_AsociadoId
    ON dbo.Creditos (asociadoId)
    INCLUDE (estado, tipoCreditoCodigo, eliminado);
GO

/*
   TR_Creditos_ProtegerIntegridad  —  Inmutabilidad (ADR-009)
   ----------------------------------------------------------
   La API ya impide estas modificaciones, pero en un sistema financiero la
   integridad no puede depender solo de la aplicación. El trigger rechaza:
     1. Cambiar el asociado, la fecha de solicitud o el usuario creador.
     2. Cambiar condiciones financieras (valor, tasa, cuotas, tipo, forma de
        pago) cuando el crédito ya salió de SOLICITADO / EN_ESTUDIO.
     3. Mover un crédito que está en un estado final.
     4. Revertir un borrado lógico o modificar un crédito eliminado.
*/
CREATE TRIGGER dbo.TR_Creditos_ProtegerIntegridad
ON dbo.Creditos
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    IF EXISTS (
        SELECT 1
        FROM inserted AS nuevo
        INNER JOIN deleted AS anterior ON anterior.id = nuevo.id
        WHERE nuevo.asociadoId         <> anterior.asociadoId
           OR nuevo.fechaSolicitud     <> anterior.fechaSolicitud
           OR nuevo.creadoPorUsuarioId <> anterior.creadoPorUsuarioId
    )
        THROW 50001, N'No se permite modificar el asociado, la fecha de solicitud ni el usuario creador de un crédito.', 1;

    IF EXISTS (
        SELECT 1
        FROM inserted AS nuevo
        INNER JOIN deleted AS anterior ON anterior.id = nuevo.id
        WHERE anterior.estado NOT IN ('SOLICITADO', 'EN_ESTUDIO')
          AND (   nuevo.valorSolicitado    <> anterior.valorSolicitado
               OR nuevo.tasaInteresMensual <> anterior.tasaInteresMensual
               OR nuevo.numeroCuotas       <> anterior.numeroCuotas
               OR nuevo.tipoCreditoCodigo  <> anterior.tipoCreditoCodigo
               OR nuevo.formaPagoCodigo    <> anterior.formaPagoCodigo)
    )
        THROW 50002, N'Las condiciones financieras solo pueden modificarse en estado SOLICITADO o EN_ESTUDIO.', 1;

    IF EXISTS (
        SELECT 1
        FROM inserted AS nuevo
        INNER JOIN deleted AS anterior ON anterior.id = nuevo.id
        WHERE anterior.estado IN ('RECHAZADO', 'DESEMBOLSADO', 'CANCELADO')
          AND nuevo.estado <> anterior.estado
    )
        THROW 50003, N'Un crédito en estado final no puede cambiar de estado.', 1;

    IF EXISTS (
        SELECT 1
        FROM inserted AS nuevo
        INNER JOIN deleted AS anterior ON anterior.id = nuevo.id
        WHERE anterior.eliminado = 1
    )
        THROW 50004, N'Un crédito eliminado no puede modificarse.', 1;
END;
GO

/* =============================================================================
   5. HISTORIAL DEL CRÉDITO (auditoría)
   -----------------------------------------------------------------------------
   Registro SOLO DE INSERCIÓN de todo lo que le ocurre a un
   crédito: creación, edición, cambio de estado y eliminación lógica.
   Responde: ¿qué cambió?, ¿de qué valor a qué valor?, ¿quién?, ¿cuándo?, ¿por qué?

   Se escribe en la MISMA transacción que la operación sobre el crédito: o
   quedan ambos registrados, o ninguno. Nunca hay un cambio sin traza.
   ============================================================================= */

CREATE TABLE dbo.HistorialCredito
(
    id              BIGINT         IDENTITY(1,1) NOT NULL,
    creditoId       BIGINT         NOT NULL,
    tipoEvento      VARCHAR(20)    NOT NULL,
    estadoAnterior  VARCHAR(20)    NULL,        -- NULL solo en la creación
    estadoNuevo     VARCHAR(20)    NOT NULL,
    /* Detalle de campos modificados en JSON, p. ej.:
       {"valorSolicitado":{"anterior":15000000.00,"nuevo":12000000.00}}
       JSON permite un único esquema de historial para cualquier campo. */
    detalleCambios  NVARCHAR(MAX)  NULL,
    observacion     NVARCHAR(500)  NULL,
    usuarioId       INT            NOT NULL,
    fechaEvento     DATETIME2(3)   NOT NULL CONSTRAINT DF_HistorialCredito_fechaEvento DEFAULT (SYSUTCDATETIME()),

    CONSTRAINT PK_HistorialCredito PRIMARY KEY (id),
    CONSTRAINT FK_HistorialCredito_Creditos FOREIGN KEY (creditoId) REFERENCES dbo.Creditos (id),
    CONSTRAINT FK_HistorialCredito_Usuarios FOREIGN KEY (usuarioId) REFERENCES dbo.Usuarios (id),

    CONSTRAINT CK_HistorialCredito_tipoEvento CHECK (tipoEvento IN ('CREACION', 'ACTUALIZACION', 'CAMBIO_ESTADO', 'ELIMINACION')),
    CONSTRAINT CK_HistorialCredito_estadoAnterior CHECK (estadoAnterior IS NULL OR estadoAnterior IN ('SOLICITADO', 'EN_ESTUDIO', 'APROBADO', 'RECHAZADO', 'DESEMBOLSADO', 'CANCELADO')),
    CONSTRAINT CK_HistorialCredito_estadoNuevo    CHECK (estadoNuevo IN ('SOLICITADO', 'EN_ESTUDIO', 'APROBADO', 'RECHAZADO', 'DESEMBOLSADO', 'CANCELADO')),
    CONSTRAINT CK_HistorialCredito_detalleJson    CHECK (detalleCambios IS NULL OR ISJSON(detalleCambios) = 1),
    -- Coherencia por tipo de evento
    CONSTRAINT CK_HistorialCredito_coherencia CHECK (
        (tipoEvento = 'CREACION'      AND estadoAnterior IS NULL AND estadoNuevo = 'SOLICITADO')
     OR (tipoEvento = 'CAMBIO_ESTADO' AND estadoAnterior IS NOT NULL AND estadoAnterior <> estadoNuevo)
     OR (tipoEvento IN ('ACTUALIZACION', 'ELIMINACION') AND estadoAnterior = estadoNuevo)
    )
);
GO

-- Consulta del detalle de un crédito: su historial en orden cronológico.
CREATE INDEX IX_HistorialCredito_CreditoId_FechaEvento
    ON dbo.HistorialCredito (creditoId, fechaEvento);
GO

-- Garantiza que la auditoría no se pueda alterar ni borrar.
CREATE TRIGGER dbo.TR_HistorialCredito_SoloInsercion
ON dbo.HistorialCredito
INSTEAD OF UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    THROW 50010, N'El historial de créditos es inmutable: no admite modificaciones ni eliminaciones.', 1;
END;
GO

/* =============================================================================
   6. WEBHOOK — OUTBOX TRANSACCIONAL
   -----------------------------------------------------------------------------
   Problema: si la API hiciera el POST al sistema externo dentro de la creación
   del crédito, una caída del sistema externo bloquearía o haría fallar la
   creación; y si se llamara después del COMMIT, una caída de la API en ese
   instante perdería la notificación para siempre.

   Solución: al crear el crédito se inserta, en la MISMA transacción, un evento
   en WebhookNotificaciones (estado PENDIENTE). Un proceso en segundo plano
   (worker) lo envía después y reintenta con espera exponencial si falla.
     * La creación del crédito no depende de la disponibilidad del externo.
     * Ningún crédito creado queda sin notificación (garantía "al menos una vez").
     * El eventId permite al receptor descartar duplicados (idempotencia).
     * WebhookIntentos deja traza de cada intento (código HTTP, error, duración).

   Ciclo de vida:
     PENDIENTE --(worker lo toma)--> ENVIANDO --(2xx)--> ENVIADO
         ^                              |
         +----(error, quedan intentos)--+--(agotó intentos)--> FALLIDO
   ============================================================================= */

CREATE TABLE dbo.WebhookNotificaciones
(
    id                BIGINT            IDENTITY(1,1) NOT NULL,
    eventId           UNIQUEIDENTIFIER  NOT NULL CONSTRAINT DF_WebhookNotificaciones_eventId DEFAULT (NEWID()),
    tipoEvento        VARCHAR(50)       NOT NULL,            -- p. ej. 'credito.creado'
    creditoId         BIGINT            NOT NULL,
    urlDestino        NVARCHAR(500)     NOT NULL,            -- Se guarda la URL vigente al momento del evento
    payload           NVARCHAR(MAX)     NOT NULL,            -- Cuerpo exacto que se envía (snapshot del evento)

    estado            VARCHAR(15)       NOT NULL CONSTRAINT DF_WebhookNotificaciones_estado DEFAULT ('PENDIENTE'),
    intentos          SMALLINT          NOT NULL CONSTRAINT DF_WebhookNotificaciones_intentos DEFAULT (0),
    maxIntentos       SMALLINT          NOT NULL CONSTRAINT DF_WebhookNotificaciones_maxIntentos DEFAULT (6),
    proximoIntento    DATETIME2(3)      NOT NULL CONSTRAINT DF_WebhookNotificaciones_proximoIntento DEFAULT (SYSUTCDATETIME()),
    /* bloqueadoHasta: "arrendamiento" del evento. Si un worker lo toma y se cae
       sin terminar, al vencer este tiempo otro worker puede retomarlo. */
    bloqueadoHasta    DATETIME2(3)      NULL,
    ultimoCodigoHttp  SMALLINT          NULL,
    ultimoError       NVARCHAR(1000)    NULL,
    fechaCreacion     DATETIME2(3)      NOT NULL CONSTRAINT DF_WebhookNotificaciones_fechaCreacion DEFAULT (SYSUTCDATETIME()),
    fechaEnvio        DATETIME2(3)      NULL,

    CONSTRAINT PK_WebhookNotificaciones PRIMARY KEY (id),
    CONSTRAINT UQ_WebhookNotificaciones_eventId UNIQUE (eventId),
    CONSTRAINT FK_WebhookNotificaciones_Creditos FOREIGN KEY (creditoId) REFERENCES dbo.Creditos (id),

    CONSTRAINT CK_WebhookNotificaciones_estado      CHECK (estado IN ('PENDIENTE', 'ENVIANDO', 'ENVIADO', 'FALLIDO')),
    CONSTRAINT CK_WebhookNotificaciones_payloadJson CHECK (ISJSON(payload) = 1),
    CONSTRAINT CK_WebhookNotificaciones_intentos    CHECK (intentos >= 0 AND intentos <= maxIntentos),
    CONSTRAINT CK_WebhookNotificaciones_maxIntentos CHECK (maxIntentos > 0),
    CONSTRAINT CK_WebhookNotificaciones_enviado     CHECK (estado <> 'ENVIADO' OR fechaEnvio IS NOT NULL)
);
GO

-- Consulta del worker: "eventos pendientes cuyo próximo intento ya venció".
-- Filtrado para que solo contenga eventos en curso: aunque la tabla crezca a
-- millones de eventos ENVIADOS, este índice sigue siendo pequeño.
CREATE INDEX IX_WebhookNotificaciones_Pendientes
    ON dbo.WebhookNotificaciones (estado, proximoIntento)
    INCLUDE (bloqueadoHasta)
    WHERE estado IN ('PENDIENTE', 'ENVIANDO');
GO

-- Consultar la traza de notificación de un crédito específico.
CREATE INDEX IX_WebhookNotificaciones_CreditoId
    ON dbo.WebhookNotificaciones (creditoId);
GO

/* Traza detallada: una fila por cada intento de envío. */
CREATE TABLE dbo.WebhookIntentos
(
    id               BIGINT          IDENTITY(1,1) NOT NULL,
    notificacionId   BIGINT          NOT NULL,
    numeroIntento    SMALLINT        NOT NULL,
    fechaIntento     DATETIME2(3)    NOT NULL CONSTRAINT DF_WebhookIntentos_fechaIntento DEFAULT (SYSUTCDATETIME()),
    exitoso          BIT             NOT NULL,
    codigoHttp       SMALLINT        NULL,      -- NULL si no hubo respuesta (timeout, DNS, conexión rechazada)
    duracionMs       INT             NULL,
    error            NVARCHAR(1000)  NULL,

    CONSTRAINT PK_WebhookIntentos PRIMARY KEY (id),
    CONSTRAINT FK_WebhookIntentos_WebhookNotificaciones FOREIGN KEY (notificacionId) REFERENCES dbo.WebhookNotificaciones (id),
    -- Un número de intento por notificación; además sirve de índice para consultar la traza.
    CONSTRAINT UQ_WebhookIntentos_notificacion_numero UNIQUE (notificacionId, numeroIntento),
    CONSTRAINT CK_WebhookIntentos_numeroIntento CHECK (numeroIntento > 0),
    CONSTRAINT CK_WebhookIntentos_duracion      CHECK (duracionMs IS NULL OR duracionMs >= 0)
);
GO

CREATE TRIGGER dbo.TR_WebhookIntentos_SoloInsercion
ON dbo.WebhookIntentos
INSTEAD OF UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    THROW 50011, N'La traza de intentos del webhook es inmutable.', 1;
END;
GO

/* =============================================================================
   Registro de la versión aplicada
   ============================================================================= */
INSERT INTO dbo.VersionesEsquema (version, descripcion)
VALUES ('001', N'Esquema inicial: catálogos, usuarios, asociados, créditos, historial y outbox de webhook');
GO

SET NOEXEC OFF;
GO
