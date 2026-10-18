import type { ReactNode } from 'react';
import { Label as LabelPrimitive } from 'radix-ui';
import type * as React from 'react';

import { cn } from '@/lib/utils';

/*
 * Controles de formulario (Input, Textarea, Select nativo, Label) con el estilo
 * de shadcn/ui. Se usa el <select> NATIVO en lugar de uno personalizado: es
 * accesible por teclado y lector de pantalla sin trabajo extra, funciona bien
 * en móviles y se integra directo con React Hook Form.
 *
 * `aria-invalid` cambia el borde a rojo: así el estado de error es visible y
 * también lo anuncian los lectores de pantalla.
 */

const baseControl =
  'w-full rounded-sm border border-input bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground/80 disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive/30';

export function Input({ className, ...props }: React.ComponentProps<'input'>) {
  return <input className={cn(baseControl, 'h-10', className)} {...props} />;
}

export function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return <textarea className={cn(baseControl, 'min-h-20 py-2', className)} {...props} />;
}

export function NativeSelect({ className, ...props }: React.ComponentProps<'select'>) {
  return <select className={cn(baseControl, 'h-10 pr-8', className)} {...props} />;
}

export function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      className={cn('text-sm font-semibold text-foreground', className)}
      {...props}
    />
  );
}

/**
 * Campo completo: etiqueta, control, ayuda y mensaje de error asociados por id
 * (aria-describedby), para que el lector de pantalla lea el error del campo.
 */
export function Campo({
  id,
  etiqueta,
  ayuda,
  error,
  children,
  className,
}: {
  id: string;
  etiqueta: string;
  ayuda?: string | undefined;
  error?: string | undefined;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('grid content-start gap-1.5', className)}>
      <Label htmlFor={id}>{etiqueta}</Label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      ) : (
        ayuda && (
          <p id={`${id}-ayuda`} className="text-sm text-muted-foreground">
            {ayuda}
          </p>
        )
      )}
    </div>
  );
}
