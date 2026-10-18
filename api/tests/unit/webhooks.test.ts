import { pino } from 'pino';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  calcularEsperaSegundos,
  esFallaTemporal,
} from '../../src/modules/webhooks/politicaReintentos.js';
import { WebhookDispatcher } from '../../src/modules/webhooks/WebhookDispatcher.js';
import type {
  NotificacionReclamada,
  ResultadoIntento,
  ResultadoIntentoFallido,
  WebhookOutboxRepository,
} from '../../src/modules/webhooks/WebhookOutboxRepository.js';
import {
  firmarWebhook,
  verificarFirmaWebhook,
  WEBHOOK_HEADERS,
} from '../../src/modules/webhooks/webhookSignature.js';

const SECRETO = 'secreto-webhook-de-pruebas-con-32-caracteres';
const AHORA = new Date('2026-10-17T15:00:00.000Z');
const AHORA_SEGUNDOS = Math.floor(AHORA.getTime() / 1000);

describe('Firma HMAC del webhook', () => {
  const cuerpo = '{"event":"credito.creado","eventId":"abc"}';

  it('acepta una firma correcta y reciente', () => {
    const firma = firmarWebhook(SECRETO, AHORA_SEGUNDOS, cuerpo);

    expect(firma).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(
      verificarFirmaWebhook({
        secreto: SECRETO,
        timestampSegundos: AHORA_SEGUNDOS,
        cuerpo,
        firmaRecibida: firma,
        ahoraSegundos: AHORA_SEGUNDOS + 10,
      }),
    ).toBe(true);
  });

  it('rechaza el cuerpo alterado en un solo carácter (integridad)', () => {
    const firma = firmarWebhook(SECRETO, AHORA_SEGUNDOS, cuerpo);

    expect(
      verificarFirmaWebhook({
        secreto: SECRETO,
        timestampSegundos: AHORA_SEGUNDOS,
        cuerpo: cuerpo.replace('abc', 'abd'),
        firmaRecibida: firma,
        ahoraSegundos: AHORA_SEGUNDOS,
      }),
    ).toBe(false);
  });

  it('rechaza una firma hecha con otro secreto (autenticidad)', () => {
    const firma = firmarWebhook(
      'otro-secreto-de-un-atacante-con-32-caracteres',
      AHORA_SEGUNDOS,
      cuerpo,
    );

    expect(
      verificarFirmaWebhook({
        secreto: SECRETO,
        timestampSegundos: AHORA_SEGUNDOS,
        cuerpo,
        firmaRecibida: firma,
        ahoraSegundos: AHORA_SEGUNDOS,
      }),
    ).toBe(false);
  });

  it('rechaza una petición válida reenviada 10 minutos después (repetición)', () => {
    const firma = firmarWebhook(SECRETO, AHORA_SEGUNDOS, cuerpo);

    expect(
      verificarFirmaWebhook({
        secreto: SECRETO,
        timestampSegundos: AHORA_SEGUNDOS,
        cuerpo,
        firmaRecibida: firma,
        ahoraSegundos: AHORA_SEGUNDOS + 600,
      }),
    ).toBe(false);
  });
});

describe('Política de reintentos', () => {
  const configuracion = { esperaBaseSegundos: 10, esperaMaximaSegundos: 3600 };
  const sinVariacion = () => 0.5; // factor 1.0

  it('duplica la espera en cada intento (backoff exponencial)', () => {
    expect(
      [1, 2, 3, 4, 5].map((n) => calcularEsperaSegundos(n, configuracion, sinVariacion)),
    ).toEqual([10, 20, 40, 80, 160]);
  });

  it('respeta la espera máxima', () => {
    expect(calcularEsperaSegundos(20, configuracion, sinVariacion)).toBe(3600);
  });

  it('agrega una variación aleatoria de ±20 % (jitter)', () => {
    expect(calcularEsperaSegundos(1, configuracion, () => 0)).toBe(8);
    expect(calcularEsperaSegundos(1, configuracion, () => 1)).toBe(12);
  });

  it.each([
    [null, true],
    [500, true],
    [503, true],
    [408, true],
    [429, true],
    [400, false],
    [401, false],
    [404, false],
  ])('HTTP %s -> ¿falla temporal? %s', (codigo, esperado) => {
    expect(esFallaTemporal(codigo)).toBe(esperado);
  });
});

/** Doble del outbox que registra lo que el despachador le informa. */
class OutboxEnMemoria implements WebhookOutboxRepository {
  pendientes: NotificacionReclamada[] = [];
  exitos: ResultadoIntento[] = [];
  fallos: ResultadoIntentoFallido[] = [];

  encolar = async () => undefined;
  listarPorCredito = async () => [];
  reprogramarFallido = async () => false;

  async reclamarPendientes(limite: number) {
    return this.pendientes.splice(0, limite);
  }
  async registrarExito(resultado: ResultadoIntento) {
    this.exitos.push(resultado);
  }
  async registrarFallo(resultado: ResultadoIntentoFallido) {
    this.fallos.push(resultado);
  }
}

const notificacion = (cambios: Partial<NotificacionReclamada> = {}): NotificacionReclamada => ({
  id: 1,
  eventId: '8f7d2c1e-0000-4000-8000-000000000001',
  tipoEvento: 'credito.creado',
  urlDestino: 'https://sistema-externo.test/webhooks/creditos',
  payload: '{"event":"credito.creado"}',
  intentos: 0,
  maxIntentos: 6,
  ...cambios,
});

describe('WebhookDispatcher', () => {
  let outbox: OutboxEnMemoria;
  let peticiones: { url: string; init: RequestInit }[];

  const crearDespachador = (respuesta: () => Promise<Response>) =>
    new WebhookDispatcher({
      outboxRepository: outbox,
      logger: pino({ level: 'silent' }),
      ahora: () => AHORA,
      config: {
        secreto: SECRETO,
        tamanoLote: 10,
        timeoutMs: 1000,
        reintentos: { esperaBaseSegundos: 10, esperaMaximaSegundos: 3600 },
      },
      httpClient: async (url, init) => {
        peticiones.push({ url: String(url), init: init ?? {} });
        return respuesta();
      },
    });

  beforeEach(() => {
    outbox = new OutboxEnMemoria();
    peticiones = [];
  });

  it('envía el cuerpo exacto con cabeceras de evento y una firma verificable', async () => {
    outbox.pendientes.push(notificacion());
    const despachador = crearDespachador(async () => new Response(null, { status: 200 }));

    await despachador.procesarLote();

    const { url, init } = peticiones[0]!;
    const cabeceras = init.headers as Record<string, string>;
    expect(url).toBe('https://sistema-externo.test/webhooks/creditos');
    expect(init.body).toBe('{"event":"credito.creado"}');
    expect(cabeceras[WEBHOOK_HEADERS.EVENT_ID]).toBe('8f7d2c1e-0000-4000-8000-000000000001');
    expect(
      verificarFirmaWebhook({
        secreto: SECRETO,
        timestampSegundos: Number(cabeceras[WEBHOOK_HEADERS.TIMESTAMP]),
        cuerpo: init.body as string,
        firmaRecibida: cabeceras[WEBHOOK_HEADERS.SIGNATURE]!,
        ahoraSegundos: AHORA_SEGUNDOS,
      }),
    ).toBe(true);
  });

  it('registra ENVIADO con el número de intento ante una respuesta 2xx', async () => {
    outbox.pendientes.push(notificacion({ intentos: 2 }));

    await crearDespachador(async () => new Response(null, { status: 202 })).procesarLote();

    expect(outbox.exitos).toEqual([expect.objectContaining({ numeroIntento: 3, codigoHttp: 202 })]);
    expect(outbox.fallos).toHaveLength(0);
  });

  it('ante 503 programa un reintento con backoff', async () => {
    outbox.pendientes.push(notificacion());

    await crearDespachador(async () => new Response(null, { status: 503 })).procesarLote();

    const [fallo] = outbox.fallos;
    expect(fallo).toMatchObject({ numeroIntento: 1, codigoHttp: 503 });
    const esperaSegundos = (fallo!.proximoIntento!.getTime() - AHORA.getTime()) / 1000;
    expect(esperaSegundos).toBeGreaterThanOrEqual(8);
    expect(esperaSegundos).toBeLessThanOrEqual(12);
  });

  it('si el externo no responde (error de red) también reintenta y deja el motivo en la traza', async () => {
    outbox.pendientes.push(notificacion());

    await crearDespachador(async () => {
      throw new TypeError('fetch failed', {
        cause: new Error('connect ECONNREFUSED 10.0.0.9:443'),
      });
    }).procesarLote();

    expect(outbox.fallos[0]).toMatchObject({
      codigoHttp: null,
      error: expect.stringContaining('ECONNREFUSED'),
      proximoIntento: expect.any(Date),
    });
  });

  it('registra el timeout cuando el externo tarda demasiado', async () => {
    outbox.pendientes.push(notificacion());

    await crearDespachador(async () => {
      throw new DOMException('The operation timed out.', 'TimeoutError');
    }).procesarLote();

    expect(outbox.fallos[0]?.error).toContain('timeout');
  });

  it('en el último intento permitido deja el evento FALLIDO (sin próximo intento)', async () => {
    outbox.pendientes.push(notificacion({ intentos: 5, maxIntentos: 6 }));

    await crearDespachador(async () => new Response(null, { status: 503 })).procesarLote();

    expect(outbox.fallos[0]).toMatchObject({ numeroIntento: 6, proximoIntento: null });
  });

  it('ante un 4xx permanente (400) no reintenta: pasa a FALLIDO de inmediato', async () => {
    outbox.pendientes.push(notificacion());

    await crearDespachador(async () => new Response(null, { status: 400 })).procesarLote();

    expect(outbox.fallos[0]).toMatchObject({
      numeroIntento: 1,
      codigoHttp: 400,
      proximoIntento: null,
    });
  });

  it('devuelve 0 cuando no hay eventos pendientes', async () => {
    await expect(
      crearDespachador(async () => new Response(null, { status: 200 })).procesarLote(),
    ).resolves.toBe(0);
    expect(peticiones).toHaveLength(0);
  });
});
