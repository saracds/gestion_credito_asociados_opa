import { writeFile } from 'node:fs/promises';

import type { Logger } from '../../shared/logging/logger.js';
import type { WebhookDispatcher } from './WebhookDispatcher.js';

export interface WebhookWorkerConfig {
  intervaloMs: number;
  archivoLatido: string;
}

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

/**
 * Ciclo del worker: procesa lotes mientras haya eventos pendientes y, cuando
 * la bandeja queda vacía, espera `intervaloMs` antes de volver a consultar.
 *
 * - Un error en un ciclo (p. ej. la base de datos se reinicia) se registra y
 *   el worker sigue: el siguiente ciclo lo vuelve a intentar.
 * - En cada ciclo escribe un "latido" (archivo con la hora actual). El
 *   healthcheck de Docker verifica que sea reciente: si el ciclo se queda
 *   colgado, el contenedor se marca como no saludable y se reinicia.
 * - `detener()` termina el ciclo después del lote en curso (apagado ordenado).
 */
export class WebhookWorker {
  private enEjecucion = false;
  private cicloActual: Promise<void> | null = null;

  constructor(
    private readonly dispatcher: WebhookDispatcher,
    private readonly logger: Logger,
    private readonly config: WebhookWorkerConfig,
  ) {}

  iniciar(): void {
    this.enEjecucion = true;
    this.cicloActual = this.ejecutarCiclo();
    this.logger.info({ intervaloMs: this.config.intervaloMs }, 'Worker de webhooks iniciado');
  }

  async detener(): Promise<void> {
    this.enEjecucion = false;
    await this.cicloActual;
    this.logger.info('Worker de webhooks detenido');
  }

  private async ejecutarCiclo(): Promise<void> {
    while (this.enEjecucion) {
      let eventosProcesados = 0;
      try {
        eventosProcesados = await this.dispatcher.procesarLote();
      } catch (error) {
        this.logger.error({ err: error }, 'Error procesando el lote de webhooks; se reintentará');
      }

      await this.registrarLatido();

      // Si el lote vino lleno puede haber más pendientes: se continúa sin esperar.
      if (eventosProcesados === 0 && this.enEjecucion) {
        await wait(this.config.intervaloMs);
      }
    }
  }

  private async registrarLatido(): Promise<void> {
    try {
      await writeFile(this.config.archivoLatido, String(Date.now()));
    } catch (error) {
      this.logger.warn({ err: error }, 'No fue posible escribir el archivo de latido');
    }
  }
}
