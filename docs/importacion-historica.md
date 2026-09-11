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
| Tipo *(opcional)* | tipo de pieza, categoria, familia |

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

El tipo de pieza es obligatorio en una refacción (es su única clasificación) y
se resuelve en este orden:

1. El que se haya elegido a mano para ese artículo en la pantalla.
2. El de la columna **Tipo** del archivo, si su nombre casa con un tipo del
   catálogo. El nombre se compara sin acentos y sin distinguir mayúsculas, para
   que "Filtro de aire" no cree un duplicado de `FILTRO DE AIRE`. Los nombres
   que no existan se listan con un botón para crearlos de una vez.
3. El de *Tipo para todas*.

La columna es opcional y ningún sistema de facturación la exporta: la escribe
quien prepara la importación. Existe porque clasificar noventa refacciones en
una hoja de cálculo son diez minutos, y hacerlo en noventa desplegables de una
pantalla es trabajo que nadie termina. Solo se usa para las refacciones que no
están en el catálogo; en las que ya existen se ignora.

## Qué alimenta lo importado

Todo lo que entra cuenta como compra real, así que aparece en:

- **Gastos del proveedor**, con su folio, fecha, cantidad y precio unitario.
- **La comparativa de precios**: el precio pagado es una de las dos fuentes con
  las que se compara a los proveedores. Ver `comparacion-de-precios.md` — ahí
  está por qué un precio pagado y una cotización no se pueden comparar crudos.

Lo que **no** toca es `precios_proveedor`: eso es lo que el proveedor cotiza, y
una factura no es una cotización. Tampoco toca el inventario, que es el punto.

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
