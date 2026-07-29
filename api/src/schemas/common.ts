// Allowlist para campos de texto corto capturados a mano (marcas, nombres de
// modelo, tipos de pieza…). Solo lo que un catálogo real necesita: letras con
// acentos y ñ, números, espacios y guiones. Deja fuera cualquier símbolo que
// pudiera usarse para colar links o marcado.
export const TEXTO_SIMPLE = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 -]+$/
