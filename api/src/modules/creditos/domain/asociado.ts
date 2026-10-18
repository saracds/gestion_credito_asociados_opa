/**
 * Reglas sobre los datos del asociado.
 */

/**
 * Deja el nombre listo para guardar: sin espacios al inicio o al final y sin
 * espacios repetidos. Conserva mayúsculas y tildes tal como se escribieron.
 */
export function limpiarNombre(nombre: string): string {
  return nombre.trim().replace(/\s+/g, ' ');
}

/** Normaliza la identificación: sin espacios y en mayúsculas (pasaportes con letras). */
export function normalizarIdentificacion(identificacion: string): string {
  return identificacion.trim().toUpperCase();
}

/**
 * Clave de comparación de nombres: sin tildes, en mayúsculas y con espacios
 * normalizados. Así "Juan Pérez", "JUAN PEREZ" y "juan  perez" se consideran
 * el MISMO nombre; solo cambia la forma de escribirlo.
 */
function claveDeComparacion(nombre: string): string {
  return limpiarNombre(nombre)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase();
}

/**
 * Regla de negocio (decisión de Sara): si la identificación ya existe con un
 * nombre DISTINTO, la solicitud se rechaza.
 *
 * Motivo: un nombre que no coincide suele indicar un error al digitar la
 * cédula. En un sistema financiero es preferible detener la operación que
 * asociar un crédito a la persona equivocada. Las diferencias de tildes,
 * mayúsculas o espacios no se consideran nombres distintos.
 */
export function nombresCoinciden(nombreRegistrado: string, nombreRecibido: string): boolean {
  return claveDeComparacion(nombreRegistrado) === claveDeComparacion(nombreRecibido);
}
