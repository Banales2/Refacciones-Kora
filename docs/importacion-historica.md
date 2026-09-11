# Importación del histórico de compras

## El problema

Hay años de facturas anteriores al sistema. Las piezas se compraron, se
montaron y se gastaron, y **de dónde acabó cada una no queda registro**: nadie
anotó en qué camión entró el kit de balatas de marzo. Lo único que existe es el
papel del proveedor, o la exportación en CSV de su sistema.

Ese papel sí vale la pena cargarlo:

- Es el **historial de precios real** del proveedor, con el que se negocia.
- Es el **gasto** del año, que hay que poder cuadrar contra contabilidad.
- Es la única forma de que el **catálogo de refacciones** incluya lo que de
  verdad se compra, en vez de solo lo capturado desde que existe el sistema.

Lo que **no** se puede hacer es cargarlo como una compra normal: eso metería al
almacén cientos de piezas que físicamente no están, y el inventario dejaría de
servir el mismo día.

## Cómo se carga

En **Catálogos → Proveedores**, se abre el proveedor y en la pestaña **Gastos**
está *Importar histórico*. El proveedor no se elige en el archivo: es aquel
cuyo detalle está abierto.

Cada renglón del CSV se guarda como un lote igual que en una compra, con una
sola diferencia y es toda la clave:

| | qué guarda | por qué |
|---|---|---|
| `lotes_pieza.cantidad_inicial` | lo que dice la factura | es lo que entró, y lo que multiplica al costo en todo reporte de gasto |
| `existencias_lote.cantidad` | **0** | es lo que hay hoy en el estante, y no hay nada |

La diferencia entre las dos **no es un descuadre**: es exactamente lo que pasó.
Se compraron y se usaron. Lo que falta es el destino, y ese no se puede
inventar — por eso no se les crea ninguna instalación ni ningún consumo, que
serían un registro falso de en qué vehículo acabaron.

Tampoco se crean **unidades** para los tipos con `rastreo_individual`
(migración 025): una unidad es una pieza física que se puede ir a tocar, y estas
ya no existen. Como la existencia también queda en cero, el cuadre de unidades
contra existencias sigue dando cero contra cero.

La factura queda marcada con `facturas.historica = 1`
(`db/migrations/028_facturas_historicas.sql`). Sin esa marca, un lote con
`cantidad_inicial` 4 y existencia 0 al que no le corresponde ningún consumo se
lee como un bug del inventario, y la primera persona que lo mire va a
perseguirlo. La pantalla de gastos lo muestra como **Histórica**.

## El archivo

Un renglón por partida, con el folio y la fecha repetidos en cada uno — que es
como exporta cualquier sistema de facturación. Las columnas se reconocen por
nombre, sin acentos y sin importar mayúsculas; se aceptan varios alias (ver
`COLUMNAS` en `src/src/lib/historicoCsv.ts`):

| columna | alias aceptados |
|---|---|
| Movimiento | folio, factura, num factura, documento |
| Fecha Emisión | fecha, fecha factura, fecha compra |
| Artículo | numero de parte, no parte, codigo, sku |
| Descripción | concepto |
| Cantidad | cant, piezas |
| Precio unit con descuento | precio unitario, precio, costo unitario |

Ejemplo:

```csv
Movimiento,Fecha Emisión,Artículo,Descripción,Cantidad,Precio unit con descuento
TPR8054,1/5/2026,5878324100,KING PIN KIT,2," 6,481.58 "
TPR8058,1/6/2026,8942575121,"LENS, BACKUP, RR COMB LAMP",4, 487.65
```

Detalles que el lector resuelve solo:

- **Comillas, comas y saltos de línea dentro de un campo.** Un
  `"NUT;WHEEL, INNER,RR AXLE"` partido por comas se llevaba la descripción a la
  columna de la cantidad.
- **Codificación**: UTF-8 y, si no lo es, windows-1252 (el CSV que guarda el
  Excel en español).
- **Miles y decimales**: entran igual `6,481.58` y `6.481,58`.
- **Fechas**: se detecta si el archivo viene en mes/día o día/mes — basta con
  que una fecha tenga un primer número mayor que 12 para decidirlo — y la
  pantalla deja cambiarlo, porque `1/5/2026` es válido de las dos formas.

Un renglón que no se pueda leer **no tumba el archivo**: se aparta con su número
de línea y el motivo, y el resto entra. Con doscientos renglones exportados de
otro sistema, rechazar todo por uno roto significa que nadie importa nunca nada.

## Las refacciones nuevas

El número de parte es la llave. Si ya está en el catálogo se usa esa refacción y
**no se le toca nada** — ni la descripción ni el tipo: el catálogo de hoy sabe
más que un archivo viejo. Si no está, se da de alta con la descripción del
archivo.

El tipo de pieza no viene en ningún CSV y es obligatorio en una refacción (es su
única clasificación), así que se elige en la pantalla: uno para todas las nuevas
y, si hace falta, uno por artículo. Solo se pide para las que no existen.

## Volver a subir el mismo archivo

Es seguro. Los folios que ese proveedor ya tenga registrados **se omiten** y se
reportan al terminar; no se fusionan ni se duplican sus renglones.

Es lo contrario de lo que hace una compra normal, donde un folio repetido mete
los renglones nuevos en la factura que ya existe (`facturasRepo.findOrCreate`)
porque ahí son el mismo papel capturado en dos tandas. Aquí, volver a soltar el
archivo —porque se cayó la conexión, porque no quedó claro si entró— es lo
normal, y fusionar convertiría cada reintento en una factura con los renglones
duplicados.

Todo el archivo entra en **una sola transacción**: o entra completo o no entra
nada, y el segundo intento continúa donde se quedó el primero.

## Dónde está cada cosa

```
db/migrations/028_facturas_historicas.sql   la bandera `facturas.historica`
api/src/schemas/historicoSchema.ts          qué acepta el endpoint
api/src/services/historicoService.ts        lo que se rechaza antes de escribir
api/src/repositories/historicoRepo.ts       la transacción
api/src/functions/historico-import.ts       POST /api/compras/historicas
src/src/lib/csv.ts                          lector de CSV
src/src/lib/historicoCsv.ts                 del CSV a las facturas
src/src/components/ImportarHistoricoModal.tsx
```
