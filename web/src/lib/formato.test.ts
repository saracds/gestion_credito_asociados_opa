import { describe, expect, it } from 'vitest';

import { formatearFechaHora, formatearPesosCompacto, formatearTasa } from './formato';

describe('formatos colombianos', () => {
  it('agrupa siempre los miles en montos compactos', () => {
    expect(formatearPesosCompacto(1_002_100_000)).toBe('$1.002,1 M');
    expect(formatearPesosCompacto(210_000_000)).toBe('$210 M');
  });

  it('escribe la tasa con coma decimal', () => {
    expect(formatearTasa(1.45)).toBe('1,45 % mensual');
  });

  it('muestra las fechas en hora de Bogotá aunque la API las entregue en UTC', () => {
    // 03:00 UTC del 17 de octubre = 10:00 p. m. del 16 de octubre en Bogotá (UTC−5).
    expect(formatearFechaHora('2026-10-17T03:00:00Z')).toMatch(/16 de oct.* de 2026.*10:00/);
  });
});
