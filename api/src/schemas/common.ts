// Allowlist para campos de texto corto capturados a mano (marcas, nombres de
// modelo, tipos de pieza…). Solo lo que un catálogo real necesita: letras con
// acentos y ñ, números, espacios y guiones. Deja fuera cualquier símbolo que
// pudiera usarse para colar links o marcado.
export const TEXTO_SIMPLE = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 -]+$/

// Allowlist para datos de contacto: además de lo del texto simple, deja pasar
// lo que aparece en un teléfono o un correo (@ . + paréntesis y coma).
export const CONTACTO = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 .,@+()-]+$/

// Allowlist para códigos e identificadores (series, placas, folios): solo
// mayúsculas, números y guiones. Sin espacios ni puntuación.
export const CODIGO = /^[A-Z0-9-]+$/

// Allowlist para texto libre (descripciones). Más amplia porque necesita
// puntuación para leerse bien, pero sigue dejando fuera lo que sirve para
// inyectar marcado o scripts: < > { } [ ] \ | ` ~ ^ * = _ $ @.
export const TEXTO_LIBRE = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 \r\n.,;:()¿?¡!"'%#°+&/-]+$/
