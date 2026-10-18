import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RotateCcwIcon } from 'lucide-react';
import { toast } from 'sonner';

import { reprogramarNotificacion } from '@/api/endpoints';
import type { TrazaNotificacion as Traza } from '@/api/types';
import { PERMISOS, useAuth } from '@/auth/AuthContext';
import { Button } from '@/components/ui/button';
import { notificarError } from '@/lib/errores';
import { formatearFechaHora } from '@/lib/formato';
import { cn } from '@/lib/utils';

const ESTADO_NOTIFICACION = {
  PENDIENTE: { etiqueta: 'Pendiente de envío', clase: 'text-estado-en-estudio' },
  ENVIANDO: { etiqueta: 'Enviando', clase: 'text-estado-solicitado' },
  ENVIADO: { etiqueta: 'Entregada', clase: 'text-estado-aprobado' },
  FALLIDO: { etiqueta: 'No entregada', clase: 'text-estado-rechazado' },
} as const;

/**
 * Traza de la notificación al sistema externo (webhook credito.creado):
 * estado, intentos y el resultado de cada uno. La consulta se refresca sola
 * mientras la notificación está pendiente, así se ven los reintentos en vivo.
 */
export function TrazaNotificacion({
  notificaciones,
  creditoId,
}: {
  notificaciones: Traza[];
  creditoId: number;
}) {
  if (notificaciones.length === 0) {
    return (
      <p className="text-muted-foreground">Este crédito no tiene notificaciones registradas.</p>
    );
  }
  return (
    <div className="grid gap-4">
      {notificaciones.map((notificacion) => (
        <Notificacion key={notificacion.id} notificacion={notificacion} creditoId={creditoId} />
      ))}
    </div>
  );
}

function Notificacion({ notificacion, creditoId }: { notificacion: Traza; creditoId: number }) {
  const { tieneRol } = useAuth();
  const queryClient = useQueryClient();
  const estado = ESTADO_NOTIFICACION[notificacion.estado];

  const reproceso = useMutation({
    mutationFn: () => reprogramarNotificacion(notificacion.id),
    onSuccess: () => {
      toast.success('La notificación se enviará de nuevo en unos segundos.');
      void queryClient.invalidateQueries({ queryKey: ['notificaciones', creditoId] });
    },
    onError: notificarError,
  });

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p>
          <span className={cn('font-bold', estado.clase)}>{estado.etiqueta}</span>
          <span className="text-muted-foreground">
            , intento {notificacion.intentos} de {notificacion.maxIntentos}
          </span>
        </p>
        {notificacion.estado === 'FALLIDO' && tieneRol(...PERMISOS.reprogramarWebhooks) && (
          <Button
            size="sm"
            variant="outline"
            disabled={reproceso.isPending}
            onClick={() => reproceso.mutate()}
          >
            <RotateCcwIcon aria-hidden />
            Reintentar envío
          </Button>
        )}
      </div>

      {notificacion.estado === 'PENDIENTE' &&
        notificacion.proximoIntento &&
        notificacion.intentos > 0 && (
          <p className="text-sm text-muted-foreground">
            Próximo intento: {formatearFechaHora(notificacion.proximoIntento)}.
          </p>
        )}

      {notificacion.detalleIntentos.length > 0 && (
        <ol className="grid gap-1.5 text-sm">
          {notificacion.detalleIntentos.map((intento) => (
            <li key={intento.numeroIntento} className="grid grid-cols-[1.5rem_1fr] gap-2">
              <span className="text-muted-foreground">{intento.numeroIntento}.</span>
              <span>
                <span
                  className={intento.exitoso ? 'text-estado-aprobado' : 'text-estado-rechazado'}
                >
                  {intento.exitoso ? 'Entregada' : 'Falló'}
                  {intento.codigoHttp !== null && ` (HTTP ${intento.codigoHttp})`}
                </span>
                <span className="text-muted-foreground">
                  {' '}
                  el {formatearFechaHora(intento.fechaIntento)}
                  {intento.duracionMs !== null && `, ${intento.duracionMs} ms`}
                </span>
                {intento.error && (
                  <span className="block text-muted-foreground">{intento.error}</span>
                )}
              </span>
            </li>
          ))}
        </ol>
      )}

      <p className="text-xs break-all text-muted-foreground">
        Identificador del evento: {notificacion.eventId}
      </p>
    </div>
  );
}
