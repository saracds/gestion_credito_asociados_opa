import { Router } from 'express';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';

import { construirDocumentoOpenApi } from './openapiDocument.js';

/**
 * Documentación interactiva de la API.
 *
 *   GET /api/docs               Swagger UI (permite probar los endpoints)
 *   GET /api/docs/openapi.json  Documento OpenAPI 3.1 (para Postman, generadores de clientes, etc.)
 *
 * El documento se construye una sola vez al iniciar (es estático).
 *
 * En un ambiente productivo real se recomienda deshabilitarla
 * (API_DOCS_ENABLED=false) o publicarla solo en la red interna.
 */
export function createDocsRouter(version: string): Router {
  const router = Router();
  const documento = construirDocumentoOpenApi(version);

  router.get('/openapi.json', (_request, response) => {
    response.json(documento);
  });

  // La política de seguridad global (Helmet) incluye "upgrade-insecure-requests",
  // que hace que el navegador pida los recursos de Swagger UI por HTTPS. Al
  // abrirla por HTTP en un equipo local, esos recursos no cargarían. Solo para
  // la documentación se desactiva esa directiva; el resto de la política se mantiene.
  router.use(
    helmet.contentSecurityPolicy({
      useDefaults: true,
      directives: { 'upgrade-insecure-requests': null },
    }),
  );

  router.use(
    '/',
    swaggerUi.serve,
    swaggerUi.setup(documento, {
      customSiteTitle: 'API de Créditos — OPA',
      swaggerOptions: {
        persistAuthorization: true, // conserva el token al recargar la página
        displayRequestDuration: true,
        docExpansion: 'list',
        tryItOutEnabled: true,
        validatorUrl: null, // no consultar el validador externo de swagger.io
      },
    }),
  );

  return router;
}
