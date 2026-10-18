import { describe, expect, it } from 'vitest';

import { loadEnvironment, loadWorkerEnvironment } from '../src/config/environment.js';

const minimumValidEnvironment = {
  DB_HOST: 'db',
  DB_USER: 'usuario_app',
  DB_PASSWORD: 'secreto',
  JWT_SECRET: 'secreto-de-pruebas-con-mas-de-32-caracteres',
};

describe('Configuración por variables de entorno', () => {
  it('aplica valores por defecto seguros', () => {
    const environment = loadEnvironment(minimumValidEnvironment);

    expect(environment).toMatchObject({
      NODE_ENV: 'development',
      PORT: 3000,
      DB_PORT: 1433,
      DB_NAME: 'CreditosOPA',
      DB_ENCRYPT: true,
      DB_TRUST_SERVER_CERTIFICATE: false,
    });
  });

  it('convierte texto en números, booleanos y listas', () => {
    const environment = loadEnvironment({
      ...minimumValidEnvironment,
      PORT: '8080',
      DB_ENCRYPT: 'false',
      CORS_ALLOWED_ORIGINS: 'http://localhost:5173, https://creditos.opa.com',
    });

    expect(environment.PORT).toBe(8080);
    expect(environment.DB_ENCRYPT).toBe(false);
    expect(environment.CORS_ALLOWED_ORIGINS).toEqual([
      'http://localhost:5173',
      'https://creditos.opa.com',
    ]);
  });

  it('falla indicando cada variable obligatoria que falta', () => {
    expect(() => loadEnvironment({})).toThrow(/DB_HOST[\s\S]*DB_USER[\s\S]*DB_PASSWORD/);
  });

  it('en producción no permite conectarse como administrador (sa)', () => {
    const produccionConSa = { ...minimumValidEnvironment, NODE_ENV: 'production', DB_USER: 'SA' };

    expect(() => loadEnvironment(produccionConSa)).toThrow(/DB_USER.*administrador/);
    expect(() =>
      loadWorkerEnvironment({ ...produccionConSa, WEBHOOK_SECRET: 'x'.repeat(32) }),
    ).toThrow(/DB_USER.*administrador/);
  });

  it('en producción acepta el login de la aplicación', () => {
    expect(
      loadEnvironment({
        ...minimumValidEnvironment,
        NODE_ENV: 'production',
        DB_USER: 'app_creditos_api',
      }).DB_USER,
    ).toBe('app_creditos_api');
  });

  it('rechaza valores booleanos ambiguos', () => {
    expect(() => loadEnvironment({ ...minimumValidEnvironment, DB_ENCRYPT: 'si' })).toThrow(
      /DB_ENCRYPT/,
    );
  });
});
