import type { ReactNode } from 'react';
import { CircleAlertIcon } from 'lucide-react';
import type * as React from 'react';
import { Toaster as SonnerToaster } from 'sonner';

import { cn } from '@/lib/utils';

/** Bloque de carga (shadcn/ui Skeleton): reserva el espacio del contenido. */
export function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} {...props} />;
}

/** Mensaje destacado dentro de la página (errores que requieren atención). */
export function Alert({
  titulo,
  children,
  className,
}: {
  titulo: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        'flex gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm',
        className,
      )}
    >
      <CircleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
      <div className="grid gap-1">
        <p className="font-semibold text-destructive">{titulo}</p>
        {children && <div className="text-foreground">{children}</div>}
      </div>
    </div>
  );
}

/** Notificaciones emergentes (sonner, el toaster de shadcn/ui). */
export function Toaster() {
  return (
    <SonnerToaster
      position="top-right"
      richColors
      closeButton
      toastOptions={{ className: 'font-sans' }}
    />
  );
}
