import { QueryClient } from '@tanstack/react-query';

import { ApiError } from '@/api/client';

/**
 * Estado del servidor con TanStack Query: caché, reintentos y recarga de datos.
 * - No se reintentan errores 4xx: repetir una petición inválida no la arregla.
 * - Al volver a la pestaña se refrescan los datos (otro analista pudo cambiarlos).
 */
export function crearQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        retry: (intentos, error) =>
          !(error instanceof ApiError && error.status >= 400 && error.status < 500) && intentos < 2,
      },
    },
  });
}
