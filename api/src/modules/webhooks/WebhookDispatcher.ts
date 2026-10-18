import type { Logger } from '../../shared/logging/logger.js';
import {
  calcularEsperaSegundos,
  esFallaTemporal,
  type ConfiguracionReintentos,
} from './politicaReintentos.js';
import { firmarWebhook, WEBHOOK_HEADERS } from './webhookSignature.js';
import type { NotificacionReclamada, WebhookOutboxRepository } from './WebhookOutboxRepository.js';

export interface WebhookDispatcherConfig {
  secreto: string;
  tamanoLote: number;
  timeoutMs: number;
  reintentos: ConfiguracionReintentos;
}

export interface WebhookDispatcherDependencies {
  outboxRepository: WebhookOutboxRepository;
  logger: Logger;
  config: WebhookDispatcherConfig;
  /** Cliente HTTP inyectable (por defecto `fetch` nativo); las pruebas lo reemplazan. */
  httpClient?: typeof fetch;
  /** Reloj inyectable para pruebas deterministas. */
  ahora?: () => Date;
}

/** Resultado de un envío, independiente de cómo terminó (éxito, error HTTP o sin respuesta). */
interface ResultadoEnvio {
  codigoHttp: number | null;
  duracionMs: number;
  error: string | null;
}

/**
 * Envía los eventos pendientes del outbox al sistema externo.
 *
 * Por cada evento:
 *   1. Firma el cuerpo con HMAC-SHA256 + timestamp.
 *   2. Hace el POST con tiempo máximo de espera (un externo colgado no puede
 *      bloquear al worker indefinidamente).
 *   3. Clasifica el resultado y lo registra: ENVIADO, reintento programado con
 *      backoff exponencial, o FALLIDO.
 *
 * Garantía de entrega: "al menos una vez". Si el worker se cae justo después
 * de que el externo respondió 200 pero antes de registrarlo, el evento se
 * reenviará; por eso cada envío lleva un `eventId` estable que el receptor usa
 * para descartar duplicados (idempotencia).
 */
export class WebhookDispatcher {
  private readonly httpClient: typeof fetch;
  private readonly ahora: () => Date;

  constructor(private readonly dependencies: WebhookDispatcherDependencies) {
    this.httpClient = dependencies.httpClient ?? fetch;
    this.ahora = dependencies.ahora ?? (() => new Date());
  }

  /**
   * Procesa un lote. Devuelve cuántos eventos tomó (0 = no había pendientes).
   * Los envíos del lote se hacen en paralelo: un externo lento no retrasa a los demás.
   */
  async procesarLote(): Promise<number> {
    const { outboxRepository, config } = this.dependencies;
    // El bloqueo dura más que el timeout del envío: mientras el worker trabaja,
    // ningún otro puede retomar el evento.
    const segundosBloqueo = Math.ceil(config.timeoutMs / 1000) + 30;

    const notificaciones = await outboxRepository.reclamarPendientes(
      config.tamanoLote,
      segundosBloqueo,
    );

    await Promise.all(notificaciones.map((notificacion) => this.procesar(notificacion)));
    return notificaciones.length;
  }

  private async procesar(notificacion: NotificacionReclamada): Promise<void> {
    const { outboxRepository, logger, config } = this.dependencies;
    const numeroIntento = notificacion.intentos + 1;
    const contexto = {
      eventId: notificacion.eventId,
      notificacionId: notificacion.id,
      intento: `${numeroIntento}/${notificacion.maxIntentos}`,
    };

    const resultado = await this.enviar(notificacion);
    const exitoso =
      resultado.codigoHttp !== null && resultado.codigoHttp >= 200 && resultado.codigoHttp < 300;

    if (exitoso) {
      await outboxRepository.registrarExito({
        notificacionId: notificacion.id,
        numeroIntento,
        codigoHttp: resultado.codigoHttp,
        duracionMs: resultado.duracionMs,
      });
      logger.info({ ...contexto, codigoHttp: resultado.codigoHttp }, 'Webhook entregado');
      return;
    }

    const quedanIntentos = numeroIntento < notificacion.maxIntentos;
    const reintentar = quedanIntentos && esFallaTemporal(resultado.codigoHttp);
    const proximoIntento = reintentar
      ? new Date(
          this.ahora().getTime() + calcularEsperaSegundos(numeroIntento, config.reintentos) * 1000,
        )
      : null;

    await outboxRepository.registrarFallo({
      notificacionId: notificacion.id,
      numeroIntento,
      codigoHttp: resultado.codigoHttp,
      duracionMs: resultado.duracionMs,
      error: resultado.error ?? `Respuesta HTTP ${resultado.codigoHttp}`,
      proximoIntento,
    });

    if (proximoIntento) {
      logger.warn(
        { ...contexto, codigoHttp: resultado.codigoHttp, error: resultado.error, proximoIntento },
        'Webhook no entregado; se reintentará',
      );
    } else {
      logger.error(
        { ...contexto, codigoHttp: resultado.codigoHttp, error: resultado.error },
        quedanIntentos
          ? 'Webhook rechazado de forma permanente (4xx); queda FALLIDO'
          : 'Webhook agotó sus intentos; queda FALLIDO',
      );
    }
  }

  /** Hace el POST firmado. Nunca lanza: cualquier problema se convierte en un resultado. */
  private async enviar(notificacion: NotificacionReclamada): Promise<ResultadoEnvio> {
    const { config } = this.dependencies;
    const timestamp = Math.floor(this.ahora().getTime() / 1000);
    const inicio = performance.now();

    try {
      const respuesta = await this.httpClient(notificacion.urlDestino, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'creditos-opa-webhooks/1.0',
          [WEBHOOK_HEADERS.EVENT_ID]: notificacion.eventId,
          [WEBHOOK_HEADERS.EVENT_TYPE]: notificacion.tipoEvento,
          [WEBHOOK_HEADERS.TIMESTAMP]: String(timestamp),
          [WEBHOOK_HEADERS.SIGNATURE]: firmarWebhook(
            config.secreto,
            timestamp,
            notificacion.payload,
          ),
        },
        body: notificacion.payload,
        signal: AbortSignal.timeout(config.timeoutMs),
        redirect: 'error', // una redirección podría enviar el evento a un destino no autorizado
      });

      // Se consume el cuerpo para liberar la conexión; su contenido no se usa.
      await respuesta.body?.cancel();

      return {
        codigoHttp: respuesta.status,
        duracionMs: Math.round(performance.now() - inicio),
        error: respuesta.ok ? null : `El sistema externo respondió HTTP ${respuesta.status}`,
      };
    } catch (error) {
      return {
        codigoHttp: null,
        duracionMs: Math.round(performance.now() - inicio),
        error: describirErrorDeRed(error, config.timeoutMs),
      };
    }
  }
}

/** Traduce errores de red a un texto claro para la traza. */
function describirErrorDeRed(error: unknown, timeoutMs: number): string {
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return `Sin respuesta del sistema externo en ${timeoutMs} ms (timeout)`;
  }
  const causa =
    error instanceof Error && error.cause instanceof Error ? error.cause.message : undefined;
  const mensaje = error instanceof Error ? error.message : String(error);
  return `No fue posible conectar con el sistema externo: ${causa ?? mensaje}`;
}
