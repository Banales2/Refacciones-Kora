# Importar el programa de mantenimiento desde CSV

## El problema

La tabla de mantenimiento del fabricante tiene cientos de casillas: la del ELF
100/200/300 son 59 renglones por 8 columnas. Transcribirla con la brocha de la
cuadrícula es lento y es donde se cuelan los errores. Si la tabla ya está
pasada a CSV, se carga de una vez.

## Dónde

En **Modelos**, se abre el modelo y en *Programas de mantenimiento*, en la
pestaña del programa que falta (del fabricante o de después de la garantía),
está **Importar desde CSV**. Solo aparece mientras ese programa no existe:
importar no reemplaza uno ya capturado. Para volver a importar, primero se
borra.

## Los archivos

Son dos por grupo de modelos. Los dos traen la columna `modelos` con la lista
separada por `;` (`ELF 100;ELF 200;ELF 300`), porque una misma tabla cubre
varios modelos.

**Operaciones** (obligatorio), una fila por regla:

| columna | qué es |
|---|---|
| `modelos` | a qué modelos aplica la fila. Puede ser solo una parte del grupo (`ELF 400`). |
| `anio_desde`, `anio_hasta` | se usan para proponer el nombre del programa. |
| `no` | número del renglón en el manual. Las filas con el mismo `no` son el mismo renglón. |
| `operacion` | el texto del renglón. |
| `condicion_severa`, `si_equipado` | `1` o `0`: el asterisco y el "[v]" del manual. |
| `indicador` | el aviso del tablero que adelanta la operación, si lo hay. |
| `tipo`, `valor`, `accion` | la regla (ver abajo). |
| `nota` | aclaración de la regla. |

| `tipo` | `valor` | cómo entra al sistema |
|---|---|---|
| `km` | marca de odómetro | una celda de la cuadrícula. Las marcas distintas son las columnas. |
| `limite_meses` | meses | el límite de meses del renglón ("lo que ocurra primero"). |
| `cada_meses` | meses | si el renglón no tiene límite, la más corta se vuelve su límite. Las demás van a sus notas. |
| `cada_km` | km | va a las notas: el programa no tiene cómo vencerla. |
| `cada_horas` | horas | va a las notas: el sistema no lleva horas de motor. |

**Precios por servicio** (opcional), una fila por kilometraje: `modelos`, `km`,
`precio`. El precio es el del servicio completo de ese kilometraje, con todas
sus operaciones; queda como el costo cotizado de la columna (migración 014). Un
precio vacío deja la columna sin cotizar.

## Lo que se pregunta antes de guardar

- **Qué modelo del archivo es este.** Se deduce por el nombre ("ELF 200",
  "Elf200" e "Isuzu ELF 200" encajan con `ELF 200`). Si no encaja se elige a
  mano. Solo entran las filas que mencionan a ese modelo.
- **Qué columnas son de una sola vez.** El archivo no lo dice. Al terminar la
  última columna el programa vuelve a la primera que se repite (migración 012);
  la pantalla muestra el recorrido para compararlo con el manual.
- **El tipo de pieza de cada reemplazo.** Todo renglón con una `R`, en la
  cuadrícula o en sus reglas por tiempo, necesita un tipo de pieza declarado en
  el modelo: al cerrar la visita se va a exigir una refacción de ese tipo
  (migración 031). Si el modelo ya declara uno con el mismo nombre que el
  renglón, se toma solo. Si no, el selector ofrece registrarlo con el nombre
  del renglón (o el que se escriba), y lo deja declarado en el modelo.

## Lo que no entra

Lo que el sistema no modela no se pierde: queda escrito en las notas del
renglón. Son el asterisco, "si está equipado", el aviso del tablero, una segunda
periodicidad en meses (el refrigerante: revisar a los 12, cambiar a los 24) y
las reglas por km fuera de columna o por horas (el DPD). Nadie las va a vencer
solas, y la pantalla de importación lista cuáles son.
