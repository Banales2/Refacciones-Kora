# Facturas de taller

El taller cobra por el trabajo. Eso ya se capturaba —`mantenimiento.costo`, "costo
de mano de obra" en la pantalla del servicio— pero nada comprobaba que ese número
fuera el que dice el papel.

**Esto rastrea mano de obra y nada más.** Si el taller también cobra refacciones,
esas van por la factura de refacciones: son mercancía que entra al almacén, con
lote, existencia y sucursal, y la mano de obra no es nada de eso.

Ver `db/migrations/046_facturas_de_mantenimiento.sql`.

## No hay una tabla de facturas de mantenimiento

Es lo primero que hay que saber para no buscarla, y es toda la decisión de
diseño.

El taller cobra las piezas y el trabajo **en el mismo papel**. Ese papel tiene un
folio, una fecha, un IVA y un descuento. Si la mano de obra tuviera su propia
cabecera, el mismo folio quedaría partido en dos filas con la tasa capturada dos
veces, y "cuánto cobra este documento" dejaría de tener una respuesta —
exactamente la enfermedad que curó la migración 026, entrando otra vez por la
puerta de al lado.

Así que `facturas` es **el papel**, y pasa a tener dos clases de hijo:

```
facturas                 folio, proveedor, fecha, IVA, descuento
  lotes_pieza            las refacciones CAPTURADAS
  facturas_renglones     las refacciones del PAPEL          (044)
  facturas_mano_obra     la mano de obra del PAPEL  → mantenimiento
  (mantenimiento.costo)  la mano de obra CAPTURADA
```

Una factura de puro taller es una `facturas` sin lotes. Una mixta es la misma
fila, con las dos clases de renglón, y **sale en las dos pantallas** — porque es
un solo documento que cobra las dos cosas. Las entradas "Refacciones" y
"Mantenimientos" del menú son dos vistas del mismo listado, filtradas por lo que
cada factura cobra.

De ahí también que el cuadre sea uno: mismo modal, dos transcripciones y dos
listas de diferencias, un solo total y un solo sello.

## Sigue el modelo de gasolina, no el de refacciones

Un mantenimiento existe **independientemente de que el taller haya emitido su
papel**: se captura cuando el camión vuelve del taller, igual que una recarga
existe sin factura. Un lote, en cambio, no existe hasta que alguien captura la
compra.

Esa diferencia da dos cosas que en refacciones no se pueden tener:

| | aquí | en refacciones |
|---|---|---|
| **El servicio sin facturar** | se detecta solo: los que ningún renglón reclama | la factura entera que nadie capturó es invisible, y hubo que inventarle un botón (045) |
| **El emparejado** | el renglón se cuelga de un servicio que una persona elige | hay que inferirlo por pieza, cantidad y costo |

**No se propone nada por importe**, ni siquiera "el más cercano". Dos servicios
del mismo taller pueden costar lo mismo sin ser el mismo trabajo, y un
emparejamiento inventado que nadie revisa es peor que ninguno. Es la misma
decisión que en gasolina, donde solo se propone por litros exactos: ahí el número
identifica la carga, aquí no hay uno así. Lo elige una persona viendo la unidad y
la fecha, que es lo que el papel también trae.

## Los candidatos

> Los mantenimientos **de su taller**, con fecha **menor o igual** a la de la
> factura, que **ningún renglón de ninguna otra factura** haya reclamado.

Las tres condiciones son la misma idea que en gasolina: el taller no cobra
trabajos de otro taller, no cobra por adelantado, y un servicio ya facturado no
se vuelve a ofrecer. La tercera excluye los de **otras** facturas, no los de
esta: los suyos tienen que seguir apareciendo para poder cambiarlos.

**Dos facturas no pueden cobrar el mismo servicio.** Lo impone un UNIQUE filtrado
sobre `facturas_mano_obra.mantenimiento_id`, no el código: comprobarlo en el
service dejaría pasar dos capturas simultáneas. El 409
`MANTENIMIENTO_YA_FACTURADO` es la traducción de ese choque.

## El taller factura como proveedor, y eso no se ve

Quien hace el trabajo vive en `tecnicos` (nombre, ubicación, contacto) y quien
emite facturas vive en `proveedores`. Son dos catálogos, y la llave de la factura
es `(proveedor_id, folio)` — tiene que serlo, porque el mismo papel puede cobrar
refacciones y esas ya viven ahí.

Pedirle al usuario que dé de alta su taller otra vez como proveedor sería
cobrarle el precio de una decisión del modelo. Así que el puente se guarda
—`tecnicos.proveedor_id`— y **la pantalla sigue diciendo "taller"**. El proveedor
se crea solo la primera vez que ese taller factura.

**El vínculo se guarda, no se vuelve a adivinar.** Una vez escrito, si mañana
alguien le cambia el nombre al taller o al proveedor, las facturas viejas siguen
siendo suyas.

La primera vez sí mira el nombre, y conviene decir por qué se admite aquí lo que
en el cuadre se rechaza: es una coincidencia **exacta**, no un parecido, y su
resultado queda guardado y a la vista. Si el taller ya estaba dado de alta como
proveedor —lo normal cuando a ese mismo taller ya se le compraron refacciones—,
reusarlo es lo correcto y crear un duplicado sería el error. Lo que no se hace
nunca es casar por aproximación.

Un proveedor no puede ser el reflejo de dos talleres: si lo fuera, las facturas de
los dos caerían bajo la misma llave y dos papeles con el mismo folio se volverían
uno solo. Lo impone `UQ_tecnicos_proveedor`.

## Las diferencias

Solo dos, y falta una a propósito:

| | qué significa |
|---|---|
| **sin registrar** | el papel cobra un trabajo y ningún mantenimiento capturado lo explica: o nadie registró el servicio, o el taller cobra algo que no hizo |
| **valores** | el servicio está registrado con un costo distinto del que cobra el papel |

**No hay "sobra capturado", y no es un olvido.** En refacciones un lote pertenece
a la factura, así que uno que el papel no traiga sobra. Un mantenimiento no
pertenece a ninguna factura hasta que un renglón lo reclama: uno que esta factura
no cobre no sobra — todavía no está facturado, o lo cobra otro papel. Esa pregunta
es de la flota entera y no de una factura suelta, y la contesta la pestaña de
servicios sin factura.

### Resolver

- **valores** → se corrige al cerrar, aplicando lo que dice el papel.
- **sin registrar** → no trae botón, al contrario que su equivalente en
  refacciones. Registrar un mantenimiento pide vehículo, fecha, kilometraje y qué
  incidencias cerró: es la captura de un servicio entero, no rellenar un campo, y
  se hace en el expediente de la unidad, donde están los datos.

Cerrar con cosas sin resolver es legítimo pero exige confirmarlo (409
`CUADRE_INCOMPLETO`, el mismo que las refacciones), y **lo que queda pendiente se
registra igual** con `campo` = `mano_obra_sin_registrar`.

## El papel gana

Al cuadrar, el importe del papel **pisa a `mantenimiento.costo`**.

No es una preferencia: `mantenimiento.costo` es de donde sale el gasto en todos
los reportes —el dashboard, el costo por kilómetro, el análisis de fugas, el
reporte de flota—. Dejarlo como se capturó y guardar el importe real solo en el
renglón crearía dos verdades y obligaría a cada reporte a elegir una. Lo que se
corrigió queda en `correcciones_revision`, que es donde vive la historia.

Y por lo mismo, **ninguna de estas facturas agrega gasto**: lo que hacen es
corregir el que ya se contaba. No hay doble conteo que evitar porque no hay un
segundo número.

### Cuánto vale un error de mano de obra

Igual que en refacciones: la diferencia en el **total** de la factura, pasando por
`api/src/shared/totales.ts`. Un costo de mano de obra tecleado 50 pesos por
debajo en una factura con descuento e IVA no costó 50 pesos.

No hay cadena que repartir, porque es un solo campo: la corrección se queda con
la diferencia entera.

El IVA y el descuento de la cabecera se miden contra el subtotal **del papel
completo**, refacciones más mano de obra. En una factura mixta, corregir la tasa
mueve el total de todo lo que cobra; medirlo solo sobre los lotes le pondría al
error un precio más bajo del que tuvo.

## Quién se equivocó

`mantenimiento.capturado_por` es el gemelo de `lotes_pieza.capturado_por`
(migración 040) y existe por lo mismo: cuando la factura descubre que la mano de
obra estaba mal tecleada, hay que poder contestar a quién hay que enseñarle a
capturar.

El backfill sale de la bitácora (`registros_cambios`, acción `CREAR`, tabla
`mantenimiento`), que es exacta hasta donde alcanza. Lo anterior a la bitácora se
queda en NULL y sale como "Sin identificar", que es la verdad.

`correcciones_revision` necesitó una columna nueva, `mantenimiento_id`: meter la
mano de obra con `lote_id` en NULL la habría confundido con las correcciones de
cabecera —folio, fecha, IVA— que es de lo único que ese NULL se distinguía.

## El sello

Va en el **mantenimiento** (`revisado_en`, `revisado_por`), no en el renglón del
papel. Por lo mismo que en refacciones va en el lote y no en
`facturas_renglones`: lo que se da por bueno es lo capturado, y el renglón del
papel se reemplaza entero en cada guardado, así que un sello ahí se borraría solo.

Al cuadrar se sella todo de una vez: cabecera, lotes y mantenimientos. Reabrir los
quita todos — si los sellos se quitaran a medias, la factura quedaría reabierta
con la mitad congelada y el cuadre no podría volver a aplicarse entero.

**`cerrada` cuenta las dos mitades**: cabecera sellada, ningún renglón de
refacción pendiente y ningún servicio pendiente. Es derivado y se calcula en
`facturasRepo.findAll`, no se guarda.

Los renglones **sin casar no cuentan** para ese cálculo, igual que `renglones`
cuenta lotes y no líneas del papel: un cobro que ningún mantenimiento explica no
tiene dónde llevar sello, y contarlo dejaría la factura eternamente en la bandeja
aunque ya se hubiera cerrado a sabiendas. El hallazgo queda en
`correcciones_revision`, que es donde no se pierde.

## El candado

Es el más estrecho de los tres, y tiene que serlo. Lo único que la factura del
taller da por bueno es `mantenimiento.costo`:

| Operación sobre un mantenimiento sellado | ¿Bloqueada? |
|---|---|
| `PUT /mantenimientos/{id}` cambiando `costo` | sí (409 `MANO_OBRA_REVISADA`) |
| Cambiar fecha, kilometraje, tipo, técnico, observaciones | **no** |
| Agregar o quitar piezas consumidas | **no** |
| Cerrar incidencias, cerrar una columna del programa | **no** |

Es el mismo principio que en refacciones: **se congela lo que dice el papel, no
el expediente del camión.** Ninguna de esas otras cosas sale de ninguna factura.

## Endpoints

| Ruta | Rol | Qué hace |
|---|---|---|
| `GET /facturas?con_mano_obra=1` | admin, editor, viewer | Las facturas que cobran trabajo |
| `POST /facturas/taller` | **admin** | Da de alta la cabecera, resolviendo el proveedor del taller |
| `GET /facturas/{id}/mano-obra/candidatos` | admin, editor, viewer | Los servicios que podría estar cobrando, y de qué taller es |
| `PUT /facturas/{id}/mano-obra` | **admin** | Guarda la transcripción de la mano de obra |
| `GET /mantenimientos/sin-facturar` | admin, editor, viewer | Los servicios que ninguna factura reclama |

El cuadre, el sello y la reapertura son los de siempre —`GET /facturas/{id}/cuadre`,
`POST /facturas/{id}/cuadrar`, `POST /facturas/{id}/reabrir`— porque la factura es
la misma. Ese es el punto.

`POST /facturas/taller` devuelve la factura que ya existía con `ya_existia` en
true en vez de fallar cuando el taller ya tiene ese folio: el caso normal del
papel mixto es que sus refacciones ya se hayan capturado como compra, y entonces
lo que falta es colgarle la mano de obra, no abrir un segundo documento.

## La pantalla

`src/src/pages/FacturasMantenimientos.tsx`, bajo **Facturas → Mantenimientos**,
con dos pestañas:

- **Facturas** — las que cobran trabajo, con su mano de obra y el total del
  papel. Las mixtas llevan "+ refacciones" debajo del total, para que no se lea
  como si todo fuera mano de obra.
- **Servicios sin factura** — el reverso, con los días que cada uno lleva
  esperando. Los de más de 30 días se marcan; no es una regla del negocio, es una
  señal, y es el mismo número que en gasolina.

El cuadre es `CuadreFacturaModal`, el mismo de refacciones, con la mitad de mano
de obra (`CuadreManoObra.tsx`) apareciendo solo cuando la factura es de un taller.

## Lo que quedó fuera

- **El papel no se desglosa por concepto.** Puede traer "diagnóstico",
  "desmontaje" y "mano de obra" en tres líneas; se captura un importe por
  servicio. El sistema solo tiene un número con que compararlo
  —`mantenimiento.costo`— y transcribir tres líneas que se suman para cuadrar
  contra uno solo es trabajo de captura que no contesta ninguna pregunta nueva.
- **La transcripción puede arrancar copiando lo registrado** (*Copiar lo
  registrado*), con la misma concesión y por la misma razón que en refacciones:
  permite dar por bueno sin leer el papel, pero teclear todo desde cero acaba en
  que nadie revisa.
- **Los mantenimientos anteriores a esta migración nacen sin sello.** Ninguno se
  marcó como revisado: nadie ha verificado su mano de obra contra ningún papel, y
  marcarlos sería escribir algo que no pasó. La bandeja nace llena, y eso es el
  trabajo que existía antes de que hubiera dónde anotarlo.
- **Los de costo cero no entran a la bandeja de sin facturar.** No hay nada que
  facturar, y llenarla de servicios que nadie va a cobrar es la forma más rápida
  de que deje de mirarse.
