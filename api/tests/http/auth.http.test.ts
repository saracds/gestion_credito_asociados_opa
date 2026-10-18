import { SignJWT } from 'jose';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { JWT_SECRET_PRUEBA } from '../fakes/fixtures.js';
import {
  CLAVE_PRUEBA,
  createTestApiApp,
  TOKEN_CONFIG_PRUEBA,
} from '../helpers/createTestApiApp.js';

describe('Autenticación', () => {
  it('POST /api/auth/login entrega un token Bearer con los datos del usuario', async () => {
    const { app } = await createTestApiApp();

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'Analista@OPA.local', password: CLAVE_PRUEBA });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      tokenType: 'Bearer',
      expiresIn: 3600,
      accessToken: expect.any(String),
      usuario: { email: 'analista@opa.local', rol: 'ANALISTA' },
    });
    expect(response.body.data.usuario).not.toHaveProperty('passwordHash');
  });

  it.each([
    ['contraseña incorrecta', 'analista@opa.local', 'otra-clave'],
    ['correo inexistente', 'nadie@opa.local', CLAVE_PRUEBA],
    ['usuario inactivo', 'inactivo@opa.local', CLAVE_PRUEBA],
  ])('responde el mismo 401 genérico ante %s', async (_caso, email, password) => {
    const { app } = await createTestApiApp();

    const response = await request(app).post('/api/auth/login').send({ email, password });

    expect(response.status).toBe(401);
    expect(response.body.error).toMatchObject({
      code: 'CREDENCIALES_INVALIDAS',
      message: 'Correo o contraseña incorrectos.',
    });
  });

  it('responde 400 si el correo no tiene formato válido', async () => {
    const { app } = await createTestApiApp();

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'no-es-correo', password: 'x' });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].field).toBe('email');
  });

  it('bloquea con 429 tras superar los intentos de login permitidos', async () => {
    const { app } = await createTestApiApp({ maxLoginAttempts: 2 });
    const intento = () =>
      request(app).post('/api/auth/login').send({ email: 'analista@opa.local', password: 'mala' });

    await intento();
    await intento();
    const response = await intento();

    expect(response.status).toBe(429);
    expect(response.body.error.code).toBe('TOO_MANY_REQUESTS');
  });

  describe('detrás del proxy Nginx del frontend', () => {
    const intentoDesde = (app: Parameters<typeof request>[0], ipUsuario: string) =>
      request(app)
        .post('/api/auth/login')
        .set('X-Forwarded-For', ipUsuario)
        .send({ email: 'analista@opa.local', password: 'mala' });

    it('con TRUST_PROXY_HOPS=1 cuenta los intentos por usuario, no por proxy', async () => {
      const { app } = await createTestApiApp({ maxLoginAttempts: 2, trustProxyHops: 1 });

      await intentoDesde(app, '203.0.113.10');
      await intentoDesde(app, '203.0.113.10');
      expect((await intentoDesde(app, '203.0.113.10')).status).toBe(429);
      // Otro usuario detrás del mismo proxy no queda bloqueado por el atacante.
      expect((await intentoDesde(app, '198.51.100.7')).status).toBe(401);
    });

    it('sin proxies de confianza ignora X-Forwarded-For (no se puede falsificar la IP)', async () => {
      const { app } = await createTestApiApp({ maxLoginAttempts: 2 });

      await intentoDesde(app, '203.0.113.10');
      await intentoDesde(app, '203.0.113.11');
      expect((await intentoDesde(app, '203.0.113.12')).status).toBe(429);
    });
  });

  it('GET /api/auth/me devuelve el usuario dueño del token', async () => {
    const { app } = await createTestApiApp();
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@opa.local', password: CLAVE_PRUEBA });

    const response = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${login.body.data.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ email: 'admin@opa.local', rol: 'ADMIN' });
  });

  it('responde 401 TOKEN_REQUERIDO al consultar créditos sin token', async () => {
    const { app } = await createTestApiApp();

    const response = await request(app).get('/api/creditos');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('TOKEN_REQUERIDO');
  });

  it('responde 401 TOKEN_INVALIDO con un token alterado', async () => {
    const { app } = await createTestApiApp();

    const response = await request(app)
      .get('/api/creditos')
      .set('Authorization', 'Bearer eyJhbGciOiJIUzI1NiJ9.e30.firma-falsa');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('TOKEN_INVALIDO');
  });

  it('responde 401 TOKEN_EXPIRADO con un token vencido', async () => {
    const { app } = await createTestApiApp();
    const tokenVencido = await new SignJWT({ email: 'a@opa.local', nombre: 'A', rol: 'ADMIN' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('1')
      .setIssuer(TOKEN_CONFIG_PRUEBA.issuer)
      .setAudience(TOKEN_CONFIG_PRUEBA.audience)
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(new TextEncoder().encode(JWT_SECRET_PRUEBA));

    const response = await request(app)
      .get('/api/creditos')
      .set('Authorization', `Bearer ${tokenVencido}`);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('TOKEN_EXPIRADO');
  });
});
