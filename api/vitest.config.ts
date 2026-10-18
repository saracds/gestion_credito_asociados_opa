import { defineConfig } from 'vitest/config';

/**
 * Pruebas con Vitest: ejecuta TypeScript y módulos ES de forma nativa,
 * sin la configuración adicional (ts-jest, transformaciones ESM) que exige Jest.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    clearMocks: true,
    restoreMocks: true,
  },
});
