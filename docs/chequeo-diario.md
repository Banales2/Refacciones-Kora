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
once renglones que cambian cuando cambia el formulario, no cuando lo decide un
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

**Si la lectura es menor que la registrada, se guarda igual y se avisa.** No se
descarta en silencio como hace `avanzarKilometraje`: un odómetro que baja es
exactamente la señal de que está desconectado o lo alteraron. Es el mismo trato
que `costosService` le da al odómetro que retrocede entre dos cargas.

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

## El modo patio, y por qué la sucursal de un tráiler no es una columna

Como el chequeo lo hacen una o dos personas recorriendo el patio —y no cada
chofer con su unidad—, la ficha del vehículo no puede ser la única entrada: ahí
cada unidad cuesta abrir el detalle completo
—refacciones, garantías, programa, mantenimientos— para usar solo lo de hasta
arriba. `pages/ChequeoPatio.tsx` es la lista del recorrido: se queda fija, el
formulario se abre encima y al guardar avanza solo a la siguiente que falte.

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

De ahí sale una dependencia que conviene no romper: en modo patio, `ubicacion`
se escribe con el nombre de la sucursal **tal cual y bloqueado**. La consulta
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
