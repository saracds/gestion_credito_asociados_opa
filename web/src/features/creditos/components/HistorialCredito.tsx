import type { EventoHistorial } from '@/api/types';
import { formatearFechaHora, formatearPesos, formatearTasa } from '@/lib/formato';

import { ESTADO_INFO } from '../estados';

const NOMBRE_CAMPO: Record<string, string> = {
  valorSolicitado: 'Valor',
  tasaInteres: 'Tasa',
  numeroCuotas: 'Cuotas',
  tipoCredito: 'Tipo de crédito',
  formaPago: 'Forma de pago',
};

function formatearValor(campo: string, valor: unknown): string {
  if (typeof valor !== 'number') return String(valor);
  if (campo === 'valorSolicitado') return formatearPesos(valor);
  if (campo === 'tasaInteres') return formatearTasa(valor);
  return valor.toLocaleString('es-CO');
}

function describirEvento(evento: EventoHistorial): string {
  switch (evento.tipoEvento) {
    case 'CREACION':
      return 'Registró la solicitud';
    case 'CAMBIO_ESTADO':
      return evento.estadoAnterior
        ? `Cambió de ${ESTADO_INFO[evento.estadoAnterior].etiqueta.toLowerCase()} a ${ESTADO_INFO[evento.estadoNuevo].etiqueta.toLowerCase()}`
        : `Cambió a ${ESTADO_INFO[evento.estadoNuevo].etiqueta.toLowerCase()}`;
    case 'ACTUALIZACION':
      return 'Modificó las condiciones';
    case 'ELIMINACION':
      return 'Eliminó el crédito';
  }
}

/**
 * Historial como renglones de una libreta: cada movimiento con fecha, quién lo
 * hizo, qué cambió y por qué.
 */
export function HistorialCredito({ eventos }: { eventos: EventoHistorial[] }) {
  return (
    <ol className="divide-y divide-dashed">
      {eventos.map((evento) => {
        const cambios =
          evento.tipoEvento === 'ACTUALIZACION' && evento.detalleCambios
            ? Object.entries(
                evento.detalleCambios as Record<string, { anterior: unknown; nuevo: unknown }>,
              )
            : [];
        return (
          <li key={evento.id} className="grid gap-1 py-3 sm:grid-cols-[13rem_1fr] sm:gap-4">
            <time dateTime={evento.fechaEvento} className="text-sm text-muted-foreground">
              {formatearFechaHora(evento.fechaEvento)}
            </time>
            <div className="grid gap-1">
              <p>
                <span className="font-semibold">{evento.usuario.nombre}</span>{' '}
                {describirEvento(evento).toLowerCase()}
              </p>
              {cambios.length > 0 && (
                <ul className="text-sm">
                  {cambios.map(([campo, cambio]) => (
                    <li key={campo}>
                      {NOMBRE_CAMPO[campo] ?? campo}:{' '}
                      <span className="text-muted-foreground line-through">
                        {formatearValor(campo, cambio.anterior)}
                      </span>{' '}
                      <span className="font-semibold">{formatearValor(campo, cambio.nuevo)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {evento.observacion && (
                <p className="text-sm text-muted-foreground">“{evento.observacion}”</p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
