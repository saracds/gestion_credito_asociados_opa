import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Credito, Rol } from '@/api/types';
import type * as ModuloAuth from '@/auth/AuthContext';
import { fallo, instalarServidorFalso, ok, type RutasFalsas } from '@/test/servidorFalso';

import { DetalleCreditoPage } from './DetalleCreditoPage';

// La sesión se simula: aquí interesa qué muestra la pantalla según el rol.
const sesion = vi.hoisted(() => ({ rol: 'ANALISTA' as Rol }));
vi.mock('@/auth/AuthContext', async (importarOriginal) => ({
  ...(await importarOriginal<typeof ModuloAuth>()),
  useAuth: () => ({
    usuario: { id: 1, email: 'x@opa.local', nombre: 'Prueba', rol: sesion.rol },
    iniciar: vi.fn(),
    cerrar: vi.fn(),
    tieneRol: (...roles: Rol[]) => roles.includes(sesion.rol),
  }),
}));

const creditoSolicitado: Credito = {
  id: 7,
  numeroCredito: 'CR-2026-000007',
  identificacionAsociado: '1032456789',
  nombreAsociado: 'Ana Pérez',
  tipoCredito: 'LIBRE_INVERSION',
  tipoCreditoNombre: 'Libre inversión',
  valorSolicitado: 5_000_000,
  tasaInteres: 1.5,
  numeroCuotas: 36,
  formaPago: 'NOMINA',
  formaPagoNombre: 'Descuento por nómina',
  estado: 'SOLICITADO',
  fechaSolicitud: '2026-10-16T15:00:00Z',
  fechaActualizacion: '2026-10-16T15:00:00Z',
  version: '00000000000007D1',
  transicionesPermitidas: ['EN_ESTUDIO', 'CANCELADO'],
  editable: true,
  eliminable: true,
};

const catalogos = {
  tiposCredito: [
    {
      codigo: 'LIBRE_INVERSION',
      nombre: 'Libre inversión',
      descripcion: null,
      valorMinimo: 500_000,
      valorMaximo: 50_000_000,
      cuotasMaximas: 60,
      tasaMaximaMensual: 2.1,
      activo: true,
    },
  ],
  formasPago: [
    { codigo: 'NOMINA', nombre: 'Descuento por nómina', descripcion: null, activo: true },
  ],
};

const historial = [
  {
    id: 1,
    tipoEvento: 'CREACION',
    estadoAnterior: null,
    estadoNuevo: 'SOLICITADO',
    detalleCambios: null,
    observacion: null,
    usuario: { nombre: 'Laura Analista', email: 'analista@opa.local' },
    fechaEvento: '2026-10-16T15:00:00Z',
  },
];

function montar(credito: Credito, rutasExtra: RutasFalsas = {}) {
  const fetchFalso = instalarServidorFalso({
    'GET /api/creditos/7': ok(credito),
    'GET /api/creditos/7/historial': ok(historial),
    'GET /api/creditos/7/notificaciones': ok([]),
    'GET /api/catalogos': ok(catalogos),
    ...rutasExtra,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/creditos/7']}>
        <Routes>
          <Route path="/creditos/:id" element={<DetalleCreditoPage />} />
          <Route path="/creditos" element={<p>Listado</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return fetchFalso;
}

describe('DetalleCreditoPage', () => {
  afterEach(() => {
    sesion.rol = 'ANALISTA';
    vi.unstubAllGlobals();
  });

  it('ofrece solo las transiciones que el backend permite para el estado actual', async () => {
    montar(creditoSolicitado);

    expect(await screen.findByRole('heading', { name: 'CR-2026-000007' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Iniciar estudio' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aprobar' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Editar condiciones/ })).toBeInTheDocument();
    // Eliminar es solo para ADMIN.
    expect(screen.queryByRole('button', { name: /Eliminar/ })).not.toBeInTheDocument();
    expect(await screen.findByText(/registró la solicitud/)).toBeInTheDocument();
  });

  it('un usuario de consulta ve el crédito pero no tiene acciones', async () => {
    sesion.rol = 'CONSULTA';
    montar(creditoSolicitado);

    await screen.findByRole('heading', { name: 'CR-2026-000007' });
    expect(screen.queryByRole('button', { name: 'Iniciar estudio' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Editar condiciones/ })).not.toBeInTheDocument();
  });

  it('en un estado final explica que el crédito ya no admite cambios', async () => {
    montar({
      ...creditoSolicitado,
      estado: 'DESEMBOLSADO',
      transicionesPermitidas: [],
      editable: false,
      eliminable: false,
    });

    expect(
      await screen.findByText('Este es un estado final: el crédito ya no admite cambios.'),
    ).toBeInTheDocument();
  });

  it('muestra bajo el campo el motivo obligatorio que exige la API al cancelar', async () => {
    const usuario = userEvent.setup();
    montar(creditoSolicitado, {
      'PATCH /api/creditos/7/estado': fallo(
        422,
        'VALIDACION',
        'La observación es obligatoria para cancelar',
        [{ field: 'observacion', message: 'La observación es obligatoria para cancelar' }],
      ),
    });

    await usuario.click(await screen.findByRole('button', { name: 'Cancelar' }));
    const dialogo = await screen.findByRole('dialog');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Cancelar' }));

    expect(
      await within(dialogo).findByText('La observación es obligatoria para cancelar'),
    ).toBeInTheDocument();
    expect(within(dialogo).getByLabelText('Motivo')).toHaveAttribute('aria-invalid', 'true');
  });

  it('edita enviando solo lo que cambió, con la versión en If-Match', async () => {
    const usuario = userEvent.setup();
    const fetchFalso = montar(creditoSolicitado, {
      'PATCH /api/creditos/7': ok({ ...creditoSolicitado, numeroCuotas: 48 }),
    });

    await usuario.click(await screen.findByRole('button', { name: /Editar condiciones/ }));
    const cuotas = await screen.findByLabelText('Número de cuotas');
    await usuario.clear(cuotas);
    await usuario.type(cuotas, '48');
    await usuario.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await vi.waitFor(() => {
      const llamada = fetchFalso.mock.calls.find(([, init]) => init?.method === 'PATCH');
      expect(llamada).toBeDefined();
      const [, init] = llamada!;
      expect(JSON.parse(init!.body as string)).toEqual({ numeroCuotas: 48 });
      expect((init!.headers as Record<string, string>)['If-Match']).toBe('"00000000000007D1"');
    });
  });

  it('si otra persona guardó primero (412), avisa y recarga la versión más reciente', async () => {
    const usuario = userEvent.setup();
    const fetchFalso = montar(creditoSolicitado, {
      'PATCH /api/creditos/7': fallo(
        412,
        'VERSION_DESACTUALIZADA',
        'El crédito fue modificado por otro usuario',
      ),
    });

    await usuario.click(await screen.findByRole('button', { name: /Editar condiciones/ }));
    const valor = await screen.findByLabelText('Valor solicitado (COP)');
    await usuario.clear(valor);
    await usuario.type(valor, '6000000');
    const consultasAntes = fetchFalso.mock.calls.filter(
      ([url]) => url === '/api/creditos/7',
    ).length;
    await usuario.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    expect(await screen.findByText('Otra persona modificó este crédito')).toBeInTheDocument();
    await vi.waitFor(() =>
      expect(
        fetchFalso.mock.calls.filter(([url]) => url === '/api/creditos/7').length,
      ).toBeGreaterThan(consultasAntes),
    );
  });

  it('informa con claridad cuando el crédito no existe', async () => {
    montar(creditoSolicitado, {
      'GET /api/creditos/7': fallo(404, 'NO_ENCONTRADO', 'Crédito no encontrado'),
    });

    expect(await screen.findByText('Este crédito no existe')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ir al listado de créditos' })).toHaveAttribute(
      'href',
      '/creditos',
    );
  });
});
