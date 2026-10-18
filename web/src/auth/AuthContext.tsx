import type { ReactNode } from 'react';
import { createContext, use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { configurarSesion } from '@/api/client';
import { iniciarSesion } from '@/api/endpoints';
import type { Rol, Usuario } from '@/api/types';

/**
 * SESIÓN EN MEMORIA.
 *
 * El token vive solo en el estado de React y en una variable del cliente HTTP;
 * nunca en localStorage, sessionStorage ni cookies legibles por JavaScript.
 *
 * - A favor: un script malicioso inyectado no puede leerlo del
 *   almacenamiento del navegador, y el token desaparece al cerrar la pestaña.
 * - En contra: al recargar la página se debe iniciar sesión otra vez.
 * - Mejora futura: token de acceso corto en memoria + token de renovación en
 *   cookie HttpOnly/SameSite=Strict (requiere un endpoint /auth/refresh).
 *
 * La sesión se cierra sola al vencer el token (temporizador) o si la API
 * responde 401 en cualquier petición.
 */

interface Sesion {
  usuario: Usuario;
  token: string;
}

interface AuthContextValue {
  usuario: Usuario | null;
  iniciar: (email: string, password: string) => Promise<void>;
  cerrar: (motivo?: string) => void;
  /** ¿El rol del usuario está entre los permitidos? */
  tieneRol: (...roles: Rol[]) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [sesion, setSesion] = useState<Sesion | null>(null);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queryClient = useQueryClient();

  const cerrar = useCallback(
    (motivo?: string) => {
      if (temporizador.current) clearTimeout(temporizador.current);
      setSesion(null);
      // Se borra la caché para que el próximo usuario del navegador no vea datos ajenos.
      queryClient.clear();
      if (motivo) toast.info(motivo);
    },
    [queryClient],
  );

  // El cliente HTTP conoce el token y sabe cómo cerrar la sesión ante un 401.
  useEffect(() => {
    configurarSesion(sesion?.token ?? null, () =>
      cerrar('Su sesión terminó. Inicie sesión de nuevo para continuar.'),
    );
  }, [sesion, cerrar]);

  const iniciar = useCallback(
    async (email: string, password: string) => {
      const resultado = await iniciarSesion(email, password);
      setSesion({ usuario: resultado.usuario, token: resultado.accessToken });

      if (temporizador.current) clearTimeout(temporizador.current);
      temporizador.current = setTimeout(
        () => cerrar('Su sesión terminó por tiempo. Inicie sesión de nuevo para continuar.'),
        resultado.expiresIn * 1000,
      );
    },
    [cerrar],
  );

  useEffect(
    () => () => {
      if (temporizador.current) clearTimeout(temporizador.current);
    },
    [],
  );

  const valor = useMemo<AuthContextValue>(
    () => ({
      usuario: sesion?.usuario ?? null,
      iniciar,
      cerrar,
      tieneRol: (...roles) => (sesion ? roles.includes(sesion.usuario.rol) : false),
    }),
    [sesion, iniciar, cerrar],
  );

  return <AuthContext value={valor}>{children}</AuthContext>;
}

export function useAuth(): AuthContextValue {
  const contexto = use(AuthContext);
  if (!contexto) throw new Error('useAuth debe usarse dentro de <AuthProvider>.');
  return contexto;
}

/** Permisos de la interfaz por rol (la API los vuelve a validar siempre). */
export const PERMISOS = {
  gestionar: ['ADMIN', 'ANALISTA'] as Rol[],
  eliminar: ['ADMIN'] as Rol[],
  reprogramarWebhooks: ['ADMIN'] as Rol[],
};
