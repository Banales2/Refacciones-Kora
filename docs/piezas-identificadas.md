# Piezas identificadas una por una

Diseño de la reestructuración del inventario. Este documento es la
decisión; el código lo sigue.

## El problema

Hoy el sistema cuenta piezas a granel. `existencias_lote` dice cuántas unidades
de una compra hay en una sucursal, y nada más. Ninguna unidad tiene identidad,
así que hay preguntas que no se pueden contestar y que ya nos han costado
parches:

- **Usado o nuevo.** Una balata usada que vuelve al estante se suma al mismo
  lote que las de paquete. Al pedir una, nadie sabe cuál le están dando.
- **Devolver al almacén.** Una pieza que vino con el vehículo no salió de ningún
  lote, así que no tiene a dónde volver. Ver `022`, `023` y `024`.
- **Corregir el destino después.** Cambiar "regresa a almacén" por "desecho" un
  mes más tarde deja un movimiento de inventario que no se puede revertir,
  porque no se sabe si *esa* unidad sigue en el estante. Ver `descuadres_inventario`.
- **Vida útil.** Una llanta debería poder decir cuántos kilómetros lleva y en qué
  unidades ha estado. Hoy no hay dónde guardarlo.

Los tres primeros son el mismo problema con distinta ropa: **no se sabe de qué
unidad física estamos hablando**. La migración 001 ya lo había visto — dejó
`robo` y `venta` como motivos de retiro anotando que eran "el gancho de la fase
2, aunque todavía no se identifique cada pieza". Esto es esa fase 2.

## Tres correcciones a la propuesta original

**1. La factura no sustituye al lote, le pone cabecera.**

La idea era "cambiar lotes por facturas". Pero una factura trae varias
refacciones, y el costo y la existencia se llevan por refacción, no por factura.
Un lote ya *es* un renglón de factura; lo que falta es la cabecera. La forma
correcta tiene tres niveles, no uno:

```
factura   (folio, proveedor, fecha, IVA, descuento)   ← hoy no existe; se repite en cada lote
  renglón (refacción, cantidad, costo unitario)       ← hoy se llama lote
    unidad (una pieza física)                          ← hoy no existe
```

Materializar la cabecera es valioso por sí solo: `totales_dispares`, "aplicar a
los N renglones" y reescribir el folio en todos los lotes existen **solo** porque
hoy la cabecera está copiada en cada renglón. Pero es un cambio independiente de
las unidades, y va después.

**2. El inventario no puede salir de un conteo de unidades para todo.**

Si cada unidad tiene id, la existencia de esa refacción es contar sus unidades en
almacén. Pero eso solo funciona si *todas* las unidades existen, y no van a
existir: nadie va a darle folio a un tornillo o a un litro de aceite.

El inventario queda híbrido, y está bien que así sea:

- Tipos **con** rastreo individual → existencia = número de unidades en almacén.
- Tipos **sin** rastreo individual → existencia = cantidad, como hoy.

Un modelo que obligue a folear todo se abandona en la primera captura.

**3. El kilometraje de una llanta no se guarda: se calcula.**

La propuesta original le daba a la unidad sus propios contadores de km y horas.
Eso contradice una regla que este sistema ya sigue en todos lados: el importe del
IVA no se guarda, el del descuento tampoco, `cantidad_disponible` quedó obsoleta
en cuanto hubo de dónde derivarla. Un contador acumulado es un dato derivado, y
se desalinea en cuanto alguien corrija un kilometraje de instalación.

`instalaciones_pieza` ya guarda `km_instalacion` y `km_retiro` por cada montaje.
Los kilómetros de una unidad son la suma de esos tramos, más lo que lleve
recorrido el vehículo en el que esté puesta ahora mismo. Se calcula al mostrarlo.

Lo que sí se guarda es lo que no se puede derivar: en qué estado está la unidad y
dónde.

## El modelo

### `tipos_pieza.rastreo_individual`

Un flag por tipo. Marcado, las piezas de ese tipo llevan unidades identificadas;
sin marcar, se cuentan a granel como hoy.

Va en el **tipo** y no en la refacción porque la decisión es de negocio, no de
producto: "las llantas se rastrean" vale para todas las llantas, sin importar la
marca. Y porque el tipo es lo que el vehículo pide (`tipos_pieza_modelo`), así
que es el nivel en el que ya se razona sobre qué lleva una unidad.

Arranca en `0` para todos. Encenderlo para un tipo que ya tiene existencias es
parte de la fase 3: hay que decidir qué hacer con las unidades a granel que ya
están en el estante.

### `unidades_pieza` (migración 027)

Una fila = una pieza física. Lo que guarda es deliberadamente poco:

| columna | por qué |
|---|---|
| `id` | la identidad que no existía |
| `pieza_id` | qué refacción es |
| `lote_id` (nullable) | de qué compra salió: conserva factura, proveedor y costo. NULL en la que vino con el vehículo |
| `sucursal_id` (nullable) | en qué estante vive. Cambia con los traspasos y no hay otra tabla que lo diga por unidad |
| `etiqueta` (nullable) | folio físico, si la pieza trae uno pegado |
| `created_at` | |

Y `instalaciones_pieza` gana `unidad_id` nullable: los renglones históricos se
quedan en NULL, y los nuevos de tipos rastreados apuntan a su unidad. Es lo que
convierte la bitácora en la historia de una pieza concreta.

**Corrección respecto a la fase 1.** El primer borrador de esta tabla llevaba
`estado` y `condicion` además de los contadores. Los tres se fueron por la misma
razón que se fueron los contadores: son derivados, y este sistema ya sabe lo que
cuesta guardarlos. `instalaciones_pieza` registra cada montaje y cada retiro, así
que de ahí salen los tres sin poder desalinearse nunca:

- **estado** — ¿hay una instalación abierta? Montada, y en qué vehículo. Si no,
  el `destino` del último retiro dice dónde acabó. ¿Nunca instalada? En el estante.
- **condición** — usada en cuanto tiene un montaje cerrado a sus espaldas.
- **kilometraje** — suma de `km_retiro − km_instalacion` de sus tramos, más lo que
  lleve recorrido el vehículo donde esté puesta ahora.

Guardar `estado` obligaría a mantenerlo en cada montaje, cada retiro y cada
corrección retroactiva. Basta que uno falle para que la unidad diga que está en
el estante cuando lleva medio año en un camión.

### Convivencia con las existencias

`existencias_lote` sigue contando, también para los tipos rastreados. Las
unidades son una capa de identidad encima, no un segundo inventario: se crean
junto con la existencia y en la misma transacción.

Que las unidades en estante cuadren con la existencia es una comprobación que se
puede correr, no una regla que la base imponga. Imponerla obligaría a reescribir
el inventario entero, y eso es la fase 4.

### Qué queda obsoleto, y qué no

El lote de recuperación (`024`) y los descuadres por retiro (`022`–`023`) dejan
de hacer falta **para los tipos rastreados**: con identidad, una pieza que vuelve
al estante solo cambia de estado, sin inventar lotes ni dejar pendientes.

Para los tipos a granel siguen siendo necesarios tal cual. No se borra nada.

## Orden de trabajo

1. ~~**El flag y el catálogo de tipos.**~~ Migración 025. Hecho.
2. ~~**Facturas como tabla.**~~ Migración 026. Hecho, y verificado contra la base.
3. **Unidades.** ← migración 027. El modelo, el alta en la compra, el enganche
   con la bitácora y la ficha por refacción. Enciende el rastreo en un solo tipo
   —llantas— y déjalo correr antes de marcar otro.
4. **El inventario sobre unidades.** Que para los tipos rastreados la existencia
   SEA el conteo de unidades, en vez de convivir con `existencias_lote`. Es el
   paso que quita la última duplicación, y el que conviene hacer solo cuando la
   fase 3 lleve tiempo en pie.
