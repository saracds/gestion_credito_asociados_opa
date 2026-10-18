import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { ADMIN, ANALISTA, CONSULTA, solicitudValida } from '../fakes/fixtures.js';
import { createTestApiApp } from '../helpers/createTestApiApp.js';

type TestContext = Awaited<ReturnType<typeof createTestApiApp>>;

describe('API /api/creditos', () => {
  let context: TestContext;
  let tokenAnalista: string;

  beforeEach(async () => {
    context = await createTestApiApp();
    tokenAnalista = await context.authHeader(ANALISTA);
  });

  const crearCredito = (cuerpo: object = solicitudValida(), token = tokenAnalista) =>
    request(context.app).post('/api/creditos').set('Authorization', token).send(cuerpo);

  describe('POST /api/creditos', () => {
    it('responde 201 con el crédito, la cabecera Location y su versión en ETag', async () => {
      const response = await crearCredito();

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        success: true,
        data: { estado: 'SOLICITADO', numeroCredito: expect.stringMatching(/^CR-/) },
      });
      expect(response.headers.location).toBe(`/api/creditos/${response.body.data.id}`);
      expect(response.headers.etag).toBe(`"${response.body.data.version}"`);
    });

    it('responde 400 con el detalle de cada campo inválido', async () => {
      const response = await crearCredito(
        solicitudValida({ valorSolicitado: 0, tasaInteres: -1, numeroCuotas: 0 }),
      );

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(
        response.body.error.details.map((detalle: { field: string }) => detalle.field),
      ).toEqual(['valorSolicitado', 'tasaInteres', 'numeroCuotas']);
    });

    it('rechaza campos no permitidos, p. ej. intentar crear un crédito ya APROBADO', async () => {
      const response = await crearCredito({ ...solicitudValida(), estado: 'APROBADO' });

      expect(response.status).toBe(400);
      expect(context.database.creditos).toHaveLength(0);
    });

    it('rechaza valores monetarios con más de 2 decimales', async () => {
      const response = await crearCredito(solicitudValida({ valorSolicitado: 1_000_000.555 }));

      expect(response.status).toBe(400);
    });

    it('responde 403 si el rol es CONSULTA', async () => {
      const response = await crearCredito(solicitudValida(), await context.authHeader(CONSULTA));

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
    });

    it('responde 409 CREDITO_DUPLICADO ante un segundo crédito activo del mismo tipo', async () => {
      await crearCredito();
      const response = await crearCredito();

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('CREDITO_DUPLICADO');
    });
  });

  describe('GET /api/creditos/{id}', () => {
    it('responde 404 con el formato de error de la prueba cuando el crédito no existe', async () => {
      const response = await request(context.app)
        .get('/api/creditos/999')
        .set('Authorization', tokenAnalista);

      expect(response.status).toBe(404);
      expect(response.body).toMatchObject({
        success: false,
        error: { code: 'CREDITO_NOT_FOUND', message: 'El crédito 999 no existe.' },
      });
    });

    it('responde 400 si el id no es numérico', async () => {
      const response = await request(context.app)
        .get('/api/creditos/abc')
        .set('Authorization', tokenAnalista);

      expect(response.status).toBe(400);
    });

    it('el rol CONSULTA puede leer', async () => {
      const creado = await crearCredito();

      const response = await request(context.app)
        .get(`/api/creditos/${creado.body.data.id}`)
        .set('Authorization', await context.authHeader(CONSULTA));

      expect(response.status).toBe(200);
      expect(response.headers.etag).toBeDefined();
    });
  });

  describe('PATCH /api/creditos/{id} (concurrencia optimista)', () => {
    it('responde 428 si no se envía If-Match', async () => {
      const creado = await crearCredito();

      const response = await request(context.app)
        .patch(`/api/creditos/${creado.body.data.id}`)
        .set('Authorization', tokenAnalista)
        .send({ valorSolicitado: 12_000_000 });

      expect(response.status).toBe(428);
      expect(response.body.error.code).toBe('PRECONDITION_REQUIRED');
    });

    it('actualiza con la versión vigente y devuelve una versión nueva', async () => {
      const creado = await crearCredito();

      const response = await request(context.app)
        .patch(`/api/creditos/${creado.body.data.id}`)
        .set('Authorization', tokenAnalista)
        .set('If-Match', creado.headers.etag!)
        .send({ valorSolicitado: 12_000_000 });

      expect(response.status).toBe(200);
      expect(response.body.data.valorSolicitado).toBe(12_000_000);
      expect(response.headers.etag).not.toBe(creado.headers.etag);
    });

    it('responde 412 si otro usuario modificó el crédito primero (actualización perdida)', async () => {
      const creado = await crearCredito();
      const versionLeidaPorAmbos = creado.headers.etag!;
      const url = `/api/creditos/${creado.body.data.id}`;

      await request(context.app)
        .patch(url)
        .set('Authorization', tokenAnalista)
        .set('If-Match', versionLeidaPorAmbos)
        .send({ numeroCuotas: 24 });

      const response = await request(context.app)
        .patch(url)
        .set('Authorization', await context.authHeader(ADMIN))
        .set('If-Match', versionLeidaPorAmbos)
        .send({ valorSolicitado: 9_000_000 });

      expect(response.status).toBe(412);
      expect(response.body.error.code).toBe('PRECONDITION_FAILED');
    });

    it('responde 422 CAMPO_INMUTABLE si se intenta cambiar la identificación o el estado', async () => {
      const creado = await crearCredito();

      const response = await request(context.app)
        .patch(`/api/creditos/${creado.body.data.id}`)
        .set('Authorization', tokenAnalista)
        .set('If-Match', creado.headers.etag!)
        .send({ identificacionAsociado: '999999999', estado: 'APROBADO' });

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('CAMPO_INMUTABLE');
      expect(
        response.body.error.details.map((detalle: { field: string }) => detalle.field),
      ).toEqual(['identificacionAsociado', 'estado']);
    });

    it('PUT responde 405 indicando que se use PATCH', async () => {
      const creado = await crearCredito();

      const response = await request(context.app)
        .put(`/api/creditos/${creado.body.data.id}`)
        .set('Authorization', tokenAnalista)
        .send(solicitudValida());

      expect(response.status).toBe(405);
      expect(response.headers.allow).toContain('PATCH');
    });
  });

  describe('PATCH /api/creditos/{id}/estado', () => {
    it('cambia el estado siguiendo la máquina de estados', async () => {
      const creado = await crearCredito();

      const response = await request(context.app)
        .patch(`/api/creditos/${creado.body.data.id}/estado`)
        .set('Authorization', tokenAnalista)
        .send({ estado: 'EN_ESTUDIO', observacion: 'Inicia estudio' });

      expect(response.status).toBe(200);
      expect(response.body.data.estado).toBe('EN_ESTUDIO');
    });

    it('responde 422 ante una transición inválida', async () => {
      const creado = await crearCredito();

      const response = await request(context.app)
        .patch(`/api/creditos/${creado.body.data.id}/estado`)
        .set('Authorization', tokenAnalista)
        .send({ estado: 'DESEMBOLSADO' });

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('TRANSICION_ESTADO_INVALIDA');
    });

    it('responde 400 ante un estado que no existe', async () => {
      const creado = await crearCredito();

      const response = await request(context.app)
        .patch(`/api/creditos/${creado.body.data.id}/estado`)
        .set('Authorization', tokenAnalista)
        .send({ estado: 'PAGADO' });

      expect(response.status).toBe(400);
    });
  });

  describe('DELETE /api/creditos/{id}', () => {
    it('solo el rol ADMIN puede eliminar', async () => {
      const creado = await crearCredito();

      const response = await request(context.app)
        .delete(`/api/creditos/${creado.body.data.id}`)
        .set('Authorization', tokenAnalista);

      expect(response.status).toBe(403);
    });

    it('ADMIN realiza el borrado lógico (204) y el crédito deja de consultarse', async () => {
      const creado = await crearCredito();
      const tokenAdmin = await context.authHeader(ADMIN);
      const url = `/api/creditos/${creado.body.data.id}`;

      const eliminado = await request(context.app).delete(url).set('Authorization', tokenAdmin);
      const consulta = await request(context.app).get(url).set('Authorization', tokenAdmin);

      expect(eliminado.status).toBe(204);
      expect(consulta.status).toBe(404);
    });
  });

  describe('GET /api/creditos (listado)', () => {
    it('devuelve los créditos con metadatos de paginación', async () => {
      await crearCredito();
      await crearCredito(
        solicitudValida({ identificacionAsociado: '43567890', nombreAsociado: 'María Gómez' }),
      );

      const response = await request(context.app)
        .get('/api/creditos?page=1&pageSize=1')
        .set('Authorization', tokenAnalista);

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.meta).toEqual({ page: 1, pageSize: 1, totalItems: 2, totalPages: 2 });
    });

    it('filtra por estado e identificación; un filtro vacío se ignora', async () => {
      await crearCredito();
      await crearCredito(
        solicitudValida({ identificacionAsociado: '43567890', nombreAsociado: 'María Gómez' }),
      );

      const response = await request(context.app)
        .get('/api/creditos?identificacionAsociado=43567890&estado=SOLICITADO&tipoCredito=')
        .set('Authorization', tokenAnalista);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].nombreAsociado).toBe('María Gómez');
    });

    it('responde 400 si pageSize supera el máximo', async () => {
      const response = await request(context.app)
        .get('/api/creditos?pageSize=1000')
        .set('Authorization', tokenAnalista);

      expect(response.status).toBe(400);
    });
  });

  describe('GET /api/creditos/resumen y /historial', () => {
    it('el resumen entrega totales por estado para el dashboard', async () => {
      await crearCredito();

      const response = await request(context.app)
        .get('/api/creditos/resumen')
        .set('Authorization', tokenAnalista);

      expect(response.status).toBe(200);
      expect(response.body.data.totalCreditos).toBe(1);
      expect(response.body.data.porEstado).toHaveLength(6);
    });

    it('el historial muestra la creación y los cambios en orden', async () => {
      const creado = await crearCredito();
      const id = creado.body.data.id;
      await request(context.app)
        .patch(`/api/creditos/${id}/estado`)
        .set('Authorization', tokenAnalista)
        .send({ estado: 'EN_ESTUDIO' });

      const response = await request(context.app)
        .get(`/api/creditos/${id}/historial`)
        .set('Authorization', tokenAnalista);

      expect(response.body.data.map((evento: { tipoEvento: string }) => evento.tipoEvento)).toEqual(
        ['CREACION', 'CAMBIO_ESTADO'],
      );
    });
  });
});
