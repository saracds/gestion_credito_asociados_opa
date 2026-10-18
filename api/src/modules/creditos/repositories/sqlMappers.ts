/**
 * Conversión de los tipos que entrega el driver mssql a los tipos de la API.
 */

/**
 * BIGINT llega como texto: JavaScript solo representa enteros exactos hasta
 * 2^53 - 1 y el driver evita perder precisión. Los ids de este sistema están
 * muy por debajo de ese límite, así que se convierten a número de forma segura.
 */
export function bigintToNumber(value: string | number): number {
  const numericValue = Number(value);
  if (!Number.isSafeInteger(numericValue)) {
    throw new Error(`El identificador ${String(value)} excede el rango numérico seguro.`);
  }
  return numericValue;
}

/** ROWVERSION llega como Buffer de 8 bytes; se expone en hexadecimal (16 caracteres). */
export function rowversionToHex(value: Buffer): string {
  return value.toString('hex').toUpperCase();
}

/** DATETIME2 en UTC -> ISO 8601 ("2026-09-07T18:00:00.000Z"). */
export function dateToIso(value: Date): string {
  return value.toISOString();
}

/**
 * Escapa los comodines de LIKE (%, _, [) para que el texto que escribe el
 * usuario se busque literalmente. Se usa junto con `ESCAPE '\'` en la consulta.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_[]/g, (character) => `\\${character}`);
}
