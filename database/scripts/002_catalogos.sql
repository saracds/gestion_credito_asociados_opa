/* =============================================================================
   002_catalogos.sql
   -----------------------------------------------------------------------------
   Propósito : Cargar los catálogos de tipos de crédito y formas de pago.
               Son datos de referencia necesarios en TODOS los ambientes
               (desarrollo, pruebas y producción).
   Requiere  : 001_esquema.sql
   Idempotente: Sí (control por dbo.VersionesEsquema).

   Nota: los montos, plazos y tasas máximas son ILUSTRATIVOS. 
   ============================================================================= */

USE CreditosOPA;
GO

IF EXISTS (SELECT 1 FROM dbo.VersionesEsquema WHERE version = '002')
BEGIN
    RAISERROR(N'La versión 002 ya fue aplicada. Se omite la ejecución.', 0, 1) WITH NOWAIT;
    SET NOEXEC ON;
END;
GO

INSERT INTO dbo.TiposCredito
    (codigo,            nombre,                  descripcion,                                                     valorMinimo,  valorMaximo,   cuotasMaximas, tasaMaximaMensual)
VALUES
    ('LIBRE_INVERSION', N'Libre inversión',      N'Crédito de destino libre para el asociado.',                    500000.00,   100000000.00,  72,           2.0000),
    ('VIVIENDA',        N'Vivienda',             N'Compra, construcción o mejora de vivienda.',                   10000000.00, 500000000.00, 240,           1.2000),
    ('VEHICULO',        N'Vehículo',             N'Compra de vehículo nuevo o usado.',                            5000000.00,  200000000.00,  84,           1.6000),
    ('EDUCACION',       N'Educación',            N'Matrículas y gastos educativos del asociado o su familia.',      300000.00,   50000000.00,  60,           1.0000),
    ('CALAMIDAD',       N'Calamidad doméstica',  N'Atención de emergencias o calamidades del núcleo familiar.',     200000.00,   10000000.00,  24,           0.9000);
GO

INSERT INTO dbo.FormasPago
    (codigo,              nombre,                      descripcion)
VALUES
    ('NOMINA',            N'Descuento por nómina',     N'Libranza: el empleador descuenta la cuota del salario del asociado.'),
    ('CAJA',              N'Pago en caja',             N'El asociado paga directamente en las oficinas de la cooperativa.'),
    ('DEBITO_AUTOMATICO', N'Débito automático',        N'Débito mensual autorizado desde una cuenta bancaria del asociado.'),
    ('TRANSFERENCIA',     N'Transferencia electrónica',N'Pago por transferencia o PSE a la cuenta de la cooperativa.');
GO

INSERT INTO dbo.VersionesEsquema (version, descripcion)
VALUES ('002', N'Catálogos: tipos de crédito y formas de pago');
GO

SET NOEXEC OFF;
GO
