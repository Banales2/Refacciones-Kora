// Página Catálogos: agrupa en pestañas la administración de sucursales,
// rutas, modelos y proveedores. Sucursales y rutas comparten el mismo
// formulario genérico (nombre + ubicación) con CRUD.
import { useState } from 'react'
import {
  Stack, Group, Text, TextInput, Table, Tabs,
  Loader, Center, Alert, Button, ActionIcon,
  Modal, Tooltip,
} from '@mantine/core'
import { useForm } from '@mantine/form'
import { IconPencil, IconTrash, IconPlus } from '@tabler/icons-react'
import {
  useSucursales, useCreateSucursal, useUpdateSucursal, useDeleteSucursal,
} from '../hooks/useSucursales'
import {
  useRutas, useCreateRuta, useUpdateRuta, useDeleteRuta,
} from '../hooks/useRutas'
import {
  useGasolineras, useCreateGasolinera, useUpdateGasolinera, useDeleteGasolinera,
} from '../hooks/useGasolineras'
import {
  useConductores, useCreateConductor, useUpdateConductor, useDeleteConductor,
} from '../hooks/useConductores'
import {
  useSeguros, useCreateSeguro, useUpdateSeguro, useDeleteSeguro,
  useAssignVehiculosSeguro, useUnassignVehiculoSeguro,
} from '../hooks/useSeguros'
import {
  usePermisosCirculacion, useCreatePermisoCirculacion,
  useUpdatePermisoCirculacion, useDeletePermisoCirculacion,
  useAssignVehiculosPermiso, useUnassignVehiculoPermiso,
} from '../hooks/usePermisosCirculacion'
import { AsignarVehiculosDrawer } from '../components/AsignarVehiculosDrawer'
import type { Sucursal, SucursalPayload } from '../hooks/useSucursales'
import type { Ruta, RutaPayload } from '../hooks/useRutas'
import type { Gasolinera, GasolineraPayload } from '../hooks/useGasolineras'
import type { Conductor, ConductorPayload } from '../hooks/useConductores'
import type { Seguro, SeguroPayload } from '../hooks/useSeguros'
import type { PermisoCirculacion, PermisoCirculacionPayload } from '../hooks/usePermisosCirculacion'
import type { VehiculoRow } from '../hooks/useVehiculos'
import Proveedores from './Proveedores'

// ── Formulario genérico (mismo shape para sucursal y ruta) ────────────────────

type Payload = { nombre: string; ubicacion: string }

function SitioForm({
  initial,
  labels,
  isPending,
  error,
  onSubmit,
  onCancel,
}: {
  initial?: Payload
  labels: { nombre: string; ubicacion: string }
  isPending: boolean
  error: string | null
  onSubmit: (p: Payload) => void
  onCancel: () => void
}) {
  const form = useForm({
    initialValues: { nombre: initial?.nombre ?? '', ubicacion: initial?.ubicacion ?? '' },
    validate: {
      nombre:    (v) => !v.trim() ? 'Requerido' : v.length > 120 ? 'Máximo 120 caracteres' : null,
      ubicacion: (v) => !v.trim() ? 'Requerido' : v.length > 200 ? 'Máximo 200 caracteres' : null,
    },
  })

  return (
    <form onSubmit={form.onSubmit((v) => onSubmit({ nombre: v.nombre, ubicacion: v.ubicacion }))}>
      <Stack gap="sm">
        <TextInput label={labels.nombre}    placeholder="Nombre"    required {...form.getInputProps('nombre')}    />
        <TextInput label={labels.ubicacion} placeholder="Ubicación" required {...form.getInputProps('ubicacion')} />
        {error && <Alert color="red" title="Error">{error}</Alert>}
        <Group justify="flex-end" mt="xs">
          <Button variant="default" onClick={onCancel} disabled={isPending}>Cancelar</Button>
          <Button type="submit" loading={isPending}>Guardar</Button>
        </Group>
      </Stack>
    </form>
  )
}

// ── Panel de sucursales ───────────────────────────────────────────────────────

function SucursalesPanel() {
  const [formOpen, setFormOpen]   = useState(false)
  const [editing, setEditing]     = useState<Sucursal | null>(null)
  const [deleting, setDeleting]   = useState<Sucursal | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const { data, isLoading, isError } = useSucursales()
  const createMut = useCreateSucursal()
  const updateMut = useUpdateSucursal()
  const deleteMut = useDeleteSucursal()
  const items = data?.data ?? []
  const isPending = createMut.isPending || updateMut.isPending

  function openCreate() { setEditing(null); setFormError(null); setFormOpen(true) }
  function openEdit(s: Sucursal) { setEditing(s); setFormError(null); setFormOpen(true) }

  function handleSubmit(payload: SucursalPayload) {
    setFormError(null)
    if (editing) {
      updateMut.mutate({ id: editing.id, payload }, {
        onSuccess: () => setFormOpen(false),
        onError:   (e: Error) => setFormError(e.message),
      })
    } else {
      createMut.mutate(payload, {
        onSuccess: () => setFormOpen(false),
        onError:   (e: Error) => setFormError(e.message),
      })
    }
  }

  return (
    <>
      <Stack gap="md">
        <Group justify="space-between">
          <Text size="sm" c="dimmed">{items.length} sucursal{items.length !== 1 ? 'es' : ''}</Text>
          <Button size="xs" leftSection={<IconPlus size={14} />} onClick={openCreate}>Nueva sucursal</Button>
        </Group>

        {isLoading ? <Center py="xl"><Loader /></Center>
        : isError   ? <Alert color="red" title="Error">No se pudieron obtener las sucursales.</Alert>
        : items.length === 0 ? <Center py="xl"><Text c="dimmed">No hay sucursales registradas.</Text></Center>
        : (
          <Table.ScrollContainer minWidth={400}>
            <Table striped highlightOnHover withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Nombre</Table.Th>
                  <Table.Th>Ubicación</Table.Th>
                  <Table.Th style={{ width: 80 }} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {items.map((s) => (
                  <Table.Tr key={s.id}>
                    <Table.Td fw={500}>{s.nombre}</Table.Td>
                    <Table.Td c="dimmed">{s.ubicacion}</Table.Td>
                    <Table.Td>
                      <Group gap={4} justify="flex-end" wrap="nowrap">
                        <Tooltip label="Editar"><ActionIcon variant="subtle" color="blue" size="sm" onClick={() => openEdit(s)}><IconPencil size={14} /></ActionIcon></Tooltip>
                        <Tooltip label="Eliminar"><ActionIcon variant="subtle" color="red"  size="sm" onClick={() => setDeleting(s)}><IconTrash  size={14} /></ActionIcon></Tooltip>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Stack>

      <Modal opened={formOpen} onClose={() => setFormOpen(false)}
        title={editing ? `Editar — ${editing.nombre}` : 'Nueva sucursal'} centered size="sm">
        <SitioForm
          initial={editing ?? undefined}
          labels={{ nombre: 'Nombre de la sucursal', ubicacion: 'Ubicación' }}
          isPending={isPending} error={formError}
          onSubmit={handleSubmit} onCancel={() => setFormOpen(false)}
        />
      </Modal>

      <Modal opened={deleting !== null} onClose={() => setDeleting(null)} title="Eliminar sucursal" centered size="sm">
        <Stack gap="md">
          <Text>¿Eliminar <strong>{deleting?.nombre}</strong>?</Text>
          <Text size="sm" c="dimmed">No podrá eliminarse si tiene unidades de reparto asignadas.</Text>
          {deleteMut.error && <Alert color="red" title="Error">{(deleteMut.error as Error).message}</Alert>}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDeleting(null)} disabled={deleteMut.isPending}>Cancelar</Button>
            <Button color="red" loading={deleteMut.isPending}
              onClick={() => deleteMut.mutate(deleting!.id, { onSuccess: () => setDeleting(null) })}>
              Eliminar
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  )
}

// ── Panel de rutas ────────────────────────────────────────────────────────────

function RutasPanel() {
  const [formOpen, setFormOpen]   = useState(false)
  const [editing, setEditing]     = useState<Ruta | null>(null)
  const [deleting, setDeleting]   = useState<Ruta | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const { data, isLoading, isError } = useRutas()
  const createMut = useCreateRuta()
  const updateMut = useUpdateRuta()
  const deleteMut = useDeleteRuta()
  const items = data?.data ?? []
  const isPending = createMut.isPending || updateMut.isPending

  function openCreate() { setEditing(null); setFormError(null); setFormOpen(true) }
  function openEdit(r: Ruta) { setEditing(r); setFormError(null); setFormOpen(true) }

  function handleSubmit(payload: RutaPayload) {
    setFormError(null)
    if (editing) {
      updateMut.mutate({ id: editing.id, payload }, {
        onSuccess: () => setFormOpen(false),
        onError:   (e: Error) => setFormError(e.message),
      })
    } else {
      createMut.mutate(payload, {
        onSuccess: () => setFormOpen(false),
        onError:   (e: Error) => setFormError(e.message),
      })
    }
  }

  return (
    <>
      <Stack gap="md">
        <Group justify="space-between">
          <Text size="sm" c="dimmed">{items.length} traslado{items.length !== 1 ? 's' : ''}</Text>
          <Button size="xs" leftSection={<IconPlus size={14} />} onClick={openCreate}>Nuevo traslado</Button>
        </Group>

        {isLoading ? <Center py="xl"><Loader /></Center>
        : isError   ? <Alert color="red" title="Error">No se pudieron obtener los traslados.</Alert>
        : items.length === 0 ? <Center py="xl"><Text c="dimmed">No hay traslados registrados.</Text></Center>
        : (
          <Table.ScrollContainer minWidth={400}>
            <Table striped highlightOnHover withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Nombre</Table.Th>
                  <Table.Th>Ubicación / Descripción</Table.Th>
                  <Table.Th style={{ width: 80 }} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {items.map((r) => (
                  <Table.Tr key={r.id}>
                    <Table.Td fw={500}>{r.nombre}</Table.Td>
                    <Table.Td c="dimmed">{r.ubicacion}</Table.Td>
                    <Table.Td>
                      <Group gap={4} justify="flex-end" wrap="nowrap">
                        <Tooltip label="Editar"><ActionIcon variant="subtle" color="blue" size="sm" onClick={() => openEdit(r)}><IconPencil size={14} /></ActionIcon></Tooltip>
                        <Tooltip label="Eliminar"><ActionIcon variant="subtle" color="red"  size="sm" onClick={() => setDeleting(r)}><IconTrash  size={14} /></ActionIcon></Tooltip>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Stack>

      <Modal opened={formOpen} onClose={() => setFormOpen(false)}
        title={editing ? `Editar — ${editing.nombre}` : 'Nuevo traslado'} centered size="sm">
        <SitioForm
          initial={editing ?? undefined}
          labels={{ nombre: 'Nombre del traslado', ubicacion: 'Ubicación / Descripción' }}
          isPending={isPending} error={formError}
          onSubmit={handleSubmit} onCancel={() => setFormOpen(false)}
        />
      </Modal>

      <Modal opened={deleting !== null} onClose={() => setDeleting(null)} title="Eliminar traslado" centered size="sm">
        <Stack gap="md">
          <Text>¿Eliminar <strong>{deleting?.nombre}</strong>?</Text>
          <Text size="sm" c="dimmed">No podrá eliminarse si tiene tractocamiones asignados.</Text>
          {deleteMut.error && <Alert color="red" title="Error">{(deleteMut.error as Error).message}</Alert>}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDeleting(null)} disabled={deleteMut.isPending}>Cancelar</Button>
            <Button color="red" loading={deleteMut.isPending}
              onClick={() => deleteMut.mutate(deleting!.id, { onSuccess: () => setDeleting(null) })}>
              Eliminar
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  )
}

// ── Panel de gasolineras ──────────────────────────────────────────────────────

function GasolinerasPanel() {
  const [formOpen, setFormOpen]   = useState(false)
  const [editing, setEditing]     = useState<Gasolinera | null>(null)
  const [deleting, setDeleting]   = useState<Gasolinera | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const { data, isLoading, isError } = useGasolineras()
  const createMut = useCreateGasolinera()
  const updateMut = useUpdateGasolinera()
  const deleteMut = useDeleteGasolinera()
  const items = data?.data ?? []
  const isPending = createMut.isPending || updateMut.isPending

  function openCreate() { setEditing(null); setFormError(null); setFormOpen(true) }
  function openEdit(g: Gasolinera) { setEditing(g); setFormError(null); setFormOpen(true) }

  function handleSubmit(payload: GasolineraPayload) {
    setFormError(null)
    if (editing) {
      updateMut.mutate({ id: editing.id, payload }, {
        onSuccess: () => setFormOpen(false),
        onError:   (e: Error) => setFormError(e.message),
      })
    } else {
      createMut.mutate(payload, {
        onSuccess: () => setFormOpen(false),
        onError:   (e: Error) => setFormError(e.message),
      })
    }
  }

  return (
    <>
      <Stack gap="md">
        <Group justify="space-between">
          <Text size="sm" c="dimmed">{items.length} gasolinera{items.length !== 1 ? 's' : ''}</Text>
          <Button size="xs" leftSection={<IconPlus size={14} />} onClick={openCreate}>Nueva gasolinera</Button>
        </Group>

        {isLoading ? <Center py="xl"><Loader /></Center>
        : isError   ? <Alert color="red" title="Error">No se pudieron obtener las gasolineras.</Alert>
        : items.length === 0 ? <Center py="xl"><Text c="dimmed">No hay gasolineras registradas.</Text></Center>
        : (
          <Table.ScrollContainer minWidth={400}>
            <Table striped highlightOnHover withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Nombre</Table.Th>
                  <Table.Th>Ubicación</Table.Th>
                  <Table.Th style={{ width: 80 }} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {items.map((g) => (
                  <Table.Tr key={g.id}>
                    <Table.Td fw={500}>{g.nombre}</Table.Td>
                    <Table.Td c="dimmed">{g.ubicacion}</Table.Td>
                    <Table.Td>
                      <Group gap={4} justify="flex-end" wrap="nowrap">
                        <Tooltip label="Editar"><ActionIcon variant="subtle" color="blue" size="sm" onClick={() => openEdit(g)}><IconPencil size={14} /></ActionIcon></Tooltip>
                        <Tooltip label="Eliminar"><ActionIcon variant="subtle" color="red"  size="sm" onClick={() => setDeleting(g)}><IconTrash  size={14} /></ActionIcon></Tooltip>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Stack>

      <Modal opened={formOpen} onClose={() => setFormOpen(false)}
        title={editing ? `Editar — ${editing.nombre}` : 'Nueva gasolinera'} centered size="sm">
        <SitioForm
          initial={editing ?? undefined}
          labels={{ nombre: 'Nombre de la gasolinera', ubicacion: 'Ubicación' }}
          isPending={isPending} error={formError}
          onSubmit={handleSubmit} onCancel={() => setFormOpen(false)}
        />
      </Modal>

      <Modal opened={deleting !== null} onClose={() => setDeleting(null)} title="Eliminar gasolinera" centered size="sm">
        <Stack gap="md">
          <Text>¿Eliminar <strong>{deleting?.nombre}</strong>?</Text>
          <Text size="sm" c="dimmed">No podrá eliminarse si tiene recargas registradas.</Text>
          {deleteMut.error && <Alert color="red" title="Error">{(deleteMut.error as Error).message}</Alert>}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDeleting(null)} disabled={deleteMut.isPending}>Cancelar</Button>
            <Button color="red" loading={deleteMut.isPending}
              onClick={() => deleteMut.mutate(deleting!.id, { onSuccess: () => setDeleting(null) })}>
              Eliminar
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  )
}

// ── Panel de conductores ──────────────────────────────────────────────────────

// El conductor solo tiene nombre, así que no puede reusar SitioForm (que exige
// también una ubicación).
function ConductorForm({
  initial, isPending, error, onSubmit, onCancel,
}: {
  initial?: ConductorPayload
  isPending: boolean
  error: string | null
  onSubmit: (payload: ConductorPayload) => void
  onCancel: () => void
}) {
  const form = useForm<ConductorPayload>({
    initialValues: initial ?? { nombre: '' },
    validate: {
      nombre: (v) => (!v.trim() ? 'Nombre requerido' : null),
    },
  })

  return (
    <form onSubmit={form.onSubmit((v) => onSubmit({ nombre: v.nombre.trim() }))}>
      <Stack gap="sm">
        <TextInput
          label="Nombre del conductor"
          placeholder="Nombre y apellido"
          required
          {...form.getInputProps('nombre')}
        />
        {error && <Alert color="red" title="Error">{error}</Alert>}
        <Group justify="flex-end" mt="xs">
          <Button variant="default" onClick={onCancel} disabled={isPending}>Cancelar</Button>
          <Button type="submit" loading={isPending}>Guardar</Button>
        </Group>
      </Stack>
    </form>
  )
}

function ConductoresPanel() {
  const [formOpen, setFormOpen]   = useState(false)
  const [editing, setEditing]     = useState<Conductor | null>(null)
  const [deleting, setDeleting]   = useState<Conductor | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const { data, isLoading, isError } = useConductores()
  const createMut = useCreateConductor()
  const updateMut = useUpdateConductor()
  const deleteMut = useDeleteConductor()
  const items = data?.data ?? []
  const isPending = createMut.isPending || updateMut.isPending

  function openCreate() { setEditing(null); setFormError(null); setFormOpen(true) }
  function openEdit(c: Conductor) { setEditing(c); setFormError(null); setFormOpen(true) }

  function handleSubmit(payload: ConductorPayload) {
    setFormError(null)
    const opts = {
      onSuccess: () => setFormOpen(false),
      onError:   (e: Error) => setFormError(e.message),
    }
    if (editing) updateMut.mutate({ id: editing.id, payload }, opts)
    else         createMut.mutate(payload, opts)
  }

  return (
    <>
      <Stack gap="md">
        <Group justify="space-between">
          <Text size="sm" c="dimmed">{items.length} conductor{items.length !== 1 ? 'es' : ''}</Text>
          <Button size="xs" leftSection={<IconPlus size={14} />} onClick={openCreate}>Nuevo conductor</Button>
        </Group>

        {isLoading ? <Center py="xl"><Loader /></Center>
        : isError   ? <Alert color="red" title="Error">No se pudieron obtener los conductores.</Alert>
        : items.length === 0 ? <Center py="xl"><Text c="dimmed">No hay conductores registrados.</Text></Center>
        : (
          <Table.ScrollContainer minWidth={300}>
            <Table striped highlightOnHover withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Nombre</Table.Th>
                  <Table.Th style={{ width: 80 }} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {items.map((c) => (
                  <Table.Tr key={c.id}>
                    <Table.Td fw={500}>{c.nombre}</Table.Td>
                    <Table.Td>
                      <Group gap={4} justify="flex-end" wrap="nowrap">
                        <Tooltip label="Editar"><ActionIcon variant="subtle" color="blue" size="sm" onClick={() => openEdit(c)}><IconPencil size={14} /></ActionIcon></Tooltip>
                        <Tooltip label="Eliminar"><ActionIcon variant="subtle" color="red"  size="sm" onClick={() => setDeleting(c)}><IconTrash  size={14} /></ActionIcon></Tooltip>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Stack>

      <Modal opened={formOpen} onClose={() => setFormOpen(false)}
        title={editing ? `Editar — ${editing.nombre}` : 'Nuevo conductor'} centered size="sm">
        <ConductorForm
          initial={editing ? { nombre: editing.nombre } : undefined}
          isPending={isPending} error={formError}
          onSubmit={handleSubmit} onCancel={() => setFormOpen(false)}
        />
      </Modal>

      <Modal opened={deleting !== null} onClose={() => setDeleting(null)} title="Eliminar conductor" centered size="sm">
        <Stack gap="md">
          <Text>¿Eliminar <strong>{deleting?.nombre}</strong>?</Text>
          <Text size="sm" c="dimmed">No podrá eliminarse si tiene recargas registradas.</Text>
          {deleteMut.error && <Alert color="red" title="Error">{(deleteMut.error as Error).message}</Alert>}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDeleting(null)} disabled={deleteMut.isPending}>Cancelar</Button>
            <Button color="red" loading={deleteMut.isPending}
              onClick={() => deleteMut.mutate(deleting!.id, { onSuccess: () => setDeleting(null) })}>
              Eliminar
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  )
}

// ── Panel de seguros ──────────────────────────────────────────────────────────

// El seguro tiene póliza, compañía y fecha de expiración, así que necesita su
// propio formulario (SitioForm solo maneja nombre + ubicación).
function SeguroForm({
  initial, isPending, error, onSubmit, onCancel,
}: {
  initial?: SeguroPayload
  isPending: boolean
  error: string | null
  onSubmit: (payload: SeguroPayload) => void
  onCancel: () => void
}) {
  const form = useForm<SeguroPayload>({
    initialValues: initial ?? { poliza: '', compania: '', fecha_expiracion: '' },
    validate: {
      poliza:           (v) => (!v.trim() ? 'Requerido' : v.length > 60  ? 'Máximo 60 caracteres'  : null),
      compania:         (v) => (!v.trim() ? 'Requerido' : v.length > 120 ? 'Máximo 120 caracteres' : null),
      fecha_expiracion: (v) => (!v ? 'Requerido' : null),
    },
  })

  return (
    <form onSubmit={form.onSubmit((v) => onSubmit({
      poliza:           v.poliza.trim(),
      compania:         v.compania.trim(),
      fecha_expiracion: v.fecha_expiracion,
    }))}>
      <Stack gap="sm">
        <TextInput label="Número de póliza" placeholder="Ej. POL-123456" required {...form.getInputProps('poliza')} />
        <TextInput label="Compañía"         placeholder="Ej. GNP Seguros"  required {...form.getInputProps('compania')} />
        <TextInput label="Fecha de expiración" type="date" required {...form.getInputProps('fecha_expiracion')} />
        {error && <Alert color="red" title="Error">{error}</Alert>}
        <Group justify="flex-end" mt="xs">
          <Button variant="default" onClick={onCancel} disabled={isPending}>Cancelar</Button>
          <Button type="submit" loading={isPending}>Guardar</Button>
        </Group>
      </Stack>
    </form>
  )
}

function SegurosPanel({
  onNavigateVehiculo, openId, onOpenIdChange,
}: {
  onNavigateVehiculo?: (v: VehiculoRow) => void
  openId?:         number | null
  onOpenIdChange?: (id: number | null) => void
}) {
  const [formOpen, setFormOpen]   = useState(false)
  const [editing, setEditing]     = useState<Seguro | null>(null)
  const [deleting, setDeleting]   = useState<Seguro | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const { data, isLoading, isError } = useSeguros()
  const createMut = useCreateSeguro()
  const updateMut = useUpdateSeguro()
  const deleteMut = useDeleteSeguro()
  const assignMut = useAssignVehiculosSeguro()
  const unassignMut = useUnassignVehiculoSeguro()
  const items = data?.data ?? []
  const isPending = createMut.isPending || updateMut.isPending
  // El drawer abierto se deriva del id que Layout conserva.
  const asignando = items.find((s) => s.id === openId) ?? null

  const hoy = new Date().toISOString().slice(0, 10)
  // Umbral de "por expirar": vence dentro de los próximos 30 días.
  const limite = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)

  function openCreate() { setEditing(null); setFormError(null); setFormOpen(true) }
  function openEdit(s: Seguro) { setEditing(s); setFormError(null); setFormOpen(true) }

  function handleSubmit(payload: SeguroPayload) {
    setFormError(null)
    const opts = {
      onSuccess: () => setFormOpen(false),
      onError:   (e: Error) => setFormError(e.message),
    }
    if (editing) updateMut.mutate({ id: editing.id, payload }, opts)
    else         createMut.mutate(payload, opts)
  }

  return (
    <>
      <Stack gap="md">
        <Group justify="space-between">
          <Text size="sm" c="dimmed">{items.length} seguro{items.length !== 1 ? 's' : ''} · clic en un renglón para asignar vehículos</Text>
          <Button size="xs" leftSection={<IconPlus size={14} />} onClick={openCreate}>Nuevo seguro</Button>
        </Group>

        {isLoading ? <Center py="xl"><Loader /></Center>
        : isError   ? <Alert color="red" title="Error">No se pudieron obtener los seguros.</Alert>
        : items.length === 0 ? <Center py="xl"><Text c="dimmed">No hay seguros registrados.</Text></Center>
        : (
          <Table.ScrollContainer minWidth={400}>
            <Table striped highlightOnHover withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Póliza</Table.Th>
                  <Table.Th>Compañía</Table.Th>
                  <Table.Th>Expiración</Table.Th>
                  <Table.Th style={{ width: 80 }} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {items.map((s) => {
                  const vencido    = s.fecha_expiracion < hoy
                  const porExpirar = !vencido && s.fecha_expiracion <= limite
                  return (
                    <Table.Tr key={s.id} onClick={() => onOpenIdChange?.(s.id)} style={{ cursor: 'pointer' }}>
                      <Table.Td fw={500}>{s.poliza}</Table.Td>
                      <Table.Td c="dimmed">{s.compania}</Table.Td>
                      <Table.Td
                        c={vencido ? 'red' : porExpirar ? 'yellow.8' : undefined}
                        fw={vencido || porExpirar ? 600 : undefined}
                      >
                        {s.fecha_expiracion}{vencido ? ' (vencido)' : porExpirar ? ' (por expirar)' : ''}
                      </Table.Td>
                      <Table.Td onClick={(e) => e.stopPropagation()}>
                        <Group gap={4} justify="flex-end" wrap="nowrap">
                          <Tooltip label="Editar"><ActionIcon variant="subtle" color="blue" size="sm" onClick={() => openEdit(s)}><IconPencil size={14} /></ActionIcon></Tooltip>
                          <Tooltip label="Eliminar"><ActionIcon variant="subtle" color="red"  size="sm" onClick={() => setDeleting(s)}><IconTrash  size={14} /></ActionIcon></Tooltip>
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

      <Modal opened={formOpen} onClose={() => setFormOpen(false)}
        title={editing ? `Editar — ${editing.poliza}` : 'Nuevo seguro'} centered size="sm">
        <SeguroForm
          initial={editing ? {
            poliza: editing.poliza, compania: editing.compania, fecha_expiracion: editing.fecha_expiracion,
          } : undefined}
          isPending={isPending} error={formError}
          onSubmit={handleSubmit} onCancel={() => setFormOpen(false)}
        />
      </Modal>

      <Modal opened={deleting !== null} onClose={() => setDeleting(null)} title="Eliminar seguro" centered size="sm">
        <Stack gap="md">
          <Text>¿Eliminar la póliza <strong>{deleting?.poliza}</strong>?</Text>
          <Text size="sm" c="dimmed">No podrá eliminarse si está asignado a algún vehículo.</Text>
          {deleteMut.error && <Alert color="red" title="Error">{(deleteMut.error as Error).message}</Alert>}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDeleting(null)} disabled={deleteMut.isPending}>Cancelar</Button>
            <Button color="red" loading={deleteMut.isPending}
              onClick={() => deleteMut.mutate(deleting!.id, { onSuccess: () => setDeleting(null) })}>
              Eliminar
            </Button>
          </Group>
        </Stack>
      </Modal>

      <AsignarVehiculosDrawer
        opened={asignando !== null}
        onClose={() => onOpenIdChange?.(null)}
        titulo={asignando ? asignando.poliza : ''}
        subtitulo={asignando ? `${asignando.compania} · expira ${asignando.fecha_expiracion}` : ''}
        targetId={asignando?.id ?? null}
        field="seguro_id"
        actualLabel={(v) => (v.seguro_id != null ? v.seguro_poliza : null)}
        assign={(ids, onDone) => asignando && assignMut.mutate({ id: asignando.id, vehiculoIds: ids }, { onSuccess: onDone })}
        assignPending={assignMut.isPending}
        assignError={assignMut.error ? (assignMut.error as Error).message : null}
        unassign={(vid) => asignando && unassignMut.mutate({ id: asignando.id, vehiculoId: vid })}
        unassignPendingId={unassignMut.isPending ? (unassignMut.variables?.vehiculoId ?? null) : null}
        onNavigateVehiculo={onNavigateVehiculo}
      />
    </>
  )
}

// ── Panel de permisos de circulación ──────────────────────────────────────────

function PermisoForm({
  initial, isPending, error, onSubmit, onCancel,
}: {
  initial?: PermisoCirculacionPayload
  isPending: boolean
  error: string | null
  onSubmit: (payload: PermisoCirculacionPayload) => void
  onCancel: () => void
}) {
  const form = useForm<PermisoCirculacionPayload>({
    initialValues: initial ?? { zona_circulacion: '', fecha_emision: '', fecha_expiracion: '' },
    validate: {
      zona_circulacion: (v) => (!v.trim() ? 'Requerido' : v.length > 120 ? 'Máximo 120 caracteres' : null),
      fecha_emision:    (v) => (!v ? 'Requerido' : null),
      fecha_expiracion: (v, vals) =>
        !v ? 'Requerido' :
        (vals.fecha_emision && v < vals.fecha_emision) ? 'Debe ser posterior a la emisión' : null,
    },
  })

  return (
    <form onSubmit={form.onSubmit((v) => onSubmit({
      zona_circulacion: v.zona_circulacion.trim(),
      fecha_emision:    v.fecha_emision,
      fecha_expiracion: v.fecha_expiracion,
    }))}>
      <Stack gap="sm">
        <TextInput label="Zona de circulación" placeholder="Ej. Zona Metropolitana" required {...form.getInputProps('zona_circulacion')} />
        <TextInput label="Fecha de emisión" type="date" required {...form.getInputProps('fecha_emision')} />
        <TextInput label="Fecha de expiración" type="date" required {...form.getInputProps('fecha_expiracion')} />
        {error && <Alert color="red" title="Error">{error}</Alert>}
        <Group justify="flex-end" mt="xs">
          <Button variant="default" onClick={onCancel} disabled={isPending}>Cancelar</Button>
          <Button type="submit" loading={isPending}>Guardar</Button>
        </Group>
      </Stack>
    </form>
  )
}

function PermisosPanel({
  onNavigateVehiculo, openId, onOpenIdChange,
}: {
  onNavigateVehiculo?: (v: VehiculoRow) => void
  openId?:         number | null
  onOpenIdChange?: (id: number | null) => void
}) {
  const [formOpen, setFormOpen]   = useState(false)
  const [editing, setEditing]     = useState<PermisoCirculacion | null>(null)
  const [deleting, setDeleting]   = useState<PermisoCirculacion | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const { data, isLoading, isError } = usePermisosCirculacion()
  const createMut = useCreatePermisoCirculacion()
  const updateMut = useUpdatePermisoCirculacion()
  const deleteMut = useDeletePermisoCirculacion()
  const assignMut = useAssignVehiculosPermiso()
  const unassignMut = useUnassignVehiculoPermiso()
  const items = data?.data ?? []
  const isPending = createMut.isPending || updateMut.isPending
  // El drawer abierto se deriva del id que Layout conserva.
  const asignando = items.find((p) => p.id === openId) ?? null

  const hoy = new Date().toISOString().slice(0, 10)
  // Umbral de "por expirar": vence dentro de los próximos 30 días.
  const limite = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)

  function openCreate() { setEditing(null); setFormError(null); setFormOpen(true) }
  function openEdit(p: PermisoCirculacion) { setEditing(p); setFormError(null); setFormOpen(true) }

  function handleSubmit(payload: PermisoCirculacionPayload) {
    setFormError(null)
    const opts = {
      onSuccess: () => setFormOpen(false),
      onError:   (e: Error) => setFormError(e.message),
    }
    if (editing) updateMut.mutate({ id: editing.id, payload }, opts)
    else         createMut.mutate(payload, opts)
  }

  return (
    <>
      <Stack gap="md">
        <Group justify="space-between">
          <Text size="sm" c="dimmed">{items.length} permiso{items.length !== 1 ? 's' : ''} · clic en un renglón para asignar vehículos</Text>
          <Button size="xs" leftSection={<IconPlus size={14} />} onClick={openCreate}>Nuevo permiso</Button>
        </Group>

        {isLoading ? <Center py="xl"><Loader /></Center>
        : isError   ? <Alert color="red" title="Error">No se pudieron obtener los permisos.</Alert>
        : items.length === 0 ? <Center py="xl"><Text c="dimmed">No hay permisos registrados.</Text></Center>
        : (
          <Table.ScrollContainer minWidth={400}>
            <Table striped highlightOnHover withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Zona de circulación</Table.Th>
                  <Table.Th>Emisión</Table.Th>
                  <Table.Th>Expiración</Table.Th>
                  <Table.Th style={{ width: 80 }} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {items.map((p) => {
                  const vencido    = p.fecha_expiracion < hoy
                  const porExpirar = !vencido && p.fecha_expiracion <= limite
                  return (
                    <Table.Tr key={p.id} onClick={() => onOpenIdChange?.(p.id)} style={{ cursor: 'pointer' }}>
                      <Table.Td fw={500}>{p.zona_circulacion}</Table.Td>
                      <Table.Td c={p.fecha_emision ? undefined : 'dimmed'}>{p.fecha_emision ?? '—'}</Table.Td>
                      <Table.Td
                        c={vencido ? 'red' : porExpirar ? 'yellow.8' : undefined}
                        fw={vencido || porExpirar ? 600 : undefined}
                      >
                        {p.fecha_expiracion}{vencido ? ' (vencido)' : porExpirar ? ' (por expirar)' : ''}
                      </Table.Td>
                      <Table.Td onClick={(e) => e.stopPropagation()}>
                        <Group gap={4} justify="flex-end" wrap="nowrap">
                          <Tooltip label="Editar"><ActionIcon variant="subtle" color="blue" size="sm" onClick={() => openEdit(p)}><IconPencil size={14} /></ActionIcon></Tooltip>
                          <Tooltip label="Eliminar"><ActionIcon variant="subtle" color="red"  size="sm" onClick={() => setDeleting(p)}><IconTrash  size={14} /></ActionIcon></Tooltip>
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

      <Modal opened={formOpen} onClose={() => setFormOpen(false)}
        title={editing ? `Editar — ${editing.zona_circulacion}` : 'Nuevo permiso'} centered size="sm">
        <PermisoForm
          initial={editing ? {
            zona_circulacion: editing.zona_circulacion,
            fecha_emision:    editing.fecha_emision ?? '',
            fecha_expiracion: editing.fecha_expiracion,
          } : undefined}
          isPending={isPending} error={formError}
          onSubmit={handleSubmit} onCancel={() => setFormOpen(false)}
        />
      </Modal>

      <Modal opened={deleting !== null} onClose={() => setDeleting(null)} title="Eliminar permiso" centered size="sm">
        <Stack gap="md">
          <Text>¿Eliminar el permiso de <strong>{deleting?.zona_circulacion}</strong>?</Text>
          <Text size="sm" c="dimmed">No podrá eliminarse si está asignado a algún vehículo.</Text>
          {deleteMut.error && <Alert color="red" title="Error">{(deleteMut.error as Error).message}</Alert>}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDeleting(null)} disabled={deleteMut.isPending}>Cancelar</Button>
            <Button color="red" loading={deleteMut.isPending}
              onClick={() => deleteMut.mutate(deleting!.id, { onSuccess: () => setDeleting(null) })}>
              Eliminar
            </Button>
          </Group>
        </Stack>
      </Modal>

      <AsignarVehiculosDrawer
        opened={asignando !== null}
        onClose={() => onOpenIdChange?.(null)}
        titulo={asignando ? asignando.zona_circulacion : ''}
        subtitulo={asignando ? `Permiso de circulación · expira ${asignando.fecha_expiracion}` : ''}
        targetId={asignando?.id ?? null}
        field="permiso_id"
        actualLabel={(v) => (v.permiso_id != null ? v.permiso_zona : null)}
        assign={(ids, onDone) => asignando && assignMut.mutate({ id: asignando.id, vehiculoIds: ids }, { onSuccess: onDone })}
        assignPending={assignMut.isPending}
        assignError={assignMut.error ? (assignMut.error as Error).message : null}
        unassign={(vid) => asignando && unassignMut.mutate({ id: asignando.id, vehiculoId: vid })}
        unassignPendingId={unassignMut.isPending ? (unassignMut.variables?.vehiculoId ?? null) : null}
        onNavigateVehiculo={onNavigateVehiculo}
      />
    </>
  )
}

// ── Página principal ──────────────────────────────────────────────────────────

export default function SitiosYRutas({
  onNavigateVehiculo, activeTab, onTabChange,
  seguroDrawerId, onSeguroDrawerChange,
  permisoDrawerId, onPermisoDrawerChange,
}: {
  onNavigateVehiculo?: (v: VehiculoRow) => void
  // La pestaña activa vive en Layout para sobrevivir al saltar a un vehículo y
  // volver: así se regresa exactamente a la pestaña desde la que se saltó.
  activeTab?:    string | null
  onTabChange?:  (value: string | null) => void
  // Id del seguro/permiso cuyo drawer de asignación está abierto (también en
  // Layout, para reabrirlo al regresar del detalle de un vehículo).
  seguroDrawerId?:        number | null
  onSeguroDrawerChange?:  (id: number | null) => void
  permisoDrawerId?:       number | null
  onPermisoDrawerChange?: (id: number | null) => void
}) {
  return (
    <Stack gap="md">
      <div>
        <Text size="xl" fw={600}>Catálogos</Text>
        <Text size="sm" c="dimmed">Proveedores, sucursales, traslados, gasolineras, conductores, seguros y permisos</Text>
      </div>

      <Tabs value={activeTab ?? 'proveedores'} onChange={onTabChange} keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="proveedores">Proveedores</Tabs.Tab>
          <Tabs.Tab value="sucursales">Sucursales</Tabs.Tab>
          <Tabs.Tab value="rutas">Traslados</Tabs.Tab>
          <Tabs.Tab value="gasolineras">Gasolineras</Tabs.Tab>
          <Tabs.Tab value="conductores">Conductores</Tabs.Tab>
          <Tabs.Tab value="seguros">Seguros</Tabs.Tab>
          <Tabs.Tab value="permisos">Permisos</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="proveedores" pt="md">
          <Proveedores />
        </Tabs.Panel>

        <Tabs.Panel value="sucursales" pt="md">
          <SucursalesPanel />
        </Tabs.Panel>

        <Tabs.Panel value="rutas" pt="md">
          <RutasPanel />
        </Tabs.Panel>

        <Tabs.Panel value="gasolineras" pt="md">
          <GasolinerasPanel />
        </Tabs.Panel>

        <Tabs.Panel value="conductores" pt="md">
          <ConductoresPanel />
        </Tabs.Panel>

        <Tabs.Panel value="seguros" pt="md">
          <SegurosPanel
            onNavigateVehiculo={onNavigateVehiculo}
            openId={seguroDrawerId}
            onOpenIdChange={onSeguroDrawerChange}
          />
        </Tabs.Panel>

        <Tabs.Panel value="permisos" pt="md">
          <PermisosPanel
            onNavigateVehiculo={onNavigateVehiculo}
            openId={permisoDrawerId}
            onOpenIdChange={onPermisoDrawerChange}
          />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  )
}
