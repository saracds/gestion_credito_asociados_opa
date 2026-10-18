import type { Response } from 'express';

import type { ErrorCodeValue } from '../errors/errorCodes.js';
import type { ErrorDetail } from '../errors/AppError.js';

/**
 * Contrato ÚNICO de respuesta de la API.
 *
 * Todas las respuestas tienen la misma forma, de modo que el cliente siempre
 * sabe dónde mirar:
 *
 *   Éxito: { "success": true,  "data": {...}, "meta": {...} }
 *   Error: { "success": false, "error": { "code": "...", "message": "..." } }
 */
export interface ApiSuccessResponse<TData> {
  success: true;
  data: TData;
  meta?: Record<string, unknown>;
}

export interface ApiErrorBody {
  code: ErrorCodeValue;
  message: string;
  details?: ErrorDetail[];
  requestId?: string;
}

export interface ApiErrorResponse {
  success: false;
  error: ApiErrorBody;
}

/** Envía una respuesta exitosa con el contrato estándar. */
export function sendSuccess<TData>(
  response: Response,
  data: TData,
  options: { status?: number; meta?: Record<string, unknown> } = {},
): void {
  const body: ApiSuccessResponse<TData> = {
    success: true,
    data,
    ...(options.meta && { meta: options.meta }),
  };
  response.status(options.status ?? 200).json(body);
}
