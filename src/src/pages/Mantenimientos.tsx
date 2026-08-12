// Página Mantenimientos: historial de servicios de toda la flota en un solo
// lugar. El detalle de cada vehículo sigue siendo donde se registran; ésta
// existe para rastrearlos sin saber de antemano a qué unidad pertenecen, y para
// dar de baja los que sobran (borrarlos devuelve las refacciones al inventario
// y reabre los pendientes que cerraban).
import { useState, useMemo } from 'react'
import {
  Stack, Group, Text, TextInput, Table, Badge, Select, Paper,
  Alert, Loader, Center, Button, ActionIcon, Modal, Anchor, Tooltip,
} from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import { IconTrash, IconSearch } from '@tabler/icons-react'
import {
  useTodosLosMantenimientos, useDeleteMantenimiento,
} from '../hooks/useMantenimientos'
import type { MantenimientoDeFlota } from '../hooks/useMantenimientos'
import MantenimientoDetalleDrawer from '../components/MantenimientoDetalleDrawer'

function formatMXN(n: number) {
  return n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })
}

// La fecha llega como date de SQL (medianoche UTC); se ancla a mediodía para
// que no retroceda un día al pasarla a la zona local.
function fmtFecha(iso: string | null) {
  if (!iso) return '—'
  return new Date(`${iso.split('T')[0]}T12:00:00`).toLocaleDateString('es-MX', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

function anioDe(iso: string | null): string | null {
  return iso ? iso.split('T')[0].slice(0, 4) : null
}

const TIPO_COLOR: Record<string, string> = {
  Preventivo: 'blue',
  Correctivo: 'orange',
}

function Metrica({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>{label}</Text>
      <Text fw={700} size="lg">{value}</Text>
    </div>
  )
}

export default function Mantenimientos({
  onNavigateVehiculo,
}: {
  onNavigateVehiculo?: (vehiculoId: number) => void
}) {
  const [search, setSearch] = useState('')
  const [debouncedSearch] = useDebouncedValue(search, 300)
  const [tipo, setTipo] = useState<string | null>(null)
  const [anio, setAnio] = useState<string | null>(null)
  const [detalleId, setDetalleId] = useState<number | null>(null)
  const [aEliminar, setAEliminar] = useState<MantenimientoDeFlota | null>(null)

  const { data, isLoading, isError } = useTodosLosMantenimientos()
  const deleteMut = useDeleteMantenimiento()

  const todos = useMemo(() => data?.data ?? [], [data])

  const anioOptions = useMemo(() => {
    const anios = new Set<string>()
    for (const m of todos) {
      const a = anioDe(m.fecha)
      if (a) anios.add(a)
    }
    return [...anios].sort().reverse().map((a) => ({ value: a, label: a }))
  }, [todos])

  const filtrados = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase()
    return todos.filter((m) => {
      if (tipo && m.tipo !== tipo) return false
      if (anio && anioDe(m.fecha) !== anio) return false
      if (!q) return true
      return [m.vehiculo_serie, m.vehiculo_placas, m.tecnico, m.observaciones, m.tipo]
        .some((campo) => campo?.toLowerCase().includes(q))
    })
  }, [todos, debouncedSearch, tipo, anio])

  const totales = useMemo(() => filtrados.reduce(
    (acc, m) => ({
      mano:     acc.mano + (m.costo ?? 0),
      piezas:   acc.piezas + (m.piezas_total ?? 0),
    }),
    { mano: 0, piezas: 0 },
  ), [filtrados])

  const hayFiltros = !!(debouncedSearch.trim() || tipo || anio)

  function handleDelete() {
    if (!aEliminar) return
    deleteMut.mutate(aEliminar.id, {
      onSuccess: () => {
        if (detalleId === aEliminar.id) setDetalleId(null)
        setAEliminar(null)
      },
    })
  }

  return (
    <>
      <Stack gap="md">
        {/* Encabezado */}
        <Group justify="space-between" align="flex-end">
          <div>
            <Text size="xl" fw={600}>Mantenimientos</Text>
            <Text size="sm" c="dimmed">Historial de servicios de toda la flota</Text>
          </div>
        </Group>

        {/* Resumen de lo que se está viendo, no del total histórico: cambia con
            los filtros para poder leer el gasto de un año o de una unidad. */}
        <Paper withBorder p="md" radius="md">
          <Group gap="xl">
            <Metrica label={hayFiltros ? 'Filtrados' : 'Mantenimientos'} value={String(filtrados.length)} />
            <Metrica label="Mano de obra" value={formatMXN(totales.mano)} />
            <Metrica label="Refacciones" value={formatMXN(totales.piezas)} />
            <Metrica label="Total" value={formatMXN(totales.mano + totales.piezas)} />
          </Group>
        </Paper>

        {/* Filtros */}
        <Group gap="xs" wrap="nowrap" align="flex-end">
          <TextInput
            style={{ flex: 1 }}
            placeholder="Buscar por unidad, placas, técnico u observaciones…"
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            leftSection={<IconSearch size={16} />}
          />
          <Select
            w={150}
            placeholder="Tipo"
            data={[{ value: 'Preventivo', label: 'Preventivo' }, { value: 'Correctivo', label: 'Correctivo' }]}
            value={tipo}
            onChange={setTipo}
            clearable
          />
          <Select
            w={110}
            placeholder="Año"
            data={anioOptions}
            value={anio}
            onChange={setAnio}
            clearable
          />
        </Group>

        {isLoading ? (
          <Center py="xl"><Loader /></Center>
        ) : isError ? (
          <Alert color="red" title="Error al cargar">
            No se pudieron obtener los mantenimientos. Verifica la conexión.
          </Alert>
        ) : filtrados.length === 0 ? (
          <Center py="xl">
            <Text c="dimmed">
              {todos.length === 0
                ? 'No hay mantenimientos registrados. Se registran desde el detalle de cada vehículo.'
                : 'Ningún mantenimiento coincide con los filtros.'}
            </Text>
          </Center>
        ) : (
          <Table.ScrollContainer minWidth={900}>
            <Table striped highlightOnHover withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th style={{ width: 120 }}>Fecha</Table.Th>
                  <Table.Th>Unidad</Table.Th>
                  <Table.Th style={{ width: 110 }}>Tipo</Table.Th>
                  <Table.Th>Técnico</Table.Th>
                  <Table.Th style={{ textAlign: 'right', width: 100 }}>Km</Table.Th>
                  <Table.Th style={{ textAlign: 'right', width: 120 }}>Mano de obra</Table.Th>
                  <Table.Th style={{ textAlign: 'right', width: 120 }}>Refacciones</Table.Th>
                  <Table.Th style={{ textAlign: 'right', width: 120 }}>Total</Table.Th>
                  <Table.Th style={{ width: 48 }} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {filtrados.map((m) => (
                  <Table.Tr
                    key={m.id}
                    onClick={() => setDetalleId(m.id)}
                    style={{ cursor: 'pointer' }}
                  >
                    <Table.Td>{fmtFecha(m.fecha)}</Table.Td>
                    <Table.Td onClick={(e) => e.stopPropagation()}>
                      {onNavigateVehiculo ? (
                        <Anchor component="button" type="button" size="sm"
                          onClick={() => onNavigateVehiculo(m.vehiculo_id)}>
                          {m.vehiculo_serie}
                        </Anchor>
                      ) : (
                        <Text size="sm">{m.vehiculo_serie}</Text>
                      )}
                      {m.vehiculo_placas && (
                        <Text size="xs" c="dimmed">{m.vehiculo_placas}</Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      {m.tipo
                        ? <Badge variant="light" size="sm" color={TIPO_COLOR[m.tipo] ?? 'gray'}>{m.tipo}</Badge>
                        : <Text c="dimmed" size="sm">—</Text>}
                    </Table.Td>
                    <Table.Td c={m.tecnico ? undefined : 'dimmed'}>{m.tecnico ?? '—'}</Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>
                      {m.km_actual ? m.km_actual.toLocaleString('es-MX') : '—'}
                    </Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>{formatMXN(m.costo ?? 0)}</Table.Td>
                    <Table.Td style={{ textAlign: 'right' }} c={m.piezas_total ? undefined : 'dimmed'}>
                      {m.piezas_total ? formatMXN(m.piezas_total) : '—'}
                    </Table.Td>
                    <Table.Td style={{ textAlign: 'right' }} fw={600}>
                      {formatMXN((m.costo ?? 0) + (m.piezas_total ?? 0))}
                    </Table.Td>
                    <Table.Td onClick={(e) => e.stopPropagation()}>
                      <Tooltip label="Eliminar mantenimiento">
                        <ActionIcon
                          variant="subtle" color="red" aria-label="Eliminar"
                          onClick={() => setAEliminar(m)}
                        >
                          <IconTrash size={16} />
                        </ActionIcon>
                      </Tooltip>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Stack>

      <MantenimientoDetalleDrawer
        mantenimientoId={detalleId}
        onClose={() => setDetalleId(null)}
      />

      {/* Modal: confirmar eliminación */}
      <Modal
        opened={aEliminar !== null}
        onClose={() => setAEliminar(null)}
        title="Eliminar mantenimiento"
        centered
        size="sm"
      >
        <Stack gap="md">
          <Text>
            ¿Seguro que deseas eliminar el mantenimiento del{' '}
            <Text component="span" fw={700}>{aEliminar ? fmtFecha(aEliminar.fecha) : ''}</Text>
            {' '}de{' '}
            <Text component="span" fw={700}>{aEliminar?.vehiculo_serie}</Text>?
          </Text>
          <Text size="sm" c="dimmed">
            Las refacciones que consumió regresan al inventario y los requerimientos
            e incidencias que cerraba vuelven a quedar abiertos.
          </Text>
          {deleteMut.error && (
            <Alert color="red" title="Error">
              {(deleteMut.error as Error).message}
            </Alert>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setAEliminar(null)} disabled={deleteMut.isPending}>
              Cancelar
            </Button>
            <Button color="red" onClick={handleDelete} loading={deleteMut.isPending}>
              Eliminar
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  )
}
