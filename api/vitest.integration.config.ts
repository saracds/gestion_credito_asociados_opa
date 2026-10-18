import { defineConfig } from 'vitest/config';

/**
 * Pruebas de INTEGRACIÓN: necesitan el SQL Server del docker-compose.
 * Se ejecutan aparte (npm run test:integration) para que `npm test` y la
 * construcción de la imagen Docker no dependan de una base de datos.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests-integration/**/*.int.test.ts'],
    // Un archivo a la vez: comparten la misma base de datos.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
