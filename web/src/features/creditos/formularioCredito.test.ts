import { describe, expect, it } from 'vitest';

import type { TipoCreditoCatalogo } from '@/api/types';

import { calcularCuotaEstimada, crearEsquemaSolicitud } from './formularioCredito';

const LIBRE_INVERSION: TipoCreditoCatalogo = {
  codigo: 'LIBRE_INVERSION',
  nombre: 'Libre inversión',
  descripcion: null,
  valorMinimo: 500_000,
  valorMaximo: 50_000_000,
  cuotasMaximas: 60,
  tasaMaximaMensual: 2.1,
  activo: true,
};

const solicitudValida = {
  identificacionAsociado: ' 1032456789 ',
  nombreAsociado: 'Ana Pérez',
  tipoCredito: 'LIBRE_INVERSION',
  formaPago: 'NOMINA',
  valorSolicitado: '5000000',
  tasaInteres: '1.5',
  numeroCuotas: '36',
};

const errores = (datos: unknown) => {
  const resultado = crearEsquemaSolicitud([LIBRE_INVERSION]).safeParse(datos);
  return resultado.success
    ? {}
    : Object.fromEntries(resultado.error.issues.map((i) => [i.path.join('.'), i.message]));
};

describe('esquema del formulario de solicitud', () => {
  it('acepta una solicitud válida y convierte los textos de los inputs en números', () => {
    const resultado = crearEsquemaSolicitud([LIBRE_INVERSION]).parse(solicitudValida);
    expect(resultado).toMatchObject({
      identificacionAsociado: '1032456789',
      valorSolicitado: 5_000_000,
      numeroCuotas: 36,
    });
  });

  it('aplica la política del tipo de crédito leída del catálogo', () => {
    expect(
      errores({
        ...solicitudValida,
        valorSolicitado: '100000',
        numeroCuotas: '72',
        tasaInteres: '3',
      }),
    ).toEqual({
      valorSolicitado: expect.stringContaining('debe estar entre'),
      numeroCuotas: 'Para libre inversión el máximo es 60 cuotas',
      tasaInteres: 'Para libre inversión la tasa máxima es 2,1 % mensual',
    });
  });

  it('exige campos y formatos básicos con mensajes claros', () => {
    expect(
      errores({
        ...solicitudValida,
        identificacionAsociado: '10.324',
        valorSolicitado: '',
        numeroCuotas: '12.5',
      }),
    ).toMatchObject({
      identificacionAsociado: 'Entre 5 y 20 letras o números, sin espacios ni puntos',
      valorSolicitado: 'Escriba el valor solicitado',
      numeroCuotas: 'Debe ser un número entero',
    });
  });
});

describe('cuota estimada (sistema francés)', () => {
  it('calcula la cuota fija mensual', () => {
    // 1.000.000 al 1 % mensual en 12 cuotas = 88.848,79
    expect(calcularCuotaEstimada(1_000_000, 1, 12)).toBeCloseTo(88_848.79, 2);
  });

  it('con tasa 0 reparte el capital en partes iguales', () => {
    expect(calcularCuotaEstimada(1_200_000, 0, 12)).toBe(100_000);
  });

  it('no calcula nada mientras faltan datos', () => {
    expect(calcularCuotaEstimada(Number.NaN, 1, 12)).toBeNull();
    expect(calcularCuotaEstimada(1_000_000, 1, 0)).toBeNull();
  });
});
