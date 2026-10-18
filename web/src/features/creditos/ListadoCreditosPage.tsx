import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon, PlusIcon, SearchIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';

import { listarCreditos, obtenerCatalogos } from '@/api/endpoints';
import {
  CAMPOS_ORDENAMIENTO,
  ESTADOS_CREDITO,
  type CampoOrdenamiento,
  type EstadoCredito,
  type FiltrosCreditos,
} from '@/api/types';
import { PERMISOS, useAuth } from '@/auth/AuthContext';
import { EncabezadoPagina } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Alert, Skeleton } from '@/components/ui/feedback';
import { Input, Label, NativeSelect } from '@/components/ui/form-controls';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useDebounce } from '@/hooks/useDebounce';
import { formatearFecha, formatearPesos } from '@/lib/formato';
import { mensajeDeError } from '@/lib/errores';

import { ESTADO_INFO, EstadoBadge } from './estados';

const TAMANOS_PAGINA = [10, 20, 50];

/**
 * Lee los filtros desde la URL. Guardarlos en la URL (y no solo en memoria)
 * permite compartir un enlace con los mismos filtros, recargar sin perderlos
 * y volver atrás con el navegador.
 */
function leerFiltros(parametros: URLSearchParams): FiltrosCreditos {
  const estado = parametros.get('estado');
  const ordenarPor = parametros.get('ordenarPor');
  return {
    page: Math.max(1, Number(parametros.get('page')) || 1),
    pageSize: TAMANOS_PAGINA.includes(Number(parametros.get('pageSize')))
      ? Number(parametros.get('pageSize'))
      : 10,
    estado: ESTADOS_CREDITO.includes(estado as EstadoCredito)
      ? (estado as EstadoCredito)
      : undefined,
    tipoCredito: parametros.get('tipoCredito') || undefined,
    busqueda: parametros.get('busqueda') || undefined,
    ordenarPor: CAMPOS_ORDENAMIENTO.includes(ordenarPor as CampoOrdenamiento)
      ? (ordenarPor as CampoOrdenamiento)
      : 'fechaSolicitud',
    direccion: parametros.get('direccion') === 'asc' ? 'asc' : 'desc',
  };
}

export function ListadoCreditosPage() {
  const { tieneRol } = useAuth();
  const [parametros, setParametros] = useSearchParams();
  const filtros = leerFiltros(parametros);

  const [textoBusqueda, setTextoBusqueda] = useState(filtros.busqueda ?? '');
  const busquedaDiferida = useDebounce(textoBusqueda.trim());

  const actualizar = (
    cambios: Partial<Record<keyof FiltrosCreditos, string | number | undefined>>,
  ) => {
    setParametros((anteriores) => {
      const siguientes = new URLSearchParams(anteriores);
      for (const [clave, valor] of Object.entries(cambios)) {
        if (valor === undefined || valor === '') siguientes.delete(clave);
        else siguientes.set(clave, String(valor));
      }
      // Cualquier cambio de filtro vuelve a la primera página.
      if (!('page' in cambios)) siguientes.delete('page');
      return siguientes;
    });
  };

  useEffect(() => {
    if (busquedaDiferida !== (filtros.busqueda ?? '')) actualizar({ busqueda: busquedaDiferida });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo debe reaccionar a la búsqueda diferida
  }, [busquedaDiferida]);

  const catalogos = useQuery({
    queryKey: ['catalogos'],
    queryFn: obtenerCatalogos,
    staleTime: Infinity,
  });
  const consulta = useQuery({
    queryKey: ['creditos', filtros],
    queryFn: () => listarCreditos(filtros),
    placeholderData: keepPreviousData, // la tabla no parpadea al cambiar de página
  });

  const hayFiltros = Boolean(filtros.estado || filtros.tipoCredito || filtros.busqueda);

  const ordenar = (campo: CampoOrdenamiento) =>
    actualizar({
      ordenarPor: campo,
      direccion: filtros.ordenarPor === campo && filtros.direccion === 'desc' ? 'asc' : 'desc',
    });

  return (
    <>
      <EncabezadoPagina
        titulo="Créditos"
        descripcion="Busque por número de crédito, identificación o nombre del asociado."
        acciones={
          tieneRol(...PERMISOS.gestionar) && (
            <Button asChild>
              <Link to="/creditos/nuevo">
                <PlusIcon aria-hidden />
                Nuevo crédito
              </Link>
            </Button>
          )
        }
      />

      <div className="mb-4 grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-[1fr_12rem_12rem_auto] sm:items-end">
        <div className="grid gap-1.5">
          <Label htmlFor="busqueda">Buscar</Label>
          <div className="relative">
            <SearchIcon
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              id="busqueda"
              type="search"
              className="pl-9"
              placeholder="CR-2026-000123, 1001234567 o Pérez"
              value={textoBusqueda}
              onChange={(evento) => setTextoBusqueda(evento.target.value)}
            />
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="filtro-estado">Estado</Label>
          <NativeSelect
            id="filtro-estado"
            value={filtros.estado ?? ''}
            onChange={(evento) => actualizar({ estado: evento.target.value })}
          >
            <option value="">Todos</option>
            {ESTADOS_CREDITO.map((estado) => (
              <option key={estado} value={estado}>
                {ESTADO_INFO[estado].etiqueta}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="filtro-tipo">Tipo de crédito</Label>
          <NativeSelect
            id="filtro-tipo"
            value={filtros.tipoCredito ?? ''}
            onChange={(evento) => actualizar({ tipoCredito: evento.target.value })}
          >
            <option value="">Todos</option>
            {catalogos.data?.tiposCredito.map((tipo) => (
              <option key={tipo.codigo} value={tipo.codigo}>
                {tipo.nombre}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button
          variant="ghost"
          disabled={!hayFiltros}
          onClick={() => {
            setTextoBusqueda('');
            setParametros(new URLSearchParams());
          }}
        >
          Limpiar filtros
        </Button>
      </div>

      {consulta.isError && (
        <Alert titulo="No fue posible cargar los créditos">{mensajeDeError(consulta.error)}</Alert>
      )}

      <div className="rounded-lg border bg-card" aria-busy={consulta.isFetching}>
        <Table>
          <caption className="sr-only">Listado de créditos</caption>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <EncabezadoOrdenable
                campo="numeroCredito"
                etiqueta="Crédito"
                filtros={filtros}
                onOrdenar={ordenar}
              />
              <EncabezadoOrdenable
                campo="nombreAsociado"
                etiqueta="Asociado"
                filtros={filtros}
                onOrdenar={ordenar}
              />
              <TableHead>Tipo</TableHead>
              <EncabezadoOrdenable
                campo="valorSolicitado"
                etiqueta="Valor"
                filtros={filtros}
                onOrdenar={ordenar}
                alineacion="derecha"
              />
              <EncabezadoOrdenable
                campo="estado"
                etiqueta="Estado"
                filtros={filtros}
                onOrdenar={ordenar}
              />
              <EncabezadoOrdenable
                campo="fechaSolicitud"
                etiqueta="Fecha"
                filtros={filtros}
                onOrdenar={ordenar}
              />
            </TableRow>
          </TableHeader>
          <TableBody>
            {consulta.isLoading &&
              Array.from({ length: 5 }, (_, indice) => (
                <TableRow key={indice}>
                  <TableCell colSpan={6}>
                    <Skeleton className="h-6" />
                  </TableCell>
                </TableRow>
              ))}
            {consulta.data?.items.map((credito) => (
              <TableRow key={credito.id}>
                <TableCell>
                  <Link
                    to={`/creditos/${credito.id}`}
                    className="font-semibold text-primary hover:underline"
                  >
                    {credito.numeroCredito}
                  </Link>
                </TableCell>
                <TableCell>
                  <span className="block">{credito.nombreAsociado}</span>
                  <span className="block text-xs text-muted-foreground">
                    {credito.identificacionAsociado}
                  </span>
                </TableCell>
                <TableCell>{credito.tipoCreditoNombre}</TableCell>
                <TableCell className="text-right font-semibold whitespace-nowrap">
                  {formatearPesos(credito.valorSolicitado)}
                </TableCell>
                <TableCell>
                  <EstadoBadge estado={credito.estado} />
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {formatearFecha(credito.fechaSolicitud)}
                </TableCell>
              </TableRow>
            ))}
            {consulta.data?.items.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={6} className="py-10 text-center">
                  <p className="font-semibold">
                    {hayFiltros
                      ? 'Ningún crédito coincide con estos filtros.'
                      : 'Todavía no hay créditos registrados.'}
                  </p>
                  <p className="text-muted-foreground">
                    {hayFiltros
                      ? 'Pruebe con otra búsqueda o limpie los filtros.'
                      : 'Las solicitudes nuevas aparecerán aquí.'}
                  </p>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {consulta.data && consulta.data.paginacion.totalItems > 0 && (
        <nav
          aria-label="Paginación"
          className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm"
        >
          <p className="text-muted-foreground" aria-live="polite">
            Mostrando {(filtros.page - 1) * filtros.pageSize + 1}–
            {Math.min(filtros.page * filtros.pageSize, consulta.data.paginacion.totalItems)} de{' '}
            {consulta.data.paginacion.totalItems}
          </p>
          <div className="flex items-center gap-2">
            <Label htmlFor="tamano-pagina" className="font-normal text-muted-foreground">
              Por página
            </Label>
            <NativeSelect
              id="tamano-pagina"
              className="h-8 w-24"
              value={filtros.pageSize}
              onChange={(evento) => actualizar({ pageSize: evento.target.value })}
            >
              {TAMANOS_PAGINA.map((tamano) => (
                <option key={tamano}>{tamano}</option>
              ))}
            </NativeSelect>
            <Button
              variant="outline"
              size="sm"
              disabled={filtros.page <= 1}
              onClick={() => actualizar({ page: filtros.page - 1 })}
            >
              Anterior
            </Button>
            <span>
              Página {filtros.page} de {consulta.data.paginacion.totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={filtros.page >= consulta.data.paginacion.totalPages}
              onClick={() => actualizar({ page: filtros.page + 1 })}
            >
              Siguiente
            </Button>
          </div>
        </nav>
      )}
    </>
  );
}

function EncabezadoOrdenable({
  campo,
  etiqueta,
  filtros,
  onOrdenar,
  alineacion = 'izquierda',
}: {
  campo: CampoOrdenamiento;
  etiqueta: string;
  filtros: FiltrosCreditos;
  onOrdenar: (campo: CampoOrdenamiento) => void;
  alineacion?: 'izquierda' | 'derecha';
}) {
  const activo = filtros.ordenarPor === campo;
  const Icono = !activo
    ? ArrowUpDownIcon
    : filtros.direccion === 'asc'
      ? ArrowUpIcon
      : ArrowDownIcon;
  return (
    <TableHead
      aria-sort={activo ? (filtros.direccion === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={alineacion === 'derecha' ? 'text-right' : undefined}
    >
      <button
        type="button"
        onClick={() => onOrdenar(campo)}
        className="inline-flex items-center gap-1 rounded-sm hover:text-foreground"
      >
        {etiqueta}
        <Icono
          className={activo ? 'size-3.5 text-foreground' : 'size-3.5 opacity-50'}
          aria-hidden
        />
        <span className="sr-only">, ordenar</span>
      </button>
    </TableHead>
  );
}
