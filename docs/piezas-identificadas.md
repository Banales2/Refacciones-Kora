# Piezas identificadas una por una

Diseño de la fase 1 de la reestructuración del inventario. Este documento es la
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

### `unidades_pieza` (fase 3, no se crea todavía)

Una fila = una pieza física. La forma propuesta:

| columna | por qué |
|---|---|
| `id` | la identidad que hoy no existe |
| `pieza_id` | qué refacción es |
| `lote_id` (nullable) | de qué compra salió: conserva factura, proveedor y costo. NULL en la que vino con el vehículo |
| `estado` | `almacen` / `montada` / `desechada` / `vendida` / `devuelta` |
| `sucursal_id` (nullable) | en qué estante está, cuando está en almacén |
| `condicion` | `nueva` / `usada`. Lo que hoy no se puede distinguir |
| `etiqueta` (nullable) | folio físico, si la pieza trae uno pegado |
| `created_at` | |

Y `instalaciones_pieza` gana `unidad_id` nullable: los renglones históricos se
quedan en NULL, y los nuevos de tipos rastreados apuntan a su unidad. Es lo que
convierte la bitácora en la historia de una pieza concreta.

**No lleva** `km_acumulado` ni `horas_acumuladas`, por lo dicho arriba.

### Qué queda obsoleto, y qué no

El lote de recuperación (`024`) y los descuadres por retiro (`022`–`023`) dejan
de hacer falta **para los tipos rastreados**: con identidad, una pieza que vuelve
al estante solo cambia de estado, sin inventar lotes ni dejar pendientes.

Para los tipos a granel siguen siendo necesarios tal cual. No se borra nada.

## Orden de trabajo

1. **El flag y el catálogo de tipos.** ← esta entrega
   Migración del flag y una pantalla para administrar los tipos de pieza, que
   hoy no existe (solo se pueden crear al vuelo desde un selector).
2. **Facturas como tabla.** Independiente de las unidades; elimina la familia de
   bugs de cabecera duplicada.
3. **Unidades, solo llantas.** De punta a punta y en producción antes de tocar
   otro tipo.
4. **El resto de tipos rastreables,** cuando el primero haya aguantado.
