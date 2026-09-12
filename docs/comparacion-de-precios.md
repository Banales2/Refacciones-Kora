# Comparación de precios entre proveedores

## Las dos fuentes, y por qué no se pueden comparar crudas

Un precio de una refacción con un proveedor puede venir de dos lados:

| fuente | dónde vive | qué es |
|---|---|---|
| **cotizado** | `precios_proveedor` | lo que pide, se le compre o no. Se captura a mano |
| **pagado** | `lotes_pieza` + `facturas` | lo que de verdad salió de la caja |

Antes la comparación miraba solo las cotizaciones. Eso dejaba fuera justo a los
proveedores a los que **sí** se les compra: "el más barato" solo sabía de quien
mandó cotización, que suele ser el que menos se usa. Al cargar un histórico de
compras (ver `importacion-historica.md`) el problema se vuelve evidente: cientos
de precios reales que la comparativa no veía.

Pero juntarlas tal cual da una respuesta equivocada, y la razón es concreta:

- **A esta empresa casi siempre le hacen descuento por volumen**, del orden del
  **10%**, con excepciones. Ese descuento es de la **factura**, no del renglón:
  los renglones se capturan a precio de lista y el porcentaje vive en
  `facturas.descuento_pct` (migración 021).
- **Una cotización no trae descuento en ningún lado**, porque el proveedor
  cotiza lista y el descuento se pacta después.

Así que comparar `precios_proveedor.precio` contra `lotes_pieza.costo_unitario`
compara una lista contra otra lista —ignorando el descuento ya conseguido— y
compararlo contra el neto le da la razón al proveedor que nunca cotiza.

## La base común

Todo precio se lleva a **lo que costaría una pieza ya con descuento**:

```
pagado    = costo_unitario × (1 − descuento de su factura)     ← un hecho
cotizado  = precio         × (1 − descuento de referencia)     ← una estimación
```

El **descuento de referencia** es 10% por omisión (`DESCUENTO_REFERENCIA` en
`api/src/repositories/preciosSql.ts`) y se puede mover desde la pantalla, en el
menú de *Comparativa de precios*. **No se guarda en ningún lado**: viaja en la
consulta (`?descuento_ref=`) y se imprime en el reporte, porque es un supuesto
de quien lee la tabla y no un dato. Guardarlo sería convertir un supuesto en un
hecho.

Cada precio de la comparativa lleva su `origen` (`cotizado` / `pagado`), su
`precio_lista` y si el descuento fue `estimado`, para que nadie tenga que
adivinar qué se está comparando.

### Una compra sin descuento declarado no es una compra sin descuento

`facturas.descuento_pct` en NULL significa hoy dos cosas que desde el código no
se distinguen: que esa compra no tuvo descuento, o —el caso de todo lo que se
captura hoy, incluido el histórico importado— que **el precio ya venía
descontado y el porcentaje no se desglosó**.

El comparable sale bien en los dos casos: el número capturado ES lo que se pagó.
Lo que no se puede afirmar es el precio de lista, así que los reportes marcan
esas compras como **"Pagado (sin desglose)"** y dejan la columna *Lista* en "—",
en vez de decir "−0%" y enseñar el neto como si fuera lista.

Cuando la captura pase a lista + descuento de la factura, esas compras empiezan
a traer su porcentaje y se etiquetan solas como "Pagado (−10%)". No hay nada que
migrar: las dos épocas dan el mismo precio comparable.

### El IVA se queda fuera, a propósito

`facturas.tasa_iva` en NULL significa que el precio capturado **ya lo incluye**
(migración 020), así que a esas facturas no se les puede quitar — no se sabe con
qué tasa entraron. Sumárselo a las demás dejaría unas con IVA y otras sin él,
que es peor que no tocarlo. Es además la misma base sobre la que el resto de la
app reporta gasto: todos los totales son `cantidad × costo_unitario`.

## Cuando no hay con quién comparar: cómo se movió el precio

Con un solo proveedor en el catálogo la comparación entre columnas no existe, y
la tabla se lee vacía aunque tenga cientos de precios detrás. Pero ahí sigue
habiendo una pregunta que sí se puede contestar con lo que hay: **¿me subieron
el precio?**

Por eso cada precio vigente lleva su historial dentro de la misma fuente y el
mismo proveedor: cuántos registros hay (`registros`), cuál era el anterior y de
cuándo (`precio_anterior`, `fecha_anterior`), el cambio contra él (`cambio_pct`)
y el recorrido completo desde el más viejo (`precio_primero`, `fecha_primera`,
`cambio_total_pct`). En pantalla es la tercera línea de cada celda; en los
reportes, la sección *Cómo cambió el precio con cada proveedor*.

**Una compra es una factura, no un renglón.** La misma refacción viene repetida
en varias partidas del mismo papel —así exporta el sistema del proveedor, ver
`importacion-historica.md`—, y contar cada partida como una compra distinta
fabricaría un cambio de precio de 0% contra sí misma. El historial agrupa por
factura antes de medir.

La refacción lleva además `alza_pct`: la mayor subida entre sus proveedores. Es
el tercer criterio de orden de la tabla, después del ahorro y de la diferencia
entre proveedores —un sobreprecio contra otro proveedor es dinero que se pierde
hoy; una subida puede ser el mercado entero—, pero por delante del orden
alfabético: con un solo proveedor los dos primeros empatan en cero para todo el
catálogo, y sin esto lo que más subió quedaba enterrado.

## Un proveedor que cotiza *y* al que se le compra

Queda **una entrada por proveedor** —la comparativa se lee como una columna por
proveedor y dos filas suyas la romperían— y manda **la más reciente** de las
dos: una cotización de esta semana dice más que una compra de hace ocho meses, y
al revés. A igual fecha gana la compra: es un hecho, no una oferta.

La que pierde no se tira, va en `otro`. Es justo el contraste con el que se
negocia: *"te pago 92 y me cotizas 105"*.

## Lo que NO se hace, y por qué

**No se copian los precios pagados a `precios_proveedor`.** Sería lo fácil —
insertar una cotización por cada compra — y está mal por dos razones:

1. El precio pagado ya está guardado en `lotes_pieza` + `facturas`. Copiarlo
   crea dos verdades que se desalinean en cuanto alguien corrija un renglón de
   la factura. Es exactamente lo que la migración 026 vino a desmontar.
2. El "precio vigente" de un proveedor empezaría a alternar entre lo que cotiza
   y lo que se le pagó, sin forma de distinguirlos.

Por eso la comparación **deriva** de las dos tablas en cada consulta, y
`precios_proveedor` sigue siendo lo que era: lo que el proveedor pide.

## Dónde está cada cosa

```
api/src/repositories/preciosSql.ts            la definición de "precio comparable"
api/src/repositories/preciosProveedorRepo.ts  findComparables + CTE_COMPARATIVA
api/src/services/preciosProveedorService.ts   el pivote y la elección por proveedor
src/src/lib/reportes/comparativaPrecios.ts    el PDF/Excel de todo el catálogo
src/src/lib/reportes/comparativaPieza.ts      el PDF de una sola refacción
```
