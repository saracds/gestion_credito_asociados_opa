import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { z } from 'zod';

import { ApiError } from '@/api/client';
import { actualizarCredito, cambiarEstado, eliminarCredito } from '@/api/endpoints';
import type { Catalogos, Credito, EstadoCredito } from '@/api/types';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Alert } from '@/components/ui/feedback';
import { Campo, Input, NativeSelect, Textarea } from '@/components/ui/form-controls';
import { aplicarErroresDeCampo, mensajeDeError } from '@/lib/errores';

import { ESTADO_INFO } from '../estados';
import { condicionesBase, describirPolitica, validarPolitica } from '../formularioCredito';

/** Tras cualquier cambio se refrescan el crédito, su historial, el listado y el resumen. */
function useRefrescarCredito(id: number) {
  const queryClient = useQueryClient();
  return () => {
    for (const clave of [
      ['credito', id],
      ['historial', id],
      ['notificaciones', id],
      ['creditos'],
      ['resumen'],
    ]) {
      void queryClient.invalidateQueries({ queryKey: clave });
    }
  };
}

// -----------------------------------------------------------------------------
// Cambio de estado
// -----------------------------------------------------------------------------

/**
 * Las opciones vienen de `credito.transicionesPermitidas` 
 * La observación obligatoria para rechazar o cancelar también la
 * exige la API: si falta, su error aparece debajo del campo.
 */
export function DialogoCambioEstado({
  credito,
  estadoDestino,
  onCerrar,
}: {
  credito: Credito;
  estadoDestino: EstadoCredito | null;
  onCerrar: () => void;
}) {
  const refrescar = useRefrescarCredito(credito.id);
  const [observacion, setObservacion] = useState('');
  const [errorObservacion, setErrorObservacion] = useState<string | null>(null);
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);

  const mutacion = useMutation({
    mutationFn: (destino: EstadoCredito) =>
      cambiarEstado(credito.id, destino, observacion.trim() || undefined),
    onSuccess: (actualizado) => {
      refrescar();
      toast.success(
        `Crédito ${actualizado.numeroCredito}: ${ESTADO_INFO[actualizado.estado].etiqueta.toLowerCase()}.`,
      );
      cerrar();
    },
    onError: (error) => {
      const campo =
        error instanceof ApiError
          ? error.details.find((d) => d.field === 'observacion')
          : undefined;
      if (campo) setErrorObservacion(error.message);
      else setErrorGeneral(mensajeDeError(error));
    },
  });

  const cerrar = () => {
    setObservacion('');
    setErrorObservacion(null);
    setErrorGeneral(null);
    onCerrar();
  };

  if (!estadoDestino) return null;
  const info = ESTADO_INFO[estadoDestino];
  const pideJustificacion = estadoDestino === 'RECHAZADO' || estadoDestino === 'CANCELADO';

  return (
    <Dialog open onOpenChange={(abierto) => !abierto && cerrar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{info.accion}</DialogTitle>
          <DialogDescription>
            {credito.numeroCredito} pasará de {ESTADO_INFO[credito.estado].etiqueta.toLowerCase()} a{' '}
            {info.etiqueta.toLowerCase()}. {info.descripcion}
          </DialogDescription>
        </DialogHeader>

        {errorGeneral && <Alert titulo="No fue posible cambiar el estado">{errorGeneral}</Alert>}

        <Campo
          id="observacion"
          etiqueta={pideJustificacion ? 'Motivo' : 'Observación (opcional)'}
          ayuda={pideJustificacion ? 'Quedará registrado en el historial del crédito.' : undefined}
          error={errorObservacion ?? undefined}
        >
          <Textarea
            id="observacion"
            value={observacion}
            maxLength={500}
            aria-invalid={Boolean(errorObservacion)}
            aria-describedby={errorObservacion ? 'observacion-error' : 'observacion-ayuda'}
            onChange={(evento) => setObservacion(evento.target.value)}
          />
        </Campo>

        <DialogFooter>
          <Button variant="ghost" onClick={cerrar}>
            Volver
          </Button>
          <Button
            variant={
              estadoDestino === 'RECHAZADO' || estadoDestino === 'CANCELADO'
                ? 'destructive'
                : 'default'
            }
            disabled={mutacion.isPending}
            onClick={() => mutacion.mutate(estadoDestino)}
          >
            {mutacion.isPending ? 'Guardando…' : info.accion}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// -----------------------------------------------------------------------------
// Edición de condiciones (PATCH con If-Match)
// -----------------------------------------------------------------------------

const CAMPOS_EDITABLES = [
  'tipoCredito',
  'formaPago',
  'valorSolicitado',
  'tasaInteres',
  'numeroCuotas',
] as const;

export function DialogoEditarCondiciones({
  credito,
  catalogos,
  abierto,
  onCerrar,
}: {
  credito: Credito;
  catalogos: Catalogos;
  abierto: boolean;
  onCerrar: () => void;
}) {
  const refrescar = useRefrescarCredito(credito.id);
  const [errorGeneral, setErrorGeneral] = useState<{ titulo: string; mensaje: string } | null>(
    null,
  );

  const esquema = useMemo(
    () =>
      z
        .object({ ...condicionesBase, observacion: z.string().trim().max(500).optional() })
        .superRefine((datos, contexto) => validarPolitica(datos, contexto, catalogos.tiposCredito)),
    [catalogos],
  );
  type Entrada = z.input<typeof esquema>;
  type Salida = z.output<typeof esquema>;

  const valoresActuales = {
    tipoCredito: credito.tipoCredito,
    formaPago: credito.formaPago,
    valorSolicitado: credito.valorSolicitado,
    tasaInteres: credito.tasaInteres,
    numeroCuotas: credito.numeroCuotas,
    observacion: '',
  };

  const {
    register,
    handleSubmit,
    setError,
    reset,
    control,
    formState: { errors, isSubmitting },
  } = useForm<Entrada, unknown, Salida>({
    resolver: zodResolver(esquema),
    values: valoresActuales,
  });

  const tipoElegido = useWatch({ control, name: 'tipoCredito' });
  const politica = catalogos.tiposCredito.find((tipo) => tipo.codigo === tipoElegido);

  const cerrar = () => {
    setErrorGeneral(null);
    reset(valoresActuales);
    onCerrar();
  };

  const enviar = handleSubmit(async ({ observacion, ...condiciones }) => {
    setErrorGeneral(null);
    // PATCH: solo se envían los campos que realmente cambiaron.
    const cambios = Object.fromEntries(
      CAMPOS_EDITABLES.filter((campo) => condiciones[campo] !== credito[campo]).map((campo) => [
        campo,
        condiciones[campo],
      ]),
    );
    if (Object.keys(cambios).length === 0) {
      setErrorGeneral({
        titulo: 'Sin cambios',
        mensaje: 'Modifique al menos un valor antes de guardar.',
      });
      return;
    }

    try {
      const actualizado = await actualizarCredito(credito.id, credito.version, {
        ...cambios,
        ...(observacion && { observacion }),
      });
      refrescar();
      toast.success(`Condiciones de ${actualizado.numeroCredito} actualizadas.`);
      onCerrar();
    } catch (error) {
      if (error instanceof ApiError && error.status === 412) {
        // Otro usuario guardó primero: se recargan los datos para no pisar su cambio.
        refrescar();
        setErrorGeneral({
          titulo: 'Otra persona modificó este crédito',
          mensaje:
            'Cargamos la versión más reciente. Revise los valores y vuelva a aplicar sus cambios.',
        });
        return;
      }
      if (aplicarErroresDeCampo(error, setError, CAMPOS_EDITABLES)) return;
      setErrorGeneral({ titulo: 'No fue posible guardar', mensaje: mensajeDeError(error) });
    }
  });

  const props = (campo: (typeof CAMPOS_EDITABLES)[number]) => ({
    id: `editar-${campo}`,
    'aria-invalid': Boolean(errors[campo]),
    ...register(campo),
  });

  return (
    <Dialog open={abierto} onOpenChange={(valor) => !valor && cerrar()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Editar condiciones</DialogTitle>
          <DialogDescription>
            Solo se guardan los valores que cambie. El historial registrará el valor anterior y el
            nuevo.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={enviar} noValidate className="grid gap-4">
          {errorGeneral && <Alert titulo={errorGeneral.titulo}>{errorGeneral.mensaje}</Alert>}

          <Campo
            id="editar-tipoCredito"
            etiqueta="Tipo de crédito"
            ayuda={describirPolitica(politica)}
            error={errors.tipoCredito?.message}
          >
            <NativeSelect {...props('tipoCredito')}>
              {catalogos.tiposCredito.map((tipo) => (
                <option key={tipo.codigo} value={tipo.codigo}>
                  {tipo.nombre}
                </option>
              ))}
            </NativeSelect>
          </Campo>
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo
              id="editar-valorSolicitado"
              etiqueta="Valor solicitado (COP)"
              error={errors.valorSolicitado?.message}
            >
              <Input type="number" step="0.01" {...props('valorSolicitado')} />
            </Campo>
            <Campo
              id="editar-numeroCuotas"
              etiqueta="Número de cuotas"
              error={errors.numeroCuotas?.message}
            >
              <Input type="number" step={1} {...props('numeroCuotas')} />
            </Campo>
            <Campo
              id="editar-tasaInteres"
              etiqueta="Tasa (% mensual)"
              error={errors.tasaInteres?.message}
            >
              <Input type="number" step="0.0001" {...props('tasaInteres')} />
            </Campo>
            <Campo id="editar-formaPago" etiqueta="Forma de pago" error={errors.formaPago?.message}>
              <NativeSelect {...props('formaPago')}>
                {catalogos.formasPago.map((forma) => (
                  <option key={forma.codigo} value={forma.codigo}>
                    {forma.nombre}
                  </option>
                ))}
              </NativeSelect>
            </Campo>
          </div>
          <Campo id="editar-observacion" etiqueta="Motivo del cambio (opcional)">
            <Textarea id="editar-observacion" maxLength={500} {...register('observacion')} />
          </Campo>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={cerrar}>
              Volver
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Guardando…' : 'Guardar cambios'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// -----------------------------------------------------------------------------
// Eliminación (borrado lógico)
// -----------------------------------------------------------------------------

export function DialogoEliminar({
  credito,
  abierto,
  onCerrar,
}: {
  credito: Credito;
  abierto: boolean;
  onCerrar: () => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const mutacion = useMutation({
    mutationFn: () => eliminarCredito(credito.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['creditos'] });
      void queryClient.invalidateQueries({ queryKey: ['resumen'] });
      toast.success(`Crédito ${credito.numeroCredito} eliminado.`);
      navigate('/creditos');
    },
  });

  return (
    <Dialog open={abierto} onOpenChange={(valor) => !valor && onCerrar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Eliminar {credito.numeroCredito}</DialogTitle>
          <DialogDescription>
            El crédito dejará de aparecer en los listados. Su registro y su historial se conservan
            para auditoría.
          </DialogDescription>
        </DialogHeader>
        {mutacion.isError && (
          <Alert titulo="No fue posible eliminar">{mensajeDeError(mutacion.error)}</Alert>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onCerrar}>
            Volver
          </Button>
          <Button
            variant="destructive"
            disabled={mutacion.isPending}
            onClick={() => mutacion.mutate()}
          >
            {mutacion.isPending ? 'Eliminando…' : 'Eliminar crédito'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
