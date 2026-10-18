import { beforeEach, describe, expect, it } from 'vitest';

import { CreditoService } from '../../src/modules/creditos/CreditoService.js';
import { InMemoryDatabase } from '../fakes/InMemoryDatabase.js';
import { ADMIN, ANALISTA, solicitudValida, URL_WEBHOOK_PRUEBA } from '../fakes/fixtures.js';

function crearServicio(database: InMemoryDatabase): CreditoService {
  return new CreditoService({
    transactionRunner: database,
    creditoRepository: database.creditoRepository,
    asociadoRepository: database.asociadoRepository,
    historialRepository: database.historialRepository,
    catalogoRepository: database.catalogoRepository,
    webhookOutboxRepository: database.webhookOutboxRepository,
    webhookUrl: URL_WEBHOOK_PRUEBA,
  });
}

describe('CreditoService', () => {
  let database: InMemoryDatabase;
  let servicio: CreditoService;

  beforeEach(() => {
    database = new InMemoryDatabase();
    servicio = crearServicio(database);
  });

  describe('crear', () => {
    it('crea el crédito en SOLICITADO, registra el historial y encola el webhook en una sola operación', async () => {
      const credito = await servicio.crear(solicitudValida(), ANALISTA);

      expect(credito).toMatchObject({
        numeroCredito: expect.stringMatching(/^CR-\d{4}-\d{6}$/),
        identificacionAsociado: '1001234567',
        estado: 'SOLICITADO',
        valorSolicitado: 15_000_000,
      });
      expect(database.historial).toEqual([
        expect.objectContaining({
          creditoId: credito.id,
          tipoEvento: 'CREACION',
          usuarioId: ANALISTA.id,
        }),
      ]);
      expect(database.outbox).toHaveLength(1);
    });

    it('el evento del webhook tiene la estructura exigida por la prueba', async () => {
      const credito = await servicio.crear(solicitudValida(), ANALISTA);
      const [evento] = database.outbox;

      expect(evento).toMatchObject({
        tipoEvento: 'credito.creado',
        urlDestino: URL_WEBHOOK_PRUEBA,
      });
      expect(evento?.payload).toEqual({
        event: 'credito.creado',
        eventId: evento?.eventId,
        timestamp: credito.fechaSolicitud,
        data: {
          id: credito.id,
          numeroCredito: credito.numeroCredito,
          identificacionAsociado: '1001234567',
          valorSolicitado: 15_000_000,
          estado: 'SOLICITADO',
        },
      });
    });

    it('ATOMICIDAD: si falla el registro del webhook, no queda crédito, asociado ni historial', async () => {
      database.fallarAlEncolarWebhook = true;

      await expect(servicio.crear(solicitudValida(), ANALISTA)).rejects.toThrow();

      expect(database.creditos).toHaveLength(0);
      expect(database.asociados).toHaveLength(0);
      expect(database.historial).toHaveLength(0);
    });

    it('reutiliza el asociado existente cuando el nombre coincide (sin importar tildes o mayúsculas)', async () => {
      await servicio.crear(solicitudValida({ nombreAsociado: 'Juan Pérez' }), ANALISTA);
      await servicio.crear(
        solicitudValida({
          nombreAsociado: 'JUAN PEREZ',
          tipoCredito: 'EDUCACION',
          tasaInteres: 0.9,
        }),
        ANALISTA,
      );

      expect(database.asociados).toHaveLength(1);
      expect(database.creditos).toHaveLength(2);
    });

    it('rechaza con 409 si la identificación existe con otro nombre', async () => {
      await servicio.crear(solicitudValida(), ANALISTA);

      await expect(
        servicio.crear(
          solicitudValida({
            nombreAsociado: 'Pedro Gómez',
            tipoCredito: 'EDUCACION',
            tasaInteres: 0.9,
          }),
          ANALISTA,
        ),
      ).rejects.toMatchObject({ httpStatus: 409, code: 'ASOCIADO_NOMBRE_NO_COINCIDE' });
    });

    it('rechaza con 409 un segundo crédito activo del mismo tipo', async () => {
      await servicio.crear(solicitudValida(), ANALISTA);

      await expect(servicio.crear(solicitudValida(), ANALISTA)).rejects.toMatchObject({
        httpStatus: 409,
        code: 'CREDITO_DUPLICADO',
      });
    });

    it('permite un nuevo crédito del mismo tipo si el anterior ya no está activo', async () => {
      const primero = await servicio.crear(solicitudValida(), ANALISTA);
      await servicio.cambiarEstado(primero.id, 'CANCELADO', ANALISTA, 'Desistió');

      await expect(servicio.crear(solicitudValida(), ANALISTA)).resolves.toBeDefined();
    });

    it('rechaza con 422 condiciones por fuera de la política del tipo de crédito', async () => {
      await expect(
        servicio.crear(solicitudValida({ valorSolicitado: 100_000, numeroCuotas: 100 }), ANALISTA),
      ).rejects.toMatchObject({
        httpStatus: 422,
        code: 'CONDICIONES_FUERA_DE_POLITICA',
        details: [
          expect.objectContaining({ field: 'valorSolicitado' }),
          expect.objectContaining({ field: 'numeroCuotas' }),
        ],
      });
    });

    it.each([
      [{ tipoCredito: 'NO_EXISTE' }, 'TIPO_CREDITO_INVALIDO'],
      [{ tipoCredito: 'DESCONTINUADO' }, 'TIPO_CREDITO_INVALIDO'],
      [{ formaPago: 'TRUEQUE' }, 'FORMA_PAGO_INVALIDA'],
    ])('rechaza catálogos inexistentes o inactivos: %o', async (cambio, codigoEsperado) => {
      await expect(servicio.crear(solicitudValida(cambio), ANALISTA)).rejects.toMatchObject({
        httpStatus: 422,
        code: codigoEsperado,
      });
    });
  });

  describe('obtenerPorId', () => {
    it('responde 404 CREDITO_NOT_FOUND si el crédito no existe', async () => {
      await expect(servicio.obtenerPorId(999)).rejects.toMatchObject({
        httpStatus: 404,
        code: 'CREDITO_NOT_FOUND',
        message: 'El crédito 999 no existe.',
      });
    });
  });

  describe('actualizar (PATCH)', () => {
    it('modifica solo los campos enviados y registra el antes y el después', async () => {
      const credito = await servicio.crear(solicitudValida(), ANALISTA);

      const actualizado = await servicio.actualizar(
        credito.id,
        { valorSolicitado: 12_000_000 },
        credito.version,
        ANALISTA,
        'Ajuste por capacidad de pago',
      );

      expect(actualizado.valorSolicitado).toBe(12_000_000);
      expect(actualizado.numeroCuotas).toBe(36);
      expect(actualizado.version).not.toBe(credito.version);
      expect(database.historial.at(-1)).toMatchObject({
        tipoEvento: 'ACTUALIZACION',
        detalleCambios: { valorSolicitado: { anterior: 15_000_000, nuevo: 12_000_000 } },
        observacion: 'Ajuste por capacidad de pago',
      });
    });

    it('rechaza con 412 si la versión no es la vigente (otro usuario modificó antes)', async () => {
      const credito = await servicio.crear(solicitudValida(), ANALISTA);
      await servicio.actualizar(credito.id, { numeroCuotas: 24 }, credito.version, ANALISTA);

      await expect(
        servicio.actualizar(credito.id, { valorSolicitado: 9_000_000 }, credito.version, ADMIN),
      ).rejects.toMatchObject({ httpStatus: 412, code: 'PRECONDITION_FAILED' });
    });

    it('rechaza con 422 la edición de un crédito APROBADO', async () => {
      const credito = await servicio.crear(solicitudValida(), ANALISTA);
      await servicio.cambiarEstado(credito.id, 'EN_ESTUDIO', ANALISTA);
      const aprobado = await servicio.cambiarEstado(credito.id, 'APROBADO', ANALISTA);

      await expect(
        servicio.actualizar(credito.id, { valorSolicitado: 9_000_000 }, aprobado.version, ANALISTA),
      ).rejects.toMatchObject({ httpStatus: 422, code: 'CREDITO_NO_EDITABLE' });
    });

    it('valida la política con el resultado combinado (campos nuevos + actuales)', async () => {
      const credito = await servicio.crear(solicitudValida(), ANALISTA);

      // Cambiar a EDUCACION con la tasa actual (1.5) supera el máximo de ese tipo (1.0).
      await expect(
        servicio.actualizar(credito.id, { tipoCredito: 'EDUCACION' }, credito.version, ANALISTA),
      ).rejects.toMatchObject({ code: 'CONDICIONES_FUERA_DE_POLITICA' });
    });

    it('no escribe historial si los valores enviados son iguales a los actuales', async () => {
      const credito = await servicio.crear(solicitudValida(), ANALISTA);

      await servicio.actualizar(credito.id, { tasaInteres: 1.5 }, credito.version, ANALISTA);

      expect(database.historial).toHaveLength(1); // solo la creación
    });
  });

  describe('cambiarEstado', () => {
    it('registra estado anterior, nuevo, usuario y observación', async () => {
      const credito = await servicio.crear(solicitudValida(), ANALISTA);

      await servicio.cambiarEstado(credito.id, 'EN_ESTUDIO', ANALISTA, 'Inicia estudio');

      expect(database.historial.at(-1)).toMatchObject({
        tipoEvento: 'CAMBIO_ESTADO',
        estadoAnterior: 'SOLICITADO',
        estadoNuevo: 'EN_ESTUDIO',
        usuarioId: ANALISTA.id,
        observacion: 'Inicia estudio',
      });
    });

    it('rechaza transiciones inválidas sin modificar nada', async () => {
      const credito = await servicio.crear(solicitudValida(), ANALISTA);

      await expect(
        servicio.cambiarEstado(credito.id, 'DESEMBOLSADO', ANALISTA),
      ).rejects.toMatchObject({
        httpStatus: 422,
        code: 'TRANSICION_ESTADO_INVALIDA',
      });
      expect((await servicio.obtenerPorId(credito.id)).estado).toBe('SOLICITADO');
    });
  });

  describe('eliminar (borrado lógico)', () => {
    it('elimina un crédito SOLICITADO y deja traza en el historial', async () => {
      const credito = await servicio.crear(solicitudValida(), ANALISTA);

      await servicio.eliminar(credito.id, ADMIN);

      await expect(servicio.obtenerPorId(credito.id)).rejects.toMatchObject({ httpStatus: 404 });
      expect(database.creditos[0]?.eliminado).toBe(true); // sigue existiendo físicamente
      expect(database.historial.at(-1)).toMatchObject({
        tipoEvento: 'ELIMINACION',
        usuarioId: ADMIN.id,
      });
    });

    it('rechaza con 422 eliminar un crédito que ya salió de SOLICITADO', async () => {
      const credito = await servicio.crear(solicitudValida(), ANALISTA);
      await servicio.cambiarEstado(credito.id, 'EN_ESTUDIO', ANALISTA);

      await expect(servicio.eliminar(credito.id, ADMIN)).rejects.toMatchObject({
        httpStatus: 422,
        code: 'CREDITO_NO_ELIMINABLE',
      });
    });
  });

  describe('obtenerResumen', () => {
    it('incluye todos los estados, también los que no tienen créditos', async () => {
      await servicio.crear(solicitudValida(), ANALISTA);

      const resumen = await servicio.obtenerResumen();

      expect(resumen.totalCreditos).toBe(1);
      expect(resumen.valorTotalSolicitado).toBe(15_000_000);
      expect(resumen.porEstado).toHaveLength(6);
      expect(resumen.porEstado.find((item) => item.estado === 'APROBADO')?.cantidad).toBe(0);
    });
  });
});
