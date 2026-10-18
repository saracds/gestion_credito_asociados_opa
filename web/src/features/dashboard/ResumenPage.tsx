import { useQuery } from '@tanstack/react-query';
import { ArrowRightIcon } from 'lucide-react';
import { Link } from 'react-router';

import { listarCreditos, obtenerResumen } from '@/api/endpoints';
import type { EstadoCredito, ResumenCreditos } from '@/api/types';
import { EncabezadoPagina } from '@/components/layout/AppLayout';
import { Alert, Skeleton } from '@/components/ui/feedback';
import { CAMINO_PRINCIPAL, ESTADO_INFO, EstadoBadge, SALIDAS } from '@/features/creditos/estados';
import { formatearFecha, formatearPesos, formatearPesosCompacto } from '@/lib/formato';
import { mensajeDeError } from '@/lib/errores';
import { cn } from '@/lib/utils';

/**
 * RESUMEN (dashboard): total de créditos y cantidad por estado
 * En lugar de una fila de tarjetas iguales, la cartera se dibuja sobre
 * el mismo flujo de estados que recorre cada crédito: se lee de un vistazo
 * dónde se acumulan las solicitudes. Cada estado lleva al listado filtrado.
 */
export function ResumenPage() {
  const resumen = useQuery({ queryKey: ['resumen'], queryFn: obtenerResumen });
  const recientes = useQuery({
    queryKey: ['creditos', 'recientes'],
    queryFn: () =>
      listarCreditos({ page: 1, pageSize: 5, ordenarPor: 'fechaSolicitud', direccion: 'desc' }),
  });

  return (
    <>
      <EncabezadoPagina
        titulo="Resumen de la cartera"
        descripcion={
          resumen.data ? (
            <>
              <strong className="text-foreground">
                {resumen.data.totalCreditos.toLocaleString('es-CO')} créditos
              </strong>{' '}
              por {formatearPesos(resumen.data.valorTotalSolicitado)} solicitados en total.
            </>
          ) : (
            'Cargando la cartera…'
          )
        }
      />

      {resumen.isError && (
        <Alert titulo="No fue posible cargar el resumen">{mensajeDeError(resumen.error)}</Alert>
      )}

      <section aria-labelledby="titulo-flujo" className="rounded-lg border bg-card p-5 sm:p-6">
        <h2 id="titulo-flujo" className="text-lg font-bold">
          Créditos por estado
        </h2>
        <p className="text-sm text-muted-foreground">
          De izquierda a derecha, el camino de una solicitud. Seleccione un estado para ver sus
          créditos.
        </p>
        {resumen.data ? (
          <FlujoCartera resumen={resumen.data} />
        ) : (
          <Skeleton className="mt-6 h-40" />
        )}
      </section>

      <section aria-labelledby="titulo-recientes" className="mt-8">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 id="titulo-recientes" className="text-lg font-bold">
            Solicitudes recientes
          </h2>
          <Link to="/creditos" className="text-sm font-semibold text-primary hover:underline">
            Ver todos los créditos
          </Link>
        </div>
        {recientes.isLoading && <Skeleton className="h-48" />}
        {recientes.data && (
          <ul className="divide-y rounded-lg border bg-card">
            {recientes.data.items.map((credito) => (
              <li key={credito.id}>
                <Link
                  to={`/creditos/${credito.id}`}
                  className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-muted/50 sm:grid-cols-[9rem_1fr_9rem_8rem]"
                >
                  <span className="font-semibold">{credito.numeroCredito}</span>
                  <span className="order-3 col-span-2 text-muted-foreground sm:order-none sm:col-span-1">
                    {credito.nombreAsociado}, {credito.tipoCreditoNombre.toLowerCase()}
                  </span>
                  <span className="text-right font-semibold">
                    {formatearPesos(credito.valorSolicitado)}
                  </span>
                  <span className="hidden justify-self-end sm:block">
                    <EstadoBadge estado={credito.estado} />
                  </span>
                </Link>
              </li>
            ))}
            {recientes.data.items.length === 0 && (
              <li className="px-4 py-6 text-muted-foreground">
                Aún no hay solicitudes.{' '}
                <Link to="/creditos/nuevo" className="font-semibold text-primary">
                  Registre la primera
                </Link>
                .
              </li>
            )}
          </ul>
        )}
        {recientes.data && recientes.data.items[0] && (
          <p className="mt-2 text-sm text-muted-foreground">
            Última solicitud: {formatearFecha(recientes.data.items[0].fechaSolicitud)}.
          </p>
        )}
      </section>
    </>
  );
}

function FlujoCartera({ resumen }: { resumen: ResumenCreditos }) {
  const datosDe = (estado: EstadoCredito) =>
    resumen.porEstado.find((item) => item.estado === estado) ?? {
      estado,
      cantidad: 0,
      valorTotal: 0,
    };
  const maximo = Math.max(1, ...resumen.porEstado.map((item) => item.cantidad));

  return (
    <div className="mt-6 grid gap-6">
      <ol className="grid gap-3 sm:grid-cols-4 sm:gap-0">
        {CAMINO_PRINCIPAL.map((estado, indice) => (
          <li key={estado} className="relative flex sm:block">
            <EstadoEnFlujo datos={datosDe(estado)} maximo={maximo} />
            {indice < CAMINO_PRINCIPAL.length - 1 && (
              <ArrowRightIcon
                className="absolute top-3 -right-2.5 hidden size-5 text-muted-foreground/60 sm:block"
                aria-hidden
              />
            )}
          </li>
        ))}
      </ol>
      <div>
        <p className="mb-2 text-sm font-semibold text-muted-foreground">Salieron del camino</p>
        <ul className="grid gap-3 sm:grid-cols-4">
          {SALIDAS.map((estado) => (
            <li key={estado}>
              <EstadoEnFlujo datos={datosDe(estado)} maximo={maximo} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function EstadoEnFlujo({
  datos,
  maximo,
}: {
  datos: { estado: EstadoCredito; cantidad: number; valorTotal: number };
  maximo: number;
}) {
  const info = ESTADO_INFO[datos.estado];
  const proporcion = Math.max(datos.cantidad / maximo, datos.cantidad > 0 ? 0.04 : 0);

  return (
    <Link
      to={`/creditos?estado=${datos.estado}`}
      className="group block w-full rounded-md px-3 py-2 hover:bg-muted/60 sm:mr-5"
      aria-label={`${info.etiqueta}: ${datos.cantidad} créditos por ${formatearPesos(datos.valorTotal)}. Ver créditos.`}
    >
      <span className={cn('text-sm font-semibold', info.texto)}>{info.etiqueta}</span>
      <span className="mt-1 block text-[2rem] leading-none font-bold">{datos.cantidad}</span>
      <span className="mt-1 block text-sm text-muted-foreground">
        {formatearPesosCompacto(datos.valorTotal)}
      </span>
      <span className="mt-3 block h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
        <span
          className={cn('block h-full rounded-full', info.relleno)}
          style={{ width: `${proporcion * 100}%` }}
        />
      </span>
    </Link>
  );
}
