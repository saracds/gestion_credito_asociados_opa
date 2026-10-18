import { QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense, useState } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router';

import { AuthProvider, PERMISOS, useAuth } from '@/auth/AuthContext';
import { AppLayout } from '@/components/layout/AppLayout';
import { Toaster } from '@/components/ui/feedback';
import { crearQueryClient } from '@/lib/queryClient';

// Cada pantalla se descarga al visitarla (división por rutas)
const LoginPage = lazy(() =>
  import('@/features/auth/LoginPage').then((m) => ({ default: m.LoginPage })),
);

const ResumenPage = lazy(() =>
  import('@/features/dashboard/ResumenPage').then((m) => ({ default: m.ResumenPage })),
);

const ListadoCreditosPage = lazy(() =>
  import('@/features/creditos/ListadoCreditosPage').then((m) => ({
    default: m.ListadoCreditosPage,
  })),
);

const NuevoCreditoPage = lazy(() =>
  import('@/features/creditos/NuevoCreditoPage').then((m) => ({ default: m.NuevoCreditoPage })),
);

const DetalleCreditoPage = lazy(() =>
  import('@/features/creditos/DetalleCreditoPage').then((m) => ({ default: m.DetalleCreditoPage })),
);

import type { Rol } from '@/api/types';

/** Solo deja pasar a usuarios autenticados (y opcionalmente con cierto rol). */
function RutaProtegida({ roles }: { roles?: Rol[] }) {
  const { usuario, tieneRol } = useAuth();
  const location = useLocation();

  if (!usuario) return <Navigate to="/login" replace state={{ desde: location.pathname }} />;
  if (roles && !tieneRol(...roles)) return <Navigate to="/" replace />;
  return <Outlet />;
}

export function Rutas() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <Suspense fallback={null}>
            <LoginPage />
          </Suspense>
        }
      />
      <Route element={<RutaProtegida />}>
        <Route element={<AppLayout />}>
          <Route index element={<ResumenPage />} />
          <Route path="creditos" element={<ListadoCreditosPage />} />
          <Route element={<RutaProtegida roles={PERMISOS.gestionar} />}>
            <Route path="creditos/nuevo" element={<NuevoCreditoPage />} />
          </Route>
          <Route path="creditos/:id" element={<DetalleCreditoPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export function App() {
  const [queryClient] = useState(crearQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Rutas />
        </BrowserRouter>
        <Toaster />
      </AuthProvider>
    </QueryClientProvider>
  );
}
