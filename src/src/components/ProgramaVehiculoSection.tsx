// El programa de mantenimiento visto desde una unidad.
//
// Arriba de todo va la etapa: mientras la unidad esté en garantía sigue el
// programa del fabricante, y cuando esa garantía se acaba pasa al de después.
// La API lo calcula contra la garantía principal del modelo; aquí se pinta, y
// se ofrece forzarlo a mano para los casos que el cálculo no cubre —la unidad
// que perdió la garantía por un choque, o aquella a la que el fabricante se la
// respetó pese al vencimiento formal—.
//
// Y de ahí sale la alerta que más importa: un servicio vencido en una unidad
// que TODAVÍA está en garantía no es un atraso cualquiera, es la garantía en
// riesgo. El programa del fabricante existe justamente para no perderla.
//
// LA VISITA ES UN MANTENIMIENTO. Aquí se sigue hablando de "visita al taller"
// porque es como se piensa el trabajo, pero registrarla abre el formulario de
// mantenimiento completo —costo, técnico, refacciones— y lo que se guarda es un
// mantenimiento como cualquier otro, que además declara qué columna del
// programa cerró. No hay dos registros de la misma entrada al taller.
//
// Debajo, dos cosas distintas se vencen, y la sección está partida en dos por
// eso:
//
//  - La **visita**: cuando el odómetro llega a la marca de la siguiente columna,
//    toca hacer esa columna entera. Es el lado grupal del programa.
//  - El **renglón**: cada operación trae su "o cada N meses" y corre por su
//    cuenta. Puede vencer con la visita todavía lejos, y entonces se atiende
//    solo, sin adelantar el resto de la columna.
import { useState } from 'react'
import {
  Stack, Group, Text, Table, Badge, Button, Modal, Alert, Loader, Center,
  ActionIcon, Tooltip, Divider, Paper, NumberInput, Progress, SegmentedControl,
} from '@mantine/core'
import {
  IconChecklist, IconPencil, IconTrash, IconPlus, IconClockExclamation, IconArrowBackUp,
  IconShieldExclamation, IconShieldCheck, IconAdjustments,
} from '@tabler/icons-react'
import {
  useProgramaVehiculo, useAsignarPrograma, useQuitarPrograma,
  useRegistrarVisita, useDeshacerVisita, useAtenderOperacion, useForzarEtapa,
  useSetExcepciones, ORIGEN_ARRANQUE_LABEL,
} from '../hooks/useProgramaVehiculo'
import type {
  ServicioPendiente, OperacionPorTiempo, Etapa, EstadoProgramaVehiculo,
} from '../hooks/useProgramaVehiculo'
import { useProgramasModelo, TIPO_PROGRAMA_LABEL } from '../hooks/usePrograma'
import { KM_MAX } from '../lib/validaciones'
import { formatMXN, formatMXNCorto } from '../lib/formato'
import { FechaInput } from './FechaInput'
import ProgramaExcepcionesModal from './ProgramaExcepcionesModal'
import MantenimientoForm from './MantenimientoForm'
import { useCreateMantenimiento } from '../hooks/useMantenimientos'
import type { MantenimientoPayload } from '../hooks/useMantenimientos'
import { useCreateDetallesMtto } from '../hooks/useDetalleMtto'
import type { DetalleMttoPayload } from '../hooks/useDetalleMtto'
import type { TipoVehiculo } from '../hooks/useVehiculos'

const nf = new Intl.NumberFormat('es-MX')

function hoyIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function fmtFecha(iso: string | null) {
  if (!iso) return '—'
  return new Date(`${iso.split('T')[0]}T12:00:00`).toLocaleDateString('es-MX', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

// ── Etapa y garantía ─────────────────────────────────────────────────────────

// En qué programa va la unidad, por qué, y qué se está arriesgando si trae algo
// vencido. Es lo primero que se lee de la sección porque cambia el significado
// de todo lo de abajo: los mismos kilómetros vencidos son un pendiente más si
// la unidad ya salió de garantía, y una garantía en riesgo si no.
function BandaEtapa({
  estado, isPending, onForzar,
}: {
  estado:    EstadoProgramaVehiculo
  isPending: boolean
  onForzar:  (etapa: Etapa | null) => void
}) {
  const { etapa, etapa_forzada, garantia, garantia_en_riesgo, falta_posgarantia } = estado
  const vigente = garantia?.estado.vigente ?? false

  return (
    <Stack gap="sm">
      <Paper withBorder p="md" radius="md">
        <Group justify="space-between" align="flex-start" wrap="wrap" gap="sm">
          <Stack gap={4}>
            <Group gap="xs">
              <Badge
                variant="light"
                color={etapa === 'fabricante' ? 'blue' : 'grape'}
                leftSection={etapa === 'fabricante' ? <IconShieldCheck size={12} /> : undefined}
              >
                {TIPO_PROGRAMA_LABEL[etapa]}
              </Badge>
              {etapa_forzada && (
                <Tooltip label="Alguien fijó esta etapa a mano; el vencimiento de la garantía no la mueve">
                  <Badge variant="outline" color="gray" size="sm">Fijada a mano</Badge>
                </Tooltip>
              )}
            </Group>
            {garantia ? (
              <Text size="sm" c="dimmed">
                Garantía principal: <strong>{garantia.nombre}</strong>
                {vigente
                  ? ` · vigente${garantia.estado.vence_el ? ` hasta el ${fmtFecha(garantia.estado.vence_el)}` : ''}` +
                    (garantia.estado.vence_a_los_km != null
                      ? ` o los ${nf.format(garantia.estado.vence_a_los_km)} km`
                      : '')
                  : ' · ya se acabó'}
              </Text>
            ) : (
              <Text size="sm" c="dimmed">
                Su modelo no tiene marcada una garantía principal, así que la unidad se queda en el
                programa del fabricante.
              </Text>
            )}
            <Text size="xs" c="dimmed">
              Arranca en {nf.format(estado.arranque.km)} km
              {estado.arranque.fecha && ` · ${fmtFecha(estado.arranque.fecha)}`}
              {' · '}{ORIGEN_ARRANQUE_LABEL[estado.arranque.origen].toLowerCase()}
            </Text>
          </Stack>

          {/* Forzar la etapa. Se ofrece siempre porque los dos sentidos son
              casos reales, no correcciones de un error. */}
          <Stack gap={4} align="flex-end">
            <Text size="xs" c="dimmed" fw={600} tt="uppercase">Etapa</Text>
            <SegmentedControl
              size="xs"
              disabled={isPending}
              value={etapa_forzada ? etapa : 'auto'}
              onChange={(v) => onForzar(v === 'auto' ? null : (v as Etapa))}
              data={[
                { value: 'auto', label: 'Automática' },
                { value: 'fabricante', label: 'Fabricante' },
                { value: 'posgarantia', label: 'Post-garantía' },
              ]}
            />
          </Stack>
        </Group>
      </Paper>

      {garantia_en_riesgo && (
        <Alert
          color="red" variant="filled" title="Garantía en riesgo"
          icon={<IconShieldExclamation size={16} />}
        >
          Esta unidad trae atrasado un servicio del programa del fabricante y su garantía
          <strong> {garantia?.nombre}</strong> sigue vigente. No llevarla a estos servicios es
          motivo para perderla.
        </Alert>
      )}

      {falta_posgarantia && (
        <Alert color="orange" variant="light" title="Sin programa de post-garantía">
          A esta unidad ya se le acabó la garantía, pero su modelo no tiene capturado el programa
          de después. Mientras tanto sigue el del fabricante. Se captura desde la ficha del modelo.
        </Alert>
      )}
    </Stack>
  )
}

// ── Próxima visita ───────────────────────────────────────────────────────────

function ProximaVisita({
  proxima, kmRecorrido, onRegistrar,
}: {
  proxima:     ServicioPendiente
  kmRecorrido: number | null
  onRegistrar: () => void
}) {
  const color = proxima.vencida ? 'red' : proxima.por_vencer ? 'yellow' : 'blue'
  // Cuánto del tramo lleva recorrido. El tramo es el intervalo de esta visita,
  // no la marca de la columna: el ciclo da la vuelta y la marca deja de
  // corresponder al odómetro (ver la migración 012).
  const avance = proxima.intervalo > 0 && proxima.km_faltantes != null
    ? Math.max(0, Math.min(100, (1 - proxima.km_faltantes / proxima.intervalo) * 100))
    : 0

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Stack gap={2}>
            <Group gap="xs">
              <Text fw={600}>Servicio de {nf.format(proxima.fase.km)} km</Text>
              {proxima.vencida && <Badge color="red" variant="light" size="sm">Vencido</Badge>}
              {!proxima.vencida && proxima.por_vencer && (
                <Badge color="yellow" variant="light" size="sm">Próximo</Badge>
              )}
              <Badge color="gray" variant="outline" size="sm">
                Visita {proxima.indice + 1}
              </Badge>
              {proxima.fase.costo != null && (
                <Badge color="teal" variant="light" size="sm">
                  {formatMXN(proxima.fase.costo)}
                </Badge>
              )}
            </Group>
            <Text size="sm" c="dimmed">
              Toca a los {nf.format(proxima.km_odometro)} km de odómetro
              {kmRecorrido != null && proxima.km_faltantes != null && (
                proxima.km_faltantes > 0
                  ? ` · faltan ${nf.format(proxima.km_faltantes)} km`
                  : ` · pasado por ${nf.format(-proxima.km_faltantes)} km`
              )}
            </Text>
          </Stack>
          <Button size="xs" leftSection={<IconPlus size={14} />} onClick={onRegistrar}>
            Registrar visita
          </Button>
        </Group>

        {kmRecorrido != null && <Progress value={avance} color={color} size="sm" />}

        {proxima.operaciones.length === 0 ? (
          <Text size="sm" c="dimmed">Esta columna no tiene operaciones capturadas.</Text>
        ) : (
          <Table striped withTableBorder verticalSpacing={4}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Qué se le hace</Table.Th>
                <Table.Th style={{ width: 70, textAlign: 'center' }}>Acción</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {proxima.operaciones.map((o) => (
                <Table.Tr key={o.operacion.id}>
                  <Table.Td>
                    <Text size="sm">{o.operacion.nombre}</Text>
                    {o.operacion.categoria && (
                      <Text size="xs" c="dimmed">{o.operacion.categoria}</Text>
                    )}
                  </Table.Td>
                  <Table.Td style={{ textAlign: 'center' }}>
                    <Badge variant="light" size="sm">{o.accion}</Badge>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Stack>
    </Paper>
  )
}

// ── Sección ──────────────────────────────────────────────────────────────────

export default function ProgramaVehiculoSection({
  vehiculoId, modeloId, kilometraje, tipoVehiculo,
}: {
  vehiculoId:  number
  modeloId:    number
  kilometraje: number | null
  /** Para el formulario de mantenimiento: define si la unidad lleva odómetro. */
  tipoVehiculo?: TipoVehiculo
}) {
  const { data, isLoading } = useProgramaVehiculo(vehiculoId)
  const estado = data?.data ?? null
  // Solo para el caso sin programa: saber si el modelo tiene alguno que ofrecer.
  const { data: delModelo } = useProgramasModelo(modeloId)

  const asignarMut  = useAsignarPrograma(vehiculoId)
  const etapaMut    = useForzarEtapa(vehiculoId)
  const excepMut    = useSetExcepciones(vehiculoId)
  const quitarMut   = useQuitarPrograma(vehiculoId)
  const visitaMut   = useRegistrarVisita(vehiculoId)
  const deshacerMut = useDeshacerVisita(vehiculoId)
  // La visita se registra creando el mantenimiento y diciendo después qué
  // columna cerró: son el mismo hecho, y el mantenimiento es donde vive.
  const mantMut     = useCreateMantenimiento(vehiculoId)
  const piezasMut   = useCreateDetallesMtto()
  const atenderMut  = useAtenderOperacion(vehiculoId)

  const [arranqueOpen, setArranqueOpen] = useState(false)
  const [visitaOpen, setVisitaOpen]     = useState(false)
  const [quitarOpen, setQuitarOpen]     = useState(false)
  const [excepOpen, setExcepOpen]       = useState(false)
  const [atendiendo, setAtendiendo]     = useState<OperacionPorTiempo | null>(null)
  const [error, setError]               = useState<string | null>(null)

  const [kmInicio, setKmInicio]         = useState<number | null>(null)
  const [fechaInicio, setFechaInicio]   = useState<string | null>(null)
  // Solo para atender un renglón suelto: la visita completa los toma del
  // formulario de mantenimiento.
  const [fechaTrabajo, setFechaTrabajo] = useState(hoyIso())
  const [kmTrabajo, setKmTrabajo]       = useState<number | null>(null)

  const encabezado = (
    <Divider
      label={
        <Group gap="xs">
          <IconChecklist size={14} />
          <Text size="sm" fw={500}>Programa de mantenimiento</Text>
        </Group>
      }
      labelPosition="left"
    />
  )

  if (isLoading) return <>{encabezado}<Center py="lg"><Loader size="sm" /></Center></>

  // ── La unidad no sigue ningún programa ──
  if (!estado) {
    const disponibles = delModelo?.data ?? []
    return (
      <>
        {encabezado}
        <Paper withBorder p="lg" radius="md">
          <Stack gap="sm" align="flex-start">
            {disponibles.length ? (
              <>
                <Text size="sm" c="dimmed">
                  Esta unidad no está siguiendo ningún programa. Su modelo tiene capturado{' '}
                  {disponibles.map((p, i) => (
                    <span key={p.id}>
                      {i > 0 && ' y '}
                      <strong>{p.nombre}</strong> ({TIPO_PROGRAMA_LABEL[p.tipo].toLowerCase()})
                    </span>
                  ))}.
                </Text>
                <Button
                  size="xs" leftSection={<IconPlus size={14} />}
                  loading={asignarMut.isPending}
                  onClick={async () => {
                    setError(null)
                    // Los dos de un golpe: el de post-garantía se asigna desde
                    // ya aunque falten años para usarlo, porque el día que la
                    // garantía venza nadie se va a acordar de venir a ponerlo.
                    // Su arranque se deriva cuando toque, así que no adelanta
                    // nada.
                    try {
                      for (const p of disponibles) {
                        await asignarMut.mutateAsync({ etapa: p.tipo, programa_id: p.id })
                      }
                    } catch (e) { setError((e as Error).message) }
                  }}
                >
                  Seguir {disponibles.length > 1 ? 'estos programas' : 'este programa'}
                </Button>
                <Text size="xs" c="dimmed">
                  El del fabricante arranca en el odómetro de hoy
                  ({kilometraje != null ? `${nf.format(kilometraje)} km` : 'sin lectura'}), para que
                  la unidad no nazca con servicios vencidos. El de post-garantía arranca donde
                  quede el último servicio que reciba bajo el primero. Los dos se pueden corregir.
                </Text>
              </>
            ) : (
              <Text size="sm" c="dimmed">
                El modelo de esta unidad no tiene capturado ningún programa de mantenimiento. Se
                capturan desde la ficha del modelo.
              </Text>
            )}
            {error && <Alert color="red" title="Error">{error}</Alert>}
          </Stack>
        </Paper>
      </>
    )
  }

  const { programa, proxima, siguientes, operaciones_tiempo, visitas, proyeccion } = estado
  const diferencias = estado.excepciones.fases.length + estado.excepciones.operaciones.length
  // El del modelo sin tocar: es contra lo que se editan las diferencias, y
  // `estado.programa` ya las trae aplicadas —una columna omitida ni siquiera
  // aparecería—.
  const delModeloActivo = (delModelo?.data ?? [])
    .find((p) => p.id === estado.vinculo.programa_id) ?? null
  const porTiempo = operaciones_tiempo.filter((o) => o.vencida || o.por_vencer)
  // La última de la etapa activa: es la única que se puede deshacer sin dejar
  // un hueco en el recorrido.
  const visitasEtapa = visitas.filter((v) => v.etapa === estado.etapa)
  const ultimaVisita = visitasEtapa[visitasEtapa.length - 1]

  // Registrar la visita son tres pasos encadenados porque son tres hechos: se
  // registra el mantenimiento, se le cargan las refacciones y se declara qué
  // columna cerró. Si el mantenimiento queda pero el vínculo falla, se dice:
  // el gasto ya está capturado y lo único que falta es marcar la columna, que
  // se puede reintentar sin volver a capturar nada.
  function registrarVisita(payload: MantenimientoPayload, piezas: DetalleMttoPayload[]) {
    setError(null)
    mantMut.mutate(payload, {
      onError: (e: Error) => setError(e.message),
      onSuccess: (res) => {
        const ligar = () => visitaMut.mutate(
          { mantenimiento_id: res.data.id },
          {
            onSuccess: () => setVisitaOpen(false),
            onError: (e: Error) => setError(
              `El mantenimiento se registró, pero no se pudo marcar como el servicio del ` +
              `programa: ${e.message}`
            ),
          }
        )
        if (!piezas.length) { ligar(); return }
        piezasMut.mutate({ mantenimientoId: res.data.id, piezas }, {
          onSuccess: ligar,
          // El mantenimiento ya quedó: lo que falló son las refacciones, y esas
          // se agregan desde su detalle. La columna se marca de todos modos.
          onError: (e: Error) => {
            setError(
              `El mantenimiento se registró, pero no se pudieron guardar todas las ` +
              `refacciones: ${e.message}. Agrégalas desde el detalle del mantenimiento.`
            )
            ligar()
          },
        })
      },
    })
  }

  return (
    <>
      {encabezado}

      <BandaEtapa
        estado={estado}
        isPending={etapaMut.isPending}
        onForzar={(e) => {
          setError(null)
          etapaMut.mutate(e, { onError: (err: Error) => setError(err.message) })
        }}
      />

      <Paper withBorder p="md" radius="md">
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Stack gap={2}>
            <Text fw={600}>{programa.nombre}</Text>
            <Text size="sm" c="dimmed">
              {estado.servicios_hechos === 0
                ? 'sin visitas registradas'
                : `${estado.servicios_hechos} ${estado.servicios_hechos === 1 ? 'visita hecha' : 'visitas hechas'} en esta etapa`}
              {estado.km_recorrido != null && ` · ${nf.format(estado.km_recorrido)} km bajo el programa`}
            </Text>
          </Stack>
          <Group gap="xs" wrap="nowrap">
            {/* Lo que esta unidad hace distinto del programa de su modelo. El
                contador dice si hay algo, para no tener que abrir el modal
                solo para averiguarlo. */}
            <Tooltip label="Lo que esta unidad hace distinto del programa de su modelo">
              <ActionIcon
                variant={diferencias > 0 ? 'filled' : 'light'} color="grape"
                onClick={() => { setError(null); setExcepOpen(true) }}
              >
                <IconAdjustments size={16} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Corregir el arranque del programa">
              <ActionIcon
                variant="light" color="blue"
                onClick={() => {
                  setError(null)
                  setKmInicio(estado.arranque.km)
                  setFechaInicio(estado.arranque.fecha)
                  setArranqueOpen(true)
                }}
              >
                <IconPencil size={16} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Dejar de seguir este programa">
              <ActionIcon variant="light" color="red" onClick={() => setQuitarOpen(true)}>
                <IconTrash size={16} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>
      </Paper>

      {error && <Alert color="red" title="Error">{error}</Alert>}

      {proxima ? (
        <ProximaVisita
          proxima={proxima}
          kmRecorrido={estado.km_recorrido}
          onRegistrar={() => { setError(null); setVisitaOpen(true) }}
        />
      ) : (
        <Alert color="blue" variant="light">
          El programa de este modelo todavía no tiene columnas capturadas.
        </Alert>
      )}

      {/* Los renglones que se vencen por su cuenta. Van aparte de la visita
          porque se atienden aparte: adelantar la columna entera por un cambio
          de aceite mandaría a reemplazar cosas que no tocaban. */}
      {porTiempo.length > 0 && (
        <Paper withBorder p="md" radius="md">
          <Stack gap="sm">
            <Group gap="xs">
              <IconClockExclamation size={16} />
              <Text fw={600} size="sm">Vencen por tiempo, sin esperar a la visita</Text>
            </Group>
            <Table striped withTableBorder verticalSpacing={4}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Operación</Table.Th>
                  <Table.Th style={{ width: 110 }}>Límite</Table.Th>
                  <Table.Th style={{ width: 130 }}>Última vez</Table.Th>
                  <Table.Th style={{ width: 90 }} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {porTiempo.map((o) => (
                  <Table.Tr key={o.operacion.id}>
                    <Table.Td>
                      <Group gap={6} wrap="nowrap">
                        <Badge color={o.vencida ? 'red' : 'yellow'} variant="light" size="sm">
                          {o.vencida ? 'Vencida' : 'Próxima'}
                        </Badge>
                        <Text size="sm">{o.operacion.nombre}</Text>
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs">
                        cada {o.operacion.limite_meses} {o.operacion.limite_meses === 1 ? 'mes' : 'meses'}
                      </Text>
                      {o.meses != null && (
                        <Text size="xs" c="dimmed">llevan {o.meses}</Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" c={o.ultima_fecha ? undefined : 'dimmed'}>
                        {o.ultima_fecha ? fmtFecha(o.ultima_fecha) : 'Nunca'}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Button
                        size="compact-xs" variant="light"
                        onClick={() => {
                          setError(null)
                          setFechaTrabajo(hoyIso())
                          setKmTrabajo(estado.kilometraje)
                          setAtendiendo(o)
                        }}
                      >
                        Atender
                      </Button>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Stack>
        </Paper>
      )}

      {siguientes.length > 0 && (
        <Group gap={6} wrap="wrap">
          <Text size="xs" c="dimmed" fw={600} tt="uppercase" mr={4}>Después</Text>
          {siguientes.map((s) => (
            <Badge key={s.indice} variant="outline" color="gray" size="sm">
              {nf.format(s.km_odometro)} km · col {nf.format(s.fase.km)}
              {s.fase.costo != null && ` · ${formatMXNCorto(s.fase.costo)}`}
            </Badge>
          ))}
        </Group>
      )}

      {/* Lo que va a costar el mantenimiento programado de aquí en adelante.
          Las columnas sin cotizar no se cuentan como cero: se dicen aparte
          para que el total se lea sabiendo qué tanto le falta. */}
      {proyeccion.visitas > 0 && (proyeccion.costo > 0 || proyeccion.sin_costo > 0) && (
        <Paper withBorder p="sm" radius="md">
          <Group justify="space-between" wrap="wrap" gap="xs">
            <Stack gap={0}>
              <Text size="xs" c="dimmed" fw={600} tt="uppercase">
                Costo de las próximas {proyeccion.visitas} visitas
              </Text>
              {proyeccion.hasta_km != null && (
                <Text size="xs" c="dimmed">
                  hasta los {nf.format(proyeccion.hasta_km)} km de odómetro
                </Text>
              )}
            </Stack>
            <Group gap="xs">
              <Text fw={700}>{formatMXN(proyeccion.costo)}</Text>
              {proyeccion.sin_costo > 0 && (
                <Tooltip label="Esas columnas no tienen cotización capturada, así que no entran en el total">
                  <Badge color="gray" variant="light" size="sm">
                    +{proyeccion.sin_costo} sin cotizar
                  </Badge>
                </Tooltip>
              )}
            </Group>
          </Group>
        </Paper>
      )}

      {visitas.length > 0 && (
        <Table.ScrollContainer minWidth={420}>
          <Table striped withTableBorder verticalSpacing={4}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th style={{ width: 60 }}>Visita</Table.Th>
                <Table.Th>Columna</Table.Th>
                <Table.Th>Fecha</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Odómetro</Table.Th>
                {/* Lo que costó de verdad, que es lo que se gana con que la
                    visita sea el mantenimiento y no un registro aparte. */}
                <Table.Th style={{ textAlign: 'right' }}>Costo</Table.Th>
                <Table.Th style={{ width: 40 }} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {[...visitas].reverse().map((v) => {
                const fase = programa.fases.find((f) => f.id === v.fase_id)
                return (
                  <Table.Tr key={v.id}>
                    <Table.Td><Text size="sm">{v.indice + 1}</Text></Table.Td>
                    <Table.Td>
                      <Group gap={6} wrap="nowrap">
                        {/* La columna solo se resuelve dentro de su etapa: las
                            de la otra son de un programa que no está cargado. */}
                        <Text size="sm">{fase ? `${nf.format(fase.km)} km` : '—'}</Text>
                        {v.etapa !== estado.etapa && (
                          <Badge size="xs" variant="outline" color="gray">
                            {TIPO_PROGRAMA_LABEL[v.etapa]}
                          </Badge>
                        )}
                      </Group>
                    </Table.Td>
                    <Table.Td><Text size="sm">{fmtFecha(v.fecha)}</Text></Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>
                      <Text size="sm">{v.km != null ? `${nf.format(v.km)} km` : '—'}</Text>
                    </Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>
                      <Text size="sm">{formatMXN(v.costo)}</Text>
                    </Table.Td>
                    <Table.Td>
                      {/* Solo la última: deshacer una de en medio dejaría un
                          hueco en el recorrido. */}
                      {v.id === ultimaVisita?.id && (
                        <Tooltip
                          label="Deshacer: la columna vuelve a pedirse. El mantenimiento se queda."
                          multiline w={230}
                        >
                          <ActionIcon
                            variant="subtle" color="red" size="sm"
                            loading={deshacerMut.isPending}
                            onClick={() => {
                              setError(null)
                              deshacerMut.mutate(v.id, { onError: (e: Error) => setError(e.message) })
                            }}
                          >
                            <IconArrowBackUp size={14} />
                          </ActionIcon>
                        </Tooltip>
                      )}
                    </Table.Td>
                  </Table.Tr>
                )
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}

      {/* ── Modales ── */}

      {/* La visita se captura como lo que es: un mantenimiento. El formulario
          es el mismo de siempre —con su costo, su técnico y sus refacciones—;
          lo único que agrega esta pantalla es decir, al guardarlo, qué columna
          del programa cerró. */}
      <Modal
        opened={visitaOpen} onClose={() => setVisitaOpen(false)}
        title={proxima ? `Registrar el servicio de ${nf.format(proxima.fase.km)} km` : 'Registrar visita'}
        centered size="lg"
      >
        <Stack gap="sm">
          <Alert color="blue" variant="light">
            Se registra como un mantenimiento normal. Al guardarlo se dan por hechas las{' '}
            {proxima?.operaciones.length ?? 0} operaciones de la columna, y sus límites de meses
            vuelven a contar desde esta fecha.
          </Alert>
          <MantenimientoForm
            vehiculoId={vehiculoId}
            tipoVehiculo={tipoVehiculo}
            // Este mantenimiento existe por el programa, así que su origen ya
            // está dado y no se elige: se pinta fijo en "qué atiende", y lo
            // demás que se haya aprovechado la entrada al taller se agrega
            // encima con normalidad.
            origenFijo={{
              etiqueta: proxima
                ? `PREVENCIÓN — servicio de ${nf.format(proxima.fase.km)} km`
                : 'PREVENCIÓN',
              ayuda:
                'Este mantenimiento es la visita con la que la unidad cierra esa columna de su ' +
                'programa: por eso su origen es la prevención y no se puede quitar.',
            }}
            isPending={visitaMut.isPending || mantMut.isPending || piezasMut.isPending}
            error={error}
            onSubmit={registrarVisita}
            onCancel={() => setVisitaOpen(false)}
          />
        </Stack>
      </Modal>

      <Modal
        opened={atendiendo !== null} onClose={() => setAtendiendo(null)}
        title="Atender la operación" centered size="md"
      >
        <Stack gap="sm">
          <Text size="sm">{atendiendo?.operacion.nombre}</Text>
          <Text size="xs" c="dimmed">
            Solo pone al día este renglón. La visita completa sigue esperando su kilometraje.
          </Text>
          <FechaInput
            label="Fecha"
            value={fechaTrabajo}
            onChange={(d) => setFechaTrabajo(d ?? hoyIso())}
            maxDate={hoyIso()}
          />
          <NumberInput
            label="Odómetro" min={0} max={KM_MAX}
            suffix=" km" thousandSeparator=","
            allowDecimal={false} allowNegative={false} clampBehavior="strict"
            value={kmTrabajo ?? ''}
            onChange={(v) => setKmTrabajo(typeof v === 'number' ? v : parseInt(String(v), 10) || null)}
          />
          {atenderMut.error && <Alert color="red" title="Error">{(atenderMut.error as Error).message}</Alert>}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setAtendiendo(null)} disabled={atenderMut.isPending}>
              Cancelar
            </Button>
            <Button
              loading={atenderMut.isPending}
              onClick={() => atenderMut.mutate(
                { operacionId: atendiendo!.operacion.id, fecha: fechaTrabajo, km: kmTrabajo },
                { onSuccess: () => setAtendiendo(null) }
              )}
            >
              Marcar como hecha
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={arranqueOpen} onClose={() => setArranqueOpen(false)}
        title="Arranque del programa" centered size="md"
      >
        <Stack gap="sm">
          <Text size="sm" c="dimmed">
            El punto cero del recorrido de esta unidad. El kilometraje de cada visita se cuenta
            desde aquí, y los límites de meses también, mientras un renglón no se haya atendido
            nunca.
          </Text>
          <NumberInput
            label="Odómetro de arranque" min={0} max={KM_MAX}
            suffix=" km" thousandSeparator=","
            allowDecimal={false} allowNegative={false} clampBehavior="strict"
            value={kmInicio ?? ''}
            onChange={(v) => setKmInicio(typeof v === 'number' ? v : parseInt(String(v), 10) || 0)}
          />
          <FechaInput
            label="Fecha de arranque" clearable
            description="Normalmente la de compra o la de entrega."
            value={fechaInicio}
            onChange={(d) => setFechaInicio(d)}
          />
          {asignarMut.error && <Alert color="red" title="Error">{(asignarMut.error as Error).message}</Alert>}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setArranqueOpen(false)} disabled={asignarMut.isPending}>
              Cancelar
            </Button>
            <Button
              loading={asignarMut.isPending}
              onClick={() => asignarMut.mutate(
                { etapa: estado.etapa, km_inicio: kmInicio ?? 0, fecha_inicio: fechaInicio },
                { onSuccess: () => setArranqueOpen(false) }
              )}
            >
              Guardar
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={excepOpen} onClose={() => setExcepOpen(false)}
        title="Lo que esta unidad hace distinto" centered size="xl"
      >
        {delModeloActivo ? (
          <ProgramaExcepcionesModal
            programa={delModeloActivo}
            excepciones={estado.excepciones}
            isPending={excepMut.isPending}
            error={error}
            onSubmit={(e) => {
              setError(null)
              excepMut.mutate(e, {
                onSuccess: () => setExcepOpen(false),
                onError:   (err: Error) => setError(err.message),
              })
            }}
            onCancel={() => setExcepOpen(false)}
          />
        ) : (
          <Center py="lg"><Loader size="sm" /></Center>
        )}
      </Modal>

      <Modal
        opened={quitarOpen} onClose={() => setQuitarOpen(false)}
        title="Dejar de seguir el programa" centered size="sm"
      >
        <Stack gap="md">
          <Text>
            ¿Quitarle a esta unidad el programa <strong>{TIPO_PROGRAMA_LABEL[estado.etapa].toLowerCase()}</strong>?
          </Text>
          <Alert color="orange" title="Atención" variant="light">
            Se borra su avance en esta etapa: las{' '}
            {visitas.filter((v) => v.etapa === estado.etapa).length} visitas registradas y lo que
            tuviera al día renglón por renglón. La otra etapa y el programa del modelo no se tocan.
          </Alert>
          {quitarMut.error && <Alert color="red" title="Error">{(quitarMut.error as Error).message}</Alert>}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setQuitarOpen(false)} disabled={quitarMut.isPending}>
              Cancelar
            </Button>
            <Button color="red" loading={quitarMut.isPending}
              onClick={() => quitarMut.mutate(estado.etapa, { onSuccess: () => setQuitarOpen(false) })}>
              Sí, quitarlo
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  )
}
