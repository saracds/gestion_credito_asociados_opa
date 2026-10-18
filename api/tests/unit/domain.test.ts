import { describe, expect, it } from 'vitest';

import { nombresCoinciden } from '../../src/modules/creditos/domain/asociado.js';
import { calcularCambios } from '../../src/modules/creditos/domain/cambiosCredito.js';
import {
  calcularAcciones,
  ESTADOS_CREDITO,
  esEditable,
  esEliminable,
  esEstadoFinal,
  obtenerTransicionesPermitidas,
  validarCambioDeEstado,
  type EstadoCredito,
} from '../../src/modules/creditos/domain/estadoCredito.js';
import { evaluarPoliticaDeCredito } from '../../src/modules/creditos/domain/politicaCredito.js';
import { TIPOS_CREDITO_PRUEBA } from '../fakes/InMemoryDatabase.js';

describe('Máquina de estados del crédito', () => {
  const transicionesValidas: [EstadoCredito, EstadoCredito][] = [
    ['SOLICITADO', 'EN_ESTUDIO'],
    ['SOLICITADO', 'CANCELADO'],
    ['EN_ESTUDIO', 'APROBADO'],
    ['EN_ESTUDIO', 'RECHAZADO'],
    ['EN_ESTUDIO', 'CANCELADO'],
    ['APROBADO', 'DESEMBOLSADO'],
    ['APROBADO', 'CANCELADO'],
  ];

  it.each(transicionesValidas)('permite %s -> %s', (desde, hacia) => {
    expect(() => validarCambioDeEstado(desde, hacia, 'Justificación')).not.toThrow();
  });

  // Todas las combinaciones que NO están en la lista anterior deben rechazarse.
  const transicionesInvalidas = ESTADOS_CREDITO.flatMap((desde) =>
    ESTADOS_CREDITO.filter(
      (hacia) => !transicionesValidas.some(([d, h]) => d === desde && h === hacia),
    ).map((hacia) => [desde, hacia] as [EstadoCredito, EstadoCredito]),
  );

  it.each(transicionesInvalidas)('rechaza %s -> %s con 422', (desde, hacia) => {
    expect(() => validarCambioDeEstado(desde, hacia, 'Justificación')).toThrow(
      expect.objectContaining({ httpStatus: 422, code: 'TRANSICION_ESTADO_INVALIDA' }),
    );
  });

  it('rechaza RECHAZADO -> DESEMBOLSADO (ejemplo explícito del enunciado)', () => {
    expect(() => validarCambioDeEstado('RECHAZADO', 'DESEMBOLSADO', undefined)).toThrow(
      /RECHAZADO es un estado final/,
    );
  });

  it('indica en el mensaje a qué estados sí puede pasar', () => {
    expect(() => validarCambioDeEstado('SOLICITADO', 'APROBADO', undefined)).toThrow(
      /solo se permite pasar a: EN_ESTUDIO, CANCELADO/,
    );
  });

  it.each(['RECHAZADO', 'CANCELADO'] as const)('exige observación para pasar a %s', (destino) => {
    expect(() => validarCambioDeEstado('EN_ESTUDIO', destino, '   ')).toThrow(
      expect.objectContaining({ code: 'OBSERVACION_REQUERIDA' }),
    );
  });

  it('identifica estados finales, editables y eliminables', () => {
    expect(ESTADOS_CREDITO.filter(esEstadoFinal)).toEqual([
      'RECHAZADO',
      'DESEMBOLSADO',
      'CANCELADO',
    ]);
    expect(ESTADOS_CREDITO.filter(esEditable)).toEqual(['SOLICITADO', 'EN_ESTUDIO']);
    expect(ESTADOS_CREDITO.filter(esEliminable)).toEqual(['SOLICITADO']);
    expect(obtenerTransicionesPermitidas('DESEMBOLSADO')).toEqual([]);
  });
});

describe('Acciones permitidas que la API expone en cada crédito', () => {
  it.each([
    ['SOLICITADO', ['EN_ESTUDIO', 'CANCELADO'], true, true],
    ['EN_ESTUDIO', ['APROBADO', 'RECHAZADO', 'CANCELADO'], true, false],
    ['APROBADO', ['DESEMBOLSADO', 'CANCELADO'], false, false],
    ['RECHAZADO', [], false, false],
  ] as const)('%s', (estado, transiciones, editable, eliminable) => {
    expect(calcularAcciones(estado)).toEqual({
      transicionesPermitidas: transiciones,
      editable,
      eliminable,
    });
  });
});

describe('Comparación de nombres del asociado', () => {
  it.each([
    ['Juan Pérez', 'JUAN PEREZ'],
    ['Juan Pérez', '  juan   pérez '],
    ['María Fernanda Gómez', 'maria fernanda gomez'],
  ])('"%s" y "%s" son el mismo nombre', (registrado, recibido) => {
    expect(nombresCoinciden(registrado, recibido)).toBe(true);
  });

  it.each([
    ['Juan Pérez', 'Juan Pérez Gómez'],
    ['Juan Pérez', 'Pedro Pérez'],
  ])('"%s" y "%s" son nombres distintos', (registrado, recibido) => {
    expect(nombresCoinciden(registrado, recibido)).toBe(false);
  });
});

describe('Política del tipo de crédito', () => {
  const libreInversion = TIPOS_CREDITO_PRUEBA[0]!;

  it('acepta condiciones dentro de la política', () => {
    expect(
      evaluarPoliticaDeCredito(
        { valorSolicitado: 15_000_000, numeroCuotas: 36, tasaInteres: 1.5 },
        libreInversion,
      ),
    ).toEqual([]);
  });

  it('reporta TODAS las violaciones a la vez', () => {
    const violaciones = evaluarPoliticaDeCredito(
      { valorSolicitado: 100, numeroCuotas: 100, tasaInteres: 5 },
      libreInversion,
    );
    expect(violaciones.map((violacion) => violacion.field)).toEqual([
      'valorSolicitado',
      'numeroCuotas',
      'tasaInteres',
    ]);
  });
});

describe('Cálculo de cambios para PATCH', () => {
  const actuales = {
    tipoCredito: 'LIBRE_INVERSION',
    valorSolicitado: 15_000_000,
    tasaInteres: 1.5,
    numeroCuotas: 36,
    formaPago: 'NOMINA',
  };

  it('devuelve solo los campos que realmente cambian, con valor anterior y nuevo', () => {
    expect(calcularCambios(actuales, { valorSolicitado: 12_000_000, numeroCuotas: 36 })).toEqual({
      valorSolicitado: { anterior: 15_000_000, nuevo: 12_000_000 },
    });
  });

  it('devuelve vacío si los valores enviados son iguales a los actuales', () => {
    expect(calcularCambios(actuales, { tasaInteres: 1.5 })).toEqual({});
  });
});
