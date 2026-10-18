import { PreconditionRequiredError } from '../errors/AppError.js';

/**
 * Concurrencia optimista con ETag / If-Match 
 *
 * Problema que resuelve — la "actualización perdida":
 *   1. La analista A abre el crédito (versión 1).
 *   2. El analista B abre el mismo crédito (versión 1).
 *   3. B cambia el valor y guarda -> el crédito pasa a la versión 2.
 *   4. A cambia el plazo y guarda -> sin control, sobrescribiría el cambio de B
 *      sin que nadie lo note.
 *
 * Solución:
 *   - Cada respuesta de un crédito incluye su versión (columna ROWVERSION de
 *     SQL Server) en la cabecera `ETag` y en el campo `version` del cuerpo.
 *   - Para editar, el cliente envía esa versión en `If-Match`.
 *   - Si no coincide con la vigente, la API responde 412 y A debe recargar.
 *
 * Es "optimista" porque no bloquea el registro mientras alguien lo mira: solo
 * verifica al guardar. Ideal cuando los conflictos son raros, como aquí.
 */

/** Formato de ETag fuerte: la versión entre comillas dobles. */
export function toEtag(version: string): string {
  return `"${version}"`;
}

/**
 * Extrae la versión de la cabecera If-Match.
 * Acepta `"ABC"` y la forma débil `W/"ABC"`. Rechaza `*` (cualquier versión),
 * porque anularía el propósito del control.
 *
 * @throws PreconditionRequiredError (428) si la cabecera falta o no es utilizable.
 */
export function requireIfMatchVersion(ifMatchHeader: string | undefined): string {
  const rawValue = ifMatchHeader?.trim();

  if (!rawValue || rawValue === '*') {
    throw new PreconditionRequiredError(
      'Debe enviar la cabecera If-Match con la versión del crédito (campo "version" o cabecera ETag de la última consulta).',
    );
  }

  const version = rawValue.replace(/^W\//, '').replace(/^"(.*)"$/, '$1');

  if (!/^[0-9A-F]{16}$/i.test(version)) {
    throw new PreconditionRequiredError('La cabecera If-Match no contiene una versión válida.');
  }

  return version.toUpperCase();
}
