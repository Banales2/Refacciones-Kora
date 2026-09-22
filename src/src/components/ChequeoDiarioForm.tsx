// El formulario del chequeo diario.
//
// QUIÉN LO LLENA: una persona aparte, que recorre el patio unidad por unidad.
// No lo llena cada chofer con su camión. De ahí sale casi todo lo demás: está
// hecho para repetirse treinta veces seguidas con el teléfono en la mano, con
// botones grandes en vez de selects, teclado numérico para la lectura y la nota
// solo cuando algo salió mal. Lo que mata un chequeo diario es que tarde.
//
// LOS DOS PASOS NO SON DECORACIÓN. Primero lo que el CHOFER de esa unidad sabe
// y no se ve —un ruido, un jalón, un golpe que sintió—, que quien recorre le
// pregunta y anota a su nombre; después el checklist de lo que sí se ve. Si la
// declaración fuera un cuadro de comentarios al final, nadie lo llenaría.
//
// Por eso hay dos nombres en cada chequeo y no uno: `declarado_por` es el
// chofer de la unidad, `revisado_por` es quien recorre, y lo pone la API con la
// cuenta de la sesión. Cambian a distinto ritmo —uno por unidad, uno por
// recorrido— y confundirlos haría que el reporte quedara a nombre de quien no
// lo hizo.
import { useState } from 'react'
import {
  Stack, Group, Button, Text, Textarea, TextInput, NumberInput, Alert, Divider,
  SegmentedControl, Card, Badge, Loader, Center, SimpleGrid,
} from '@mantine/core'
import {
  IconAlertTriangle, IconCheck, IconGauge, IconUserOff,
} from '@tabler/icons-react'
import { SelectCatalogo } from './SelectCatalogo'
import ConfirmarLecturaMenor from './ConfirmarLecturaMenor'
import {
  useFormularioChequeo, useCreateChequeo, useUpdateChequeo, useDeclarantes,
  type ItemPayload, type ChequeoPayload,
} from '../hooks/useChequeos'
import type { Resultado, Severidad } from '../lib/chequeoItems'
import { NIVELES_TANQUE } from '../lib/chequeoItems'
import { TEXTO_LIBRE, TEXTO_SIMPLE, limpiarTextoLibre, limpiarTextoSimple, KM_MAX } from '../lib/validaciones'
import { useOpcionesTexto } from '../hooks/useOpcionesTexto'

/** Lo capturado de una pregunta, antes de mandarse. */
interface Respuesta {
  resultado: Resultado | null
  valor:     string | null
  nota:      string
  severidad: Severidad
}

const VACIA: Respuesta = { resultado: null, valor: null, nota: '', severidad: 'moderada' }

// A nivel de módulo: `useOpcionesTexto` la trae en las dependencias de su
// useMemo, y una función nueva en cada render recalcularía las opciones cada vez.
const etiquetaNueva = (v: string) => `+ Usar "${v}"`

export default function ChequeoDiarioForm({
  vehiculoId, onListo, onCancel, ubicacionFija,
}: {
  vehiculoId: number
  onListo:    (avisos: string[]) => void
  onCancel:   () => void
  /**
   * En el chequeo de flotilla la ubicación es la sucursal que se recorre y no se
   * teclea. No es comodidad: la consulta que encuentra las unidades visitantes
   * cruza `chequeos.ubicacion` contra el nombre de la sucursal, y basta que
   * alguien escriba "Patio norte" en vez de "Sucursal Norte" para que esa caja
   * desaparezca de la lista.
   */
  ubicacionFija?: string
}) {
  const { data, isLoading, isError, refetch } = useFormularioChequeo(vehiculoId, true)
  const crear     = useCreateChequeo(vehiculoId)
  const actualizar = useUpdateChequeo(vehiculoId)
  const declarantes = useDeclarantes()

  const formulario = data?.data
  const existente  = formulario?.hoy ?? null

  // Paso 1, con tres respuestas y no dos. `null` = todavía no contesta, que no
  // es ninguna de las tres: mientras siga en null el checklist no aparece.
  //
  // 'sin_chofer' existe porque quien recorre pasa a las seis de la mañana y la
  // mitad de las unidades están solas. Sin esa opción, el que revisa acabaría
  // marcando "sin novedad" por alguien que no estaba, que es inventar el único
  // dato que este formulario existe para proteger.
  const [paso1, setPaso1] = useState<'sin_novedad' | 'novedad' | 'sin_chofer' | null>(
    existente
      ? (existente.sin_chofer ? 'sin_chofer' : existente.hay_novedad ? 'novedad' : 'sin_novedad')
      : null
  )
  const hayNovedad = paso1 === 'novedad'
  const sinChofer  = paso1 === 'sin_chofer'
  const [declaracion, setDeclaracion] = useState(existente?.declaracion ?? '')
  // El chofer de ESTA unidad. No se arrastra del chequeo anterior ni de quien
  // recorre: el chequeo lo hace una persona aparte que camina el patio, y el
  // chofer cambia con cada unidad que revisa.
  const [declaradoPor, setDeclaradoPor] = useState(existente?.declarado_por ?? '')
  const [ubicacion, setUbicacion] = useState(
    ubicacionFija ?? existente?.ubicacion ?? ''
  )
  const [lectura, setLectura] = useState<number | ''>(existente?.lectura ?? '')
  const [respuestas, setRespuestas] = useState<Record<string, Respuesta>>(() => {
    const inicial: Record<string, Respuesta> = {}
    for (const item of existente?.items ?? []) {
      inicial[item.clave] = {
        resultado: item.resultado,
        valor:     item.valor,
        nota:      item.nota ?? '',
        severidad: 'moderada',
      }
    }
    return inicial
  })
  const [error, setError] = useState<string | null>(null)
  // Una lectura menor que la registrada sí baja el odómetro de la unidad (el
  // chequeo es el único módulo donde retrocede), así que se pregunta antes de
  // mandarla. `true` = ya se confirmó y el próximo guardar pasa de largo.
  const [confirmarBaja, setConfirmarBaja] = useState(false)

  const {
    options: declaranteOptions, setSearch: setDeclaranteSearch,
  } = useOpcionesTexto(
    declarantes.data?.data, declaradoPor, existente?.declarado_por, etiquetaNueva
  )

  if (isLoading) {
    return <Center py="xl"><Loader /></Center>
  }
  if (isError || !formulario) {
    return (
      <Alert color="red" title="No se pudo cargar el chequeo">
        <Group>
          <Text size="sm">Revisa la conexión e inténtalo de nuevo.</Text>
          <Button size="xs" variant="light" onClick={() => refetch()}>Reintentar</Button>
        </Group>
      </Alert>
    )
  }

  const responder = (clave: string, cambio: Partial<Respuesta>) => {
    setRespuestas((prev) => ({ ...prev, [clave]: { ...VACIA, ...prev[clave], ...cambio } }))
  }

  // Ninguna pregunta se puede quedar sin contestar: un chequeo a medias no dice
  // si la unidad está bien o si a quien revisó se le acabó la prisa.
  const faltantes = formulario.items.filter((i) => !respuestas[i.clave]?.resultado)

  const validar = (): string | null => {
    if (paso1 === null) return 'Contesta primero si el chofer reporta algo'
    if (hayNovedad && !declaracion.trim()) return 'Escribe qué reportó el chofer'
    if (hayNovedad && !TEXTO_LIBRE.test(declaracion.trim())) return 'El reporte tiene caracteres no permitidos'
    // Sin chofer no se pide su nombre: es justo lo que se está diciendo que no hubo.
    if (!sinChofer && !declaradoPor.trim()) return 'Falta el nombre del chofer'
    if (!sinChofer && !TEXTO_SIMPLE.test(declaradoPor.trim())) return 'El nombre solo admite letras, números, espacios y guiones'
    if (!ubicacion.trim()) return 'Falta dónde se revisó'
    if (!TEXTO_LIBRE.test(ubicacion.trim())) return 'La ubicación tiene caracteres no permitidos'
    if (formulario.lectura && lectura === '') return `Falta la lectura del ${formulario.lectura.label.toLowerCase()}`
    if (lectura !== '' && (lectura < 0 || lectura > KM_MAX)) return 'Lectura fuera de rango'
    if (faltantes.length > 0) {
      return faltantes.length === 1
        ? `Falta contestar: ${faltantes[0].label}`
        : `Faltan ${faltantes.length} preguntas por contestar`
    }
    // Una falla sin nota obliga a quien la atienda a adivinar qué vio el que
    // revisó, y para entonces la unidad ya se fue.
    const sinNota = formulario.items.find(
      (i) => respuestas[i.clave]?.resultado === 'falla' && !respuestas[i.clave]?.nota.trim()
    )
    if (sinNota) return `Describe qué pasa con: ${sinNota.label}`
    return null
  }

  const armarPayload = (confirmarBajaLectura: boolean): ChequeoPayload => {
    const items: ItemPayload[] = formulario.items.map((i) => {
      const r = respuestas[i.clave]
      return {
        clave:     i.clave,
        resultado: r.resultado!,
        valor:     i.captura === 'fraccion' ? r.valor : null,
        nota:      r.nota.trim() || null,
        // La severidad solo viaja donde el catálogo la pide; el backend rechaza
        // el resto.
        ...(i.incidencia?.preguntarSeveridad && r.resultado === 'falla'
          ? { severidad: r.severidad }
          : {}),
      }
    })
    return {
      ubicacion:     ubicacion.trim(),
      hay_novedad:   hayNovedad,
      sin_chofer:    sinChofer,
      declarado_por: sinChofer ? null : declaradoPor.trim(),
      declaracion:   hayNovedad ? declaracion.trim() : null,
      lectura:       lectura === '' ? null : lectura,
      // Solo cuando toca: mandarla siempre la volvería ruido y la API dejaría
      // de frenar la lectura mal tecleada, que es justo para lo que está.
      ...(confirmarBajaLectura ? { confirmar_baja: true } : {}),
      items,
    }
  }

  // `lectura_anterior` del chequeo: contra esto se compara y esto es lo que
  // baja. Solo aplica a las unidades con odómetro —en las demás `kilometraje`
  // llega null— y solo si la lectura cambió, que es cuando la API la aplica.
  const kmVehiculo = formulario.kilometraje
  const lecturaBaja =
    kmVehiculo != null && lectura !== '' && lectura < kmVehiculo &&
    lectura !== (existente?.lectura ?? null)

  const guardar = async () => {
    const problema = validar()
    if (problema) { setError(problema); return }
    setError(null)
    if (lecturaBaja) { setConfirmarBaja(true); return }
    await enviar()
  }

  // El modal se queda abierto mientras guarda —su botón es el que trae el
  // spinner— y se cierra al terminar, pase lo que pase: si algo falló, el error
  // se lee en el formulario, no detrás de un modal.
  const enviar = async () => {
    try {
      const payload = armarPayload(lecturaBaja)
      const res = existente
        ? await actualizar.mutateAsync({ id: existente.id, payload })
        : await crear.mutateAsync(payload)
      onListo(res.avisos ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el chequeo')
    } finally {
      setConfirmarBaja(false)
    }
  }

  const guardando = crear.isPending || actualizar.isPending

  return (
    <Stack gap="md">
      {existente && (
        <Alert color="blue" variant="light">
          Esta unidad ya tiene chequeo de hoy, capturado por {existente.revisado_por}.
          Lo que guardes aquí lo corrige.
        </Alert>
      )}

      {/* ---- Paso 1: la declaración ---- */}
      <Card withBorder radius="md" padding="md">
        <Stack gap="sm">
          <Text fw={600}>¿El chofer reporta algo de la unidad?</Text>
          <Text size="sm" c="dimmed">
            Pregúntale antes de revisarla: un ruido raro, un jalón, un golpe.
            Lo que él sabe y no se ve dando la vuelta.
          </Text>
          {/* Apilados en el teléfono, en fila desde tablet. Lado a lado a
              390px cada uno queda en ~170px y "No reporta nada" se corta; y de
              paso el botón de ancho completo es más fácil de picar con una mano
              ocupada. */}
          <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="xs">
            <Button
              size="lg"
              variant={paso1 === 'sin_novedad' ? 'filled' : 'default'}
              color="teal"
              leftSection={<IconCheck size={18} />}
              onClick={() => { setPaso1('sin_novedad'); setError(null) }}
            >
              No reporta nada
            </Button>
            <Button
              size="lg"
              variant={paso1 === 'novedad' ? 'filled' : 'default'}
              color="orange"
              leftSection={<IconAlertTriangle size={18} />}
              onClick={() => { setPaso1('novedad'); setError(null) }}
            >
              Sí, algo pasó
            </Button>
          </SimpleGrid>
          {/* Aparte y en gris: es una respuesta legítima, no una de las dos
              normales. Ponerla junto a las otras invitaría a usarla para salir
              del paso rápido, que es justo lo que no debe pasar. */}
          <Button
            variant={paso1 === 'sin_chofer' ? 'filled' : 'subtle'}
            color="gray"
            size="sm"
            leftSection={<IconUserOff size={16} />}
            onClick={() => { setPaso1('sin_chofer'); setError(null) }}
          >
            No había chofer a quien preguntarle
          </Button>

          {paso1 === 'novedad' && (
            <Textarea
              label="¿Qué pasó?"
              placeholder="Se oye un rechinido al frenar desde ayer en la tarde…"
              autosize
              minRows={3}
              maxLength={500}
              value={declaracion}
              onChange={(e) => setDeclaracion(limpiarTextoLibre(e.currentTarget.value, 500))}
              data-autofocus
            />
          )}

          {paso1 === 'novedad' && (
            <Text size="xs" c="dimmed">
              Esto no se convierte solo en una orden de trabajo: lo revisa alguien antes.
            </Text>
          )}

          {paso1 === 'sin_chofer' && (
            <Text size="xs" c="dimmed">
              La unidad se revisa igual; queda anotado que no se le pudo preguntar a nadie.
            </Text>
          )}
        </Stack>
      </Card>

      {/* El checklist no existe hasta que la declaración está contestada. */}
      {paso1 !== null && (
        <>
          <Divider label="Revisión de la unidad" labelPosition="center" />

          {/* Los dos campos, uno por renglón en el teléfono: a media pantalla
              se les corta la etiqueta, que es justo lo que dice qué se captura
              en cada uno. */}
          <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="xs" verticalSpacing="xs">
            {!sinChofer && (
              <SelectCatalogo
                label="¿Qué chofer trae esta unidad?"
                placeholder="Nombre del chofer"
                description="A nombre de quién queda el reporte"
                nombre="choferes"
                creable
                estado={declarantes}
                data={declaranteOptions}
                value={declaradoPor}
                onChange={(v) => setDeclaradoPor(limpiarTextoSimple(v ?? '', 120))}
                onSearchChange={setDeclaranteSearch}
              />
            )}
            <TextInput
              label="¿Dónde se revisó?"
              placeholder="Patio Norte"
              maxLength={160}
              value={ubicacion}
              disabled={!!ubicacionFija}
              description={ubicacionFija ? 'La sucursal del recorrido' : undefined}
              onChange={(e) => setUbicacion(limpiarTextoLibre(e.currentTarget.value, 160))}
            />
          </SimpleGrid>

          {formulario.lectura && (
            <NumberInput
              label={formulario.lectura.label}
              description={
                formulario.kilometraje != null
                  ? `Registrado: ${formulario.kilometraje.toLocaleString('es-MX')}`
                  : 'Sin lectura previa registrada'
              }
              placeholder="0"
              min={0}
              max={KM_MAX}
              inputMode="numeric"
              size="md"
              leftSection={<IconGauge size={18} />}
              thousandSeparator=","
              value={lectura}
              onChange={(v) => setLectura(typeof v === 'number' ? v : '')}
            />
          )}

          <Stack gap="xs">
            {formulario.items.map((item) => {
              const r = respuestas[item.clave] ?? VACIA
              return (
                <Card key={item.clave} withBorder radius="md" padding="sm">
                  <Stack gap="xs">
                    <Group justify="space-between" wrap="nowrap" align="flex-start">
                      <Text size="sm" fw={500} style={{ flex: 1 }}>{item.label}</Text>
                      {r.resultado === 'falla' && (
                        <Badge color="red" variant="light" size="sm">Abre incidencia</Badge>
                      )}
                    </Group>

                    {item.captura === 'fraccion' ? (
                      <Stack gap={4}>
                        {/* Rejilla y no SegmentedControl: en un teléfono los
                            cuatro segmentos dan ~85px cada uno, donde "Lleno"
                            entra completo y el toque no se falla. */}
                        <SimpleGrid cols={4} spacing={4}>
                          {NIVELES_TANQUE.map((nivel) => (
                            <Button
                              key={nivel.valor}
                              size="md"
                              px={4}
                              variant={r.valor === nivel.valor ? 'filled' : 'default'}
                              onClick={() => responder(item.clave, { resultado: 'ok', valor: nivel.valor })}
                            >
                              {nivel.label}
                            </Button>
                          ))}
                        </SimpleGrid>
                        {/* Un chequeo capturado en octavos que hoy se corrige:
                            ninguno de los cuatro botones lo representa, y sin
                            esto parecería que el nivel nunca se contestó. Se
                            queda como está mientras no toquen un botón. */}
                        {r.valor && !NIVELES_TANQUE.some((n) => n.valor === r.valor) && (
                          <Text size="xs" c="dimmed">
                            Capturado antes como {r.valor}. Toca un nivel para cambiarlo.
                          </Text>
                        )}
                      </Stack>
                    ) : (
                      // "Sí" y "No", no "Bien" y "Mal": las preguntas están
                      // redactadas como preguntas —"Sin golpes nuevos",
                      // "Parabrisas sin estrellar"— y a una pregunta se le
                      // contesta sí o no. Con "Bien"/"Mal" había que traducir
                      // en la cabeza en cada renglón, y en una redactada en
                      // negativo la traducción se invierte: "sin golpes" está
                      // "bien" cuando la respuesta es "sí". Es justo el
                      // renglón que se contesta al revés con prisa.
                      //
                      // Sin iconos: el icono más el texto no caben en un
                      // tercio de 390px y lo que se recortaba era la palabra,
                      // que es lo único que de verdad se lee. El color ya
                      // distingue los tres (verde, rojo, gris).
                      <SimpleGrid cols={3} spacing="xs">
                        <Button
                          size="md"
                          px={4}
                          variant={r.resultado === 'ok' ? 'filled' : 'default'}
                          color="teal"
                          onClick={() => responder(item.clave, { resultado: 'ok', nota: '' })}
                        >
                          Sí
                        </Button>
                        <Button
                          size="md"
                          px={4}
                          variant={r.resultado === 'falla' ? 'filled' : 'default'}
                          color="red"
                          onClick={() => responder(item.clave, { resultado: 'falla' })}
                        >
                          No
                        </Button>
                        <Button
                          size="md"
                          px={4}
                          variant={r.resultado === 'na' ? 'filled' : 'default'}
                          color="gray"
                          onClick={() => responder(item.clave, { resultado: 'na' })}
                        >
                          Sin revisar
                        </Button>
                      </SimpleGrid>
                    )}

                    {/* La nota aparece solo cuando hace falta: pedirla siempre
                        convierte diecisiete preguntas en diecisiete cuadros de texto. */}
                    {(r.resultado === 'falla' || r.resultado === 'na') && (
                      <TextInput
                        placeholder={r.resultado === 'falla' ? '¿Qué tiene?' : '¿Por qué no se revisó?'}
                        maxLength={200}
                        value={r.nota}
                        onChange={(e) => responder(item.clave, {
                          nota: limpiarTextoLibre(e.currentTarget.value, 200),
                        })}
                      />
                    )}

                    {/* Un rayón y un cuarto hundido no son lo mismo, y es lo
                        único que el catálogo deja graduar a quien revisa. */}
                    {r.resultado === 'falla' && item.incidencia?.preguntarSeveridad && (
                      <SegmentedControl
                        fullWidth
                        size="xs"
                        data={[
                          { label: 'Superficial', value: 'superficial' },
                          { label: 'Moderada',    value: 'moderada'    },
                          { label: 'Grave',       value: 'grave'       },
                        ]}
                        value={r.severidad}
                        onChange={(v) => responder(item.clave, { severidad: v as Severidad })}
                      />
                    )}
                  </Stack>
                </Card>
              )
            })}
          </Stack>
        </>
      )}

      {error && <Alert color="red" icon={<IconAlertTriangle size={16} />}>{error}</Alert>}

      {/* El pie, en orden inverso en el teléfono: Guardar arriba y de ancho
          completo —es la acción del 99% de las veces y queda al alcance del
          pulgar—, y Cancelar debajo, donde no se pica por error. En pantalla
          ancha vuelve a la fila de siempre. */}
      {paso1 !== null && faltantes.length > 0 && (
        <Text size="sm" c="dimmed" ta="center">
          Faltan {faltantes.length} de {formulario.items.length} preguntas
        </Text>
      )}
      <Stack gap="xs" hiddenFrom="xs">
        <Button
          size="lg"
          onClick={guardar}
          loading={guardando}
          disabled={paso1 === null}
          leftSection={<IconCheck size={18} />}
        >
          {existente ? 'Guardar corrección' : 'Guardar chequeo'}
        </Button>
        <Button variant="subtle" onClick={onCancel} disabled={guardando}>Cancelar</Button>
      </Stack>
      <Group justify="space-between" visibleFrom="xs">
        <Button variant="subtle" onClick={onCancel} disabled={guardando}>Cancelar</Button>
        <Button
          onClick={guardar}
          loading={guardando}
          disabled={paso1 === null}
          leftSection={<IconCheck size={16} />}
        >
          {existente ? 'Guardar corrección' : 'Guardar chequeo'}
        </Button>
      </Group>

      <ConfirmarLecturaMenor
        opened={confirmarBaja}
        etiqueta={formulario.lectura?.label ?? 'Odómetro'}
        kmVehiculo={kmVehiculo ?? 0}
        kmNuevo={lectura === '' ? 0 : lectura}
        isPending={guardando}
        onCancel={() => setConfirmarBaja(false)}
        onConfirm={enviar}
      />
    </Stack>
  )
}
