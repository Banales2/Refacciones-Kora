// El formulario del chequeo diario.
//
// Se llena en el patio, con el teléfono, antes de salir. Todo lo de aquí está
// puesto para que tarde menos de un minuto: botones grandes en vez de selects,
// teclado numérico para la lectura, y la nota solo cuando algo salió mal. Lo
// que mata un chequeo diario es que tarde.
//
// LOS DOS PASOS NO SON DECORACIÓN. Primero la declaración del chofer —lo que él
// SABE: un ruido, un jalón, un golpe que sintió—, y el checklist no aparece
// hasta que la contesta. Si la declaración fuera un cuadro de comentarios al
// final, nadie lo llenaría, y es justo lo que una vuelta alrededor del camión
// no alcanza a ver.
import { useState } from 'react'
import {
  Stack, Group, Button, Text, Textarea, TextInput, NumberInput, Alert, Divider,
  SegmentedControl, Card, Badge, Loader, Center, ThemeIcon,
} from '@mantine/core'
import {
  IconAlertTriangle, IconCheck, IconX, IconQuestionMark, IconGauge,
} from '@tabler/icons-react'
import { SelectCatalogo } from './SelectCatalogo'
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
  vehiculoId, onListo, onCancel,
}: {
  vehiculoId: number
  onListo:    (avisos: string[]) => void
  onCancel:   () => void
}) {
  const { data, isLoading, isError, refetch } = useFormularioChequeo(vehiculoId, true)
  const crear     = useCreateChequeo(vehiculoId)
  const actualizar = useUpdateChequeo(vehiculoId)
  const declarantes = useDeclarantes()

  const formulario = data?.data
  const existente  = formulario?.hoy ?? null

  // Paso 1. `null` = todavía no contesta, que es distinto de "no hay novedad":
  // mientras siga en null el checklist no aparece.
  const [hayNovedad, setHayNovedad] = useState<boolean | null>(
    existente ? existente.hay_novedad : null
  )
  const [declaracion, setDeclaracion] = useState(existente?.declaracion ?? '')
  const [declaradoPor, setDeclaradoPor] = useState(existente?.declarado_por ?? '')
  const [ubicacion, setUbicacion] = useState(existente?.ubicacion ?? '')
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
    if (hayNovedad === null) return 'Contesta primero si hay algo que reportar'
    if (hayNovedad && !declaracion.trim()) return 'Escribe qué pasó'
    if (hayNovedad && !TEXTO_LIBRE.test(declaracion.trim())) return 'El reporte tiene caracteres no permitidos'
    if (!declaradoPor.trim()) return 'Falta quién declara'
    if (!TEXTO_SIMPLE.test(declaradoPor.trim())) return 'El nombre solo admite letras, números, espacios y guiones'
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

  const armarPayload = (): ChequeoPayload => {
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
      declarado_por: declaradoPor.trim(),
      hay_novedad:   hayNovedad === true,
      declaracion:   hayNovedad ? declaracion.trim() : null,
      lectura:       lectura === '' ? null : lectura,
      items,
    }
  }

  const guardar = async () => {
    const problema = validar()
    if (problema) { setError(problema); return }
    setError(null)
    try {
      const payload = armarPayload()
      const res = existente
        ? await actualizar.mutateAsync({ id: existente.id, payload })
        : await crear.mutateAsync(payload)
      onListo(res.avisos ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el chequeo')
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
          <Text fw={600}>¿Algo que reportar de la unidad?</Text>
          <Text size="sm" c="dimmed">
            Un ruido raro, un jalón, un golpe: lo que sepas aunque no se vea.
          </Text>
          <Group grow>
            <Button
              size="lg"
              variant={hayNovedad === false ? 'filled' : 'default'}
              color="teal"
              leftSection={<IconCheck size={18} />}
              onClick={() => { setHayNovedad(false); setError(null) }}
            >
              Sin novedad
            </Button>
            <Button
              size="lg"
              variant={hayNovedad === true ? 'filled' : 'default'}
              color="orange"
              leftSection={<IconAlertTriangle size={18} />}
              onClick={() => { setHayNovedad(true); setError(null) }}
            >
              Sí, algo pasó
            </Button>
          </Group>

          {hayNovedad === true && (
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

          {hayNovedad === true && (
            <Text size="xs" c="dimmed">
              Esto no se convierte solo en una orden de trabajo: lo revisa alguien antes.
            </Text>
          )}
        </Stack>
      </Card>

      {/* El checklist no existe hasta que la declaración está contestada. */}
      {hayNovedad !== null && (
        <>
          <Divider label="Revisión de la unidad" labelPosition="center" />

          <Group grow align="flex-start">
            <SelectCatalogo
              label="¿Quién declara?"
              placeholder="Nombre del chofer"
              nombre="choferes"
              creable
              estado={declarantes}
              data={declaranteOptions}
              value={declaradoPor}
              onChange={(v) => setDeclaradoPor(limpiarTextoSimple(v ?? '', 120))}
              onSearchChange={setDeclaranteSearch}
            />
            <TextInput
              label="¿Dónde se revisó?"
              placeholder="Patio Norte"
              maxLength={160}
              value={ubicacion}
              onChange={(e) => setUbicacion(limpiarTextoLibre(e.currentTarget.value, 160))}
            />
          </Group>

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
                      <SegmentedControl
                        fullWidth
                        size="sm"
                        data={NIVELES_TANQUE}
                        value={r.valor ?? ''}
                        onChange={(v) => responder(item.clave, { resultado: 'ok', valor: v })}
                      />
                    ) : (
                      <Group grow gap="xs">
                        <Button
                          size="md"
                          variant={r.resultado === 'ok' ? 'filled' : 'default'}
                          color="teal"
                          leftSection={<IconCheck size={16} />}
                          onClick={() => responder(item.clave, { resultado: 'ok', nota: '' })}
                        >
                          Bien
                        </Button>
                        <Button
                          size="md"
                          variant={r.resultado === 'falla' ? 'filled' : 'default'}
                          color="red"
                          leftSection={<IconX size={16} />}
                          onClick={() => responder(item.clave, { resultado: 'falla' })}
                        >
                          Mal
                        </Button>
                        <Button
                          size="md"
                          variant={r.resultado === 'na' ? 'filled' : 'default'}
                          color="gray"
                          leftSection={<IconQuestionMark size={16} />}
                          onClick={() => responder(item.clave, { resultado: 'na' })}
                        >
                          No se pudo
                        </Button>
                      </Group>
                    )}

                    {/* La nota aparece solo cuando hace falta: pedirla siempre
                        convierte once preguntas en once cuadros de texto. */}
                    {(r.resultado === 'falla' || r.resultado === 'na') && (
                      <TextInput
                        placeholder={r.resultado === 'falla' ? '¿Qué tiene?' : '¿Por qué no se pudo?'}
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

      <Group justify="space-between">
        <Button variant="subtle" onClick={onCancel} disabled={guardando}>Cancelar</Button>
        <Group gap="xs">
          {hayNovedad !== null && faltantes.length > 0 && (
            <Text size="xs" c="dimmed">
              Faltan {faltantes.length} de {formulario.items.length}
            </Text>
          )}
          <Button
            onClick={guardar}
            loading={guardando}
            disabled={hayNovedad === null}
            leftSection={<ThemeIcon variant="transparent" size="sm" c="inherit"><IconCheck size={16} /></ThemeIcon>}
          >
            {existente ? 'Guardar corrección' : 'Guardar chequeo'}
          </Button>
        </Group>
      </Group>
    </Stack>
  )
}
