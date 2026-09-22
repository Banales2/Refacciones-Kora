# El chequeo diario de la unidad

## Quién lo hace

Una persona aparte —una o dos— que recorre el patio de una sucursal unidad por
unidad. **No lo llena cada chofer con su camión.** De ahí salen casi todas las
decisiones de este documento: la pantalla principal es un recorrido y no una
ficha, el formulario está hecho para repetirse treinta veces seguidas, y cada
chequeo lleva dos nombres en vez de uno.

## Qué registra

Dos cosas distintas en un mismo registro:

- **La declaración** es lo que el *chofer* de esa unidad sabe: un ruido raro, un
  jalón, un golpe que sintió y no sabe dónde quedó. Quien recorre se lo pregunta
  antes de revisar y lo anota **a nombre del chofer**, no del suyo.
- **El checklist** es lo que se *ve*: llantas, golpes, luces, odómetro. Eso sí
  lo contesta quien recorre, con sus propios ojos.

La distinción no es cosmética. Una vuelta alrededor del camión no agarra un
rechinido al frenar, y eso es justo lo que más caro sale cuando no se dice.

## Por qué la declaración va primero y es obligatoria

Porque un cuadro de comentarios al final del formulario no lo llena nadie.

Va como dos campos y no como uno: un `BIT` (`hay_novedad`) y un texto
(`declaracion`) que solo existe cuando el bit está encendido. Si la declaración
fuera un `NVARCHAR NOT NULL` a secas, en dos semanas todos los renglones dirían
"ok", "bien", "." — y entonces no se podría distinguir *"no hay nada que
reportar"* de *"no me quise molestar"*, que es exactamente la diferencia que el
campo existe para capturar. Con el bit, "sin novedad" es una respuesta
deliberada y auditable. Es el mismo criterio de `'Marca Faltante'` en la
migración 036: el centinela explícito en vez del vacío ambiguo.

En el formulario, el checklist no se muestra hasta que la declaración está
contestada. Eso cuesta un toque más, y es el toque que se está pagando.

## Cuando no había chofer

A las seis de la mañana media flota está sola en el patio. Que no haya chofer no
impide revisar la unidad —las llantas, las luces y el odómetro se ven sin
ayuda—; lo único que se pierde es lo que solo él sabe.

Por eso el paso uno tiene **tres** respuestas y no dos:

| respuesta | `sin_chofer` | `hay_novedad` | significa |
|---|---|---|---|
| No reporta nada | 0 | 0 | se le preguntó y no había nada |
| Sí, algo pasó | 0 | 1 | reportó algo; `declaracion` lo dice |
| No había chofer | 1 | 0 | no hubo a quién preguntarle |

**"No estaba el chofer" no es "el chofer dijo que todo bien."** Es la misma
distinción que ya hace `'na'` contra no insertar el renglón. Si las dos
terminaran en `hay_novedad = 0`, la bandera que dice si el chofer habla sería
indistinguible de la que dice que nadie le preguntó — y sin la tercera opción,
quien recorre acabaría marcando "sin novedad" por alguien que no estaba, que es
inventar el único dato que este módulo existe para proteger.

Va como un bit aparte y no como un estado de tres (migración 039) porque
`hay_novedad` sigue significando lo que dice y de él cuelgan el índice filtrado
y la bandeja de pendientes. La cuarta combinación —declarar sin estar— la vuelve
imposible el `CHECK`, así que las dos columnas juntas solo admiten tres estados.
Un estado inválido que la base no deja escribir no es ambigüedad.

En la interfaz, la tercera opción va aparte y en gris, no junto a las otras dos:
es una respuesta legítima, pero ponerla al mismo nivel invitaría a usarla para
salir del paso rápido.

## Por qué la declaración NO abre una incidencia sola

Porque el chofer declara justamente porque no lo quiere ocultar.

Si declarar un golpe dispara al instante una incidencia grave con su nombre
encima, el tercer chofer ya aprendió a no declarar nada, y el campo se vuelve
adorno en un mes. Lo que se gana obligando a declarar se pierde castigando al
que declara.

Entonces una declaración con novedad queda **pendiente de revisión**. Quien
revisa decide: abrir la incidencia —y ahí queda `declaracion_pendiente_id`— o
cerrarla con una nota. Las dos salidas dejan constancia de quién la leyó y
cuándo, que es lo que evita el caso peor de todos: que quede el registro de que
alguien avisó y nadie hizo nada.

La bandeja de reportes sin leer **no filtra por fecha**. Un reporte del viernes
que nadie revisó sigue sin revisar el lunes; si la consulta preguntara solo por
hoy, la bandeja rotaría en vez de vaciarse y lo no atendido quedaría enterrado.

El checklist sí abre incidencias solo, sin revisión: ahí no hay nada que
interpretar —la luz prende o no prende— y el catálogo ya dice de antemano qué
severidad le toca a cada falla. La única excepción es `golpes`, donde se
pregunta: un rayón y un cuarto hundido no son lo mismo y se ven distinto.

## Las dos pestañas de la pantalla

"Chequeo de flotilla" tiene dos mitades del mismo día: **Recorrido**, que es
capturar, y **Reportes de hoy**, que es leer lo que salió. Son pestañas y no dos
secciones del menú porque las hace la misma persona con el mismo teléfono y una
detrás de la otra: al terminar el patio, lo siguiente es ver qué reportó la
gente. Mandarla a otro lado del menú para eso la pierde a medio camino.

La bandeja ordena por urgencia y no por hora: primero los reportes del chofer
que nadie ha leído —los únicos que esperan una decisión de una persona—, luego
las unidades con fallas, y hasta abajo las limpias, que por omisión ni se
muestran. Un orden cronológico se vería más natural y serviría menos: lo que hay
que atender quedaría repartido entre lo que no.

El panel de revisión (`RevisarReporteChequeo`) es el mismo que usa la ficha de
la unidad. Ahí se lee de una en una; aquí se vacía la bandeja del día sin entrar
a treinta fichas, que es la razón de que la pestaña exista.

## La pregunta y el pendiente son dos textos

`label` es lo que se le pregunta a quien revisa y es una pregunta literal:
"¿Los faros funcionan?", no "Faros funcionando". Con el teléfono en la mano y
treinta unidades por delante, un enunciado hay que traducirlo a sí o no en la
cabeza, y en uno redactado en negativo la traducción se invierte. El "sí" va
siempre del lado bueno, para que la respuesta buena sea la misma en todos.

`incidencia.nombre` es cómo se llama el pendiente que abre esa falla: "Faros
fundidos". Son textos distintos porque los leen personas distintas en momentos
distintos —uno lo lee quien revisa, el otro quien tiene que arreglarlo— y una
pregunta en la lista de pendientes no dice qué hay que hacer. Si el catálogo no
trae nombre, se cae al label, recortado a los 40 de la columna.

## Los niveles se capturan en cuartos, no con sí o no

Aceite de motor, aceite hidráulico, dirección, frenos, anticongelante y
limpiaparabrisas usan la misma escala que el combustible (1/4, 1/2, 3/4,
Lleno). "Está bien" no distingue un depósito lleno de uno a la mitad, y esa es
justo la diferencia entre una unidad que aguanta la semana y una que hay que
rellenar antes de que alguien se quede tirado.

A diferencia del combustible, estos sí abren incidencia: `umbralFalla` en el
catálogo dice en qué nivel un renglón cuenta como falla (hoy `1/4` en los seis).
Un tanque de gasolina en un cuarto solo quiere decir que hay que cargar; un
depósito de frenos en un cuarto es un pendiente.

**El resultado de una `fraccion` lo decide el servidor, no el formulario**
(`prepararItems`): si el nivel está en el umbral, el renglón es falla aunque el
teléfono mande `ok` —una PWA vieja no conoce el umbral— y no lo es aunque mande
`falla`. Lo único que el formulario decide es `na`, que es lo que el nivel no
puede decir: que no se pudo mirar. Por eso las fracciones también llevan su
botón de "Sin revisar".

## El comentario final

`chequeos.nota` existe desde la migración 038, pero hasta ahora el formulario no
la escribía. Es el cuadro libre del final: lo que no encaja en ningún renglón
—"la dejaron con la caja sucia"— y que si no tiene dónde ir, acaba metido a
empujones en la nota de una pregunta que no era.

Va al final y es opcional a propósito. Al final porque quien recorre recién
entonces vio la unidad entera; opcional porque un comentario obligatorio se
llena con "ok" en el segundo chequeo del día y deja de significar nada. No se
confunde con `declaracion`, que es del chofer y sí desata una revisión: esta es
de quien recorre y no desata nada.

## Por qué renglones y no una columna por pregunta

La lista de preguntas va a crecer —empezó en tres y nació con once—, y una
columna por pregunta significa migración, esquema y formulario cada vez que
alguien quiera revisar el claxon. Con renglones, agregar una pregunta es una
entrada en una constante de TypeScript.

De paso, el checklist por tipo de unidad sale gratis: las preguntas que no
aplican no se insertan. Una caja de tráiler no contesta por sus faros, y un
montacargas no tiene odómetro.

`resultado = 'na'` **no** es lo mismo que no insertar el renglón. No insertarlo
significa que la pregunta no aplica a ese tipo de unidad y nunca se hizo; `'na'`
significa que se hizo y no se pudo contestar: la unidad estaba cargada y no se
pudo ver debajo, el patio estaba a oscuras. La diferencia importa al leer un
chequeo viejo.

## Por qué el catálogo vive en código

`api/src/shared/chequeoItems.ts`, no una tabla. Las claves de `chequeo_items` no
tienen llave foránea contra nada: el servicio valida contra la constante y
rechaza con 400 cualquier clave que no reconozca, así que la base no se ensucia.

Una tabla de catálogo aquí solo agregaría una pantalla de mantenimiento para
veinticuatro renglones que cambian cuando cambia el formulario, no cuando lo decide un
usuario.

Un ítem que se deja de preguntar se marca `retirado` en vez de borrarse: los
chequeos viejos lo referencian por clave y la pantalla de historial tiene que
saber cómo llamarlo. Mismo criterio que archivar en vez de borrar (migración
033).

El frontend lleva un espejo en `src/src/lib/chequeoItems.ts`, pero **no lo usa
para saber qué preguntar**: eso lo trae `/vehiculos/{id}/chequeos/formulario`.
La aplicación es una PWA instalada en los teléfonos del patio, y una pregunta
nueva tendría que esperar a que cada uno actualizara. El espejo sirve para
pintar el historial y como respaldo si la consulta falla.

## La lectura del odómetro

Hasta ahora el kilometraje de la flota solo avanzaba con un mantenimiento o una
recarga de combustible. El chequeo diario lo vuelve la fuente principal, y con
eso la proyección de preventivos por kilómetro deja de depender de que alguien
cargue gasolina.

`lectura` y no `odometro`: en montacargas es el horómetro y en `caja_trailer` no
hay ninguna (ver `TABLA_KM` en `vehiculosRepo.ts`). Un nombre que solo es cierto
para tres de los cinco tipos miente en los otros dos.

**Si la lectura es menor que la registrada, la unidad la adopta igual y se
avisa.** El chequeo lo hace alguien parado frente al tablero, así que su lectura
manda sobre lo que trae el sistema —odómetro reemplazado, corregido, o un km de
más cargado antes por error— y por eso usa `fijarKilometraje` y no
`avanzarKilometraje`, que solo sube y es lo que siguen usando mantenimientos y
recargas. El aviso queda porque un odómetro que baja también puede ser la señal
de que está desconectado o lo alteraron, igual que el trato que `costosService`
le da al odómetro que retrocede entre dos cargas.

Antes de mandarlo, el formulario pregunta (`ConfirmarLecturaMenor`). No es el
mismo caso que `ConfirmarAvanceKm`, que avisa de un odómetro que sube: la causa
más común de una lectura menor no es un odómetro reemplazado, es un dígito mal
tecleado con el teléfono en la mano, y aquí el dato sí retrocede. Un aviso
después de guardar no deshace nada.

Y la pregunta no se puede saltar: el alta y la corrección rechazan la lectura
menor si no viene `confirmar_baja: true` (`validarBaja` en el servicio). La
bandera no se guarda en ningún lado —no es un dato del chequeo, es un acuse— y
va ausente por omisión, que es lo correcto: un cliente viejo o alguien pegando
directo al endpoint cae del lado seguro. La validación corre ANTES de insertar,
porque una vez guardado el chequeo el odómetro ya se movió. Al corregir solo se
exige si la lectura de verdad cambia: arreglar la ubicación de un chequeo cuya
lectura ya estaba abajo no vuelve a preguntar.

`lectura_anterior` es la columna que hace posible todo esto: guarda el odómetro
que traía la unidad en el momento del chequeo. Sin ella, el retroceso se pierde
en cuanto el vehículo vuelve a avanzar, y los kilómetros por día habría que
reconstruirlos adivinando. Con ella, el recorrido diario es una resta.

## Las tres firmas

No son la misma persona y por eso son tres campos:

| campo | quién | de dónde sale |
|---|---|---|
| `declarado_por` | el chofer de esa unidad | texto libre con sugerencias, como `incidencias.reportado_por` |
| `revisado_por` | quien recorrió el patio y capturó | la cuenta de la sesión, la pone la API |
| `revisada_por` | quien leyó la declaración después | la cuenta de la sesión al revisar |

De ahí sale también a quién se le atribuye cada incidencia. Una falla del
**checklist** la reporta quien recorre, porque el checklist es lo que se ve y el
que lo ve es él; ponerla a nombre del chofer sería firmarle un hallazgo que no
hizo, y dejaría sin reportante las unidades revisadas sin chofer presente. Una
incidencia nacida de la **declaración** sí va a nombre del chofer: es suya.

Los dos primeros **no son la misma persona y cambian a distinto ritmo**: quien
recorre es uno solo en todo el patio, el chofer es uno por unidad. Por eso
`declarado_por` se captura en cada chequeo y no se arrastra del anterior:
arrastrarlo dejaría el reporte firmado por quien no lo hizo, que es exactamente
lo que la declaración existe para evitar. El chofer dicta, el de patio teclea.

## Uno por unidad por día

`UQ_chequeos_vehiculo_fecha` es la regla del módulo. Es lo que convierte "¿a
quién le falta el chequeo de hoy?" en una consulta en vez de un cálculo, y lo
que impide dos chequeos del mismo día que se contradigan.

El de hoy **se corrige**, no se captura otro. Al corregir, los renglones que ya
abrieron incidencia se conservan tal cual: su `pendiente_id` es la única liga
con lo que hay que atender, y volver a insertarlos abriría una incidencia
duplicada por cada corrección. Si un renglón dejó de ser falla, la incidencia
queda viva y se cancela desde Incidencias — deshacerla aquí borraría el trabajo
de quien ya la hubiera atendido, y el sistema no borra entidades (ver
`sin-delete.md`).

## El chequeo de flotilla, y por qué la sucursal de un tráiler no es una columna

Como el chequeo lo hacen una o dos personas recorriendo el patio —y no cada
chofer con su unidad—, la ficha del vehículo no puede ser la única entrada: ahí
cada unidad cuesta abrir el detalle completo
—refacciones, garantías, programa, mantenimientos— para usar solo lo de hasta
arriba. `pages/ChequeoPatio.tsx` es la lista del recorrido: se queda fija, el
formulario se abre encima, así que pasar a la siguiente unidad es un toque en
vez de cuatro pantallas.

Lo que la pantalla **no** hace es imponer un orden. Tuvo un botón de "empezar el
recorrido" y avanzaba sola a la siguiente pendiente al guardar; se quitó porque
suponía que el patio se camina en una secuencia, y las unidades no se estacionan
igual dos días seguidos. Cualquier orden que proponga la pantalla acaba mandando
a quien revisa a la otra punta del patio, y lo obliga a salirse para buscar la
que sí tiene enfrente. Quien decide qué unidad sigue es el que está ahí
viéndolas; la lista solo pone las pendientes arriba y lleva la cuenta.

Ahora bien, "las unidades de esta sucursal" no es una sola pregunta:

- **Reparto y montacargas tienen base fija.** `sucursal_id` vive en `camiones` y
  en `montacargas`, y dice dónde duerme la unidad. El sistema puede reclamarlas
  por su nombre: si falta una, falta.
- **Los tráilers andan hoy en una sucursal y mañana en otra.** Su sucursal no es
  un atributo, es dónde amanecieron. Una columna que lo guardara estaría
  mintiendo a los dos días, y mantenerla al día sería un movimiento que nadie va
  a capturar.

Por eso la pantalla tiene dos listas y no un filtro. Las de base se reclaman;
las itinerantes **no se predicen**: quien recorre las ve porque están enfrente,
las busca y las agrega. Después de revisarlas aparecen abajo, porque su chequeo
ya dice dónde se hizo — y esa constancia sí es cierta, a diferencia de una
columna adivinada.

De ahí sale una dependencia que conviene no romper: en el chequeo de flotilla,
`ubicacion` se escribe con el nombre de la sucursal **tal cual y bloqueado**. La consulta
que encuentra a las visitantes (`findVisitantes`) cruza `chequeos.ubicacion`
contra ese nombre, y basta que alguien teclee "Patio norte" en vez de "Sucursal
Norte" para que esa caja desaparezca de la lista.

## Lo que este módulo todavía no resuelve

**Sin señal en el patio.** `api.ts` reintenta, pero no encola: si no hay red, el
chequeo se pierde al cerrar la pantalla. Una cola en IndexedDB es una fase
aparte con su propio peso —conflictos, orden, el índice único peleando con los
reintentos—. Conviene medir cuántas altas fallan antes de decidir si vale la
pena.

**Fotos de los golpes.** Obligan a resolver almacenamiento de archivos y hacen
lento justo el ítem que más se usa. Por ahora la incidencia captura el texto.

**Los utilitarios no entran a la lista de base.** `vehiculos_utilitarios` no
tiene `sucursal_id` —solo un `ubicacion` de texto libre— así que hoy caen en el
grupo de buscar y agregar, junto a los tráilers. Si resulta que sí tienen base
fija como el reparto, la columna es una migración chica y un `COALESCE` más en
`findPatio`; si de verdad andan rotando, están donde deben.
