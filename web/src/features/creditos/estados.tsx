import { CheckIcon } from 'lucide-react';

import type { EstadoCredito } from '@/api/types';
import { cn } from '@/lib/utils';

/**
 * Presentación de los estados del crédito. 
 * La API entrega un estado por crédito; la UI lo muestra con su etiqueta, color y descripción.
 */
export const ESTADO_INFO: Record<
  EstadoCredito,
  {
    etiqueta: string;
    accion: string;
    descripcion: string;
    texto: string;
    fondo: string;
    borde: string;
    relleno: string;
  }
> = {
  SOLICITADO: {
    etiqueta: 'Solicitado',
    accion: 'Volver a solicitado',
    descripcion: 'Recibido, pendiente de iniciar el estudio.',
    texto: 'text-estado-solicitado',
    fondo: 'bg-estado-solicitado/10',
    borde: 'border-estado-solicitado',
    relleno: 'bg-estado-solicitado',
  },
  EN_ESTUDIO: {
    etiqueta: 'En estudio',
    accion: 'Iniciar estudio',
    descripcion: 'Un analista verifica capacidad de pago y documentos.',
    texto: 'text-estado-en-estudio',
    fondo: 'bg-estado-en-estudio/10',
    borde: 'border-estado-en-estudio',
    relleno: 'bg-estado-en-estudio',
  },
  APROBADO: {
    etiqueta: 'Aprobado',
    accion: 'Aprobar',
    descripcion: 'Aprobado, pendiente de desembolso.',
    texto: 'text-estado-aprobado',
    fondo: 'bg-estado-aprobado/10',
    borde: 'border-estado-aprobado',
    relleno: 'bg-estado-aprobado',
  },
  DESEMBOLSADO: {
    etiqueta: 'Desembolsado',
    accion: 'Registrar desembolso',
    descripcion: 'El dinero fue entregado al asociado.',
    texto: 'text-estado-desembolsado',
    fondo: 'bg-estado-desembolsado/10',
    borde: 'border-estado-desembolsado',
    relleno: 'bg-estado-desembolsado',
  },
  RECHAZADO: {
    etiqueta: 'Rechazado',
    accion: 'Rechazar',
    descripcion: 'No cumplió las condiciones del estudio.',
    texto: 'text-estado-rechazado',
    fondo: 'bg-estado-rechazado/10',
    borde: 'border-estado-rechazado',
    relleno: 'bg-estado-rechazado',
  },
  CANCELADO: {
    etiqueta: 'Cancelado',
    accion: 'Cancelar',
    descripcion: 'Retirado antes de completarse.',
    texto: 'text-estado-cancelado',
    fondo: 'bg-estado-cancelado/10',
    borde: 'border-estado-cancelado',
    relleno: 'bg-estado-cancelado',
  },
};

/** Camino principal del crédito; RECHAZADO y CANCELADO son salidas del camino. */
export const CAMINO_PRINCIPAL: EstadoCredito[] = [
  'SOLICITADO',
  'EN_ESTUDIO',
  'APROBADO',
  'DESEMBOLSADO',
];
export const SALIDAS: EstadoCredito[] = ['RECHAZADO', 'CANCELADO'];

/** Insignia compacta para tablas y listas. */
export function EstadoBadge({ estado }: { estado: EstadoCredito }) {
  const info = ESTADO_INFO[estado];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold',
        info.fondo,
        info.texto,
      )}
    >
      <span className={cn('size-1.5 rounded-full', info.relleno)} aria-hidden />
      {info.etiqueta}
    </span>
  );
}

/**
 * SELLO: el elemento distintivo del detalle. 
 */
export function EstadoSello({ estado, className }: { estado: EstadoCredito; className?: string }) {
  const info = ESTADO_INFO[estado];
  return (
    <div
      className={cn(
        'inline-flex -rotate-3 flex-col items-center rounded-md border-[3px] border-double px-4 py-1.5',
        info.borde,
        info.texto,
        className,
      )}
      role="img"
      aria-label={`Estado: ${info.etiqueta}`}
    >
      <span className="text-xl leading-tight font-extrabold tracking-wide">{info.etiqueta}</span>
    </div>
  );
}

/**
 * RECORRIDO del crédito sobre la máquina de estados: qué pasos cumplió, dónde
 * está y, si salió del camino (rechazado o cancelado), en qué punto lo hizo.
 */
export function RecorridoEstados({
  estadoActual,
  estadosVisitados,
}: {
  estadoActual: EstadoCredito;
  estadosVisitados: EstadoCredito[];
}) {
  const salioDelCamino = SALIDAS.includes(estadoActual);
  const ultimoEnCamino = salioDelCamino
    ? [...estadosVisitados].reverse().find((estado) => CAMINO_PRINCIPAL.includes(estado))
    : estadoActual;
  const indiceUltimo = ultimoEnCamino ? CAMINO_PRINCIPAL.indexOf(ultimoEnCamino) : 0;

  return (
    <ol className="flex flex-wrap items-center gap-y-3" aria-label="Recorrido del crédito">
      {CAMINO_PRINCIPAL.map((estado, indice) => {
        const info = ESTADO_INFO[estado];
        const esActual = !salioDelCamino && estado === estadoActual;
        const cumplido = indice < indiceUltimo || (salioDelCamino && indice === indiceUltimo);
        const pendiente = !esActual && !cumplido;
        return (
          <li key={estado} className="flex items-center">
            {indice > 0 && (
              <span
                className={cn('mx-2 h-0.5 w-6 sm:w-10', pendiente ? 'bg-border' : 'bg-primary/60')}
                aria-hidden
              />
            )}
            <span
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm',
                esActual && cn('border-2 font-bold', info.borde, info.texto, info.fondo),
                cumplido && 'border-primary/40 text-foreground',
                pendiente && 'border-dashed text-muted-foreground',
              )}
              aria-current={esActual ? 'step' : undefined}
            >
              {cumplido && <CheckIcon className="size-3.5 text-primary" aria-hidden />}
              {info.etiqueta}
              <span className="sr-only">
                {esActual ? ' (estado actual)' : cumplido ? ' (cumplido)' : ' (pendiente)'}
              </span>
            </span>
          </li>
        );
      })}
      {salioDelCamino && (
        <li className="flex items-center">
          <span className="mx-2 h-0.5 w-6 bg-border sm:w-10" aria-hidden />
          <span
            className={cn(
              'rounded-full border-2 px-3 py-1 text-sm font-bold',
              ESTADO_INFO[estadoActual].borde,
              ESTADO_INFO[estadoActual].texto,
              ESTADO_INFO[estadoActual].fondo,
            )}
            aria-current="step"
          >
            {ESTADO_INFO[estadoActual].etiqueta}
            <span className="sr-only"> (estado actual, salió del camino)</span>
          </span>
        </li>
      )}
    </ol>
  );
}
