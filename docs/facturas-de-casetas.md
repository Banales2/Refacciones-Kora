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
- que ese UUID no se haya importado ya (409 `FACTURA_DUPLICADA`). Si dos
  personas importan el mismo XML a la vez, la segunda choca con la UNIQUE del
  UUID y recibe el mismo 409, no un error interno.

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
| **Fuera de tarifa** | cobro | el importe no es el de ningún tramo que esa caseta cobra, para su clase | lo que pasa del tramo más caro; $0 si cobró menos o queda entre dos |
| **Corregido después** | cobro | un ajuste de otra factura corrige este cruce (misma hora) | $0: el ajuste se revisa en su factura |
| **Ya cobrado en otra factura** | cobro | mismo tag, caseta y hora al segundo en otra factura (sin contar ajustes) | el cruce entero; $0 en la factura donde se cobró primero |
| **Posible doble cobro** | cobro | mismo tag y caseta con menos de 60 min entre un cruce y el siguiente, y no son dos tramos distintos | todos menos el más caro |
| **Clase arriba de la habitual** | cobro | el tag pagó en esa caseta una clase mayor que la que suele pagar | lo que pagó por encima de lo **más caro** que ha pagado en su clase habitual |
| **Ajuste de PASE** | cobro | clase 0 o "AJUSTE …"; con tarifa, busca el cruce que corrige | $0 si la corrección deja la tarifa que el tag suele pagar; lo de encima si la pasa; el cargo entero si no se sabe |
| **Fuera del periodo** | cobro | cruce con fecha fuera de las del periodo | el cruce |
| **Tag sin unidad** | uso | nadie ha dicho de qué unidad es | lo que suman sus cruces |
| **Caseta que el tag no cruzaba** | uso | con 30+ cruces en otras facturas, nunca por esta caseta | lo que suman |

El **Posible doble cobro** junta la ráfaga entera: tres cruces seguidos en la
misma caseta son un hallazgo, no dos pares. Los cruces se ordenan por tag y
caseta antes que por hora, así que pasar por otra caseta en medio no esconde el
doble cobro. Se ponen lado a lado con la hora al segundo, el tiempo desde el
anterior, el carril, el evento, la clase y el total. El más caro sale como "se
paga" porque es el que el monto deja fuera.

El hallazgo **Ya cobrado en otra factura** sale una vez por cruce, en todas las
facturas donde viene. Pone el cruce lado a lado tal como aparece en cada factura
(partida, hora, clase, total), en orden de emisión, y trae un botón para abrir
cada una sin cerrar el detalle. **La primera vez que se cobró no cuenta**: ahí
el hallazgo vale $0. Cada factura posterior cuenta el cruce entero como cobrado
de más. Con tres facturas, se reclaman dos.

**Ninguno es una conclusión.** Un tráiler que paga clase 9 donde siempre paga 5
puede llevar doble caja ese día; quien lo sabe es quien revisa.

## Las tarifas

Ver `db/migrations/071_tarifas_de_casetas.sql`.

```
tramos_casetas         autopista + tramo, como lo publica el operador
  tarifas_casetas      tramo + vigencia -> tarifa por clasificación (con IVA)
casetas_tramos         código de caseta de PASE -> tramos que puede cobrar
```

**La tarifa es del tramo, no de la caseta.** En un sistema cerrado se paga
según por dónde se entró: en La Peñita un camión de 5 ejes paga $193 (Capomo →
La Peñita), $1,871 (La Peñita → Aeropuerto) o $2,038 (Capomo → Aeropuerto). Por
eso una caseta apunta a varios tramos, y **el importe dice cuál fue**: sale
debajo de la caseta en la pestaña Cruces y en la comparación del doble cobro.

Con eso se separan tres cosas que antes se confundían:

- **un cobro fuera de tarifa**: ningún tramo de esa caseta cuesta eso;
- **dos tramos seguidos en la misma caseta** (salió en La Peñita y volvió a
  entrar): ya no es doble cobro. En septiembre era el único falso positivo;
- **un ajuste que es una corrección**: el de $227 en Plan de Barrancas es $596 −
  $369, de camión 2-4 ejes a 5-6. Los ajustes tampoco entran al doble cobro.

### Los ajustes son correcciones de clase

El caso típico: el carril cobra un tráiler como automóvil (clase 1, $214 en
Arenal) y días después PASE manda la diferencia como **AJUSTE con clase 0**
($199, para llegar a los $413 de camión 5-6). **PASE fecha el ajuste con la hora del
cruce que corrige** (en agosto: partida 37 a las 15:30 en clase 1 por $151, y
el ajuste de $101 en otra factura, a las 15:30, clase 0: $252 en total). Así se
liga:

1. el cruce del mismo tag, en la misma caseta y **a la misma hora**, en
   cualquier factura. Si existe, es ese, haya tarifa o no;
2. si no, con tarifa: de los cruces de los 15 días antes, el más cercano cuyo
   importe es la tarifa de una clasificación y que **con el ajuste sube exacto**
   a la de una clasificación mayor del mismo tramo.

Por la misma hora, el ajuste y su original se veían como **"Ya cobrado en otra
factura"**: la consulta ahora deja fuera los ajustes de los dos lados. En la
factura del cruce original sale **"Corregido después"** con el ajuste y un botón
para abrir su factura.

Encontrado, la tarjeta pone la cuenta —original, ajuste, en qué quedó— contra
**la clase que ese tag suele pagar en esa caseta**. Si la suma es esa tarifa, la
corrección es correcta y el hallazgo vale **$0**: no se confunde con un cobro de
más. Sin tarifa cargada, se compara contra **lo más que el tag ha pagado en su
clase habitual en esa caseta**. Si la pasa, lo de encima es el monto. Sin historia del tag se queda el
cargo entero, para que alguien confirme la clase de la unidad.

Si no se encuentra el original (todavía no se importa la factura donde vino),
el ajuste dice con qué diferencias de tarifas cuadra, sin monto en $0.

**La clase de PASE es el número de ejes**, con 1 para el automóvil (sale de
cruzar septiembre contra las tarifas): 1 automóvil, 2-4 autobús o camión 2-4
ejes, 5-6 camión 5-6, 7-9 camión 7-9. Las casetas EASYTRIP no siguen esta
regla (cobran clase 1 a los tractocamiones); si se cargan, hay que revisarla.

**Vigencia.** Cada aumento es una fila nueva con su fecha; un cruce se revisa
contra la tarifa vigente el día que cruzó. La primera tanda se cargó con
vigencia 2026-01-01 porque las páginas no dicen desde cuándo rige.

**Lo que no tiene tarifa no se revisa contra precio**, y la pestaña de
hallazgos lo dice (casetas, cruces y dinero), para que "nada fuera de tarifa" no
se lea como que todo cuadró.

Primera tanda (sitio de IDEAL, consultado el 2026-10-19): Guadalajara - Tepic
(Arenal 155, Plan de Barrancas 156, Sta. Ma. del Oro 157, Chapala 325, Santa
Cecilia 405) y Las Varas - Vallarta (La Peñita 406, Vallarta 468, Florida 469,
Bucerías Aux. 1 520). Con la factura de septiembre explica 253 de 255 cruces;
los otros dos son Arenal clase 3-4 a $278 contra $287 publicados.

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
| `GET /tarifas-casetas` | admin, editor, lector | Casetas con sus tramos y tarifas de hoy, y lo cobrado en cada una |
| `PUT /tarifas-casetas/{id}` | **admin** | Corrige una vigencia (precios o fecha) |
| `POST /tarifas-casetas` | **admin** | Registra un aumento: vigencia nueva de un tramo |
| `POST /tramos-casetas` | **admin** | Agrega un tramo a una caseta, con su primera tarifa |
| `GET /tags-casetas` | admin, editor, lector | Los tags, los sin unidad primero |
| `POST /tags-casetas` | admin, editor | Registra un tag antes de que cruce |
| `PUT /tags-casetas/{id}` | admin, editor | Cambia la unidad del tag |

Los hallazgos se calculan al pedir el detalle, no se guardan: dependen de la
historia de cada tag, que cambia con cada factura nueva.

## La pantalla

`src/src/pages/FacturasCasetas.tsx`, bajo **Facturas → Casetas**, con tres
pestañas: **Facturas** (la bandeja, con el importador), **Tags** y **Tarifas**.
En Tarifas, cada caseta con tarifa muestra sus tramos con la tarifa de hoy
(marcadas las que PASE sí ha cobrado) y, debajo, lo cobrado agrupado por clase e
importe con el tramo que le corresponde o "Fuera de tarifa". Al final, las
casetas sin tarifa ordenadas por lo que han costado: son las que conviene
cargar.

**Editar tarifas es solo de admin**, porque deciden qué cuenta como cobro de más
en todas las facturas, las ya revisadas incluidas. Hay dos acciones distintas
sobre un tramo: **corregir** (el precio estaba mal: cambia la vigencia que ya
existe) y **registrar un aumento** (vigencia nueva con fecha posterior; la
anterior se queda para los cruces de antes). Si el tramo lo cobran otras
casetas, el modal lo avisa. **Agregar tramo** sirve también en las casetas sin
tarifa: el tramo queda ligado solo a esa caseta. Todo pasa por la bitácora.

### De dónde sacar tarifas

- **El operador** (IDEAL para Guadalajara - Tepic y Las Varas - Vallarta): por
  tramo, sin fecha de vigencia. Tenía un error: Arenal, camión 2-4 ejes, $287.
- **casetas.com.mx**: por caseta y por número de ejes, con fecha ("válidas
  desde el 13 de abril de 2026" en Guadalajara - Tepic). Ahí Arenal camión 2-4
  es $278, lo que cobra PASE. En Las Varas - Vallarta sus precios son más bajos
  que los de IDEAL y que lo que cobra PASE: parece desactualizada.

Comparar contra lo que PASE cobra (pestaña Tarifas) dice cuál fuente está bien. Al abrir una
factura: cuatro tarjetas —total, cruces, lo que pudo cobrarse de más, uso por
revisar— y tres pestañas: hallazgos, por unidad y los cruces.
