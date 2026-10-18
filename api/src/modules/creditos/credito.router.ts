import { Router } from 'express';

import { AppError } from '../../shared/errors/AppError.js';
import { authorize } from '../auth/auth.middleware.js';
import { ROLES_ADMINISTRACION, ROLES_GESTION, ROLES_LECTURA } from '../auth/auth.types.js';
import type { CreditoController } from './credito.controller.js';

/**
 * Rutas de /api/creditos con su autorización por rol.
 *
 *   Método  Ruta                  Roles                     Descripción
 *   GET     /                     ADMIN, ANALISTA, CONSULTA Listado paginado con filtros
 *   GET     /resumen              ADMIN, ANALISTA, CONSULTA Totales por estado (dashboard)
 *   GET     /:id                  ADMIN, ANALISTA, CONSULTA Detalle (+ ETag)
 *   GET     /:id/historial        ADMIN, ANALISTA, CONSULTA Auditoría del crédito
 *   GET     /:id/notificaciones   ADMIN, ANALISTA, CONSULTA Traza del webhook
 *   POST    /                     ADMIN, ANALISTA           Crear (dispara el webhook)
 *   PATCH   /:id                  ADMIN, ANALISTA           Actualización parcial (If-Match)
 *   PATCH   /:id/estado           ADMIN, ANALISTA           Cambio de estado
 *   DELETE  /:id                  ADMIN                     Borrado lógico
 *
 * "/resumen" se registra antes de "/:id" para que no se interprete como un id.
 */
export function createCreditoRouter(controller: CreditoController): Router {
  const router = Router();

  router.get('/', authorize(ROLES_LECTURA), controller.listar);
  router.get('/resumen', authorize(ROLES_LECTURA), controller.resumen);
  router.get('/:id', authorize(ROLES_LECTURA), controller.obtener);
  router.get('/:id/historial', authorize(ROLES_LECTURA), controller.historial);
  router.get('/:id/notificaciones', authorize(ROLES_LECTURA), controller.notificaciones);

  router.post('/', authorize(ROLES_GESTION), controller.crear);
  router.patch('/:id', authorize(ROLES_GESTION), controller.actualizar);
  router.patch('/:id/estado', authorize(ROLES_GESTION), controller.cambiarEstado);
  router.delete('/:id', authorize(ROLES_ADMINISTRACION), controller.eliminar);

  // Decisión de diseño (ADR-020): la actualización es parcial con PATCH. PUT
  // respondería con 405 e indicaría el método correcto en vez de un 404 confuso.
  router.put('/:id', (_request, response) => {
    response.setHeader('Allow', 'GET, PATCH, DELETE');
    throw new AppError({
      httpStatus: 405,
      code: 'METHOD_NOT_ALLOWED',
      message:
        'Use PATCH /api/creditos/{id} enviando solo los campos que desea modificar. Los créditos no admiten reemplazo completo (PUT).',
    });
  });

  return router;
}
