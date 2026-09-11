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

### El IVA se queda fuera, a propósito

`facturas.tasa_iva` en NULL significa que el precio capturado **ya lo incluye**
(migración 020), así que a esas facturas no se les puede quitar — no se sabe con
qué tasa entraron. Sumárselo a las demás dejaría unas con IVA y otras sin él,
que es peor que no tocarlo. Es además la misma base sobre la que el resto de la
app reporta gasto: todos los totales son `cantidad × costo_unitario`.

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
