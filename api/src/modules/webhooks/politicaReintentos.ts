/**
 * POLÍTICA DE REINTENTOS — ¿qué pasa si el sistema externo no responde,
 * devuelve error o está temporalmente fuera de servicio? 
 *
 * 1. El crédito YA está creado: la notificación nunca bloquea ni revierte la
 *    operación de negocio (outbox transaccional).
 * 2. Se clasifica el resultado de cada intento:
 *      - 2xx                      -> ENVIADO.
 *      - Sin respuesta (timeout, conexión rechazada, DNS), 5xx, 408 o 429
 *                                 -> falla TEMPORAL: se reintenta.
 *      - Otros 4xx (400, 401, 404...) -> falla PERMANENTE: reenviar el mismo
 *        contenido daría el mismo resultado (p. ej. firma rechazada o URL
 *        inexistente). Pasa a FALLIDO de inmediato para revisión humana.
 * 3. Los reintentos esperan cada vez más (backoff exponencial): 10 s, 20 s,
 *    40 s, 80 s... con tope. Así no se satura a un sistema que se está
 *    recuperando.
 * 4. Se agrega una variación aleatoria de ±20 % (jitter). Si el externo estuvo
 *    caído y había cientos de eventos pendientes, evita que todos se reintenten
 *    en el mismo segundo (efecto "manada").
 * 5. Al agotar los intentos (6 por defecto, columna maxIntentos) el evento
 *    queda FALLIDO. Un ADMIN puede reprogramarlo cuando el externo se recupere.
 */

export interface ConfiguracionReintentos {
  esperaBaseSegundos: number;
  esperaMaximaSegundos: number;
}

const VARIACION_ALEATORIA = 0.2;

/** Códigos HTTP 4xx que sí indican una condición temporal. */
const CODIGOS_4XX_TEMPORALES = new Set([408, 429]);

/** ¿Tiene sentido volver a intentar? `codigoHttp` es null si no hubo respuesta. */
export function esFallaTemporal(codigoHttp: number | null): boolean {
  if (codigoHttp === null) return true;
  if (codigoHttp >= 500) return true;
  return CODIGOS_4XX_TEMPORALES.has(codigoHttp);
}

/**
 * Segundos de espera antes del siguiente intento.
 * @param numeroIntento intento que acaba de fallar (1, 2, 3...).
 * @param aleatorio fuente de aleatoriedad (inyectable para pruebas deterministas).
 */
export function calcularEsperaSegundos(
  numeroIntento: number,
  configuracion: ConfiguracionReintentos,
  aleatorio: () => number = Math.random,
): number {
  const esperaExponencial = configuracion.esperaBaseSegundos * 2 ** (numeroIntento - 1);
  const esperaAcotada = Math.min(esperaExponencial, configuracion.esperaMaximaSegundos);
  const factorVariacion = 1 + (aleatorio() * 2 - 1) * VARIACION_ALEATORIA;
  return Math.max(1, Math.round(esperaAcotada * factorVariacion));
}
