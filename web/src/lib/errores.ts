import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { toast } from 'sonner';

import { ApiError } from '@/api/client';

/**
 * Traduce los errores de la API a la interfaz:
 *  - Errores por campo (details) -> se muestran debajo de cada campo del formulario.
 *  - Errores de negocio (409, 412, 422) -> notificación con el mensaje de la API,
 *    que ya está escrito para el usuario y dice cómo resolverlo.
 *  - Errores inesperados -> mensaje genérico con el identificador de la petición
 *    para que soporte pueda encontrarla en los logs.
 */
export function mensajeDeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status >= 500) {
      return `Ocurrió un error en el servidor.${error.requestId ? ` Código de soporte: ${error.requestId}` : ''}`;
    }
    return error.message;
  }
  return 'Ocurrió un error inesperado. Intente de nuevo.';
}

export function notificarError(error: unknown): void {
  toast.error(mensajeDeError(error));
}

/**
 * Asigna los errores por campo de la API al formulario. Devuelve true si al
 * menos uno corresponde a un campo visible (en ese caso no hace falta toast).
 */
export function aplicarErroresDeCampo<TForm extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<TForm>,
  camposDelFormulario: readonly string[],
): boolean {
  if (!(error instanceof ApiError)) return false;
  let aplicados = 0;
  for (const detalle of error.details) {
    if (detalle.field && camposDelFormulario.includes(detalle.field)) {
      setError(detalle.field as Path<TForm>, { type: 'server', message: detalle.message });
      aplicados++;
    }
  }
  return aplicados > 0;
}
