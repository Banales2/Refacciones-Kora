// Allowlist para campos de texto corto capturados a mano (marcas, nombres de
// modelo, tipos de pieza…). Solo lo que un catálogo real necesita: letras con
// acentos y ñ, números, espacios y guiones. Deja fuera cualquier símbolo que
// pudiera usarse para colar links o marcado. Espeja TEXTO_SIMPLE del backend.
export const TEXTO_SIMPLE = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 -]+$/

// Quita lo que la allowlist no acepta y recorta al máximo permitido. Se usa en
// onChange para que ni pegando texto entren símbolos.
export function limpiarTextoSimple(valor: string, max: number): string {
  return valor.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 -]/g, '').slice(0, max)
}
