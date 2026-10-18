import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeftIcon, PencilIcon, Trash2Icon } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';

import { ApiError } from '@/api/client';
import {
  obtenerCatalogos,
  obtenerCredito,
  obtenerHistorial,
  obtenerNotificaciones,
} from '@/api/endpoints';
import type { EstadoCredito } from '@/api/types';
import { PERMISOS, useAuth } from '@/auth/AuthContext';
import { Button } from '@/components/ui/button';
import { Alert, Skeleton } from '@/components/ui/feedback';
import { formatearFechaHora, formatearPesos, formatearTasa } from '@/lib/formato';
import { mensajeDeError } from '@/lib/errores';

import {
  DialogoCambioEstado,
  DialogoEditarCondiciones,
  DialogoEliminar,
} from './components/AccionesCredito';
import { HistorialCredito } from './components/HistorialCredito';
import { TrazaNotificacion } from './components/TrazaNotificacion';
import { ESTADO_INFO, EstadoSello, RecorridoEstados } from './estados';

export function DetalleCreditoPage() {
  const id = Number(useParams().id);
  const { tieneRol } = useAuth();
  const [estadoDestino, setEstadoDestino] = useState<EstadoCredito | null>(null);
  const [editando, setEditando] = useState(false);
  const [eliminando, setEliminando] = useState(false);

  const credito = useQuery({
    queryKey: ['credito', id],
    queryFn: () => obtenerCredito(id),
    enabled: id > 0,
  });
  const historial = useQuery({
    queryKey: ['historial', id],
    queryFn: () => obtenerHistorial(id),
    enabled: id > 0,
  });
  const catalogos = useQuery({
    queryKey: ['catalogos'],
    queryFn: obtenerCatalogos,
    staleTime: Infinity,
  });
  const notificaciones = useQuery({
    queryKey: ['notificaciones', id],
    queryFn: () => obtenerNotificaciones(id),
    enabled: id > 0,
    // Mientras haya envíos en curso se consulta cada 3 s para mostrar los reintentos en vivo.
    refetchInterval: (consulta) =>
      consulta.state.data?.some((n) => n.estado === 'PENDIENTE' || n.estado === 'ENVIANDO')
        ? 3_000
        : false,
  });

  if (credito.isLoading) return <Skeleton className="h-96" />;

  if (credito.isError || !credito.data) {
    const noExiste = credito.error instanceof ApiError && credito.error.status === 404;
    return (
      <div className="grid max-w-xl gap-4">
        <Alert titulo={noExiste ? 'Este crédito no existe' : 'No fue posible cargar el crédito'}>
          {noExiste
            ? 'Puede que se haya eliminado o que el enlace esté incompleto.'
            : mensajeDeError(credito.error)}
        </Alert>
        <Button variant="outline" asChild className="justify-self-start">
          <Link to="/creditos">Ir al listado de créditos</Link>
        </Button>
      </div>
    );
  }

  const c = credito.data;
  const puedeGestionar = tieneRol(...PERMISOS.gestionar);
  const estadosVisitados = historial.data?.map((evento) => evento.estadoNuevo) ?? [c.estado];

  return (
    <>
      <Link
        to="/creditos"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
      >
        <ArrowLeftIcon className="size-4" aria-hidden />
        Créditos
      </Link>

      <header className="mb-6 flex flex-wrap items-start justify-between gap-6">
        <div className="grid gap-1">
          <h1 className="text-[1.75rem] leading-tight font-bold">{c.numeroCredito}</h1>
          <p className="text-lg">
            {c.nombreAsociado}{' '}
            <span className="text-muted-foreground">({c.identificacionAsociado})</span>
          </p>
        </div>
        <EstadoSello estado={c.estado} />
      </header>

      <section aria-label="Recorrido del crédito" className="mb-6 rounded-lg border bg-card p-5">
        <RecorridoEstados estadoActual={c.estado} estadosVisitados={estadosVisitados} />
        <p className="mt-3 text-sm text-muted-foreground">{ESTADO_INFO[c.estado].descripcion}</p>

        {puedeGestionar &&
          (c.transicionesPermitidas.length > 0 ||
            c.editable ||
            (c.eliminable && tieneRol(...PERMISOS.eliminar))) && (
            <div className="mt-4 flex flex-wrap gap-2 border-t pt-4">
              {c.transicionesPermitidas.map((estado) => (
                <Button
                  key={estado}
                  variant={estado === 'RECHAZADO' || estado === 'CANCELADO' ? 'outline' : 'default'}
                  onClick={() => setEstadoDestino(estado)}
                >
                  {ESTADO_INFO[estado].accion}
                </Button>
              ))}
              {c.editable && catalogos.data && (
                <Button variant="outline" onClick={() => setEditando(true)}>
                  <PencilIcon aria-hidden />
                  Editar condiciones
                </Button>
              )}
              {c.eliminable && tieneRol(...PERMISOS.eliminar) && (
                <Button
                  variant="ghost"
                  className="text-destructive hover:bg-destructive/10"
                  onClick={() => setEliminando(true)}
                >
                  <Trash2Icon aria-hidden />
                  Eliminar
                </Button>
              )}
            </div>
          )}
        {c.transicionesPermitidas.length === 0 && (
          <p className="mt-3 text-sm text-muted-foreground">
            Este es un estado final: el crédito ya no admite cambios.
          </p>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
        <section aria-labelledby="titulo-condiciones" className="rounded-lg border bg-card p-5">
          <h2 id="titulo-condiciones" className="mb-3 text-lg font-bold">
            Condiciones
          </h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2.5">
            <Dato
              termino="Valor solicitado"
              valor={<strong className="text-lg">{formatearPesos(c.valorSolicitado)}</strong>}
            />
            <Dato termino="Tipo de crédito" valor={c.tipoCreditoNombre} />
            <Dato termino="Tasa de interés" valor={formatearTasa(c.tasaInteres)} />
            <Dato termino="Cuotas" valor={`${c.numeroCuotas} cuotas mensuales`} />
            <Dato termino="Forma de pago" valor={c.formaPagoNombre} />
            <Dato termino="Solicitado" valor={formatearFechaHora(c.fechaSolicitud)} />
            <Dato termino="Última modificación" valor={formatearFechaHora(c.fechaActualizacion)} />
          </dl>
        </section>

        <section aria-labelledby="titulo-historial" className="rounded-lg border bg-card p-5">
          <h2 id="titulo-historial" className="mb-1 text-lg font-bold">
            Historial
          </h2>
          {historial.isLoading && <Skeleton className="h-32" />}
          {historial.data && <HistorialCredito eventos={historial.data} />}
        </section>
      </div>

      <section aria-labelledby="titulo-notificacion" className="mt-6 rounded-lg border bg-card p-5">
        <h2 id="titulo-notificacion" className="text-lg font-bold">
          Notificación al sistema externo
        </h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Al crear el crédito se avisa al sistema externo. Si no responde, se reintenta
          automáticamente.
        </p>
        {notificaciones.isLoading && <Skeleton className="h-20" />}
        {notificaciones.data && (
          <TrazaNotificacion notificaciones={notificaciones.data} creditoId={c.id} />
        )}
      </section>

      <DialogoCambioEstado
        credito={c}
        estadoDestino={estadoDestino}
        onCerrar={() => setEstadoDestino(null)}
      />
      {catalogos.data && (
        <DialogoEditarCondiciones
          credito={c}
          catalogos={catalogos.data}
          abierto={editando}
          onCerrar={() => setEditando(false)}
        />
      )}
      <DialogoEliminar credito={c} abierto={eliminando} onCerrar={() => setEliminando(false)} />
    </>
  );
}

function Dato({ termino, valor }: { termino: string; valor: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{termino}</dt>
      <dd className="font-semibold">{valor}</dd>
    </>
  );
}
