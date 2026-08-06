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

// Allowlist para texto libre (descripciones). Más amplia porque necesita
// puntuación para leerse bien, pero sigue dejando fuera lo que sirve para
// inyectar marcado o scripts: < > { } [ ] \ | ` ~ ^ * = _ $ @.
export const TEXTO_LIBRE = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 \r\n.,;:()¿?¡!"'%#°+&/-]+$/
