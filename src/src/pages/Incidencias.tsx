// Página Incidencias: lo reportado en toda la flota, con alta, edición y baja.
// Una incidencia se cierra atendiéndola en un mantenimiento (desde el detalle
// del vehículo) o se cancela, que conserva el registro pero deja de alertar.
import { useMemo, useState } from 'react'
import {
  Stack, Group, Text, Table, Loader, Center, Alert, Badge, Button, ActionIcon,
  Modal, Select, TextInput, Tooltip, SegmentedControl,
} from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import { IconPencil, IconTrash, IconPlus, IconAlertTriangle, IconSearch } from '@tabler/icons-react'
import {
  useIncidencias, useCreateIncidencia, useUpdateIncidencia, useDeleteIncidencia,
} from '../hooks/useIncidencias'
import type { Incidencia, IncidenciaConVehiculo, IncidenciaPayload } from '../hooks/useIncidencias'
import { useVehiculos, vehiculoLabel } from '../hooks/useVehiculos'
import IncidenciaForm from '../components/IncidenciaForm'
import { SEVERIDAD_META, STATUS_INCIDENCIA_META } from '../lib/incidenciaMeta'

function fmtFechaHora(fecha: string, hora: string | null) {
  const f = new Date(`${fecha.split('T')[0]}T12:00:00`).toLocaleDateString('es-MX', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
  return hora ? `${f}, ${hora.slice(0, 5)}` : f
}

export default function Incidencias() {
  const { data, isLoading, isError } = useIncidencias()
  const { data: vehiculosData } = useVehiculos()

  const [filtro, setFiltro]       = useState<'abiertas' | 'todas'>('abiertas')
  const [busqueda, setBusqueda]   = useState('')
  const [debounced]               = useDebouncedValue(busqueda, 250)

  // El vehículo se elige al crear; al editar sale de la propia incidencia.
  const [createOpen, setCreateOpen]   = useState(false)
  const [vehiculoNueva, setVehiculoNueva] = useState<string | null>(null)
  const [editando, setEditando]       = useState<IncidenciaConVehiculo | null>(null)
  const [borrando, setBorrando]       = useState<IncidenciaConVehiculo | null>(null)
  const [formError, setFormError]     = useState<string | null>(null)

  // Las mutaciones necesitan el id del vehículo para invalidar sus listas.
  const vehiculoActivo = editando?.vehiculo_id ?? borrando?.vehiculo_id ?? Number(vehiculoNueva ?? 0)
  const createMut = useCreateIncidencia(vehiculoActivo)
  const updateMut = useUpdateIncidencia(vehiculoActivo)
  const deleteMut = useDeleteIncidencia(vehiculoActivo)

  const incidencias = useMemo(() => data?.data ?? [], [data])

  const visibles = useMemo(() => {
    const q = debounced.trim().toLowerCase()
    return incidencias.filter((i) => {
      if (filtro === 'abiertas' && i.status !== 'activo') return false
      if (!q) return true
      return [i.nombre, i.categoria, i.vehiculo_nombre, i.ubicacion, i.reportado_por, i.autorizado_por]
        .some((c) => c?.toLowerCase().includes(q))
    })
  }, [incidencias, filtro, debounced])

  const abiertas = incidencias.filter((i) => i.status === 'activo').length
  const graves   = incidencias.filter((i) => i.status === 'activo' && i.severidad === 'grave').length

  const vehiculoOptions = (vehiculosData?.data ?? []).map((v) => ({
    value: String(v.id), label: vehiculoLabel(v),
  }))

  function handleCreate(payload: IncidenciaPayload) {
    setFormError(null)
    createMut.mutate(payload, {
      onSuccess: () => { setCreateOpen(false); setVehiculoNueva(null) },
      onError: (e) => setFormError((e as Error).message),
    })
  }

  function handleUpdate(payload: IncidenciaPayload) {
    if (!editando) return
    setFormError(null)
    updateMut.mutate({ id: editando.id, payload }, {
      onSuccess: () => setEditando(null),
      onError: (e) => setFormError((e as Error).message),
    })
  }

  return (
    <>
      <Stack gap="md">
        <Group justify="space-between" align="flex-end">
          <div>
            <Text size="xl" fw={600}>Incidencias</Text>
            <Text size="sm" c="dimmed">Lo reportado en la flota y que está por atenderse</Text>
          </div>
          <Button
            leftSection={<IconPlus size={16} />}
            onClick={() => { setFormError(null); setVehiculoNueva(null); setCreateOpen(true) }}
          >
            Nueva incidencia
          </Button>
        </Group>

        {abiertas > 0 && (
          <Alert
            color={graves > 0 ? 'red' : 'orange'}
            title={`${abiertas} incidencia${abiertas !== 1 ? 's' : ''} sin atender`}
            icon={<IconAlertTriangle size={16} />}
          >
            {graves > 0 ? (
              <>
                De ellas, <strong>{graves}</strong> {graves !== 1 ? 'son graves' : 'es grave'}: esas
                unidades no deberían salir así.
              </>
            ) : (
              <>Ninguna es grave.</>
            )}{' '}
            Se cierran solas al registrar el mantenimiento que las atiende.
          </Alert>
        )}

        <Group justify="space-between" wrap="wrap" gap="sm">
          <SegmentedControl
            value={filtro}
            onChange={(v) => setFiltro(v as 'abiertas' | 'todas')}
            data={[
              { value: 'abiertas', label: `Sin atender (${abiertas})` },
              { value: 'todas',    label: `Todas (${incidencias.length})` },
            ]}
          />
          <TextInput
            placeholder="Buscar por nombre, vehículo, categoría…"
            leftSection={<IconSearch size={16} />}
            value={busqueda}
            onChange={(e) => setBusqueda(e.currentTarget.value)}
            w={320}
          />
        </Group>

        {isLoading ? (
          <Center py="xl"><Loader /></Center>
        ) : isError ? (
          <Alert color="red" title="Error">No se pudieron cargar las incidencias.</Alert>
        ) : visibles.length === 0 ? (
          <Center py="xl">
            <Text c="dimmed" size="sm">
              {incidencias.length === 0
                ? 'Todavía no hay incidencias registradas.'
                : 'Ninguna incidencia coincide con el filtro.'}
            </Text>
          </Center>
        ) : (
          <Table.ScrollContainer minWidth={1040}>
            <Table striped highlightOnHover withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Incidencia</Table.Th>
                  <Table.Th>Vehículo</Table.Th>
                  <Table.Th>Categoría</Table.Th>
                  <Table.Th>Severidad</Table.Th>
                  <Table.Th>Reportada</Table.Th>
                  <Table.Th>Reportó</Table.Th>
                  <Table.Th>Autorizó</Table.Th>
                  <Table.Th style={{ textAlign: 'center' }}>Status</Table.Th>
                  <Table.Th style={{ width: 80 }} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {visibles.map((i) => {
                  const sev = SEVERIDAD_META[i.severidad]
                  const st  = STATUS_INCIDENCIA_META[i.status]
                  return (
                    <Table.Tr key={i.id}>
                      <Table.Td fw={500}>{i.nombre}</Table.Td>
                      <Table.Td><Text size="sm">{i.vehiculo_nombre}</Text></Table.Td>
                      <Table.Td>{i.categoria ?? <Text component="span" c="dimmed" size="sm">—</Text>}</Table.Td>
                      <Table.Td>
                        <Badge variant="light" color={sev.color} size="sm">{sev.label}</Badge>
                      </Table.Td>
                      <Table.Td><Text size="sm">{fmtFechaHora(i.fecha, i.hora)}</Text></Table.Td>
                      <Table.Td>
                        {i.reportado_por ?? <Text component="span" c="dimmed" size="sm">—</Text>}
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">
                          {i.autorizado_por || <Text component="span" c="dimmed" size="sm">—</Text>}
                        </Text>
                      </Table.Td>
                      <Table.Td style={{ textAlign: 'center' }}>
                        <Badge variant="light" color={st.color} size="sm">{st.label}</Badge>
                      </Table.Td>
                      <Table.Td>
                        <Group gap={4} justify="flex-end">
                          <Tooltip label="Editar">
                            <ActionIcon variant="subtle" color="blue" size="sm"
                              onClick={() => { setFormError(null); setEditando(i) }}>
                              <IconPencil size={14} />
                            </ActionIcon>
                          </Tooltip>
                          <Tooltip label="Eliminar">
                            <ActionIcon variant="subtle" color="red" size="sm" onClick={() => setBorrando(i)}>
                              <IconTrash size={14} />
                            </ActionIcon>
                          </Tooltip>
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  )
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Stack>

      <Modal
        opened={createOpen} onClose={() => setCreateOpen(false)}
        title="Nueva incidencia" centered size="md"
      >
        <Stack gap="sm">
          <Select
            label="Vehículo" required
            placeholder="¿De qué unidad es la incidencia?"
            data={vehiculoOptions}
            searchable
            value={vehiculoNueva}
            onChange={setVehiculoNueva}
          />
          {vehiculoNueva ? (
            <IncidenciaForm
              isPending={createMut.isPending}
              error={formError}
              onSubmit={handleCreate}
              onCancel={() => setCreateOpen(false)}
            />
          ) : (
            <Text c="dimmed" size="sm">Elige primero el vehículo.</Text>
          )}
        </Stack>
      </Modal>

      <Modal
        opened={editando !== null} onClose={() => setEditando(null)}
        title="Editar incidencia" centered size="md"
      >
        {editando && (
          <IncidenciaForm
            initial={editando as Incidencia}
            isPending={updateMut.isPending}
            error={formError}
            onSubmit={handleUpdate}
            onCancel={() => setEditando(null)}
          />
        )}
      </Modal>

      <Modal
        opened={borrando !== null} onClose={() => setBorrando(null)}
        title="Eliminar incidencia" centered size="sm"
      >
        <Stack gap="md">
          <Text>¿Eliminar <strong>{borrando?.nombre}</strong>? Esta acción no se puede deshacer.</Text>
          <Text size="sm" c="dimmed">
            Si solo quieres que deje de alertar sin perder el registro, edítala y ponla como cancelada.
          </Text>
          {deleteMut.error && <Alert color="red" title="Error">{(deleteMut.error as Error).message}</Alert>}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setBorrando(null)} disabled={deleteMut.isPending}>
              Cancelar
            </Button>
            <Button color="red" loading={deleteMut.isPending}
              onClick={() => deleteMut.mutate(borrando!.id, { onSuccess: () => setBorrando(null) })}>
              Eliminar
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  )
}
