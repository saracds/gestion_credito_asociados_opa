import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';

import { ApiError } from '@/api/client';
import { crearCredito, obtenerCatalogos } from '@/api/endpoints';
import type { Catalogos } from '@/api/types';
import { EncabezadoPagina } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Alert, Skeleton } from '@/components/ui/feedback';
import { Campo, Input, NativeSelect } from '@/components/ui/form-controls';
import { aplicarErroresDeCampo, mensajeDeError } from '@/lib/errores';
import { formatearPesos } from '@/lib/formato';

import {
  CAMPOS_SOLICITUD,
  calcularCuotaEstimada,
  crearEsquemaSolicitud,
  describirPolitica,
  type DatosSolicitud,
  type DatosSolicitudEntrada,
} from './formularioCredito';

export function NuevoCreditoPage() {
  const catalogos = useQuery({
    queryKey: ['catalogos'],
    queryFn: obtenerCatalogos,
    staleTime: Infinity,
  });

  return (
    <>
      <EncabezadoPagina
        titulo="Nuevo crédito"
        descripcion="La solicitud queda en estado Solicitado y se notifica al sistema externo."
      />
      {catalogos.isLoading && <Skeleton className="h-96 max-w-3xl" />}
      {catalogos.isError && (
        <Alert titulo="No fue posible cargar los tipos de crédito">
          {mensajeDeError(catalogos.error)}
        </Alert>
      )}
      {catalogos.data && <FormularioNuevoCredito catalogos={catalogos.data} />}
    </>
  );
}

function FormularioNuevoCredito({ catalogos }: { catalogos: Catalogos }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [errorGeneral, setErrorGeneral] = useState<{ titulo: string; mensaje: string } | null>(
    null,
  );

  const esquema = useMemo(() => crearEsquemaSolicitud(catalogos.tiposCredito), [catalogos]);
  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors, isSubmitting },
  } = useForm<DatosSolicitudEntrada, unknown, DatosSolicitud>({
    resolver: zodResolver(esquema),
    defaultValues: { tipoCredito: '', formaPago: '' },
  });

  const [tipoElegido, valor, tasa, cuotas] = useWatch({
    control,
    name: ['tipoCredito', 'valorSolicitado', 'tasaInteres', 'numeroCuotas'],
  });
  const politica = catalogos.tiposCredito.find((tipo) => tipo.codigo === tipoElegido);
  const cuotaEstimada = calcularCuotaEstimada(Number(valor), Number(tasa), Number(cuotas));

  const creacion = useMutation({
    mutationFn: crearCredito,
    onSuccess: (credito) => {
      void queryClient.invalidateQueries({ queryKey: ['creditos'] });
      void queryClient.invalidateQueries({ queryKey: ['resumen'] });
      toast.success(`Crédito ${credito.numeroCredito} creado.`);
      navigate(`/creditos/${credito.id}`);
    },
  });

  const enviar = handleSubmit(async (datos) => {
    setErrorGeneral(null);
    try {
      await creacion.mutateAsync(datos);
    } catch (error) {
      if (aplicarErroresDeCampo(error, setError, CAMPOS_SOLICITUD)) return;
      // 409: duplicado o identificación con otro nombre. El mensaje de la API ya explica qué revisar.
      const titulo =
        error instanceof ApiError && error.status === 409
          ? 'No se puede registrar esta solicitud'
          : 'No fue posible crear el crédito';
      setErrorGeneral({ titulo, mensaje: mensajeDeError(error) });
    }
  });

  const props = (campo: (typeof CAMPOS_SOLICITUD)[number]) => ({
    id: campo,
    'aria-invalid': Boolean(errors[campo]),
    'aria-describedby': errors[campo] ? `${campo}-error` : `${campo}-ayuda`,
    ...register(campo),
  });

  return (
    <form onSubmit={enviar} noValidate className="grid max-w-3xl gap-8">
      {errorGeneral && <Alert titulo={errorGeneral.titulo}>{errorGeneral.mensaje}</Alert>}

      <fieldset className="grid gap-4 rounded-lg border bg-card p-5 sm:grid-cols-2 sm:p-6">
        <legend className="px-1 text-lg font-bold">Asociado</legend>
        <Campo
          id="identificacionAsociado"
          etiqueta="Identificación"
          ayuda="Sin puntos ni espacios."
          error={errors.identificacionAsociado?.message}
        >
          <Input inputMode="numeric" autoComplete="off" {...props('identificacionAsociado')} />
        </Campo>
        <Campo
          id="nombreAsociado"
          etiqueta="Nombre completo"
          ayuda="Si el asociado ya existe, debe coincidir con el registrado."
          error={errors.nombreAsociado?.message}
        >
          <Input autoComplete="off" {...props('nombreAsociado')} />
        </Campo>
      </fieldset>

      <fieldset className="grid gap-4 rounded-lg border bg-card p-5 sm:grid-cols-2 sm:p-6">
        <legend className="px-1 text-lg font-bold">Condiciones del crédito</legend>
        <Campo
          id="tipoCredito"
          etiqueta="Tipo de crédito"
          ayuda={describirPolitica(politica)}
          error={errors.tipoCredito?.message}
          className="sm:col-span-2"
        >
          <NativeSelect {...props('tipoCredito')}>
            <option value="">Seleccione…</option>
            {catalogos.tiposCredito.map((tipo) => (
              <option key={tipo.codigo} value={tipo.codigo}>
                {tipo.nombre}
              </option>
            ))}
          </NativeSelect>
        </Campo>
        <Campo
          id="valorSolicitado"
          etiqueta="Valor solicitado (COP)"
          error={errors.valorSolicitado?.message}
        >
          <Input
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            {...props('valorSolicitado')}
          />
        </Campo>
        <Campo id="numeroCuotas" etiqueta="Número de cuotas" error={errors.numeroCuotas?.message}>
          <Input type="number" min={1} step={1} inputMode="numeric" {...props('numeroCuotas')} />
        </Campo>
        <Campo
          id="tasaInteres"
          etiqueta="Tasa de interés (% mensual)"
          ayuda="Ejemplo: 1,5 para 1,5 % mensual."
          error={errors.tasaInteres?.message}
        >
          <Input
            type="number"
            min={0}
            step="0.0001"
            inputMode="decimal"
            {...props('tasaInteres')}
          />
        </Campo>
        <Campo id="formaPago" etiqueta="Forma de pago" error={errors.formaPago?.message}>
          <NativeSelect {...props('formaPago')}>
            <option value="">Seleccione…</option>
            {catalogos.formasPago.map((forma) => (
              <option key={forma.codigo} value={forma.codigo}>
                {forma.nombre}
              </option>
            ))}
          </NativeSelect>
        </Campo>

        <p className="rounded-md bg-muted px-4 py-3 text-sm sm:col-span-2" aria-live="polite">
          {cuotaEstimada ? (
            <>
              Cuota mensual estimada:{' '}
              <strong className="text-base">{formatearPesos(Math.round(cuotaEstimada))}</strong>
              <span className="text-muted-foreground">
                {' '}
                (cuota fija, sin seguros ni otros cargos).
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">
              Complete valor, tasa y cuotas para ver la cuota mensual estimada.
            </span>
          )}
        </p>
      </fieldset>

      <div className="flex flex-wrap gap-3">
        <Button type="submit" size="lg" disabled={isSubmitting}>
          {isSubmitting ? 'Creando crédito…' : 'Crear crédito'}
        </Button>
        <Button variant="ghost" size="lg" asChild>
          <Link to="/creditos">Cancelar</Link>
        </Button>
      </div>
    </form>
  );
}
