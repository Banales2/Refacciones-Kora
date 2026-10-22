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
| **Clase distinta en el recorrido** | cobro | en el mismo viaje las demás casetas cobraron una clase menor | contra la tarifa de la clase del recorrido en el mismo tramo; $0 sin tarifa |
| **Clase arriba de la habitual** | cobro | el tag pagó en esa caseta una clase mayor que la que suele pagar, y no es la que paga casi siempre | lo que pagó por encima de lo **más caro** que ha pagado en su clase habitual |
| **Clase distinta a la de siempre** | cobro | la clase está 2 o más arriba de la que el tag paga casi siempre (todas sus casetas), y ese día no pagó una parecida en otra caseta | contra la tarifa de su clase de siempre en el mismo tramo; $0 sin tarifa |
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

Ver `db/migrations/071_tarifas_de_casetas.sql` y `072_tarifas_por_eje.sql`.

```
tramos_casetas         autopista + tramo, como lo publica el operador
  tarifas_casetas      tramo + vigencia -> tarifa por número de ejes (con IVA)
casetas_tramos         código de caseta de PASE -> tramos que puede cobrar
casetas_pase           código de caseta -> ignora_clase (EASYTRIP)
```

**Una columna por número de ejes** (moto, auto, autobús 2-4, camión 2-9, eje
excedente ligero y pesado), porque cada operador agrupa a su modo: IDEAL cobra
camión 2-4 / 5-6 / 7-9 y Jala - Compostela - Las Varas 2-3 / 4-5 / 6-9. Al
capturar una tabla agrupada se teclea el primero del grupo y "Rellenar hacia la
derecha" copia el resto.

**Las casetas EASYTRIP no mandan la clase**: en el XML todo cruce de Amado
Nervo (581) y Compostela EASYTRIP (582) viene en clase 1, sea un auto o un
tráiler. Esas casetas se marcan con `ignora_clase` (un switch en la pestaña
Tarifas, solo admin) y su importe se compara contra todas las clasificaciones:
el importe es lo que dice cuántos ejes se cobraron, y sale junto al tramo
("Jala - Las Varas · camión 4-5 ejes"). En ellas no se usa la clase habitual
del tag para revisar ajustes.

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
cruzar septiembre contra las tarifas); de 2 a 4 puede ser autobús o camión.
Salvo en las casetas EASYTRIP, San Blas y Compostela (53), ver arriba.

**Vigencia.** Cada aumento es una fila nueva con su fecha; un cruce se revisa
contra la tarifa vigente el día que cruzó. La primera tanda se cargó con
vigencia 2026-01-01 porque las páginas no dicen desde cuándo rige.

**Lo que no tiene tarifa no se revisa contra precio**, y la pestaña de
hallazgos lo dice (casetas, cruces y dinero), para que "nada fuera de tarifa" no
se lea como que todo cuadró.

Primera tanda (sitio de IDEAL, consultado el 2026-10-19): Guadalajara - Tepic
(Arenal 155, Plan de Barrancas 156, Sta. Ma. del Oro 157, Chapala 325, Santa
Cecilia 405) y Las Varas - Vallarta (La Peñita 406, Vallarta 468, Florida 469,
Bucerías Aux. 1 520). Segunda tanda (072): Jala - Compostela - Las Varas,
tabla del operador vigente desde el 13 de abril de 2026 (Amado Nervo y
Compostela EASYTRIP). Tercera tanda (073): Tepic - Mazatlán, de IDEAL, publicada
por caseta (troncal y auxiliar) en vez de por tramo; el código de PASE apunta a
las dos (Estación Ruiz cobró la troncal, Acaponeta la auxiliar). Yago y El
Rosario se cargaron **sin caseta** porque aún no salen en ninguna factura: la
pestaña los lista y se ligan con "Agregar tramo → Ligar uno que ya existe".
Cuarta tanda (074): Tepic - Compostela, de cmronayarit.com (la misma
concesionaria de Jala - Compostela), para 526 TEPIC; agrupa 2-3 / 4-5 / 6-9 ejes.
Quinta tanda (075): Tepic - San Blas, plaza Matanchén, de la tabla 2026 de
COTESA en el sitio de RCO (`redviacorta.mx/documents/d/red-v%C3%ADa-corta/cts_tarifas_2026`),
para **407 SAN BLAS**. casetas.com.mx sigue con la de 2025 ($226 camión 2-4) y
por eso antes no cuadraba. San Blas **tampoco manda la clase real**: cobra $236,
camión 2-4 ejes, y el XML dice clase 9 (los 10 cruces, de un camión que en las
demás casetas paga 3). Se marcó `ignora_clase`, como las EASYTRIP.

Sexta tanda (076): Chapalilla - Compostela, de la tabla 2026 de CAPUFE (Red
FONADIN, en vigor desde el 1 de julio de 2023), para **53 COMPOSTELA**, km 31.6.
Igual que San Blas: cobra $81, camión 2-3 ejes, y el XML dice clase 1 (los 5
cruces, del mismo tipo de camión de clase 3). También `ignora_clase`.

Con eso, a 2026-10-20 todas las casetas que han salido en una factura tienen
tarifa.

Con la factura de septiembre las dos primeras tandas explican 301 de 303
cruces; los otros dos son Arenal camión 2-4 a $278, que IDEAL publica en $287
y casetas.com.mx en $278: hay que corregirla.

### Los recorridos

Una caseta sola no dice si cobró mal: si siempre cobra la misma clase de más a
un tag, para ella eso es lo habitual. **El mismo viaje sí lo dice**: si de
Tepic a Guadalajara Sta. Ma. del Oro y Arenal cobraron clase 5 y en medio Plan de
Barrancas cobró 9, la rara es Plan de Barrancas. No es para rastrear la unidad;
es para comparar cada caseta contra las demás.

Un **recorrido** son los cruces de un tag con menos de **3 horas** entre uno y
el siguiente. Sta. Ma. del Oro → Plan de Barrancas tarda unas dos; con más, la
ida cargado y la vuelta vacío (con menos ejes) se juntarían. Entran los cruces
de otras facturas que quedan pegados: el viaje del último día del periodo sigue
en la factura siguiente.

**La clase del recorrido** es la que cobró la mayoría de las casetas, **cada
caseta un voto**: ida y vuelta por San Blas (dos cruces en 9) no le gana a
Trapichillo y Trapichillo Bis (3). Hacen falta dos casetas que coincidan y que
ninguna otra clase empate; si no, el recorrido no tiene clase y no se compara.
No votan las casetas que no mandan la clase real.

Se señala un cruce **arriba** de la clase del recorrido, salvo que no pase la
que el tag paga casi siempre: a un tráiler de 9, Plan de Barrancas y Sta. Ma.
del Oro le cobraron 5 la misma noche, el recorrido quedó en 5 y el 9 de Arenal
era el bueno. Lo de más se mide contra la tarifa de la clase del recorrido en el
mismo tramo; si cuesta igual (en Arenal 5 y 6 son $413), no hay hallazgo. Sin
tarifa, contra lo más que el tag ha pagado ahí en esa clase; sin eso tampoco,
sale en $0 solo si el salto es de 2 o más.

**Y al revés: el recorrido confirma.** Un cruce que cobró lo mismo que su
recorrido (o menos) ya no lo revisan "Clase arriba de la habitual" ni "Clase
distinta a la de siempre". Sta. Ma. del Oro suele cobrar 5 a ese tráiler de 9;
el día que cobraba 9 junto con las otras dos, la clase habitual de la caseta lo
marcaba con $40 de más, ocho veces en cinco facturas. Por lo mismo, "Clase
arriba de la habitual" tampoco señala la clase que el tag paga casi siempre.

Con las cinco facturas (agosto a octubre de 2026): Plan de Barrancas cobró 9 y
7 en recorridos de 5 ($76 cada uno) y Arenal cobró clase 2 a un auto ($64). San
Blas salía con clase 9 en recorridos de 3, hasta que su tarifa (075) mostró que
cobra lo de 3 ejes y que es la clase la que no es real.

En el detalle de la factura, la pestaña **Recorridos** los enseña todos, por
unidad, con la clase de cada caseta lado a lado; el hallazgo trae el suyo.

### Clase distinta a la de siempre

La **clase habitual** es por caseta, y por eso no ve una caseta que **siempre**
cobra mal: San Blas cobró clase 9 en todos los cruces de un camión que en otras
89 casetas pagó clase 3, y para San Blas el 9 era lo habitual. Esta revisión
mira la clase que el tag paga casi siempre **sumando todas sus casetas**
(mínimo 10 cruces y que sea la mayoría; no cuentan las casetas sin clase real
ni los ajustes).

Se señala un cruce si su clase está **2 o más arriba** de esa (un 5 contra un 6
es el eje retráctil de todos los días) y si **ese mismo día** (12 horas antes o
después) el tag no pagó una clase parecida en otra caseta: si la pagó, el
vehículo sí venía así (doble caja). Cuando no se cuenta con otra caseta ese día,
se dice cuál fue la más cercana y qué clase pagó ahí; eso incluye los cruces de
otras facturas. Se agrupa por caseta y clase: nueve cruces iguales son un
hallazgo. Un cruce que ya señaló "clase arriba de la habitual" o que ya vio su
recorrido no se repite aquí.

La tarifa de la clase de siempre se busca en el tramo que el importe
identificó o, si el importe no es de ningún tramo, en todos los de la caseta.
Si todos los cruces tienen tarifa y ninguno costó más, no hay hallazgo.

**Solo hacia arriba.** Con las cinco primeras facturas, hacia abajo era casi todo
ruido: Sta. Ma. del Oro cobra clase 4-5 a un tráiler que paga 9 en todas partes
(unos 50 cruces). Eso es cobrar de menos, y PASE lo corrige con un ajuste que
se liga solo. Hacia arriba quedaban San Blas (clase 9 a un camión de clase 3,
en cuatro facturas; resultó que cobra lo de 3 ejes, ver la 075) y Plan de
Barrancas cobrando clase 9 el día que el mismo tag pagó 5 en Arenal.

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
| `GET /tarifas-casetas/{caseta}/cruces?clase=&total=` | admin, editor, lector | Los cruces cobrados con esa clase e importe, con su factura y contra la tarifa de su fecha |
| `PUT /tarifas-casetas/{id}` | **admin** | Corrige una vigencia (precios o fecha) |
| `POST /tarifas-casetas` | **admin** | Registra un aumento: vigencia nueva de un tramo |
| `POST /tramos-casetas` | **admin** | Agrega un tramo a una caseta, con su primera tarifa |
| `GET /tramos-casetas` | admin, editor, lector | Todos los tramos, con las casetas que los cobran |
| `POST /casetas-tramos` | **admin** | Liga un tramo que ya existe a una caseta |
| `PUT /casetas-pase/{caseta}` | **admin** | Marca que la caseta no manda la clase real |
| `GET /tags-casetas` | admin, editor, lector | Los tags, los sin unidad primero |
| `GET /tags-casetas/{tag}/historial?caseta=` | admin, editor, lector | Todo lo que el tag pagó en esa caseta, por factura y por importe, con lo que pagaron los demás |
| `POST /tags-casetas` | admin, editor | Registra un tag antes de que cruce |
| `PUT /tags-casetas/{id}` | admin, editor | Cambia la unidad del tag |

Los hallazgos se calculan al pedir el detalle, no se guardan: dependen de la
historia de cada tag, que cambia con cada factura nueva.

## En el tablero

Las casetas son gasto y entran como tal: en el **Costo total** del Resumen, en
**Salida de caja**, en la gráfica mensual y en el costo por kilómetro de cada
unidad (`costosRepo.findCasetasEnRango`). Van por la **fecha del cruce**, igual
que una recarga va por el día que se cargó. Como PASE factura cada diez días,
el final de cualquier periodo casi siempre está incompleto: la API devuelve
`casetas_hasta` (el último cruce facturado) y la pantalla lo dice cuando no
llega al fin del periodo. Los cruces de un tag sin unidad entran a la caja pero
no al costo por kilómetro: no se sabe de quién son.

En **Costos y ahorro**, *Lo que PASE pudo cobrar de más* suma los hallazgos de
cobro de las facturas cuyo periodo termina dentro de la ventana
(`GET /dashboard/cobros-casetas?dias=`). Se recalculan con el mismo `detalle`
de la pantalla de la factura y se suman igual que ella. **No se suman al ahorro
identificado**: aquel se logra cambiando de proveedor; esto se le reclama a PASE.

En **Pendientes** salen las facturas sin revisar y los tags sin unidad.

## La pantalla

`src/src/pages/FacturasCasetas.tsx`, bajo **Facturas → Casetas**, con tres
pestañas: **Facturas** (la bandeja, con el importador), **Tags** y **Tarifas**.
En Tarifas, cada caseta con tarifa muestra sus tramos con la tarifa de hoy
(marcadas las que PASE sí ha cobrado) y, debajo, lo cobrado agrupado por clase e
importe con el tramo que le corresponde o "Fuera de tarifa". Al final, las
casetas sin tarifa ordenadas por lo que han costado: son las que conviene
cargar.

**Rastrear un fuera de tarifa.** Arriba, cuántos cruces están fuera de tarifa
y en cuántas casetas, con un switch para dejar solo esas. Cada importe fuera
de tarifa dice lo más parecido **en su clase** y **en cualquier clase** (la
clase de PASE no siempre es la real), y el botón **Rastrear** lista los cruces
cobrados así: factura y partida (se abre encima sin cerrar la lista), fecha,
unidad, carril y si cuadra **con la tarifa de su fecha**, porque la pestaña
compara contra la de hoy y un aumento puede hacer ver fuera lo que en su día
cuadraba. Trae un botón para buscar las tarifas de la caseta en internet: lo
que se encuentre se corrige o se registra como aumento.

**El historial del tag en la caseta** es la evidencia para PASE: no "confía",
sino sus propias facturas. Se abre con "Historial" en el rastreo y con
"Historial del tag en esta caseta" en cada hallazgo. Arriba, cada importe que
el tag pagó ahí, cuántas veces, entre qué fechas y **cuántos cruces de otros
tags** pagaron lo mismo: si todos pasan a un importe nuevo desde una fecha fue
un aumento; si solo este tag lo pagó, una vez, es un cobro que PASE tiene que
explicar. Abajo, cruce por cruce con folio, partida y cuánto cambió contra la
vez anterior, con el cruce reclamado resaltado. Se exporta a PDF
(`src/src/lib/exportHistorialCaseta.ts`) para mandarlo.

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
revisar— y cuatro pestañas: hallazgos, por unidad, recorridos y los cruces.
