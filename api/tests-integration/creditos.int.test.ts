import { randomInt } from 'node:crypto';

import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { buildApiRouter } from '../src/compositionRoot.js';
import { loadEnvironment } from '../src/config/environment.js';
import { DatabaseClient } from '../src/infrastructure/database/DatabaseClient.js';

/**
 * PRUEBAS DE INTEGRACIÓN contra el SQL Server real del docker-compose.
 *
 * Verifican lo que las pruebas unitarias no pueden: las consultas SQL, las
 * transacciones, los bloqueos, los triggers y los índices reales.
 *
 * Ejecución (desde la raíz del repositorio):
 *   docker compose --profile test run --rm api-integration-tests
 *
 * Requieren los usuarios de demostración (SEED_DEMO=true). Cada ejecución usa
 * identificaciones aleatorias, así que puede repetirse sin limpiar la base.
 */

const CLAVES_DEMO = {
  admin: { email: 'admin@opa.local', password: 'Admin123*' },
  analista: { email: 'analista@opa.local', password: 'Analista123*' },
  consulta: { email: 'consulta@opa.local', password: 'Consulta123*' },
};

const environment = loadEnvironment();
const database = new DatabaseClient(environment, pino({ level: 'silent' }));
let app: ReturnType<typeof createApp>;
const tokens = { admin: '', analista: '', consulta: '' };

/** Identificación única por ejecución para no chocar con datos previos. */
const nuevaIdentificacion = () => `IT${Date.now()}${randomInt(100, 999)}`.slice(0, 20);

const solicitud = (identificacionAsociado: string, cambios: Record<string, unknown> = {}) => ({
  identificacionAsociado,
  nombreAsociado: 'Ana María López',
  tipoCredito: 'LIBRE_INVERSION',
  valorSolicitado: 15_000_000,
  tasaInteres: 1.5,
  numeroCuotas: 36,
  formaPago: 'NOMINA',
  ...cambios,
});

const crear = (cuerpo: object, token = tokens.analista) =>
  request(app).post('/api/creditos').set('Authorization', token).send(cuerpo);

const cambiarEstado = (id: number, estado: string, observacion?: string) =>
  request(app)
    .patch(`/api/creditos/${id}/estado`)
    .set('Authorization', tokens.analista)
    .send({ estado, ...(observacion && { observacion }) });

beforeAll(async () => {
  await database.connect();
  app = createApp({
    logger: pino({ level: 'silent' }),
    corsAllowedOrigins: [],
    checkDatabase: () => database.ping(),
    apiRouter: buildApiRouter(database, environment),
    version: 'integration-test',
  });

  for (const rol of ['admin', 'analista', 'consulta'] as const) {
    const response = await request(app).post('/api/auth/login').send(CLAVES_DEMO[rol]);
    expect(response.status, `login de ${rol}`).toBe(200);
    tokens[rol] = `Bearer ${response.body.data.accessToken}`;
  }
});

afterAll(async () => {
  await database.close();
});

describe('Integración: creación de créditos', () => {
  it('guarda crédito, historial y evento del webhook en la misma transacción', async () => {
    const response = await crear(solicitud(nuevaIdentificacion()));

    expect(response.status).toBe(201);
    const credito = response.body.data;
    expect(credito.numeroCredito).toMatch(/^CR-\d{4}-\d{6,}$/);
    expect(credito.version).toMatch(/^[0-9A-F]{16}$/);

    const verificacion = await database.createRequest().input('creditoId', credito.id).query<{
      historial: number;
      eventos: number;
      payload: string;
      estadoEvento: string;
    }>(`
        SELECT
          (SELECT COUNT(*) FROM dbo.HistorialCredito WHERE creditoId = @creditoId AND tipoEvento = 'CREACION') AS historial,
          (SELECT COUNT(*) FROM dbo.WebhookNotificaciones WHERE creditoId = @creditoId) AS eventos,
          (SELECT payload FROM dbo.WebhookNotificaciones WHERE creditoId = @creditoId) AS payload,
          (SELECT estado  FROM dbo.WebhookNotificaciones WHERE creditoId = @creditoId) AS estadoEvento;
      `);

    const fila = verificacion.recordset[0]!;
    expect(fila.historial).toBe(1);
    expect(fila.eventos).toBe(1);
    expect(fila.estadoEvento).toBe('PENDIENTE');
    expect(JSON.parse(fila.payload)).toMatchObject({
      event: 'credito.creado',
      data: { id: credito.id, numeroCredito: credito.numeroCredito, estado: 'SOLICITADO' },
    });
  });

  it('rechaza el duplicado activo (409) y permite otro tipo de crédito al mismo asociado', async () => {
    const identificacion = nuevaIdentificacion();
    await crear(solicitud(identificacion));

    const duplicado = await crear(solicitud(identificacion));
    const otroTipo = await crear(
      solicitud(identificacion, { tipoCredito: 'EDUCACION', tasaInteres: 0.9 }),
    );

    expect(duplicado.status).toBe(409);
    expect(duplicado.body.error.code).toBe('CREDITO_DUPLICADO');
    expect(otroTipo.status).toBe(201);
  });

  it('acepta el mismo nombre con otra escritura y rechaza un nombre distinto (409)', async () => {
    const identificacion = nuevaIdentificacion();
    await crear(solicitud(identificacion));

    const mismaPersona = await crear(
      solicitud(identificacion, {
        nombreAsociado: 'ANA MARIA LOPEZ',
        tipoCredito: 'EDUCACION',
        tasaInteres: 0.9,
      }),
    );
    const otraPersona = await crear(
      solicitud(identificacion, { nombreAsociado: 'Pedro Ramírez', tipoCredito: 'VEHICULO' }),
    );

    expect(mismaPersona.status).toBe(201);
    expect(otraPersona.status).toBe(409);
    expect(otraPersona.body.error.code).toBe('ASOCIADO_NOMBRE_NO_COINCIDE');
  });

  it('aplica la política del tipo de crédito leída de la base de datos (422)', async () => {
    const response = await crear(solicitud(nuevaIdentificacion(), { valorSolicitado: 1_000 }));

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('CONDICIONES_FUERA_DE_POLITICA');
  });

  it('impide crear con el rol CONSULTA (403)', async () => {
    const response = await crear(solicitud(nuevaIdentificacion()), tokens.consulta);
    expect(response.status).toBe(403);
  });
});

describe('Integración: consulta, edición y estados', () => {
  it('responde 404 para un crédito inexistente', async () => {
    const response = await request(app)
      .get('/api/creditos/999999999')
      .set('Authorization', tokens.consulta);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('CREDITO_NOT_FOUND');
  });

  it('PATCH con If-Match: 428 sin versión, 200 con la vigente, 412 con una vencida', async () => {
    const creado = await crear(solicitud(nuevaIdentificacion()));
    const url = `/api/creditos/${creado.body.data.id}`;
    const versionOriginal = creado.headers.etag!;

    const sinVersion = await request(app)
      .patch(url)
      .set('Authorization', tokens.analista)
      .send({ valorSolicitado: 12_000_000 });
    const conVersion = await request(app)
      .patch(url)
      .set('Authorization', tokens.analista)
      .set('If-Match', versionOriginal)
      .send({ valorSolicitado: 12_000_000, observacion: 'Ajuste' });
    const versionVencida = await request(app)
      .patch(url)
      .set('Authorization', tokens.analista)
      .set('If-Match', versionOriginal)
      .send({ numeroCuotas: 24 });

    expect(sinVersion.status).toBe(428);
    expect(conVersion.status).toBe(200);
    expect(conVersion.body.data.valorSolicitado).toBe(12_000_000);
    expect(conVersion.headers.etag).not.toBe(versionOriginal);
    expect(versionVencida.status).toBe(412);
  });

  it('recorre la máquina de estados y bloquea RECHAZADO -> DESEMBOLSADO', async () => {
    const creado = await crear(solicitud(nuevaIdentificacion()));
    const id = creado.body.data.id as number;

    expect((await cambiarEstado(id, 'APROBADO')).status).toBe(422); // salto no permitido
    expect((await cambiarEstado(id, 'EN_ESTUDIO')).status).toBe(200);
    expect((await cambiarEstado(id, 'RECHAZADO')).status).toBe(422); // falta observación
    expect((await cambiarEstado(id, 'RECHAZADO', 'Sin capacidad de pago')).status).toBe(200);

    const desembolso = await cambiarEstado(id, 'DESEMBOLSADO');
    expect(desembolso.status).toBe(422);
    expect(desembolso.body.error.code).toBe('TRANSICION_ESTADO_INVALIDA');

    const historial = await request(app)
      .get(`/api/creditos/${id}/historial`)
      .set('Authorization', tokens.analista);
    expect(
      historial.body.data.map((evento: { estadoNuevo: string }) => evento.estadoNuevo),
    ).toEqual(['SOLICITADO', 'EN_ESTUDIO', 'RECHAZADO']);
  });

  it('no permite editar un crédito rechazado (422)', async () => {
    const creado = await crear(solicitud(nuevaIdentificacion()));
    const id = creado.body.data.id as number;
    await cambiarEstado(id, 'EN_ESTUDIO');
    const rechazado = await cambiarEstado(id, 'RECHAZADO', 'Documentación incompleta');

    const response = await request(app)
      .patch(`/api/creditos/${id}`)
      .set('Authorization', tokens.analista)
      .set('If-Match', rechazado.headers.etag!)
      .send({ valorSolicitado: 1_000_000 });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('CREDITO_NO_EDITABLE');
  });
});

describe('Integración: borrado lógico', () => {
  it('ANALISTA no puede eliminar; ADMIN sí, y el registro se conserva en la base de datos', async () => {
    const creado = await crear(solicitud(nuevaIdentificacion()));
    const id = creado.body.data.id as number;
    const url = `/api/creditos/${id}`;

    const porAnalista = await request(app).delete(url).set('Authorization', tokens.analista);
    const porAdmin = await request(app).delete(url).set('Authorization', tokens.admin);
    const consulta = await request(app).get(url).set('Authorization', tokens.admin);

    expect(porAnalista.status).toBe(403);
    expect(porAdmin.status).toBe(204);
    expect(consulta.status).toBe(404);

    const fila = await database
      .createRequest()
      .input('id', id)
      .query<{ eliminado: boolean }>('SELECT eliminado FROM dbo.Creditos WHERE id = @id;');
    expect(fila.recordset[0]?.eliminado).toBe(true);
  });
});

describe('Integración: listado y dashboard', () => {
  it('filtra por identificación y estado, con paginación', async () => {
    const identificacion = nuevaIdentificacion();
    await crear(solicitud(identificacion));
    await crear(solicitud(identificacion, { tipoCredito: 'EDUCACION', tasaInteres: 0.9 }));

    const response = await request(app)
      .get(`/api/creditos?identificacionAsociado=${identificacion}&estado=SOLICITADO&pageSize=1`)
      .set('Authorization', tokens.consulta);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.meta).toMatchObject({ totalItems: 2, totalPages: 2 });
  });

  it('busca por nombre sin importar tildes', async () => {
    const identificacion = nuevaIdentificacion();
    await crear(solicitud(identificacion, { nombreAsociado: `Búsqueda Pérez ${identificacion}` }));

    const response = await request(app)
      .get(`/api/creditos?busqueda=${encodeURIComponent(`busqueda perez ${identificacion}`)}`)
      .set('Authorization', tokens.consulta);

    expect(
      response.body.data.map(
        (item: { identificacionAsociado: string }) => item.identificacionAsociado,
      ),
    ).toContain(identificacion);
  });

  it('el resumen incluye los seis estados', async () => {
    const response = await request(app)
      .get('/api/creditos/resumen')
      .set('Authorization', tokens.consulta);

    expect(response.status).toBe(200);
    expect(response.body.data.porEstado).toHaveLength(6);
    expect(response.body.data.totalCreditos).toBeGreaterThan(0);
  });

  it('los catálogos devuelven tipos de crédito con su política', async () => {
    const response = await request(app).get('/api/catalogos').set('Authorization', tokens.consulta);

    expect(response.status).toBe(200);
    expect(response.body.data.tiposCredito[0]).toHaveProperty('tasaMaximaMensual');
    expect(response.body.data.formasPago.length).toBeGreaterThan(0);
  });
});
