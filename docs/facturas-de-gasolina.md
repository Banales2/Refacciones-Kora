# Facturas de gasolinera

La gasolinera no factura carga por carga: manda una factura que cubre varias.
Pero **sí las desglosa**, y eso es lo que hace posible cuadrarla. Un CFDI real:

```
No. Identificacion              Cantidad  Unidad  P.Unit  Importe
PL/6809/EXP/ES/2015-8367437      219.37    LTR    23.33   5119.10
PL/6809/EXP/ES/2015-8367573       27.23    LTR    23.33    635.39
PL/6809/EXP/ES/2015-8368006      335.65    LTR    23.33   7832.40
...
Tickets: 8367437,8367573,8368006,8368018,8368392,8368429
Subtotal 29210.10   IVA 16% 4575.30   Total 33785.40
```

Cada renglón es **un ticket**: una carga. Lo que **no** trae es a qué vehículo
fue, qué chofer la hizo ni contra qué vale — eso solo lo sabe el sistema.
Conciliar es casar cada renglón del papel con la recarga que le corresponde.

Ver `db/migrations/041_facturas_de_gasolina.sql`.

## Por qué no se parece a la revisión de facturas de refacciones

| | refacciones (040) | gasolina (041) |
|---|---|---|
| el papel trae | un renglón por refacción | un renglón por ticket |
| el renglón dice a qué apunta | sí: la refacción | **no**: ni vehículo, ni chofer, ni vale |
| la pregunta | ¿esto está bien capturado? | ¿a qué recarga corresponde? |
| la operación | verificar y corregir | **emparejar** |
| el producto | quién se equivocó y cuánto | qué carga no se capturó |

## Se empareja por litros, no por importe

Es lo único no evidente de todo esto:

- El **importe del renglón es sin IVA** — los renglones suman el subtotal
  (29,210.10), no el total (33,785.40).
- **`recargas_combustible.costo` es lo que se pagó en la bomba**, que sí lo
  incluye.

Compararlos da 16% de diferencia **siempre**. Los litros, en cambio, son el mismo
número de los dos lados —el IVA no cambia cuánto se despachó— y con tres
decimales prácticamente no se repiten: 219.37, 27.23, 335.65, 364.35, 57.91,
247.26.

Por eso **no se propone nada por importe**, ni siquiera "el más cercano": casaría
cosas equivocadas con toda confianza.

## El ticket es mejor llave todavía

La migración agrega **`recargas_combustible.ticket`**. Si quien captura la recarga
teclea el número del papel de la bomba, el cuadre deja de ser una inferencia y
pasa a ser exacto.

Nace NULL en todo lo capturado, así que hoy los litros son el camino normal; el
ticket es el atajo para cuando exista. No se hace obligatorio: forzarlo rompería
la captura de las recargas que llegan sin ticket a la mano.

## Las dos pasadas

1. **Por ticket.** Si el renglón trae número y alguna recarga lo tiene capturado,
   eso no es inferencia: es el mismo papel. El CFDI lo trae dentro de un
   identificador largo (`PL/6809/EXP/ES/2015-8367437`) y la recarga lo captura
   suelto (`8367437`), así que se compara por el último tramo y sin ceros a la
   izquierda.
2. **Por litros exactos**, a la milésima. Es lo que queda cuando el ticket no
   está.

Lo que no casa en ninguna pasada se queda sin proponer y lo resuelve una persona.
Cada emparejamiento guarda **cómo** se hizo (`ticket`, `litros`, `manual`) para
poder confiar distinto en cada uno.

En empate —dos recargas con los mismos litros— gana la más reciente, que es la
que cae dentro del periodo que la factura cobra.

## Las candidatas

> Las de **su gasolinera**, con fecha **menor o igual** a la de la factura, que
> **ningún renglón de ninguna otra factura** haya reclamado.

El corte por fecha no tiene límite inferior a propósito: una carga de hace tres
meses que nadie facturó sigue siendo candidata legítima, y poner una ventana la
escondería justo cuando aparece la factura atrasada que la cobra.

El vínculo vive en el **renglón** (`facturas_gasolina_renglones.recarga_id`), no
en la recarga. Así "qué falta por facturar" y "qué renglón no tiene recarga" son
la misma consulta vista desde dos lados, y un índice único impide que dos
renglones se lleven la misma carga.

## Lo que la pantalla existe para encontrar

Un renglón sin recarga **no es un descuadre de dinero abstracto**: es *el ticket
8368392, de 57.91 litros, por 1,351.35 sin IVA, que la gasolinera está cobrando y
que nadie registró*. Con eso se puede ir a preguntar.

Sellar con renglones sin casar es legítimo —la recarga puede capturarse la semana
que viene y entonces se reabre— pero exige `confirmar_sin_casar`, así que no pasa
por descuido. La API responde 409 `RENGLONES_SIN_CASAR` con cuántos son y cuánto
valen.

## El candado

Una recarga que ya entró en una factura **conciliada** no puede cambiar de
`costo`, `fecha` ni `gasolinera_id`: el cuadre se hizo con esos datos y dejaría de
ser cierto sin que nadie se entere. `PUT /recargas/{id}` responde 409
`RECARGA_CONCILIADA`.

Los demás campos —chofer, vale, kilometraje, litros— **sí se siguen corrigiendo**
con la factura cerrada. Son datos de la operación, no del papel.

## Al capturar la factura

El **subtotal no se teclea**: es la suma de los renglones. El servidor rechaza la
factura si no cuadran, porque un renglón que falta nunca aparecería como "falta en
el sistema" — el hueco se escondería justo en el dato que esto existe para
encontrar.

El **UUID del CFDI** es opcional pero vale la pena: es lo único que detecta la
misma factura capturada dos veces aunque le cambien la serie.

Los renglones se pegan como texto (`src/src/lib/ticketsFactura.ts`). Ese lector
**no pretende entender el PDF** — los formatos no se parecen entre emisores y un
parser que adivina se equivoca en silencio, que es la peor forma de equivocarse
con dinero. Toma una línea, saca los números y los interpreta por posición con una
regla fija: los tres últimos son litros, precio e importe. Lo que no encaje se
reporta y se teclea a mano.

## Reabrir

`POST /facturas-gasolina/{id}/reabrir` suelta el sello. Es lo que hace falta
cuando aparece la recarga que no estaba: se captura por la vía normal, se reabre y
ahora sí casa. Los emparejamientos **no** se deshacen, así que solo hay que
ajustar lo que faltaba.

## Endpoints

| Ruta | Rol | Qué hace |
|---|---|---|
| `GET /facturas-gasolina` | admin, editor, viewer | Lista, con `?por_conciliar=1` |
| `POST /facturas-gasolina` | admin, editor | Alta: cabecera y renglones |
| `GET /facturas-gasolina/{id}/candidatas` | admin, editor, viewer | Renglones con su propuesta, y las recargas elegibles |
| `POST /facturas-gasolina/{id}/conciliar` | **admin** | Guarda los emparejamientos y sella |
| `POST /facturas-gasolina/{id}/reabrir` | **admin** | Suelta el sello |

Conciliar es solo admin, igual que revisar una factura de refacciones: es el
segundo par de ojos sobre lo capturado.

`casados` es el conjunto **completo**, con los renglones sin casar incluidos y su
`recarga_id` en null: la pantalla manda la verdad entera y el servidor reemplaza.

## La pantalla

`src/src/pages/FacturasGasolina.tsx`, en **Operación → Facturas de gas**.

Lista con estado (`Por conciliar`, `Cuadrada`, `N sin capturar`), y al abrir una
factura: tres tarjetas —total del papel, tickets casados, importe sin capturar—,
la tabla de renglones con un desplegable de recargas por cada uno, y una insignia
diciendo cómo casó cada emparejamiento.

## Lo que quedó fuera

- **No hay importación del XML del CFDI.** Se pega el desglose como texto. Si les
  llega el XML, parsearlo daría los conceptos exactos sin el lector heurístico.
- **Un renglón se casa con una recarga y solo una.** Si una carga apareciera
  partida entre dos facturas, esto se queda corto — pero inventar hoy la tabla
  intermedia para un caso que nadie ha visto cuesta complejidad en el 100% de los
  casos reales.
- **Nada se marcó como conciliado al migrar.** Ninguna recarga existente se ha
  casado contra nada, así que todas nacen libres.
