# Facturas de gasolinera

La gasolinera no factura carga por carga: manda una factura que cubre varias,
desglosada en renglones. Lo que **no** trae cada renglón es a qué vehículo fue,
qué chofer la hizo ni contra qué vale — eso solo lo sabe el sistema.

**Esto no guarda la factura.** El documento se archiva por otro lado; aquí vive
lo necesario para comprobar que el gasto está bien capturado, y nada más:

```
facturas_gasolina          folio, gasolinera, fecha, tasa de IVA
  ..._renglones            descripción, cantidad, importe  →  recarga
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

Y como en la 020, **los importes no se guardan, se calculan**. Lo único que se
guarda es la tasa:

- `tasa_iva NULL` → los importes de los renglones **ya incluyen IVA**.
- `tasa_iva 16.00` → son subtotal, y el total es `subtotal × 1.16`.

El subtotal sale de sumar los renglones. Guardar los tres sería repetir datos
derivados que quedan desalineados en cuanto alguien corrija un renglón.

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

> Las de **su gasolinera**, con fecha **menor o igual** a la de la factura, que
> **ningún renglón de ninguna otra factura** haya reclamado.

El corte por fecha no tiene límite inferior a propósito: una carga de hace tres
meses que nadie facturó sigue siendo candidata legítima, y poner una ventana la
escondería justo cuando aparece la factura atrasada que la cobra.

El vínculo vive en el **renglón** (`facturas_gasolina_renglones.recarga_id`), no
en la recarga. Así "qué falta por facturar" y "qué renglón no tiene recarga" son
la misma consulta vista desde dos lados, y un índice único impide que dos
renglones se lleven la misma carga.

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

Una recarga que ya entró en una factura **conciliada** no puede cambiar de
`litros`, `fecha` ni `gasolinera_id`: el emparejamiento se hizo con esos datos y
dejaría de ser cierto sin que nadie se entere. `PUT /recargas/{id}` responde 409
`RECARGA_CONCILIADA`.

Los demás campos —chofer, vale, kilometraje, costo— **sí se siguen corrigiendo**
con la factura cerrada. Son datos de la operación, no del cuadre.

## Reabrir

`POST /facturas-gasolina/{id}/reabrir` suelta el sello. Es lo que hace falta
cuando aparece la recarga que no estaba: se captura por la vía normal, se reabre y
ahora sí casa. Los emparejamientos **no** se deshacen, así que solo hay que
ajustar lo que faltaba.

## Capturar la factura

Ni el subtotal ni el total se teclean: salen de los renglones y la tasa. Pedirlos
aparte solo crea la oportunidad de que discrepen de lo capturado.

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
| `GET /facturas-gasolina` | admin, editor, viewer | Lista, con `?por_conciliar=1` |
| `POST /facturas-gasolina` | admin, editor | Alta: cabecera y renglones |
| `GET /facturas-gasolina/{id}/candidatas` | admin, editor, viewer | Renglones con su propuesta, y las recargas elegibles |
| `POST /facturas-gasolina/{id}/conciliar` | **admin** | Guarda los emparejamientos y sella |
| `POST /facturas-gasolina/{id}/reabrir` | **admin** | Suelta el sello |
| `GET /facturas-gasolina/sin-facturar` | admin, editor, viewer | Las recargas que ninguna factura ha reclamado |

Conciliar es solo admin, igual que revisar una factura de refacciones: es el
segundo par de ojos sobre lo capturado.

`casados` es el conjunto **completo**, con los renglones sin casar incluidos y su
`recarga_id` en null: la pantalla manda la verdad entera y el servidor reemplaza.

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

- **La factura completa.** Serie, UUID, régimen, sello, precio unitario: nada de
  eso ayuda a contestar "¿a qué recarga corresponde este renglón?", y el
  documento ya se archiva por otro lado.
- **El número de ticket.** Sería la llave exacta si la recarga lo capturara, pero
  hoy no lo hace, y agregarlo a `recargas_combustible` es una decisión aparte.
- **Importar el XML del CFDI.** Los renglones se capturan a mano.
- **Un renglón se casa con una recarga y solo una.** Si una carga apareciera
  partida entre dos facturas, esto se queda corto — pero inventar hoy la tabla
  intermedia para un caso que nadie ha visto cuesta complejidad en el 100% de los
  casos reales.
