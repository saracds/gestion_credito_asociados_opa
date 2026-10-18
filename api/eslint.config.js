// @ts-check
import eslint from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * ESLint revisa calidad del código (errores probables, malas prácticas).
 * El formato (espacios, comillas, saltos de línea) lo controla Prettier;
 * eslint-config-prettier desactiva las reglas de estilo que chocarían con él.
 */
export default tseslint.config(
  { ignores: ['dist/', 'coverage/', 'node_modules/'] },
  eslint.configs.recommended,
  ...tseslint.configs.strict,
  ...tseslint.configs.stylistic,
  {
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      // Toda salida pasa por el logger estructurado (pino), nunca por console.
      'no-console': 'error',
      // Los parámetros que se ignoran a propósito se nombran con prefijo "_".
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      eqeqeq: ['error', 'always'],
    },
  },
  {
    // En las pruebas, afirmar que un valor existe (`valor!`) es intencional: si
    // no existiera, la prueba debe fallar.
    files: ['tests/**/*.ts', 'tests-integration/**/*.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
  eslintConfigPrettier,
);
