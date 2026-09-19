# La revisión de facturas

Quien captura una compra no es quien la verifica. Después de que los lotes están
en el sistema, alguien más se sienta con el fajo de facturas originales y las
cuadra contra la pantalla.

Eso no es "editar una compra". Es un segundo par de ojos, y el sistema tiene que
poder contestar tres preguntas:

1. **¿Qué falta por revisar?** — el trabajo pendiente del verificador.
2. **¿Quién se equivocó?** — no para castigar: para saber a quién hay que
   enseñarle a capturar.
3. **¿Cuánto dinero se equivocó?** — un costo mal tecleado no es lo mismo que
   una cantidad mal tecleada, y la única forma de compararlos es en pesos.

Ver `db/migrations/040_revision_de_facturas.sql`.

## El cuadre: dos listas, no una

Se transcribe lo que dice el papel —renglón por renglón, eligiendo la refacción
del catálogo— y el sistema lo compara contra los lotes capturados:

```
facturas              folio, proveedor, fecha, IVA, descuento
  facturas_renglones  lo que dice el PAPEL      →  lote_id
  lotes_pieza         lo que está CAPTURADO
```

Con las dos listas, las tres preguntas se contestan solas:

| | qué significa |
|---|---|
| **renglón del papel sin lote** | nadie capturó esa compra |
| **lote sin renglón del papel** | se capturó algo que el papel no trae |
| **los dos, con valores distintos** | error de captura, y se sabe de cuánto |

La tercera ya se detectaba antes; las dos primeras no. Hubo un intento
intermedio —guardar el total impreso y comprobar que cuadrara, migración 043—
pero eso decía que faltaba dinero sin decir **qué** faltaba. Era un parche, y la
044 lo retira.

**La refacción se elige del catálogo, no se teclea.** En las facturas de
gasolina los renglones se casan por litros porque ese número identifica la
carga; aquí no hay uno así, y casar por parecido entre descripciones se equivoca
en silencio. Si el papel trae una pieza que no existe, se da de alta ahí mismo —
igual que en el alta de compra.

**El emparejado va en dos pasadas**: primero los que coinciden en pieza, cantidad
y costo (esos no son inferencia, son el mismo renglón), después por pieza a
secas. Sin la primera pasada, una factura con la misma refacción en dos renglones
a distinto precio cruzaría los dos y reportaría dos errores donde no hay ninguno.

## Resolver, no solo señalar

Cada diferencia trae su acción al lado:

- **falta capturar** → *Registrar la compra*. El renglón ya sabe qué refacción,
  cuántas y a qué costo; lo único que el papel no dice es dónde entró la
  mercancía, así que solo pide la sucursal.
- **sobra capturado** → *Quitar lo capturado*, con las mismas comprobaciones de
  siempre. Si sí se compró pero es de otra factura, se le cambia el folio.
- **valores** → se corrigen al cerrar, aplicando lo que dice el papel.

Cerrar con cosas sin resolver es legítimo —el papel puede tardar en aclararse—
pero exige confirmarlo (409 `CUADRE_INCOMPLETO`), y **lo que queda pendiente se
registra igual** en `correcciones_revision` con `campo` = `renglon_faltante` o
`renglon_sobrante`. Perderlo porque alguien cerró la factura sería quedarse sin
la respuesta.

Al cerrar se sella todo de una vez: cabecera y todos los renglones. El cuadre es
de la factura completa, no de un renglón suelto.

## Cómo se le pone precio a un error

Es lo único no evidente de todo esto. La respuesta ingenua —"puso 1,200 en vez de
1,250, son 50 pesos"— está mal en cuanto la factura trae descuento o IVA: esos 50
de lista son 52.20 de los que de verdad se pagaron.

El importe de una corrección es **siempre la diferencia en el total de la
factura**, calculada con la cadena de `api/src/shared/totales.ts`:

```
subtotal  → descuento → base → IVA → total
```

Cuando cambian dos cosas a la vez —la cantidad *y* el costo del mismo renglón—
se aplican **en cadena**: primero la cantidad sobre el costo viejo, después el
costo sobre la cantidad ya corregida. Cada corrección se queda con lo que ella
sola movió y la suma da exactamente el cambio total. Medidas por separado se
solapan y suman de más.

El signo dice de qué lado estuvo el error:

- **positivo** → se había registrado de menos de lo que dice el papel.
- **negativo** → se había registrado de más.

Por eso el reporte devuelve dos sumas y no una. El **neto** cancela un +500 con
un −500, y eso es correcto para saber cuánto se desvió el gasto del año. El
**absoluto** dice que esos mismos dos errores son 1,000 pesos que pasaron por
manos equivocadas, que es lo que mide qué tan bien captura una persona.

## Quién se equivocó

`facturas.autorizado_por` ya guardaba quién registró la compra, sacado de la
sesión. Pero es de la factura, y `facturasRepo.findOrCreate` reusa la que ya
existe sin pisarla: el mismo papel capturado en dos tandas por dos personas
quedaría entero a nombre de la primera.

Por eso la 040 agrega **`lotes_pieza.capturado_por`**, que se escribe en los tres
caminos de alta (`comprasRepo`, `lotesRepo.create`, `historicoRepo`). El backfill
sale de la bitácora (`registros_cambios`, acción `CREAR`), que es exacta hasta
donde alcanza, y cae a `autorizado_por` donde no.

Las correcciones de cabecera se le cargan a `autorizado_por`, que es lo más cerca
que se puede estar de quien tecleó algo que no pertenece a ningún renglón.

`correcciones_revision.capturado_por` **se copia, no se referencia**: si mañana
alguien corrige el lote o se fusiona la factura, esa fila tiene que seguir
diciendo lo que era verdad el día de la revisión.

## Qué se bloquea y qué no

Un renglón sellado ya no se edita; una cabecera sellada tampoco. El candado vive
en `api/src/shared/revision.ts` y se aplica en los **endpoints**, no en los
services — la revisión misma pasa por los services para aplicar sus correcciones,
y con el candado ahí el verificador no podría corregir nada.

**El candado es de la captura, no del almacén.** Esto es lo que más fácil se
rompe: lo que se bloquea es lo que dice el papel. Las existencias, los montajes,
los consumos, los traspasos y los descuadres siguen moviéndose igual sobre un
lote sellado. Una pieza revisada se sigue montando en un camión; congelar el
papel no puede congelar el estante.

| Operación | ¿Bloqueada? |
|---|---|
| `PUT /lotes/{id}` con costo o cantidad | sí, si el renglón está sellado |
| `PUT /lotes/{id}` con proveedor, fecha, IVA, folio | sí, si la **cabecera** está sellada |
| `PUT /facturas/totales`, `PUT /facturas/folio` | sí, si la cabecera está sellada |
| Fusionar dos facturas | sí, si **cualquiera** de las dos está sellada |
| Mover un renglón a una factura sellada | **no** — ver abajo |
| Agregar un renglón a una factura cerrada | **no** — ver abajo |
| Montar, consumir, traspasar, descuadrar | **nunca** |

Las dos excepciones son deliberadas: el renglón llega **sin sellar**, así que la
factura deja de estar cerrada y vuelve sola a la bandeja. El cambio se ve y
alguien lo revisa. Es justo lo que tiene que pasar cuando el verificador
encuentra en el papel una pieza que nadie capturó. Fusionar, en cambio, borra la
factura de origen y con ella su identidad, y de eso no se vuelve igual de fácil.

## Reabrir

`POST /facturas/{id}/reabrir` quita los sellos de la factura entera. Sin esto el
candado no tendría marcha atrás: una factura sellada no la puede corregir nadie,
ni un admin, y un error descubierto después quedaría congelado para siempre.

**No borra las correcciones ya registradas.** Lo que se corrigió la primera vez
pasó, y si reabrir las borrara sería la forma de hacer desaparecer el rastro de
un error.

## El renglón que sobra

Cuando el papel no trae una pieza que sí está capturada,
`POST /lotes/{id}/quitar` la borra. Borra de verdad, y está bien que lo haga: no
es historia, es un renglón que nunca debió existir. `docs/sin-delete.md` distingue
justamente eso — las entidades se archivan, lo capturado por error se quita.

Antes comprueba que de verdad nunca existió. El 409 nombra qué lo detiene:

- piezas montadas en un vehículo (`piezas_vehiculo`, `instalaciones_pieza`)
- consumos en mantenimientos (`detalle_mtto_pieza`)
- unidades dadas de alta (`unidades_pieza`)
- traspasos entre sucursales (`traspasos_pieza`)
- descuadres de inventario (`descuadres`)
- correcciones de revisión ya registradas
- existencia que ya no coincide con lo capturado

**El caso parecido que no es este:** que el renglón sí se haya comprado pero
pertenezca a otra factura. Eso se mueve con `PUT /lotes/{id}` poniéndole el folio
correcto, **no se borra**. Es el error que más caro sale confundir, así que el
mensaje del 409 lo recuerda.

Quitar el último renglón deja la cabecera vacía, y una factura sin renglones no
es nada: se borra también, salvo que ya tenga correcciones registradas.

## Endpoints

| Ruta | Rol | Qué hace |
|---|---|---|
| `GET /facturas?por_revisar=1` | admin, editor, viewer | La bandeja de lo pendiente |
| `GET /facturas/{id}/cuadre` | admin, editor, viewer | Las dos listas y sus diferencias |
| `PUT /facturas/{id}/renglones` | **admin** | Guarda la transcripción del papel |
| `POST /facturas/renglones/{id}/registrar` | **admin** | Da de alta la compra que falta |
| `POST /facturas/{id}/cuadrar` | **admin** | Aplica el papel y sella la factura |
| `POST /facturas/{id}/revisar` | **admin** | Cuadra la cabecera (folio, fecha, IVA, descuento) |
| `POST /facturas/{id}/reabrir` | **admin** | Quita los sellos |
| `POST /lotes/{id}/quitar` | **admin** | Borra el renglón que no está en el papel |
| `GET /facturas/{id}/correcciones` | admin, editor | Qué se le corrigió a esta factura |
| `GET /revision/errores` | **admin** | Cuánto lleva equivocado cada quien |
| `GET /revision/correcciones` | **admin** | El detalle detrás de ese acumulado |

`/api/revision/*` además está cerrado a admin en el borde
(`staticwebapp.config.json`), igual que la bitácora: las funciones ya lo imponen
con `requireRole`, pero esa segunda capa sigue en pie aunque mañana alguien
agregue una ruta descuidada bajo ese prefijo. Las demás acciones de revisión
viven bajo `/api/lotes` y `/api/facturas` y se quedan solo con `requireRole`,
como el resto de las acciones de admin.

Revisar es solo admin: es el segundo par de ojos, y que lo haga cualquiera con
permiso de captura lo vacía de sentido. `/facturas/{id}/correcciones` se abre a
editor a propósito — quien capturó tiene que poder ver en qué se equivocó, que es
el único punto de registrarlo. Lo que queda reservado es el acumulado por
persona.

`PUT /facturas/{id}/renglones` recibe el papel **completo**, no lo que se
agrega: la pantalla manda la transcripción entera y el servidor reemplaza.

## La pantalla

`src/src/pages/ErroresCaptura.tsx`, bajo **Administración → Errores de captura**,
junto a la bitácora y por la misma razón: enseña el desempeño de personas con
nombre y apellido.

Cuatro tarjetas arriba (dinero mal capturado, desviación neta, correcciones,
personas), la tabla por persona ordenada por importe absoluto, y debajo el
detalle. Tocar una persona filtra el detalle a lo suyo — es la pregunta que
sigue siempre a ver el acumulado.

El signo del importe se explica al pasar el cursor en vez de dejarlo al lector:
**+** es que se había registrado de menos que el papel, **−** de más.

## Lo que quedó fuera

- **El proveedor no se corrige en la revisión.** Cambiarlo mueve la factura a
  otro proveedor entero y la llave `(proveedor, folio)` haría que dejara de ser
  la misma compra. Es una operación aparte.
- **La transcripción puede arrancar copiando lo capturado** (*Copiar lo
  capturado*). Permite dar por bueno sin leer el papel, pero teclear quince
  renglones desde cero acaba en que nadie revisa. Es un acto explícito, no un
  prellenado: la tabla nace vacía.
- **Las facturas selladas antes de la 044** no tienen transcripción del papel:
  su revisión sigue valiendo, pero no se comparó contra dos listas. Para
  aplicarles el cuadre hay que reabrirlas.
- **Nada se marcó como revisado al migrar.** Nadie ha verificado ninguna factura
  existente contra su papel; marcarlas sería escribir algo que no pasó. La
  bandeja nace llena, y eso no es un efecto secundario: es el trabajo que existía
  antes de que hubiera dónde anotarlo.
