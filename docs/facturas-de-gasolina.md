# Facturas de gasolinera

La gasolinera no factura carga por carga: manda una factura que cubre varias,
desglosada en renglones. Lo que **no** trae cada renglón es a qué vehículo fue,
qué chofer la hizo ni contra qué vale — eso solo lo sabe el sistema.

**Esto no guarda la factura.** El documento se archiva por otro lado; aquí vive
lo necesario para comprobar que el gasto está bien capturado, y nada más:

```
facturas_gasolina          folio, gasolinera, fecha, IVA del papel, uuid
  ..._renglones            descripción, cantidad, importe, IVA, despacho  →  recarga
gasolineras                permiso de la CRE  ← con él se reconocen sus facturas
```

Ver `db/migrations/041_facturas_de_gasolina.sql`, y la **042** si se llegó a
correr una versión anterior de la 041: las migraciones de este repo crean la
tabla solo `IF OBJECT_ID(...) IS NULL`, así que volver a correr una 041 corregida
no cambia una tabla que ya existe — se salta el `CREATE` y la deja como estaba.
Un cambio de forma siempre necesita su propio número.

## Sigue el modelo de las facturas de refacciones

Como en la migración 026, la cabecera lleva la llave de negocio
`UNIQUE (gasolinera_id, folio)`: la misma gasolinera no emite dos veces el mismo
folio, pero dos gasolineras sí pueden tener cada una su "44272".

El subtotal sale de sumar los renglones. **El IVA se guarda como lo imprime el
papel**, y el total es `subtotal + IVA` (migración 065). La API lo calcula y lo
devuelve; la pantalla no hace cuentas.

### Por qué el IVA y no la tasa

Hasta la 065 se guardaba solo la tasa y el total salía de `subtotal × 1.16`. En
combustible eso da de más: el precio incluye IEPS, y **el IVA no se cobra sobre
el IEPS**, así que la base del IVA es menor que el importe. Con cuatro facturas
reales de octubre de 2026:

| | papel | subtotal × 1.16 | de más |
|---|---|---|---|
| Dakota G-4969 | $47,402.36 | $47,542.16 | $139.80 |
| Flogas CF-171482 | $28,810.93 | $28,893.05 | $82.12 |
| Vázquez G-44703 | $16,284.89 | $16,333.15 | $48.26 |
| Bagaleza BGC-17491 | $16,199.67 | $16,246.81 | $47.14 |

Tampoco sirve una "tasa efectiva": el IEPS es una cuota por litro que cambia con
el producto y con la semana. El único número correcto es el del papel.

La 042 había hecho justo lo contrario —convirtió el IVA guardado en tasa— y de
ahí venía el error.

Las facturas capturadas antes de la 065 conservan su tasa y su total sale de
ella, **marcado como estimado**. Al abrirlas, el cuadre pide el IVA del papel
(`PUT /facturas-gasolina/{id}/iva`); con él, el total pasa a ser el correcto. No
se rellenó nada al migrar: `subtotal × 0.16` sería guardar el mismo error con
otro nombre.

## Se empareja por cantidad, no por importe

Es lo único no evidente:

- El **importe del renglón suele venir sin IVA**.
- **`recargas_combustible.costo` es lo que se pagó en la bomba**, que sí lo
  incluye.

Compararlos da 16% de diferencia **siempre**. Los litros, en cambio, son el mismo
número de los dos lados —el IVA no cambia cuánto se despachó— y con tres
decimales prácticamente no se repiten: 219.37, 27.23, 335.65, 364.35, 57.91,
247.26.

Por eso **no se propone nada por importe**, ni siquiera "el más cercano": casaría
cosas equivocadas con toda confianza. Lo que no case por cantidad exacta se queda
sin proponer y lo resuelve una persona — preferible a inventar un emparejamiento
que nadie va a revisar.

En empate —dos recargas con los mismos litros— gana la más reciente, que es la
que cae dentro del periodo que la factura cobra. Se puede cambiar a mano.

## Las candidatas

> Las de **su gasolinera**, con fecha **hasta 3 días después** de la de la
> factura, que **ningún renglón de ninguna otra factura** haya reclamado.

El corte por fecha no tiene límite inferior a propósito: una carga de hace tres
meses que nadie facturó sigue siendo candidata legítima, y poner una ventana la
escondería justo cuando aparece la factura atrasada que la cobra.

### Los días de gracia

La fecha de la recarga es la de **captura**, y no siempre la de la carga: la del
sábado se registra el lunes, la de un puente el martes. Con el corte exacto, esa
recarga ni aparecía como opción y su renglón salía como "carga que nadie
capturó" aunque sí se capturó. Por eso el corte admite `DIAS_DE_GRACIA` (3) días
después de la factura (`facturasGasolinaRepo.ts`).

Esos tickets se distinguen en el desplegable —"registrada 2 días después de la
factura"— y **en empate de litros pierden** contra uno registrado hasta la fecha
de la factura: pueden ser la carga del sábado, pero también una carga de después
que no le toca a esta factura. Si no hay otro con esos litros, se proponen.

El vínculo vive en el **renglón** (`facturas_gasolina_renglones.ticket_id`), no
en la recarga. Así "qué falta por facturar" y "qué renglón no tiene recarga" son
la misma consulta vista desde dos lados, y un índice único impide que dos
renglones se lleven el mismo ticket.

## Varios tickets por recarga

Los tráileres tienen más de un tanque y cada uno se despacha aparte: la bomba
imprime un ticket por tanque y la gasolinera cobra cada ticket en su propio
renglón, a veces en facturas distintas. Por eso una recarga trae de **1 a 3
tickets** (`recargas_combustible_tickets`, migración 059), cada uno con sus
litros y su costo. El vale sigue siendo uno: autoriza la carga completa.

- El renglón se casa con el **ticket**. También guarda la `recarga_id` del
  ticket, que es por donde se pregunta "qué factura cobra esta recarga"; una
  llave compuesta impide que las dos discrepen.
- La recarga conserva `litros` y `costo` como la **suma** de sus tickets, y la
  API la recalcula en la misma transacción. Costos, rendimientos y reportes leen
  esas columnas y no necesitan saber cuántos papeles eran.
- **Recargas sin factura** se lista por ticket: una recarga de tres tanques puede
  tener dos cobrados y uno pendiente.

## Las dos mitades de la pregunta

| | qué dice |
|---|---|
| **renglón sin recarga** | la gasolinera cobra algo que **no está capturado** |
| **recarga sin factura** | está capturado algo que la gasolinera **no ha cobrado** |

La primera es el hallazgo: alguien no registró una carga. La segunda casi nunca
es un problema —la factura llega después— pero una recarga de hace tres meses sin
facturar sí lo es, y por eso el listado trae los **días de espera** y resalta lo
que pasa de **30 días** (`DIAS_PARA_PREOCUPARSE`). El umbral no es una regla del
negocio, es una señal: por debajo la factura simplemente viene en camino.

Esas mismas recargas son las candidatas de la próxima factura de su gasolinera,
así que la lista se vacía sola conforme se concilia.

## El renglón sin recarga es el producto

No es un descuadre de dinero abstracto: es una carga concreta, con sus litros y
su importe, que la gasolinera está cobrando y que nadie registró.

Sellar con renglones sin casar es legítimo —la recarga puede capturarse la semana
que viene y entonces se reabre— pero exige `confirmar_sin_casar`, así que no pasa
por descuido. La API responde 409 `RENGLONES_SIN_CASAR` con cuántos son y cuánto
valen.

## El candado

Un ticket que ya entró en una factura **conciliada** no puede cambiar de `litros`
ni desaparecer, y su recarga no puede cambiar de `gasolinera_id`: el
emparejamiento se hizo con esos datos y dejaría de ser cierto sin que nadie se
entere. `PUT /recargas/{id}` responde 409 `RECARGA_CONCILIADA`.

La `fecha` **sí se puede corregir**, mientras no quede después de la fecha de la
factura más los días de gracia. Es justo el arreglo que tiene que poder hacerse
—la carga del sábado registrada el lunes— y dentro de ese margen la recarga
seguía siendo candidata, así que el cuadre sigue siendo cierto. Moverla más allá
sí pide reabrir la factura.

Los demás campos —chofer, vale, kilometraje, costo, y los tickets que ninguna
factura conciliada cobra— **sí se siguen corrigiendo**. Son datos de la
operación, no del cuadre. Quitar un ticket que casó con una factura **abierta**
suelta ese renglón, que vuelve a quedar sin casar.

## Reabrir

`POST /facturas-gasolina/{id}/reabrir` suelta el sello. Es lo que hace falta
cuando aparece la recarga que no estaba: se captura por la vía normal, se reabre y
ahora sí casa. Los emparejamientos **no** se deshacen, así que solo hay que
ajustar lo que faltaba.

## Importar el XML

Es el camino normal. Toda factura de combustible es un **CFDI 4.0 con el
complemento de Hidrocarburos**, sea de la gasolinera que sea, y lo que hace falta
sale de campos estándar del SAT (`src/src/lib/xmlGasolina.ts`):

| dato | de dónde |
|---|---|
| producto | `ClaveProdServ`: 15101505 Diesel, 15101514 Magna, 15101515 Premium |
| litros | `Cantidad` (se guarda a 3 decimales, como el ticket) |
| importe | `Importe` menos su `Descuento` |
| IVA | el `Traslado` 002 del concepto |
| estación | `NumeroPermiso` del complemento `HidroYPetro` |
| despacho | lo que va después del permiso en `NoIdentificacion` |

La descripción **no se usa**: cada gasolinera escribe lo suyo ("DIESEL 34006",
"DIESEL (Despacho 576356-0)", "DIESEL").

**La gasolinera se reconoce por el permiso de la estación** (migración 066), no
por el nombre ni por el RFC: una razón social puede tener varias estaciones. La
primera vez que llega una factura de un permiso desconocido, quien importa elige
de cuál gasolinera es y el permiso se le queda; de ahí en adelante se reconoce
sola. Si se ligó a la equivocada, se desliga desde Catálogos → Gasolineras.

Se pueden importar varios XML a la vez. Cada uno se enseña antes de guardar, y la
API rechaza **entera** la factura cuyos renglones no sumen el subtotal, el IVA o
el total impresos, la que ya se importó (409 `FACTURA_DUPLICADA`, por UUID) y la
que ya estaba capturada a mano con ese folio —con o sin serie—. También se
rechaza, para capturarla a mano, la que traiga algo que no sea combustible, un
impuesto que no sea IVA o cargas de dos estaciones.

Lo importado se concilia igual que lo capturado a mano.

## Capturar la factura a mano

Para la que no trae XML. El subtotal no se teclea: sale de los renglones. El IVA
sí, el que imprime el papel —no se puede calcular, por lo del IEPS—.

El botón **Agregar recarga** pone una fila en la tabla y ahí se llena, campo por
campo: producto, cantidad e importe, cada uno con su nombre. El producto hereda
el del renglón anterior porque en una factura de gasolinera casi todos dicen lo
mismo.

El **producto es una lista cerrada** —Diesel, Magna, Premium— en la pantalla y en
el schema. Texto libre solo produciría "DIESEL", "diesel" y "Diésel" como si
fueran cosas distintas, y entonces cualquier corte por producto miente. Los
renglones convertidos por la 042 pueden traer otra cosa; la columna lo sigue
admitiendo, la validación aplica a lo que entra de aquí en adelante.

Hubo una versión que leía la línea entera pegada del PDF y repartía los números
por posición. Se quitó: los formatos no se parecen entre emisores y un lector que
adivina **se equivoca en silencio**, que es la peor forma de equivocarse con
dinero. Pegar sigue funcionando — campo por campo, que es donde se ve lo que se
pegó.

## Endpoints

| Ruta | Rol | Qué hace |
|---|---|---|
| `GET /facturas-gasolina` | admin, editor, lector | Lista, con `?por_conciliar=1` |
| `POST /facturas-gasolina` | admin, editor | Alta a mano: cabecera y renglones |
| `POST /facturas-gasolina/importar` | admin, editor | Alta desde el XML |
| `PUT /facturas-gasolina/{id}/iva` | admin, editor | Pone el IVA del papel a una capturada con tasa |
| `GET /facturas-gasolina/{id}/candidatas` | admin, editor, lector | Renglones con su propuesta, y los tickets elegibles |
| `POST /facturas-gasolina/{id}/conciliar` | **admin** | Guarda los emparejamientos y sella |
| `POST /facturas-gasolina/{id}/reabrir` | **admin** | Suelta el sello |
| `GET /facturas-gasolina/sin-facturar` | admin, editor, lector | Los tickets que ninguna factura ha reclamado |

Conciliar es solo admin, igual que revisar una factura de refacciones: es el
segundo par de ojos sobre lo capturado.

`casados` es el conjunto **completo**, con los renglones sin casar incluidos y su
`ticket_id` en null: la pantalla manda la verdad entera y el servidor reemplaza.

## La pantalla

`src/src/pages/FacturasGasolina.tsx`, en **Operación → Facturas de gas**.

Dos pestañas: **Facturas** y **Recargas sin factura**.

La primera lista con estado (`Por conciliar`, `Cuadrada`, `N sin capturar`), y al
abrir una factura: tres tarjetas —total, renglones casados, importe sin capturar— y la
tabla de renglones con un desplegable de recargas por cada uno.

**También se ven desde el catálogo**: en Catálogos → Gasolineras, al abrir una
estación el cajón tiene dos pestañas. *Recargas* dice lo que la flota cargó ahí,
con el folio de la factura que cobra cada una o "Sin facturar"; *Facturas* dice
lo que la gasolinera cobró, con su estado. Juntas contestan la pregunta que de
verdad se hace: qué está facturado y qué no. Desde ahí no se concilia — eso vive
en la pantalla de arriba, que es donde está el cuadre completo.

## Lo que quedó fuera, a propósito

- **La factura completa.** Régimen, sello, precio unitario: nada de eso ayuda a
  contestar "¿a qué recarga corresponde este renglón?", y el documento ya se
  archiva por otro lado. El UUID sí se guarda, para no importar dos veces.
- **Casar por número de despacho.** El XML lo trae y ya se guarda en el renglón
  (`despacho`), pero el ticket de la recarga no lo captura, así que el cuadre
  sigue yendo por litros. Algunas gasolineras mandan los litros con seis
  decimales (90.451852); se redondean a tres. Si el ticket capturado dice otra
  cosa (90.45), el emparejado exacto no lo propone y hay que elegirlo a mano.
