import { useEffect, useState } from 'react';

/**
 * Devuelve el valor solo después de que deja de cambiar durante `esperaMs`.
 * Evita consultar la API con cada tecla al escribir en la búsqueda.
 */
export function useDebounce<T>(valor: T, esperaMs = 350): T {
  const [valorDiferido, setValorDiferido] = useState(valor);

  useEffect(() => {
    const temporizador = setTimeout(() => setValorDiferido(valor), esperaMs);
    return () => clearTimeout(temporizador);
  }, [valor, esperaMs]);

  return valorDiferido;
}
