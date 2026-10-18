import { Router } from 'express';

import { sendSuccess } from '../../shared/http/apiResponse.js';
import type { CatalogoRepository } from './CatalogoRepository.js';

/**
 * GET /api/catalogos
 * Tipos de crédito (con su política) y formas de pago activos. El frontend los
 * usa para llenar las listas del formulario y validar antes de enviar.
 */
export function createCatalogosRouter(catalogoRepository: CatalogoRepository): Router {
  const router = Router();

  router.get('/', async (_request, response) => {
    const [tiposCredito, formasPago] = await Promise.all([
      catalogoRepository.listarTiposCreditoActivos(),
      catalogoRepository.listarFormasPagoActivas(),
    ]);
    sendSuccess(response, { tiposCredito, formasPago });
  });

  return router;
}
