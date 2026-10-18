import type { z } from 'zod';

import { ValidationError, type ErrorDetail } from '../errors/AppError.js';

/**
 * Valida un dato de entrada (body, query o params) contra un esquema Zod.
 *
 * - Si es válido, devuelve el dato ya convertido y TIPADO (p. ej. "10" -> 10).
 * - Si no, lanza ValidationError (400) con el detalle de cada campo inválido.
 *
 * Se usa dentro de los controladores, en lugar de un middleware genérico,
 * porque así TypeScript conoce el tipo exacto del dato validado. Además, en
 * Express 5 `req.query` es de solo lectura y no puede reemplazarse.
 */
export function parseOrThrow<TSchema extends z.ZodType>(
  schema: TSchema,
  input: unknown,
  message = 'La petición contiene datos inválidos.',
): z.output<TSchema> {
  const result = schema.safeParse(input);

  if (!result.success) {
    const details: ErrorDetail[] = result.error.issues.map((issue) => ({
      ...(issue.path.length > 0 && { field: issue.path.join('.') }),
      message: issue.message,
    }));
    throw new ValidationError(message, details);
  }

  return result.data;
}
