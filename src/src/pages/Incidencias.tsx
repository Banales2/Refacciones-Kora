// Página Incidencias: lo reportado en toda la flota, con alta, edición y baja.
// Una incidencia se cierra atendiéndola en un mantenimiento —que se puede
// registrar aquí mismo o desde el detalle del vehículo— o se cancela, que
// conserva el registro pero deja de alertar.
import { useMemo, useState } from 'react'
import {
  Stack, Group, Text, Table, Loader, Center, Alert, Badge, Button, ActionIcon,
  Modal, Select, TextInput, Tooltip, SegmentedControl, Grid, Divider, Anchor,
} from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import {
  IconPencil, IconTrash, IconPlus, IconAlertTriangle, IconSearch, IconTool,
} from '@tabler/icons-react'
import {
  useIncidencias, useCreateIncidencia, useUpdateIncidencia, useDeleteIncidencia,
} from '../hooks/useIncidencias'
import type { Incidencia, IncidenciaConVehiculo, IncidenciaPayload } from '../hooks/useIncidencias'
import { useVehiculos, vehiculoLabel } from '../hooks/useVehiculos'
import type { TipoVehiculo } from '../hooks/useVehiculos'
import { useCreateMantenimiento } from '../hooks/useMantenimientos'
import type { MantenimientoPayload } from '../hooks/useMantenimientos'
import { useCreateDetallesMtto } from '../hooks/useDetalleMtto'
import type { DetalleMttoPayload } from '../hooks/useDetalleMtto'
import IncidenciaForm from '../components/IncidenciaForm'
import MantenimientoDetalleDrawer from '../components/MantenimientoDetalleDrawer'
import { MantenimientoForm } from './Vehiculos'
import type { DeshacerAtencion } from './Vehiculos'
import { SEVERIDAD_META, STATUS_INCIDENCIA_META } from '../lib/incidenciaMeta'

function fmtFechaHora(fecha: string, hora: string | null) {
  const f = new Date(`${fecha.split('T')[0]}T12:00:00`).toLocaleDateString('es-MX', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
  return hora ? `${f}, ${hora.slice(0, 5)}` : f
}

function InfoItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <Text size="xs" c="dimmed">{label}</Text>
      <Text size="sm">{value || <Text component="span" c="dimmed">—</Text>}</Text>
    </div>
  )
}

export default function Incidencias({ onNavigateVehiculo }: {
  // Saltar a la ficha del vehículo de la incidencia. Lo provee Layout, que es
  // quien maneja la navegación entre secciones.
  onNavigateVehiculo?: (vehiculoId: number) => void
}) {
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
  // Incidencia cuya ficha se está viendo, y la que se está atendiendo con un
  // mantenimiento nuevo. Son distintas porque atender se puede disparar desde
  // el renglón sin pasar por la ficha.
  const [detalle, setDetalle]         = useState<IncidenciaConVehiculo | null>(null)
  const [atendiendo, setAtendiendo]   = useState<IncidenciaConVehiculo | null>(null)
  const [mantError, setMantError]     = useState<string | null>(null)
  // La incidencia quedó marcada como atendida: el mantenimiento que la cierra es
  // obligatorio, y `deshacer` dice cómo revertir el cambio si se cancela.
  const [deshacer, setDeshacer] = useState<DeshacerAtencion | null>(null)
  // Mantenimiento recién registrado cuyo detalle se abre cuando sus refacciones
  // no se pudieron guardar completas.
  const [detalleMttoId, setDetalleMttoId] = useState<number | null>(null)

  // Las mutaciones necesitan el id del vehículo para invalidar sus listas.
  const vehiculoActivo =
    editando?.vehiculo_id ?? borrando?.vehiculo_id ?? atendiendo?.vehiculo_id ?? Number(vehiculoNueva ?? 0)
  const createMut = useCreateIncidencia(vehiculoActivo)
  const updateMut = useUpdateIncidencia(vehiculoActivo)
  const deleteMut = useDeleteIncidencia(vehiculoActivo)
  const mantMut   = useCreateMantenimiento(atendiendo?.vehiculo_id ?? 0)
  const piezasMut = useCreateDetallesMtto()

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

  // Marcar una incidencia como atendida obliga a registrar el mantenimiento que
  // la cerró: si no, quedaría cerrada sin nada que explique cómo (y de hecho la
  // sincronización diaria la volvería a abrir). El cambio se guarda primero
  // porque el mantenimiento la vincula por id; si no llega a registrarse, se
  // deshace (ver `cancelarAtencion`).
  function handleCreate(payload: IncidenciaPayload) {
    setFormError(null)
    createMut.mutate(payload, {
      onSuccess: ({ data }) => {
        setCreateOpen(false)
        if (payload.status === 'completado') {
          const v = (vehiculosData?.data ?? []).find((x) => x.id === data.vehiculo_id)
          setMantError(null)
          setDeshacer({ tipo: 'eliminar' })
          setAtendiendo({
            ...data,
            vehiculo_nombre: v ? vehiculoLabel(v) : '',
            vehiculo_tipo:   v?.tipo ?? '',
          })
        }
        setVehiculoNueva(null)
      },
      onError: (e) => setFormError((e as Error).message),
    })
  }

  function handleUpdate(payload: IncidenciaPayload) {
    if (!editando) return
    setFormError(null)
    const { status: statusPrevio, vehiculo_nombre, vehiculo_tipo } = editando
    updateMut.mutate({ id: editando.id, payload }, {
      onSuccess: ({ data }) => {
        setEditando(null)
        if (payload.status === 'completado' && statusPrevio !== 'completado') {
          setMantError(null)
          setDeshacer({ tipo: 'revertir', status: statusPrevio })
          setAtendiendo({ ...data, vehiculo_nombre, vehiculo_tipo })
        }
      },
      onError: (e) => setFormError((e as Error).message),
    })
  }

  // Atender la incidencia = registrarle el mantenimiento que la cierra. Es el
  // mismo formulario del detalle del vehículo, con la incidencia ya vinculada;
  // el alta invalida la lista de incidencias, así que esta se marca como
  // atendida sola. Se puede seguir agregando lo demás que se hizo en ese
  // servicio, por eso el selector de pendientes queda editable.
  function abrirAtender(i: IncidenciaConVehiculo) {
    setMantError(null)
    setDeshacer(null)
    setDetalle(null)
    setAtendiendo(i)
  }

  // Cancelar el mantenimiento de una incidencia que seguía abierta solo cierra
  // el modal. Si se acaba de cerrar la incidencia, se deshace ese cambio:
  // borrarla si nació atendida o devolverle su status anterior si se editó.
  function cancelarAtencion() {
    if (!atendiendo || !deshacer) { setAtendiendo(null); return }
    setMantError(null)
    const cerrar = () => { setAtendiendo(null); setDeshacer(null) }
    const onError = (e: unknown) =>
      setMantError(`No se pudo deshacer el cambio en la incidencia: ${(e as Error).message}`)

    if (deshacer.tipo === 'eliminar') {
      deleteMut.mutate(atendiendo.id, { onSuccess: cerrar, onError })
    } else {
      updateMut.mutate(
        { id: atendiendo.id, payload: { status: deshacer.status } },
        { onSuccess: cerrar, onError },
      )
    }
  }

  function handleAtender(payload: MantenimientoPayload, piezas: DetalleMttoPayload[]) {
    setMantError(null)
    mantMut.mutate(payload, {
      onSuccess: (res) => {
        setDeshacer(null)
        if (!piezas.length) { setAtendiendo(null); return }
        piezasMut.mutate({ mantenimientoId: res.data.id, piezas }, {
          onSuccess: () => setAtendiendo(null),
          // El mantenimiento ya quedó registrado: no hay forma de deshacer el
          // alta, así que se abre su detalle para capturar a mano lo que faltó.
          onError: (e: Error) => {
            setAtendiendo(null)
            setDetalleMttoId(res.data.id)
            alert(
              `El mantenimiento se registró, pero no se pudieron guardar todas las refacciones: ${e.message}\n\n` +
              'Revisa el detalle del mantenimiento para agregar las que falten.'
            )
          },
        })
      },
      onError: (e: Error) => setMantError(e.message),
    })
  }

  function irAlVehiculo(vehiculoId: number) {
    setDetalle(null)
    onNavigateVehiculo?.(vehiculoId)
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
                    <Table.Tr
                      key={i.id}
                      onClick={() => setDetalle(i)}
                      style={{ cursor: 'pointer' }}
                    >
                      <Table.Td fw={500}>{i.nombre}</Table.Td>
                      <Table.Td onClick={(e) => e.stopPropagation()}>
                        {onNavigateVehiculo ? (
                          // Botón y no <a>: no hay URL a la que apuntar (la
                          // navegación es por estado), y así se puede tabular.
                          <Anchor component="button" type="button" size="sm"
                            onClick={() => irAlVehiculo(i.vehiculo_id)}>
                            {i.vehiculo_nombre}
                          </Anchor>
                        ) : (
                          <Text size="sm">{i.vehiculo_nombre}</Text>
                        )}
                      </Table.Td>
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
                      <Table.Td onClick={(e) => e.stopPropagation()}>
                        <Group gap={4} justify="flex-end">
                          {/* Solo las que siguen sin atender: registrarle un
                              mantenimiento a una ya cerrada no cierra nada. */}
                          {i.status === 'activo' && (
                            <Tooltip label="Registrar el mantenimiento que la atiende">
                              <ActionIcon variant="subtle" color="teal" size="sm"
                                onClick={() => abrirAtender(i)}>
                                <IconTool size={14} />
                              </ActionIcon>
                            </Tooltip>
                          )}
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

      {/* ── Ficha de la incidencia ── */}
      <Modal
        opened={detalle !== null} onClose={() => setDetalle(null)}
        title="Detalle de la incidencia" centered size="lg"
      >
        {detalle && (
          <Stack gap="md">
            <div>
              <Group gap="xs" align="center">
                <Text fw={600} size="lg">{detalle.nombre}</Text>
                <Badge variant="light" size="sm" color={SEVERIDAD_META[detalle.severidad].color}>
                  {SEVERIDAD_META[detalle.severidad].label}
                </Badge>
                <Badge variant="light" size="sm" color={STATUS_INCIDENCIA_META[detalle.status].color}>
                  {STATUS_INCIDENCIA_META[detalle.status].label}
                </Badge>
              </Group>
              <Text size="sm" c="dimmed" mt={4}>
                {detalle.descripcion || 'Sin descripción capturada.'}
              </Text>
            </div>

            <Divider />

            <Grid>
              <Grid.Col span={{ base: 12, sm: 6 }}>
                <InfoItem
                  label="Vehículo"
                  value={onNavigateVehiculo ? (
                    <Anchor component="button" type="button" size="sm"
                      onClick={() => irAlVehiculo(detalle.vehiculo_id)}>
                      {detalle.vehiculo_nombre}
                    </Anchor>
                  ) : detalle.vehiculo_nombre}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 6, sm: 6 }}>
                <InfoItem label="Categoría" value={detalle.categoria} />
              </Grid.Col>
              <Grid.Col span={{ base: 6, sm: 6 }}>
                <InfoItem label="Ocurrió" value={fmtFechaHora(detalle.fecha, detalle.hora)} />
              </Grid.Col>
              <Grid.Col span={{ base: 6, sm: 6 }}>
                <InfoItem label="Ubicación" value={detalle.ubicacion} />
              </Grid.Col>
              <Grid.Col span={{ base: 6, sm: 6 }}>
                <InfoItem label="Reportó" value={detalle.reportado_por} />
              </Grid.Col>
              <Grid.Col span={{ base: 6, sm: 6 }}>
                <InfoItem label="Autorizó" value={detalle.autorizado_por} />
              </Grid.Col>
            </Grid>

            <Group justify="space-between" mt="xs">
              <Button variant="subtle" leftSection={<IconPencil size={16} />}
                onClick={() => { setFormError(null); setEditando(detalle); setDetalle(null) }}>
                Editar
              </Button>
              <Group gap="sm">
                {detalle.status === 'activo' && (
                  <Button color="teal" leftSection={<IconTool size={16} />}
                    onClick={() => abrirAtender(detalle)}>
                    Registrar mantenimiento
                  </Button>
                )}
              </Group>
            </Group>
          </Stack>
        )}
      </Modal>

      {/* ── Atender la incidencia con un mantenimiento ── */}
      <Modal
        opened={atendiendo !== null} onClose={cancelarAtencion}
        title={atendiendo
          ? `${deshacer ? 'Registra el mantenimiento' : 'Atender'} — ${atendiendo.nombre}`
          : ''}
        centered size="md" closeOnClickOutside={false}
        withCloseButton={!deshacer}
      >
        {atendiendo && (
          <Stack gap="sm">
            {deshacer ? (
              <Alert color="orange" variant="light" title="Falta el mantenimiento que la cierra">
                Marcaste la incidencia como <strong>atendida</strong>, así que hay que registrar
                el mantenimiento con el que se atendió en{' '}
                <strong>{atendiendo.vehiculo_nombre}</strong>. Si cancelas,{' '}
                {deshacer.tipo === 'revertir'
                  ? 'la incidencia vuelve a como estaba.'
                  : 'la incidencia se descarta y no queda registrada.'}
              </Alert>
            ) : (
              <Alert color="blue" variant="light">
                Se registrará en <strong>{atendiendo.vehiculo_nombre}</strong> y cerrará esta
                incidencia. Si el mismo servicio atendió más pendientes, agrégalos abajo.
              </Alert>
            )}
            <MantenimientoForm
              vehiculoId={atendiendo.vehiculo_id}
              tipoVehiculo={atendiendo.vehiculo_tipo as TipoVehiculo}
              {...(deshacer
                ? { pendienteFijo: { id: atendiendo.id, nombre: atendiendo.nombre } }
                : { prefillPendienteIds: [atendiendo.id] })}
              isPending={mantMut.isPending || piezasMut.isPending
                || deleteMut.isPending || updateMut.isPending}
              error={mantError}
              onSubmit={handleAtender}
              onCancel={cancelarAtencion}
            />
          </Stack>
        )}
      </Modal>

      {detalleMttoId !== null && (
        <MantenimientoDetalleDrawer
          mantenimientoId={detalleMttoId}
          onClose={() => setDetalleMttoId(null)}
        />
      )}

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
