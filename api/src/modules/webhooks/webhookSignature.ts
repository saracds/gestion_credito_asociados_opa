import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * FIRMA DE WEBHOOKS — HMAC-SHA256 con marca de tiempo
 *
 * El sistema externo necesita estar seguro de dos cosas:
 *   1. AUTENTICIDAD: la notificación la envió esta API y no un tercero.
 *   2. INTEGRIDAD: el cuerpo no fue alterado en el camino.
 *
 * Cómo funciona: ambos sistemas comparten un secreto que nunca viaja por la
 * red. Por cada envío se calcula
 *
 *     firma = HMAC-SHA256(secreto, "<timestamp>.<cuerpo exacto>")
 *
 * y se envía en cabeceras junto con el timestamp. El receptor repite el
 * cálculo con su copia del secreto y compara. Si alguien cambia un solo
 * carácter del cuerpo, la firma deja de coincidir.
 *
 * Por qué incluir el timestamp en la firma: evita ataques de REPETICIÓN. Un
 * atacante que capture una petición válida no puede reenviarla días después,
 * porque el receptor rechaza firmas con más de unos minutos de antigüedad, y
 * tampoco puede cambiar el timestamp sin invalidar la firma.
 *
 * Por qué no una API Key en una cabecera: la llave probaría quién envía, pero
 * no que el cuerpo llegó intacto, y quien la capture puede reutilizarla.
 */

export const WEBHOOK_HEADERS = {
  EVENT_ID: 'X-Webhook-Id',
  EVENT_TYPE: 'X-Webhook-Event',
  TIMESTAMP: 'X-Webhook-Timestamp',
  SIGNATURE: 'X-Webhook-Signature',
} as const;

const SIGNATURE_PREFIX = 'sha256=';

/** Tolerancia de antigüedad que se recomienda al receptor. */
export const TOLERANCIA_FIRMA_SEGUNDOS = 300;

/** Calcula la firma en el formato de la cabecera: "sha256=<hex>". */
export function firmarWebhook(secreto: string, timestampSegundos: number, cuerpo: string): string {
  const firma = createHmac('sha256', secreto)
    .update(`${timestampSegundos}.${cuerpo}`)
    .digest('hex');
  return `${SIGNATURE_PREFIX}${firma}`;
}

/**
 * Verifica una firma recibida. Es la lógica que debe implementar el receptor;
 * se incluye aquí para las pruebas automatizadas.
 *
 * Usa `timingSafeEqual` (comparación de tiempo constante): con una comparación
 * normal, un atacante podría deducir la firma correcta midiendo cuánto tarda
 * el servidor en rechazar cada intento.
 */
export function verificarFirmaWebhook(params: {
  secreto: string;
  timestampSegundos: number;
  cuerpo: string;
  firmaRecibida: string;
  ahoraSegundos?: number;
  toleranciaSegundos?: number;
}): boolean {
  const ahora = params.ahoraSegundos ?? Math.floor(Date.now() / 1000);
  const tolerancia = params.toleranciaSegundos ?? TOLERANCIA_FIRMA_SEGUNDOS;

  if (Math.abs(ahora - params.timestampSegundos) > tolerancia) {
    return false;
  }

  const esperada = Buffer.from(
    firmarWebhook(params.secreto, params.timestampSegundos, params.cuerpo),
  );
  const recibida = Buffer.from(params.firmaRecibida);

  return esperada.length === recibida.length && timingSafeEqual(esperada, recibida);
}
