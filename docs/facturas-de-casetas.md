# Facturas de casetas

PASE, el proveedor del TAG, factura cada diez días ("Decenal") con **un renglón
por cruce** de todos los tags de la empresa. La del 21 al 30 de septiembre de
2026 trae 403 cruces de 14 tags por $201,967. Eso no se captura: **se importa
del XML**.

Ver `db/migrations/064_facturas_de_casetas.sql`.

```
tags_casetas                  tag -> vehiculo
facturas_casetas              uuid, serie/folio, periodo, totales impresos
  facturas_casetas_cruces     un renglón por cruce -> vehiculo
```

## El XML, no el PDF

El PDF, leído a máquina, mezcla columnas de un renglón con las del siguiente:
en una prueba, la tarifa del renglón 2 salió con el subtotal del 3. El XML trae,
además del CFDI estándar, una addenda de Interfactura con un `if:Cuerpo` por
cruce y cada dato en su atributo: `Renglon`, `Tag`, `Fecha`, `Hora`, `Evento`,
`Carril`, `Caseta`, `Clase`, `Importe`, `Iva`, `Total`.

La pantalla lo lee (`src/src/lib/xmlPase.ts`) y enseña una vista previa antes
de guardar. **Lo que no se puede leer entero se rechaza** con el renglón y el
motivo: este repo ya quitó una vez un lector de PDF de gasolinera que se
equivocaba en silencio. La API vuelve a comprobar, antes de escribir nada:

- que las partidas vayan de 1 a N sin huecos ni repetidas,
- que en cada cruce importe + IVA = total,
- que los cruces sumen el subtotal, el IVA y el total impresos, al centavo,
- que ese UUID no se haya importado ya (409 `FACTURA_DUPLICADA`).

Si algo falla no se guarda nada: media factura sería peor que ninguna.

**El tag viene cortado, también en el XML** (`IMDM27096290..`). Es lo único que
PASE entrega, así que se guarda sin los puntos y ese es el identificador.

**Los importes se guardan como vienen**, con seis decimales. Aquí nadie teclea
nada: el documento es la única fuente, y recalcular a partir de una tasa abriría
la puerta a que la suma no diera lo impreso por redondeo.

## No hay nada capturado contra qué casar

Es la diferencia con gasolina y con taller. Allá la recarga o el servicio
existen antes que la factura, y el cuadre los empareja. Aquí el cruce no existe
en el sistema hasta que PASE lo cobra.

Lo que se puede revisar sale del documento y de la historia de cada tag. La API
lo devuelve como **hallazgos**, en dos grupos que no se suman porque contestan
preguntas distintas:

| | grupo | qué es | el dinero que se enseña |
|---|---|---|---|
| **Ya cobrado en otra factura** | cobro | mismo tag, caseta y hora al segundo en otra factura | el cruce entero |
| **Posible doble cobro** | cobro | mismo tag y caseta con menos de 60 min | el menor de los dos |
| **Clase arriba de la habitual** | cobro | el tag pagó en esa caseta una clase mayor que la que suele pagar | lo que pagó por encima de lo **más caro** que ha pagado en su clase habitual |
| **Ajuste de PASE** | cobro | clase 0 o "AJUSTE …" | el cargo |
| **Fuera del periodo** | cobro | cruce con fecha fuera de las del periodo | el cruce |
| **Tag sin unidad** | uso | nadie ha dicho de qué unidad es | lo que suman sus cruces |
| **Caseta que el tag no cruzaba** | uso | con 30+ cruces en otras facturas, nunca por esta caseta | lo que suman |

**Ninguno es una conclusión.** Un tráiler que paga clase 9 donde siempre paga 5
puede llevar doble caja ese día; quien lo sabe es quien revisa.

### Por qué la clase se compara así

Cada operador clasifica a su modo: las casetas EASYTRIP cobran clase 1 a los
tractocamiones que en las demás pagan 5. Por eso **solo se compara un tag contra
sí mismo en la misma caseta**, nunca contra una tabla de clases.

La clase habitual es la más frecuente, con al menos 3 cruces. En empate gana la
más alta: entre dos clases igual de frecuentes no se puede decir que la cara sea
la rara.

Y el exceso se mide contra lo **más caro** que ese tag ha pagado en su clase
habitual, no contra el promedio. En Bucerías la clase 6 cuesta lo mismo que la
5 ($1,150); contra el promedio salía un "+$87" que no existía. Con la factura de
septiembre, esto deja un solo hallazgo de clase: Tepic, clase 6 a $295 cuando el
tag nunca había pagado más de $213 en clase 5.

### Lo que todavía no se detecta

El uso indebido que depende de saber **cuándo debía circular la unidad** —en el
taller, sin viaje, fuera de su translado— necesita datos que el sistema no tiene
todavía: horarios o viajes. Las unidades de reparto, además, pueden ir a otro
municipio, así que cruzar una caseta no es en sí mismo una falta. La caseta
inusual es lo que se puede decir sin inventar una regla.

## Los tags

Un tag por unidad. Los que llegan en una factura y no están en el catálogo se
dan de alta solos, sin unidad, y salen primero en la pestaña Tags.

**La unidad se guarda en el cruce**, no se resuelve al leer. Si mañana el tag
pasa a otra unidad, sus cruces viejos siguen siendo de la que lo traía. Al
asignarle unidad a un tag, la API le pone esa unidad a sus cruces que no tenían
ninguna, y solo a esos.

## Endpoints

| Ruta | Rol | Qué hace |
|---|---|---|
| `GET /facturas-casetas` | admin, editor, lector | Lista, con `?por_revisar=1` |
| `POST /facturas-casetas` | admin, editor | Importa la factura con sus cruces |
| `GET /facturas-casetas/{id}` | admin, editor, lector | Cruces, hallazgos y resumen por unidad |
| `POST /facturas-casetas/{id}/revisar` | **admin** | La marca como revisada |
| `POST /facturas-casetas/{id}/reabrir` | **admin** | Quita la marca |
| `GET /tags-casetas` | admin, editor, lector | Los tags, los sin unidad primero |
| `POST /tags-casetas` | admin, editor | Registra un tag antes de que cruce |
| `PUT /tags-casetas/{id}` | admin, editor | Cambia la unidad del tag |

Los hallazgos se calculan al pedir el detalle, no se guardan: dependen de la
historia de cada tag, que cambia con cada factura nueva.

## La pantalla

`src/src/pages/FacturasCasetas.tsx`, bajo **Facturas → Casetas**, con dos
pestañas: **Facturas** (la bandeja, con el importador) y **Tags**. Al abrir una
factura: cuatro tarjetas —total, cruces, lo que pudo cobrarse de más, uso por
revisar— y tres pestañas: hallazgos, por unidad y los cruces.
