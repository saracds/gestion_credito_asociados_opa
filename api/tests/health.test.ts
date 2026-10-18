import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createTestApp } from './helpers/createTestApp.js';

describe('Health checks', () => {
  it('GET /health/live responde 200 sin consultar dependencias', async () => {
    const app = createTestApp({
      checkDatabase: async () => {
        throw new Error('No debería consultarse la base de datos');
      },
    });

    const response = await request(app).get('/health/live');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, data: { status: 'UP' } });
  });

  it('GET /health/ready responde 200 cuando la base de datos responde', async () => {
    const app = createTestApp();

    const response = await request(app).get('/health/ready');

    expect(response.status).toBe(200);
    expect(response.body.data.checks).toEqual({ database: 'UP' });
  });

  it('GET /health/ready responde 503 cuando la base de datos no responde', async () => {
    const app = createTestApp({
      checkDatabase: async () => {
        throw new Error('Conexión rechazada');
      },
    });

    const response = await request(app).get('/health/ready');

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      success: false,
      error: { code: 'SERVICE_UNAVAILABLE' },
    });
  });
});
