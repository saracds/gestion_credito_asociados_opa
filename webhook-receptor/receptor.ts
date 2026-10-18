/**
 * =============================================================================
 * Receptor de webhooks de prueba 
 * -----------------------------------------------------------------------------
 * Representa al sistema que recibe la notificación "credito.creado". Sirve para
 * DEMOSTRAR en vivo qué pasa cuando el sistema externo responde bien, falla,
 * está caído o tarda demasiado (punto 7 de la prueba técnica).
 *
 * Hace lo que debe hacer un receptor de webhooks:
 *   1. Verifica la firma HMAC-SHA256 y la antigüedad del timestamp (rechaza
 *      peticiones falsificadas, alteradas o repetidas) -> 401.
 *   2. Es IDEMPOTENTE: si el mismo eventId llega dos veces (el emisor garantiza
 *      "al menos una vez"), responde 200 sin procesarlo de nuevo.
 *
 * Modos de comportamiento :
 *   normal          Responde 200.
 *   falla-temporal  Responde 503 los primeros N intentos de cada evento y
 *                   luego 200. Ideal para ver los reintentos con backoff.
 *   caido           Siempre 503 (servicio no disponible). El evento termina
 *                   FALLIDO al agotar los intentos.
 *   lento           Tarda más que el timeout del emisor (ve un timeout).
 *   rechazar        Siempre 400: error permanente, el emisor NO reintenta.
 *
 * Endpoints:
 *   POST   /webhooks/creditos   Recibe las notificaciones.
 *   GET    /eventos             Eventos recibidos (más recientes primero).
 *   DELETE /eventos             Limpia lo recibido.
 *   GET    /modo                Modo actual.
 *   PUT    /modo                Cambia el modo: {"modo": "caido"}.
 *   GET    /health              Healthcheck.
 *
 * ⚠ Solo para desarrollo y demostración: los endpoints de administración
 *   (/modo, /eventos) no tienen autenticación.
 *
 * =============================================================================
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

const MODOS = ['normal', 'falla-temporal', 'caido', 'lento', 'rechazar'] as const;
type Modo = (typeof MODOS)[number];

interface EventoRecibido {
  recibidoEn: string;
  eventId: string;
  tipoEvento: string;
  firmaValida: boolean;
  duplicado: boolean;
  respuesta: number;
  modo: Modo;
  cuerpo: unknown;
}

// ----- Configuración ---------------------------------------------------------

const SECRETO = process.env.WEBHOOK_SECRET ?? '';
const PUERTO = Number(process.env.PORT ?? 4000);
const FALLOS_POR_EVENTO = Number(process.env.RECEPTOR_FALLOS_POR_EVENTO ?? 2);
const DEMORA_MODO_LENTO_MS = Number(process.env.RECEPTOR_DEMORA_MS ?? 15_000);
const TOLERANCIA_FIRMA_SEGUNDOS = 300;
const TAMANO_MAXIMO_CUERPO = 1024 * 1024;
const MAXIMO_EVENTOS_EN_MEMORIA = 200;

if (SECRETO.length < 32) {
  process.stderr.write('WEBHOOK_SECRET es obligatorio y debe tener al menos 32 caracteres.\n');
  process.exit(1);
}

let modoActual: Modo = esModo(process.env.RECEPTOR_MODO) ? process.env.RECEPTOR_MODO : 'normal';

/** Eventos ya procesados con éxito, por eventId */
const eventosProcesados = new Set<string>();
/** Intentos recibidos por evento (para el modo falla-temporal). */
const intentosPorEvento = new Map<string, number>();
/** Historial visible en GET /eventos. */
const eventosRecibidos: EventoRecibido[] = [];

// ----- Utilidades ------------------------------------------------------------

function esModo(valor: unknown): valor is Modo {
  return typeof valor === 'string' && (MODOS as readonly string[]).includes(valor);
}

function log(mensaje: string, datos: Record<string, unknown> = {}): void {
  process.stdout.write(`${new Date().toISOString()} [receptor] ${mensaje} ${JSON.stringify(datos)}\n`);
}

function responderJson(respuesta: ServerResponse, status: number, cuerpo: unknown): void {
  respuesta.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  respuesta.end(JSON.stringify(cuerpo, null, 2));
}

function leerCuerpo(peticion: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const fragmentos: Buffer[] = [];
    let tamano = 0;
    peticion.on('data', (fragmento: Buffer) => {
      tamano += fragmento.length;
      if (tamano > TAMANO_MAXIMO_CUERPO) {
        reject(new Error('Cuerpo demasiado grande'));
        peticion.destroy();
        return;
      }
      fragmentos.push(fragmento);
    });
    peticion.on('end', () => resolve(Buffer.concat(fragmentos).toString('utf-8')));
    peticion.on('error', reject);
  });
}

function cabecera(peticion: IncomingMessage, nombre: string): string {
  const valor = peticion.headers[nombre.toLowerCase()];
  return Array.isArray(valor) ? (valor[0] ?? '') : (valor ?? '');
}

/**
 * Verificación de la firma: recalcula HMAC-SHA256("<timestamp>.<cuerpo>") con
 * el secreto compartido y compara en tiempo constante.
 */
function verificarFirma(timestamp: string, cuerpo: string, firmaRecibida: string): boolean {
  const timestampSegundos = Number(timestamp);
  const ahoraSegundos = Math.floor(Date.now() / 1000);
  if (!Number.isInteger(timestampSegundos)) return false;
  if (Math.abs(ahoraSegundos - timestampSegundos) > TOLERANCIA_FIRMA_SEGUNDOS) return false;

  const esperada = Buffer.from(
    `sha256=${createHmac('sha256', SECRETO).update(`${timestamp}.${cuerpo}`).digest('hex')}`,
  );
  const recibida = Buffer.from(firmaRecibida);
  return esperada.length === recibida.length && timingSafeEqual(esperada, recibida);
}

function registrar(evento: EventoRecibido): void {
  eventosRecibidos.unshift(evento);
  eventosRecibidos.length = Math.min(eventosRecibidos.length, MAXIMO_EVENTOS_EN_MEMORIA);
}

// ----- Recepción del webhook --------------------------------------------------

async function recibirWebhook(peticion: IncomingMessage, respuesta: ServerResponse): Promise<void> {
  const cuerpo = await leerCuerpo(peticion);
  const eventId = cabecera(peticion, 'X-Webhook-Id');
  const tipoEvento = cabecera(peticion, 'X-Webhook-Event');
  const firmaValida = verificarFirma(
    cabecera(peticion, 'X-Webhook-Timestamp'),
    cuerpo,
    cabecera(peticion, 'X-Webhook-Signature'),
  );

  let cuerpoJson: unknown = cuerpo;
  try {
    cuerpoJson = JSON.parse(cuerpo);
  } catch {
    // Se conserva como texto; la firma ya decide si se acepta.
  }

  const base = { recibidoEn: new Date().toISOString(), eventId, tipoEvento, firmaValida, modo: modoActual, cuerpo: cuerpoJson };

  // 1. Seguridad primero: sin firma válida no se procesa nada.
  if (!firmaValida) {
    registrar({ ...base, duplicado: false, respuesta: 401 });
    log('Firma inválida: petición rechazada', { eventId });
    responderJson(respuesta, 401, { error: 'Firma inválida o expirada' });
    return;
  }

  // 2. Idempotencia: un evento ya procesado se confirma sin repetir el efecto.
  if (eventosProcesados.has(eventId)) {
    registrar({ ...base, duplicado: true, respuesta: 200 });
    log('Evento duplicado: ya se había procesado, se confirma sin repetir', { eventId });
    responderJson(respuesta, 200, { recibido: true, duplicado: true });
    return;
  }

  // 3. Comportamiento según el modo configurado.
  const intento = (intentosPorEvento.get(eventId) ?? 0) + 1;
  intentosPorEvento.set(eventId, intento);

  const responderFallo = (status: number, motivo: string) => {
    registrar({ ...base, duplicado: false, respuesta: status });
    log(motivo, { eventId, intento, status });
    responderJson(respuesta, status, { error: motivo });
  };

  switch (modoActual) {
    case 'caido':
      responderFallo(503, 'Simulación: servicio no disponible');
      return;
    case 'rechazar':
      responderFallo(400, 'Simulación: solicitud rechazada de forma permanente');
      return;
    case 'falla-temporal':
      if (intento <= FALLOS_POR_EVENTO) {
        responderFallo(503, `Simulación: falla temporal (${intento}/${FALLOS_POR_EVENTO})`);
        return;
      }
      break;
    case 'lento':
      log('Simulación: respuesta lenta', { eventId, demoraMs: DEMORA_MODO_LENTO_MS });
      await new Promise((resolve) => setTimeout(resolve, DEMORA_MODO_LENTO_MS));
      break;
    case 'normal':
      break;
  }

  eventosProcesados.add(eventId);
  registrar({ ...base, duplicado: false, respuesta: 200 });
  log('Evento procesado', { eventId, intento, tipoEvento });
  responderJson(respuesta, 200, { recibido: true, eventId });
}

// ----- Servidor -----------------------------------------------------------------

const servidor = createServer(async (peticion, respuesta) => {
  const ruta = new URL(peticion.url ?? '/', 'http://localhost').pathname;
  const metodo = peticion.method ?? 'GET';

  try {
    if (metodo === 'POST' && ruta === '/webhooks/creditos') {
      await recibirWebhook(peticion, respuesta);
    } else if (metodo === 'GET' && ruta === '/eventos') {
      responderJson(respuesta, 200, { total: eventosRecibidos.length, eventos: eventosRecibidos });
    } else if (metodo === 'DELETE' && ruta === '/eventos') {
      eventosRecibidos.length = 0;
      eventosProcesados.clear();
      intentosPorEvento.clear();
      responderJson(respuesta, 200, { limpiado: true });
    } else if (metodo === 'GET' && ruta === '/modo') {
      responderJson(respuesta, 200, { modo: modoActual, modosDisponibles: MODOS });
    } else if (metodo === 'PUT' && ruta === '/modo') {
      const { modo } = JSON.parse((await leerCuerpo(peticion)) || '{}') as { modo?: unknown };
      if (!esModo(modo)) {
        responderJson(respuesta, 400, { error: `Modo inválido. Use uno de: ${MODOS.join(', ')}` });
        return;
      }
      modoActual = modo;
      log('Modo cambiado', { modo });
      responderJson(respuesta, 200, { modo: modoActual });
    } else if (metodo === 'GET' && ruta === '/health') {
      responderJson(respuesta, 200, { status: 'UP', modo: modoActual });
    } else {
      responderJson(respuesta, 404, { error: 'Ruta no encontrada' });
    }
  } catch (error) {
    log('Error procesando la petición', { error: String(error) });
    if (!respuesta.headersSent) responderJson(respuesta, 500, { error: 'Error interno del receptor' });
  }
});

servidor.listen(PUERTO, () => log('Receptor de webhooks escuchando', { puerto: PUERTO, modo: modoActual }));

const apagar = () => servidor.close(() => process.exit(0));
process.on('SIGTERM', apagar);
process.on('SIGINT', apagar);
