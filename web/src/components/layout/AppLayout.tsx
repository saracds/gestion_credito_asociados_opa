import { FilePlus2Icon, LayoutDashboardIcon, ListIcon, LogOutIcon } from 'lucide-react';
import { Suspense, type ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router';

import { PERMISOS, useAuth } from '@/auth/AuthContext';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/feedback';
import { cn } from '@/lib/utils';

const ETIQUETA_ROL = {
  ADMIN: 'Administrador',
  ANALISTA: 'Analista',
  CONSULTA: 'Consulta',
} as const;

/**
 * Estructura de la aplicación: navegación lateral fija (en pantallas grandes)
 * con el color de la tapa de la libreta, y el contenido a la derecha.
 * En móviles la navegación pasa arriba, en una fila.
 */
export function AppLayout() {
  const { usuario, cerrar, tieneRol } = useAuth();

  const enlaces = [
    { a: '/', etiqueta: 'Resumen', icono: LayoutDashboardIcon, visible: true },
    { a: '/creditos', etiqueta: 'Créditos', icono: ListIcon, visible: true },
    {
      a: '/creditos/nuevo',
      etiqueta: 'Nuevo crédito',
      icono: FilePlus2Icon,
      visible: tieneRol(...PERMISOS.gestionar),
    },
  ];

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_1fr]">
      <aside className="flex flex-col bg-sidebar text-sidebar-foreground lg:sticky lg:top-0 lg:h-dvh">
        <div className="px-5 pt-5 pb-4">
          <p className="text-lg leading-tight font-bold text-white">Créditos</p>
          <p className="text-sm text-sidebar-foreground/80">Módulo de crédito para asociados</p>
        </div>

        <nav aria-label="Principal" className="px-3">
          <ul className="flex gap-1 overflow-x-auto pb-3 lg:flex-col lg:pb-0">
            {enlaces
              .filter((enlace) => enlace.visible)
              .map(({ a, etiqueta, icono: Icono }) => (
                <li key={a}>
                  <NavLink
                    to={a}
                    end
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm whitespace-nowrap',
                        isActive
                          ? 'bg-sidebar-active font-semibold text-white'
                          : 'hover:bg-sidebar-active/60',
                      )
                    }
                  >
                    <Icono className="size-4" aria-hidden />
                    {etiqueta}
                  </NavLink>
                </li>
              ))}
          </ul>
        </nav>

        {usuario && (
          <div className="mt-auto hidden border-t border-white/10 px-5 py-4 lg:block">
            <p className="text-sm font-semibold text-white">{usuario.nombre}</p>
            <p className="text-sm text-sidebar-foreground/80">{ETIQUETA_ROL[usuario.rol]}</p>
            <Button
              variant="ghost"
              size="sm"
              className="mt-3 -ml-3 text-sidebar-foreground hover:bg-sidebar-active hover:text-white"
              onClick={() => cerrar()}
            >
              <LogOutIcon aria-hidden />
              Cerrar sesión
            </Button>
          </div>
        )}
      </aside>

      <div className="min-w-0">
        {usuario && (
          <div className="flex items-center justify-end gap-3 border-b bg-card px-4 py-2 text-sm lg:hidden">
            <span>
              {usuario.nombre} ({ETIQUETA_ROL[usuario.rol]})
            </span>
            <Button variant="outline" size="sm" onClick={() => cerrar()}>
              Cerrar sesión
            </Button>
          </div>
        )}
        <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-8 sm:py-8">
          {/* Mientras llega el código de la pantalla se mantiene el menú y se ve un esqueleto. */}
          <Suspense fallback={<Skeleton className="h-96" />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}

/** Encabezado de página consistente: título, descripción opcional y acciones. */
export function EncabezadoPagina({
  titulo,
  descripcion,
  acciones,
}: {
  titulo: string;
  descripcion?: ReactNode;
  acciones?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="grid gap-1">
        <h1 className="text-[1.75rem] leading-tight font-bold">{titulo}</h1>
        {descripcion && <div className="text-muted-foreground">{descripcion}</div>}
      </div>
      {acciones && <div className="flex flex-wrap gap-2">{acciones}</div>}
    </header>
  );
}
