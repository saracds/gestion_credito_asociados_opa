import { Router } from 'express';
import { pino } from 'pino';

import { createApp } from '../../src/app.js';

interface TestAppOptions {
  /** Simula la base de datos: por defecto responde bien. */
  checkDatabase?: () => Promise<void>;
  /** Rutas adicionales bajo /api para ejercitar escenarios específicos. */
  apiRouter?: Router;
}

/** Logger silencioso: las pruebas no deben llenar la consola. */
const silentLogger = pino({ level: 'silent' });

/** Crea la aplicación con dobles de prueba, sin base de datos real ni puertos abiertos. */
export function createTestApp({ checkDatabase, apiRouter }: TestAppOptions = {}) {
  return createApp({
    logger: silentLogger,
    corsAllowedOrigins: ['http://localhost:5173'],
    checkDatabase: checkDatabase ?? (async () => undefined),
    apiRouter: apiRouter ?? Router(),
    version: '0.0.0-test',
  });
}
