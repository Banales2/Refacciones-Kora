// Allowlist para campos de texto corto capturados a mano (marcas, nombres de
// modelo, tipos de pieza…). Solo lo que un catálogo real necesita: letras con
// acentos y ñ, números, espacios y guiones. Deja fuera cualquier símbolo que
// pudiera usarse para colar links o marcado. Espeja TEXTO_SIMPLE del backend.
export const TEXTO_SIMPLE = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 -]+$/

// Allowlist para texto libre (descripciones). Más amplia porque necesita
// puntuación para leerse bien, pero sigue dejando fuera lo que sirve para
// inyectar marcado o scripts. Espeja TEXTO_LIBRE del backend.
export const TEXTO_LIBRE = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 \r\n.,;:()¿?¡!"'%#°+&/-]+$/

// Allowlist para datos de contacto: además de lo del texto simple, deja pasar
// lo que aparece en un teléfono o un correo. Espeja CONTACTO del backend.
export const CONTACTO = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 .,@+()-]+$/

export function limpiarContacto(valor: string, max: number): string {
  return valor.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 .,@+()-]/g, '').slice(0, max)
}

// Año-versión de un modelo: "2018" o, cuando en un mismo año salieron dos
// unidades del mismo modelo con piezas distintas, "2018-1" / "2018-2".
// Espeja ANIO_MODELO del backend.
export const ANIO_MODELO = /^\d{4}(-[1-9])?$/

// Deja solo dígitos y un guion, y recorta a los 6 caracteres de la columna.
export function limpiarAnioModelo(valor: string): string {
  return valor.replace(/[^0-9-]/g, '').slice(0, 6)
}

// Allowlist para números telefónicos: dígitos y los separadores con los que se
// suelen capturar. Sin letras. Espeja TELEFONO del backend.
export const TELEFONO = /^[0-9 ()+-]+$/

export function limpiarTelefono(valor: string, max: number): string {
  return valor.replace(/[^0-9 ()+-]/g, '').slice(0, max)
}

// Allowlist para códigos e identificadores (series, placas, folios): solo
// mayúsculas, números y guiones. Espeja CODIGO del backend.
export const CODIGO = /^[A-Z0-9-]+$/

// Pasa a mayúsculas, quita lo que no sea código y recorta al máximo permitido.
export function limpiarCodigo(valor: string, max: number): string {
  return valor.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, max)
}

// Quita lo que la allowlist no acepta y recorta al máximo permitido. Se usa en
// onChange para que ni pegando texto entren símbolos.
export function limpiarTextoSimple(valor: string, max: number): string {
  return valor.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 -]/g, '').slice(0, max)
}

// Igual que limpiarTextoSimple pero para descripciones: conserva la puntuación.
export function limpiarTextoLibre(valor: string, max: number): string {
  return valor.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 \r\n.,;:()¿?¡!"'%#°+&/-]/g, '').slice(0, max)
}

// Tope de cualquier campo de kilometraje: odómetros, lecturas de taller e
// intervalos. Siete dígitos dan de sobra para la vida de una unidad y atajan el
// dedazo de teclear un cero de más. Espeja KM_MAX del backend.
export const KM_MAX = 9_999_999

export function validarKm(valor: number | string | null | undefined): string | null {
  if (valor === '' || valor === null || valor === undefined) return null
  return Number(valor) > KM_MAX ? `Máximo ${KM_MAX.toLocaleString('es-MX')} km` : null
}
