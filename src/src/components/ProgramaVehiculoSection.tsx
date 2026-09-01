// El programa del fabricante visto desde una unidad.
//
// Dos cosas distintas se vencen aquí, y la sección está partida en dos por eso:
//
//  - La **visita**: cuando el odómetro llega a la marca de la siguiente columna,
//    toca hacer esa columna entera. Es el lado grupal del programa.
//  - El **renglón**: cada operación trae su "o cada N meses" y corre por su
//    cuenta. Puede vencer con la visita todavía lejos, y entonces se atiende
//    solo, sin adelantar el resto de la columna.
import { useState } from 'react'
import {
  Stack, Group, Text, Table, Badge, Button, Modal, Alert, Loader, Center,
  ActionIcon, Tooltip, Divider, Paper, NumberInput, Progress,
} from '@mantine/core'
import {
  IconChecklist, IconPencil, IconTrash, IconPlus, IconClockExclamation, IconArrowBackUp,
} from '@tabler/icons-react'
import {
  useProgramaVehiculo, useAsignarPrograma, useQuitarPrograma,
  useRegistrarVisita, useDeshacerVisita, useAtenderOperacion,
} from '../hooks/useProgramaVehiculo'
import type { ServicioPendiente, OperacionPorTiempo } from '../hooks/useProgramaVehiculo'
import { useProgramaModelo } from '../hooks/usePrograma'
import { KM_MAX } from '../lib/validaciones'
import { FechaInput } from './FechaInput'

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
  vehiculoId, modeloId, kilometraje,
}: {
  vehiculoId:  number
  modeloId:    number
  kilometraje: number | null
}) {
  const { data, isLoading } = useProgramaVehiculo(vehiculoId)
  const estado = data?.data ?? null
  // Solo para el caso sin programa: saber si el modelo tiene uno que ofrecer.
  const { data: delModelo } = useProgramaModelo(modeloId)

  const asignarMut  = useAsignarPrograma(vehiculoId)
  const quitarMut   = useQuitarPrograma(vehiculoId)
  const visitaMut   = useRegistrarVisita(vehiculoId)
  const deshacerMut = useDeshacerVisita(vehiculoId)
  const atenderMut  = useAtenderOperacion(vehiculoId)

  const [arranqueOpen, setArranqueOpen] = useState(false)
  const [visitaOpen, setVisitaOpen]     = useState(false)
  const [quitarOpen, setQuitarOpen]     = useState(false)
  const [atendiendo, setAtendiendo]     = useState<OperacionPorTiempo | null>(null)
  const [error, setError]               = useState<string | null>(null)

  const [kmInicio, setKmInicio]         = useState<number | null>(null)
  const [fechaInicio, setFechaInicio]   = useState<string | null>(null)
  const [fechaTrabajo, setFechaTrabajo] = useState(hoyIso())
  const [kmTrabajo, setKmTrabajo]       = useState<number | null>(null)

  const encabezado = (
    <Divider
      label={
        <Group gap="xs">
          <IconChecklist size={14} />
          <Text size="sm" fw={500}>Programa del fabricante</Text>
        </Group>
      }
      labelPosition="left"
    />
  )

  if (isLoading) return <>{encabezado}<Center py="lg"><Loader size="sm" /></Center></>

  // ── La unidad no sigue ningún programa ──
  if (!estado) {
    const disponible = delModelo?.data ?? null
    return (
      <>
        {encabezado}
        <Paper withBorder p="lg" radius="md">
          <Stack gap="sm" align="flex-start">
            {disponible ? (
              <>
                <Text size="sm" c="dimmed">
                  Esta unidad no está siguiendo el programa del fabricante. Su modelo tiene
                  capturado <strong>{disponible.nombre}</strong>.
                </Text>
                <Button
                  size="xs" leftSection={<IconPlus size={14} />}
                  loading={asignarMut.isPending}
                  onClick={() => {
                    setError(null)
                    asignarMut.mutate(
                      { programa_id: disponible.id },
                      { onError: (e: Error) => setError(e.message) }
                    )
                  }}
                >
                  Seguir este programa
                </Button>
                <Text size="xs" c="dimmed">
                  Arranca en el odómetro de hoy ({kilometraje != null ? `${nf.format(kilometraje)} km` : 'sin lectura'}),
                  para que la unidad no nazca con servicios vencidos. Después se puede corregir.
                </Text>
              </>
            ) : (
              <Text size="sm" c="dimmed">
                El modelo de esta unidad no tiene capturado el programa del fabricante. Se captura
                desde la ficha del modelo.
              </Text>
            )}
            {error && <Alert color="red" title="Error">{error}</Alert>}
          </Stack>
        </Paper>
      </>
    )
  }

  const { programa, proxima, siguientes, operaciones_tiempo, visitas, vinculo } = estado
  const porTiempo = operaciones_tiempo.filter((o) => o.vencida || o.por_vencer)
  const ultimaVisita = visitas[visitas.length - 1]

  return (
    <>
      {encabezado}

      <Paper withBorder p="md" radius="md">
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Stack gap={2}>
            <Text fw={600}>{programa.nombre}</Text>
            <Text size="sm" c="dimmed">
              Arranca en {nf.format(vinculo.km_inicio)} km
              {vinculo.fecha_inicio && ` · ${fmtFecha(vinculo.fecha_inicio)}`}
              {' · '}
              {estado.servicios_hechos === 0
                ? 'sin visitas registradas'
                : `${estado.servicios_hechos} ${estado.servicios_hechos === 1 ? 'visita hecha' : 'visitas hechas'}`}
              {estado.km_recorrido != null && ` · ${nf.format(estado.km_recorrido)} km bajo el programa`}
            </Text>
          </Stack>
          <Group gap="xs" wrap="nowrap">
            <Tooltip label="Corregir el arranque del programa">
              <ActionIcon
                variant="light" color="blue"
                onClick={() => {
                  setError(null)
                  setKmInicio(vinculo.km_inicio)
                  setFechaInicio(vinculo.fecha_inicio)
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
          onRegistrar={() => {
            setError(null)
            setFechaTrabajo(hoyIso())
            setKmTrabajo(estado.kilometraje)
            setVisitaOpen(true)
          }}
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
            </Badge>
          ))}
        </Group>
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
                      <Text size="sm">{fase ? `${nf.format(fase.km)} km` : '—'}</Text>
                    </Table.Td>
                    <Table.Td><Text size="sm">{fmtFecha(v.fecha)}</Text></Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>
                      <Text size="sm">{v.km != null ? `${nf.format(v.km)} km` : '—'}</Text>
                    </Table.Td>
                    <Table.Td>
                      {/* Solo la última: deshacer una de en medio dejaría un
                          hueco en el recorrido. */}
                      {v.id === ultimaVisita?.id && (
                        <Tooltip label="Deshacer esta visita">
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

      <Modal
        opened={visitaOpen} onClose={() => setVisitaOpen(false)}
        title={proxima ? `Registrar el servicio de ${nf.format(proxima.fase.km)} km` : 'Registrar visita'}
        centered size="md"
      >
        <Stack gap="sm">
          <Text size="sm" c="dimmed">
            Se dan por hechas las {proxima?.operaciones.length ?? 0} operaciones de esta columna.
            Los renglones que se atiendan aquí dejan de contar su límite de meses desde esta fecha.
          </Text>
          <FechaInput
            label="Fecha del servicio"
            value={fechaTrabajo}
            onChange={(d) => setFechaTrabajo(d ?? hoyIso())}
            maxDate={hoyIso()}
          />
          <NumberInput
            label="Odómetro" min={0} max={KM_MAX}
            suffix=" km" thousandSeparator=","
            description="Con el que entró al taller."
            allowDecimal={false} allowNegative={false} clampBehavior="strict"
            value={kmTrabajo ?? ''}
            onChange={(v) => setKmTrabajo(typeof v === 'number' ? v : parseInt(String(v), 10) || null)}
          />
          {visitaMut.error && <Alert color="red" title="Error">{(visitaMut.error as Error).message}</Alert>}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setVisitaOpen(false)} disabled={visitaMut.isPending}>
              Cancelar
            </Button>
            <Button
              loading={visitaMut.isPending}
              onClick={() => visitaMut.mutate(
                { fecha: fechaTrabajo, km: kmTrabajo },
                { onSuccess: () => setVisitaOpen(false) }
              )}
            >
              Registrar
            </Button>
          </Group>
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
                { km_inicio: kmInicio ?? 0, fecha_inicio: fechaInicio },
                { onSuccess: () => setArranqueOpen(false) }
              )}
            >
              Guardar
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={quitarOpen} onClose={() => setQuitarOpen(false)}
        title="Dejar de seguir el programa" centered size="sm"
      >
        <Stack gap="md">
          <Text>¿Quitarle el programa a esta unidad?</Text>
          <Alert color="orange" title="Atención" variant="light">
            Se borra su avance: las {visitas.length} visitas registradas y lo que tuviera al día
            renglón por renglón. El programa del modelo no se toca.
          </Alert>
          {quitarMut.error && <Alert color="red" title="Error">{(quitarMut.error as Error).message}</Alert>}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setQuitarOpen(false)} disabled={quitarMut.isPending}>
              Cancelar
            </Button>
            <Button color="red" loading={quitarMut.isPending}
              onClick={() => quitarMut.mutate(undefined, { onSuccess: () => setQuitarOpen(false) })}>
              Sí, quitarlo
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  )
}
