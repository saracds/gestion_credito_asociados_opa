import type { Request, Response } from 'express';

import { BusinessRuleError } from '../../shared/errors/AppError.js';
import { sendSuccess } from '../../shared/http/apiResponse.js';
import { requireIfMatchVersion, toEtag } from '../../shared/http/etag.js';
import { parseOrThrow } from '../../shared/validation/parseOrThrow.js';
import { getUsuarioAutenticado } from '../auth/auth.middleware.js';
import {
  actualizarCreditoSchema,
  cambiarEstadoSchema,
  creditoIdParamsSchema,
  crearCreditoSchema,
  detectarCamposInmutables,
  listarCreditosQuerySchema,
} from './credito.schemas.js';
import type { CreditoService } from './CreditoService.js';
import { CreditoErrorCode } from './domain/creditoErrorCodes.js';
import type { Credito } from './domain/credito.types.js';

/**
 * CAPA DE CONTROLADOR — traduce HTTP <-> servicio.
 *
 * Cada método hace siempre lo mismo:
 *   1. Validar y tipar la entrada (params, query, body, cabeceras).
 *   2. Invocar al servicio con datos ya limpios.
 *   3. Construir la respuesta HTTP (código, cabeceras, cuerpo estándar).
 * No contiene reglas de negocio ni SQL.
 */
export class CreditoController {
  constructor(private readonly creditoService: CreditoService) {}

  /** GET /api/creditos */
  listar = async (request: Request, response: Response): Promise<void> => {
    const criterios = parseOrThrow(
      listarCreditosQuerySchema,
      request.query,
      'Los parámetros de consulta son inválidos.',
    );
    const pagina = await this.creditoService.buscar(criterios);

    sendSuccess(response, pagina.items, {
      meta: {
        page: criterios.page,
        pageSize: criterios.pageSize,
        totalItems: pagina.totalItems,
        totalPages: Math.ceil(pagina.totalItems / criterios.pageSize),
      },
    });
  };

  /** GET /api/creditos/resumen */
  resumen = async (_request: Request, response: Response): Promise<void> => {
    sendSuccess(response, await this.creditoService.obtenerResumen());
  };

  /** GET /api/creditos/{id} */
  obtener = async (request: Request, response: Response): Promise<void> => {
    const { id } = parseOrThrow(creditoIdParamsSchema, request.params);
    const credito = await this.creditoService.obtenerPorId(id);
    this.responderCredito(response, credito);
  };

  /** GET /api/creditos/{id}/historial */
  historial = async (request: Request, response: Response): Promise<void> => {
    const { id } = parseOrThrow(creditoIdParamsSchema, request.params);
    sendSuccess(response, await this.creditoService.obtenerHistorial(id));
  };

  /** GET /api/creditos/{id}/notificaciones — traza del webhook */
  notificaciones = async (request: Request, response: Response): Promise<void> => {
    const { id } = parseOrThrow(creditoIdParamsSchema, request.params);
    sendSuccess(response, await this.creditoService.obtenerNotificaciones(id));
  };

  /** POST /api/creditos -> 201 Created + Location + ETag */
  crear = async (request: Request, response: Response): Promise<void> => {
    const solicitud = parseOrThrow(crearCreditoSchema, request.body);
    const credito = await this.creditoService.crear(solicitud, getUsuarioAutenticado(request));

    response.location(`/api/creditos/${credito.id}`);
    this.responderCredito(response, credito, 201);
  };

  /** PATCH /api/creditos/{id} — exige If-Match */
  actualizar = async (request: Request, response: Response): Promise<void> => {
    const { id } = parseOrThrow(creditoIdParamsSchema, request.params);

    const camposInmutables = detectarCamposInmutables(request.body);
    if (camposInmutables.length > 0) {
      throw new BusinessRuleError(
        CreditoErrorCode.CAMPO_INMUTABLE,
        'La solicitud intenta modificar campos que no pueden cambiar. El estado se cambia con PATCH /api/creditos/{id}/estado.',
        camposInmutables.map((campo) => ({ field: campo, message: 'Campo inmutable' })),
      );
    }

    const { observacion, ...cambios } = parseOrThrow(actualizarCreditoSchema, request.body);
    const versionEsperada = requireIfMatchVersion(request.get('If-Match'));

    const credito = await this.creditoService.actualizar(
      id,
      cambios,
      versionEsperada,
      getUsuarioAutenticado(request),
      observacion,
    );
    this.responderCredito(response, credito);
  };

  /** PATCH /api/creditos/{id}/estado */
  cambiarEstado = async (request: Request, response: Response): Promise<void> => {
    const { id } = parseOrThrow(creditoIdParamsSchema, request.params);
    const { estado, observacion } = parseOrThrow(cambiarEstadoSchema, request.body);

    const credito = await this.creditoService.cambiarEstado(
      id,
      estado,
      getUsuarioAutenticado(request),
      observacion,
    );
    this.responderCredito(response, credito);
  };

  /** DELETE /api/creditos/{id} -> 204 No Content (borrado lógico) */
  eliminar = async (request: Request, response: Response): Promise<void> => {
    const { id } = parseOrThrow(creditoIdParamsSchema, request.params);
    await this.creditoService.eliminar(id, getUsuarioAutenticado(request));
    response.status(204).end();
  };

  /** Toda respuesta con un crédito incluye su versión en la cabecera ETag. */
  private responderCredito(response: Response, credito: Credito, status = 200): void {
    response.setHeader('ETag', toEtag(credito.version));
    sendSuccess(response, credito, { status });
  }
}
