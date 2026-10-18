import SwaggerParser from '@apidevtools/swagger-parser';
import request from 'supertest';
import { beforeEach, describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';

import { construirDocumentoOpenApi } from '../../src/docs/openapiDocument.js';
import {
  catalogosSchema,
  creditoSchema,
  errorRespuestaSchema,
  eventoHistorialSchema,
  loginRespuestaSchema,
  resumenCreditosSchema,
  respuestaExitosa,
  trazaNotificacionSchema,
  usuarioSchema,
} from '../../src/docs/openapiSchemas.js';
import type {
  Credito,
  EventoHistorial,
  ResumenCreditos,
} from '../../src/modules/creditos/domain/credito.types.js';
import type { TrazaNotificacion } from '../../src/modules/webhooks/WebhookOutboxRepository.js';
import { ADMIN, ANALISTA, solicitudValida } from '../fakes/fixtures.js';
import { CLAVE_PRUEBA, createTestApiApp } from '../helpers/createTestApiApp.js';

/**
 * PRUEBAS DE CONTRATO: la documentación OpenAPI debe describir exactamente lo
 * que la API hace. Si alguien cambia una respuesta sin actualizar el esquema
 * (o al revés), estas pruebas fallan.
 */

type TestContext = Awaited<ReturnType<typeof createTestApiApp>>;

describe('Documento OpenAPI', () => {
  it('es un documento OpenAPI 3.1 válido según el estándar', async () => {
    const documento = construirDocumentoOpenApi('1.0.0');

    // validate() verifica la estructura y resuelve todas las referencias $ref.
    await expect(
      SwaggerParser.validate(structuredClone(documento) as never),
    ).resolves.toBeDefined();
    expect(documento.openapi).toBe('3.1.0');
  });

  it('documenta el webhook saliente credito.creado', () => {
    const documento = construirDocumentoOpenApi('1.0.0') as { webhooks: Record<string, unknown> };
    expect(documento.webhooks).toHaveProperty('credito.creado');
  });

  it('los tipos de TypeScript coinciden con los esquemas documentados (verificación en compilación)', () => {
    expectTypeOf<Credito>().toEqualTypeOf<z.infer<typeof creditoSchema>>();
    expectTypeOf<ResumenCreditos>().toEqualTypeOf<z.infer<typeof resumenCreditosSchema>>();
    expectTypeOf<EventoHistorial>().toEqualTypeOf<z.infer<typeof eventoHistorialSchema>>();
    expectTypeOf<TrazaNotificacion>().toEqualTypeOf<z.infer<typeof trazaNotificacionSchema>>();
  });
});

describe('Swagger UI', () => {
  it('publica la interfaz en /api/docs y el documento en /api/docs/openapi.json sin exigir token', async () => {
    const { app } = await createTestApiApp();

    const interfaz = await request(app).get('/api/docs/');
    const documento = await request(app).get('/api/docs/openapi.json');

    expect(interfaz.status).toBe(200);
    expect(interfaz.text).toContain('swagger-ui');
    expect(documento.status).toBe(200);
    expect(documento.body.openapi).toBe('3.1.0');
  });

  it('la política de seguridad de la documentación no fuerza HTTPS (funciona en http://localhost)', async () => {
    const { app } = await createTestApiApp();

    const interfaz = await request(app).get('/api/docs/');

    expect(interfaz.headers['content-security-policy']).not.toContain('upgrade-insecure-requests');
  });
});

describe('Cada operación documentada existe en la API', () => {
  const documento = construirDocumentoOpenApi('1.0.0') as {
    paths: Record<string, Record<string, unknown>>;
  };
  const operaciones = Object.entries(documento.paths).flatMap(([ruta, metodos]) =>
    Object.keys(metodos).map((metodo) => [metodo.toUpperCase(), ruta] as const),
  );

  it.each(operaciones)('%s %s', async (metodo, ruta) => {
    const { app, authHeader } = await createTestApiApp();
    const url = ruta.replace('{id}', '1');

    const response = await request(app)
      [metodo.toLowerCase() as 'get' | 'post' | 'patch' | 'delete'](url)
      .set('Authorization', await authHeader(ADMIN))
      .send({});

    expect(response.body?.error?.code).not.toBe('ROUTE_NOT_FOUND');
  });
});

describe('Las respuestas reales cumplen los esquemas documentados', () => {
  let context: TestContext;
  let token: string;

  beforeEach(async () => {
    context = await createTestApiApp();
    token = await context.authHeader(ANALISTA);
  });

  /** Valida y muestra exactamente qué campo no cumple, si falla. */
  const cumple = (esquema: z.ZodType, cuerpo: unknown) => {
    const resultado = esquema.safeParse(cuerpo);
    expect(resultado.success, JSON.stringify(resultado.error?.issues, null, 2)).toBe(true);
  };

  const crear = () =>
    request(context.app).post('/api/creditos').set('Authorization', token).send(solicitudValida());

  it('POST /api/auth/login', async () => {
    const response = await request(context.app)
      .post('/api/auth/login')
      .send({ email: 'analista@opa.local', password: CLAVE_PRUEBA });
    cumple(respuestaExitosa(loginRespuestaSchema), response.body);
  });

  it('GET /api/auth/me', async () => {
    const response = await request(context.app).get('/api/auth/me').set('Authorization', token);
    cumple(respuestaExitosa(usuarioSchema), response.body);
  });

  it('GET /api/catalogos', async () => {
    const response = await request(context.app).get('/api/catalogos').set('Authorization', token);
    cumple(respuestaExitosa(catalogosSchema), response.body);
  });

  it('POST /api/creditos y GET /api/creditos/{id}', async () => {
    const creado = await crear();
    const consultado = await request(context.app)
      .get(`/api/creditos/${creado.body.data.id}`)
      .set('Authorization', token);

    cumple(respuestaExitosa(creditoSchema), creado.body);
    cumple(respuestaExitosa(creditoSchema), consultado.body);
  });

  it('GET /api/creditos (con paginación)', async () => {
    await crear();
    const response = await request(context.app).get('/api/creditos').set('Authorization', token);
    cumple(respuestaExitosa(z.array(creditoSchema), true), response.body);
  });

  it('GET /api/creditos/resumen', async () => {
    const response = await request(context.app)
      .get('/api/creditos/resumen')
      .set('Authorization', token);
    cumple(respuestaExitosa(resumenCreditosSchema), response.body);
  });

  it('GET /api/creditos/{id}/historial y /notificaciones', async () => {
    const creado = await crear();
    const id = creado.body.data.id;

    const historial = await request(context.app)
      .get(`/api/creditos/${id}/historial`)
      .set('Authorization', token);
    const notificaciones = await request(context.app)
      .get(`/api/creditos/${id}/notificaciones`)
      .set('Authorization', token);

    cumple(respuestaExitosa(z.array(eventoHistorialSchema)), historial.body);
    cumple(respuestaExitosa(z.array(trazaNotificacionSchema)), notificaciones.body);
  });

  it('las respuestas de error (400, 401, 404, 422) siguen el formato documentado', async () => {
    const respuestas = await Promise.all([
      request(context.app).post('/api/creditos').set('Authorization', token).send({}),
      request(context.app).get('/api/creditos'),
      request(context.app).get('/api/creditos/999').set('Authorization', token),
      request(context.app)
        .post('/api/creditos')
        .set('Authorization', token)
        .send(solicitudValida({ valorSolicitado: 100 })),
    ]);

    expect(respuestas.map((response) => response.status)).toEqual([400, 401, 404, 422]);
    for (const response of respuestas) {
      cumple(errorRespuestaSchema, response.body);
    }
  });
});
