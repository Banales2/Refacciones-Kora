import { z } from 'zod'

// Allowlist para campos de texto corto capturados a mano (marcas, nombres de
// modelo, tipos de pieza…). Solo lo que un catálogo real necesita: letras con
// acentos y ñ, números, espacios y guiones. Deja fuera cualquier símbolo que
// pudiera usarse para colar links o marcado.
export const TEXTO_SIMPLE = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 -]+$/

// Allowlist para datos de contacto: además de lo del texto simple, deja pasar
// lo que aparece en un teléfono o un correo (@ . + paréntesis y coma).
export const CONTACTO = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 .,@+()-]+$/

// Año-versión de un modelo: "2018" o, cuando en un mismo año salieron dos
// unidades del mismo modelo con piezas distintas, "2018-1" / "2018-2". Máximo
// 6 caracteres, que es lo que cabe en la columna.
export const ANIO_MODELO = /^\d{4}(-[1-9])?$/

// Allowlist para números telefónicos: dígitos y los separadores con los que se
// suelen capturar. Sin letras.
export const TELEFONO = /^[0-9 ()+-]+$/

// Allowlist para códigos e identificadores (series, placas, folios): solo
// mayúsculas, números y guiones. Sin espacios ni puntuación.
export const CODIGO = /^[A-Z0-9-]+$/

// Tope de cualquier campo de kilometraje: odómetros, lecturas de taller e
// intervalos. Siete dígitos dan de sobra para la vida de una unidad y atajan el
// dedazo de teclear un cero de más. Espeja KM_MAX del frontend.
export const KM_MAX = 9_999_999

// Una lectura de odómetro admite UN decimal: es lo que marca el tablero
// ("123,456.7"). Los intervalos del programa y los límites de las garantías
// siguen enteros —son números del manual, no lecturas—.
//
// Se compara multiplicado por diez y con tolerancia: 0.1 + 0.2 no es 0.3 en
// punto flotante, y un `% 0.1` rechazaría lecturas válidas.
export function conUnDecimal(v: number): boolean {
  return Math.abs(v * 10 - Math.round(v * 10)) < 1e-6
}
const MSG_DECIMAL = 'Máximo un decimal'

/** Lectura de odómetro (o horómetro): de 0 al tope, con un decimal. */
export const lecturaKm = (msgMax = 'Máximo 9,999,999 km') =>
  z.coerce.number().min(0, 'No puede ser negativo').max(KM_MAX, msgMax).refine(conUnDecimal, MSG_DECIMAL)

/** Igual, pero mayor que cero (lo que marcaba el tablero al reiniciarse). */
export const lecturaKmPositiva = (msgMax = 'Máximo 9,999,999 km') =>
  z.coerce.number().positive('Debe ser mayor a 0').max(KM_MAX, msgMax).refine(conUnDecimal, MSG_DECIMAL)

// Allowlist para texto libre (descripciones). Más amplia porque necesita
// puntuación para leerse bien, pero sigue dejando fuera lo que sirve para
// inyectar marcado o scripts: < > { } [ ] \ | ` ~ ^ * = _ $ @.
export const TEXTO_LIBRE = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 \r\n.,;:()¿?¡!"'%#°+&/-]+$/
