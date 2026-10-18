import { zodResolver } from '@hookform/resolvers/zod';
import { LockKeyholeIcon } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { z } from 'zod';

import { useAuth } from '@/auth/AuthContext';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { Campo, Input } from '@/components/ui/form-controls';
import { mensajeDeError } from '@/lib/errores';

const esquemaLogin = z.object({
  email: z.string().trim().min(1, 'Escriba su correo').email('Escriba un correo válido'),
  password: z.string().min(1, 'Escriba su contraseña'),
});
type DatosLogin = z.infer<typeof esquemaLogin>;

export function LoginPage() {
  const { usuario, iniciar } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<DatosLogin>({ resolver: zodResolver(esquemaLogin) });

  // Ruta a la que el usuario intentaba entrar antes de iniciar sesión.
  const destino = (location.state as { desde?: string } | null)?.desde ?? '/';

  if (usuario) return <Navigate to={destino} replace />;

  const enviar = handleSubmit(async ({ email, password }) => {
    setErrorGeneral(null);
    try {
      await iniciar(email, password);
      navigate(destino, { replace: true });
    } catch (error) {
      setErrorGeneral(mensajeDeError(error));
    }
  });

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_minmax(28rem,36rem)]">
      <section className="hidden flex-col justify-between bg-sidebar p-12 text-sidebar-foreground lg:flex">
        <p className="text-lg font-bold text-white">Créditos de asociados</p>
        <div className="max-w-md">
          <p className="text-3xl leading-snug font-bold text-white">
            Cada solicitud, desde que llega hasta que se desembolsa.
          </p>
          <p className="mt-4 text-sidebar-foreground/85">
            Registre solicitudes, llévelas por el estudio y deje constancia de cada decisión.
          </p>
        </div>
        <p className="text-sm text-sidebar-foreground/70">Uso interno de la cooperativa</p>
      </section>

      <section className="flex items-center justify-center px-4 py-12">
        <form onSubmit={enviar} noValidate className="grid w-full max-w-sm gap-5">
          <div className="grid gap-1">
            <LockKeyholeIcon className="mb-2 size-6 text-primary" aria-hidden />
            <h1 className="text-2xl font-bold">Iniciar sesión</h1>
            <p className="text-muted-foreground">Ingrese con su correo de la cooperativa.</p>
          </div>

          {errorGeneral && <Alert titulo="No fue posible iniciar sesión">{errorGeneral}</Alert>}

          <Campo id="email" etiqueta="Correo" error={errors.email?.message}>
            <Input
              id="email"
              type="email"
              autoComplete="username"
              aria-invalid={Boolean(errors.email)}
              aria-describedby={errors.email ? 'email-error' : undefined}
              {...register('email')}
            />
          </Campo>

          <Campo id="password" etiqueta="Contraseña" error={errors.password?.message}>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              aria-invalid={Boolean(errors.password)}
              aria-describedby={errors.password ? 'password-error' : undefined}
              {...register('password')}
            />
          </Campo>

          <Button type="submit" size="lg" disabled={isSubmitting}>
            {isSubmitting ? 'Ingresando…' : 'Ingresar'}
          </Button>

          <details className="rounded-md border bg-card p-3 text-sm">
            <summary className="cursor-pointer font-semibold">Usuarios de demostración</summary>
            <ul className="mt-2 grid gap-1 text-muted-foreground">
              <li>admin@opa.local, clave Admin123* (administrador)</li>
              <li>analista@opa.local, clave Analista123* (analista)</li>
              <li>consulta@opa.local, clave Consulta123* (solo consulta)</li>
            </ul>
          </details>
        </form>
      </section>
    </div>
  );
}
