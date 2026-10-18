import { Router } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { BusinessRuleError, NotFoundError } from '../src/shared/errors/AppError.js';
import { parseOrThrow } from '../src/shared/validation/parseOrThrow.js';
import { createTestApp } from './helpers/createTestApp.js';

/** Rutas de prueba que reproducen cada tipo de error. */
function createErrorScenariosRouter(): Router {
  const router = Router();

  router.get('/recurso-inexistente', async () => {
    throw new NotFoundError('CREDITO_NOT_FOUND', 'El crédito no existe');
  });

  router.post('/regla-de-negocio', async () => {
    throw new BusinessRuleError('TRANSICION_ESTADO_INVALIDA', 'Transición no permitida');
  });

  router.post('/validacion', (req) => {
    parseOrThrow(z.object({ valorSolicitado: z.number().positive() }), req.body);
  });

  router.get('/error-inesperado', async () => {
    throw new Error('Detalle interno: conexión a 10.0.0.5 con usuario sa');
  });

  router.get('/error-sql-duplicado', async () => {
    throw Object.assign(new Error('Cannot insert duplicate key row'), { number: 2601 });
  });

  return router;
}

describe('Manejo de errores', () => {
  const app = createTestApp({ apiRouter: createErrorScenariosRouter() });

  it('responde 404 con el formato estándar cuando la ruta no existe', async () => {
    const response = await request(app).get('/api/no-existe');

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      success: false,
      error: { code: 'ROUTE_NOT_FOUND' },
    });
  });

  it('responde con el código y mensaje del AppError lanzado (formato exigido por la prueba)', async () => {
    const response = await request(app).get('/api/recurso-inexistente');

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      success: false,
      error: { code: 'CREDITO_NOT_FOUND', message: 'El crédito no existe' },
    });
  });

  it('responde 422 ante una violación de regla de negocio', async () => {
    const response = await request(app).post('/api/regla-de-negocio');

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('TRANSICION_ESTADO_INVALIDA');
  });

  it('responde 400 con el detalle por campo cuando la validación falla', async () => {
    const response = await request(app).post('/api/validacion').send({ valorSolicitado: -5 });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details).toEqual([
      expect.objectContaining({ field: 'valorSolicitado' }),
    ]);
  });

  it('responde 400 INVALID_JSON cuando el body no es JSON válido', async () => {
    const response = await request(app)
      .post('/api/validacion')
      .set('Content-Type', 'application/json')
      .send('{ "valorSolicitado": ');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_JSON');
  });

  it('responde 500 genérico sin exponer detalles internos', async () => {
    const response = await request(app).get('/api/error-inesperado');

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(response.body)).not.toContain('10.0.0.5');
  });

  it('traduce la violación de índice único de SQL Server (2601) a 409', async () => {
    const response = await request(app).get('/api/error-sql-duplicado');

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('CONFLICT');
  });

  it('incluye el requestId en la respuesta y en la cabecera X-Request-Id', async () => {
    const response = await request(app).get('/api/no-existe');

    expect(response.headers['x-request-id']).toBeDefined();
    expect(response.body.error.requestId).toBe(response.headers['x-request-id']);
  });

  it('reutiliza el X-Request-Id recibido para correlacionar con otros sistemas', async () => {
    const response = await request(app)
      .get('/api/no-existe')
      .set('X-Request-Id', 'balanceador-123');

    expect(response.headers['x-request-id']).toBe('balanceador-123');
  });

  it('agrega cabeceras de seguridad (Helmet) y oculta la tecnología del servidor', async () => {
    const response = await request(app).get('/health/live');

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });
});
