import { randomInt } from 'node:crypto';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';

import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { buildApiRouter } from '../src/compositionRoot.js';
import { loadEnvironment } from '../src/config/environment.js';
import { DatabaseClient } from '../src/infrastructure/database/DatabaseClient.js';
import { WebhookDispatcher } from '../src/modules/webhooks/WebhookDispatcher.js';
import { SqlServerWebhookOutboxRepository } from '../src/modules/webhooks/WebhookOutboxRepository.js';
import {
  verificarFirmaWebhook,
  WEBHOOK_HEADERS,
} from '../src/modules/webhooks/webhookSignature.js';

/**
 * PRUEBAS DE INTEGRACIÓN DEL WEBHOOK: API + outbox real en SQL Server + worker
 * + un receptor HTTP levantado dentro de la prueba.
 *
 * Flujo verificado de punta a punta:
 *   POST /api/creditos -> evento PENDIENTE en BD -> worker lo toma -> POST
 *   firmado al receptor -> traza en BD -> GET /api/creditos/{id}/notificaciones
 *
 * Cada parte se conecta con SU login, igual que en producción: la API con
 * app_creditos_api y el worker con app_creditos_worker (WORKER_DB_USER). Si a
 * alguno le faltara un permiso, estas pruebas fallarían.
 */

// Mismo secreto del receptor del docker-compose: si el lote incluye eventos
// dirigidos a él (creados por otras pruebas), los recibe con firma válida.
const SECRETO_WEBHOOK =
  process.env.WEBHOOK_SECRET ?? 'secreto-webhook-integracion-con-32-caracteres';
const PUERTO_RECEPTOR = 4999;

interface PeticionRecibida {
  headers: IncomingHttpHeaders;
  cuerpo: string;
}

let receptor: Server;
let modoReceptor: 'aceptar' | 'fallar' = 'aceptar';
const recibidas: PeticionRecibida[] = [];

// La API de esta prueba registra los eventos dirigidos al receptor local.
const environment = loadEnvironment({
  ...process.env,
  WEBHOOK_URL: `http://127.0.0.1:${PUERTO_RECEPTOR}/webhooks/creditos`,
});
const database = new DatabaseClient(environment, pino({ level: 'silent' }));

// Conexión del worker con su propio login (mínimo privilegio).
const baseDatosWorker = new DatabaseClient(
  {
    ...environment,
    DB_USER: process.env.WORKER_DB_USER ?? environment.DB_USER,
    DB_PASSWORD: process.env.WORKER_DB_PASSWORD ?? environment.DB_PASSWORD,
  },
  pino({ level: 'silent' }),
);
const outboxRepository = new SqlServerWebhookOutboxRepository(baseDatosWorker);
const dispatcher = new WebhookDispatcher({
  outboxRepository,
  logger: pino({ level: 'silent' }),
  config: {
    secreto: SECRETO_WEBHOOK,
    tamanoLote: 50,
    timeoutMs: 3_000,
    reintentos: { esperaBaseSegundos: 1, esperaMaximaSegundos: 2 },
  },
});

let app: ReturnType<typeof createApp>;
let tokenAnalista = '';
let tokenAdmin = '';

async function crearCredito(): Promise<number> {
  const response = await request(app)
    .post('/api/creditos')
    .set('Authorization', tokenAnalista)
    .send({
      identificacionAsociado: `WH${Date.now()}${randomInt(100, 999)}`.slice(0, 20),
      nombreAsociado: 'Prueba Webhook',
      tipoCredito: 'LIBRE_INVERSION',
      valorSolicitado: 5_000_000,
      tasaInteres: 1.5,
      numeroCuotas: 24,
      formaPago: 'NOMINA',
    });
  expect(response.status).toBe(201);
  return response.body.data.id as number;
}

async function consultarTraza(creditoId: number) {
  const response = await request(app)
    .get(`/api/creditos/${creditoId}/notificaciones`)
    .set('Authorization', tokenAnalista);
  expect(response.status).toBe(200);
  return response.body.data[0] as {
    id: number;
    eventId: string;
    estado: string;
    intentos: number;
    ultimoCodigoHttp: number | null;
    detalleIntentos: { numeroIntento: number; exitoso: boolean; codigoHttp: number | null }[];
  };
}

/**
 * Ejecuta el worker hasta que la notificación del crédito cumpla la condición.
 * Se repite porque otros eventos pendientes de la base compartida pueden
 * ocupar el lote, o porque un worker externo en ejecución pudo tomarla antes.
 */
async function procesarHasta(
  creditoId: number,
  condicion: (traza: Awaited<ReturnType<typeof consultarTraza>>) => boolean,
) {
  const limite = Date.now() + 25_000;
  while (Date.now() < limite) {
    await dispatcher.procesarLote();
    const traza = await consultarTraza(creditoId);
    if (condicion(traza)) return traza;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`La notificación del crédito ${creditoId} no alcanzó el estado esperado`);
}

beforeAll(async () => {
  receptor = createServer((peticion, respuesta) => {
    let cuerpo = '';
    peticion.on('data', (fragmento: Buffer) => (cuerpo += fragmento.toString('utf-8')));
    peticion.on('end', () => {
      recibidas.push({ headers: peticion.headers, cuerpo });
      respuesta.statusCode = modoReceptor === 'aceptar' ? 200 : 503;
      respuesta.end();
    });
  });
  await new Promise<void>((resolve) => receptor.listen(PUERTO_RECEPTOR, '127.0.0.1', resolve));

  await database.connect();
  await baseDatosWorker.connect();
  app = createApp({
    logger: pino({ level: 'silent' }),
    corsAllowedOrigins: [],
    checkDatabase: () => database.ping(),
    apiRouter: buildApiRouter(database, environment),
    version: 'integration-test',
  });

  const login = async (email: string, password: string) => {
    const response = await request(app).post('/api/auth/login').send({ email, password });
    return `Bearer ${response.body.data.accessToken}`;
  };
  tokenAnalista = await login('analista@opa.local', 'Analista123*');
  tokenAdmin = await login('admin@opa.local', 'Admin123*');
});

afterAll(async () => {
  await new Promise((resolve) => receptor.close(resolve));
  await database.close();
  await baseDatosWorker.close();
});

describe('Integración: envío del webhook', () => {
  it('entrega el evento firmado al receptor y deja la traza ENVIADO', async () => {
    modoReceptor = 'aceptar';
    const creditoId = await crearCredito();

    const traza = await procesarHasta(creditoId, (t) => t.estado === 'ENVIADO');

    expect(traza.ultimoCodigoHttp).toBe(200);
    expect(traza.detalleIntentos.at(-1)).toMatchObject({ exitoso: true, codigoHttp: 200 });

    const entrega = recibidas.find(
      (peticion) => peticion.headers[WEBHOOK_HEADERS.EVENT_ID.toLowerCase()] === traza.eventId,
    );
    expect(entrega).toBeDefined();
    const cuerpo = JSON.parse(entrega!.cuerpo);
    expect(cuerpo).toMatchObject({
      event: 'credito.creado',
      eventId: traza.eventId,
      data: { id: creditoId, estado: 'SOLICITADO' },
    });
    expect(
      verificarFirmaWebhook({
        secreto: SECRETO_WEBHOOK,
        timestampSegundos: Number(entrega!.headers[WEBHOOK_HEADERS.TIMESTAMP.toLowerCase()]),
        cuerpo: entrega!.cuerpo,
        firmaRecibida: String(entrega!.headers[WEBHOOK_HEADERS.SIGNATURE.toLowerCase()]),
      }),
    ).toBe(true);
  });

  it('si el receptor responde 503 registra el intento fallido y programa el reintento; luego entrega', async () => {
    modoReceptor = 'fallar';
    const creditoId = await crearCredito();

    const trazaFallida = await procesarHasta(creditoId, (t) => t.intentos >= 1);
    expect(trazaFallida.estado).toBe('PENDIENTE');
    expect(trazaFallida.ultimoCodigoHttp).toBe(503);
    expect(trazaFallida.detalleIntentos[0]).toMatchObject({ exitoso: false, codigoHttp: 503 });

    // El sistema externo se recupera: el siguiente reintento se entrega.
    modoReceptor = 'aceptar';
    const trazaFinal = await procesarHasta(creditoId, (t) => t.estado === 'ENVIADO');
    expect(trazaFinal.intentos).toBeGreaterThanOrEqual(2);
    expect(trazaFinal.detalleIntentos.at(-1)).toMatchObject({ exitoso: true });
  });

  it('un ADMIN puede reprogramar una notificación FALLIDA conservando la traza', async () => {
    modoReceptor = 'aceptar';
    const creditoId = await crearCredito();
    const { id: notificacionId } = await consultarTraza(creditoId);

    // Se simula que agotó sus intentos, con la misma conexión y los mismos
    // permisos del worker (es lo que él haría tras el último fallo).
    const agotada = await baseDatosWorker
      .createRequest()
      .input('id', notificacionId)
      .query<{ intentos: number }>(
        `UPDATE dbo.WebhookNotificaciones SET estado = 'FALLIDO', intentos = maxIntentos
         OUTPUT INSERTED.intentos WHERE id = @id;`,
      );
    const intentosAgotados = agotada.recordset[0]!.intentos;

    const porAnalista = await request(app)
      .post(`/api/webhooks/notificaciones/${notificacionId}/reprogramar`)
      .set('Authorization', tokenAnalista);
    const porAdmin = await request(app)
      .post(`/api/webhooks/notificaciones/${notificacionId}/reprogramar`)
      .set('Authorization', tokenAdmin)
      .send({ intentosAdicionales: 2 });

    expect(porAnalista.status).toBe(403);
    expect(porAdmin.status).toBe(200);

    const traza = await procesarHasta(creditoId, (t) => t.estado === 'ENVIADO');
    // Un intento más que los agotados: la traza anterior se conserva.
    expect(traza.intentos).toBe(intentosAgotados + 1);
  });
});
