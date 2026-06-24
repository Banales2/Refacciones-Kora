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
import type { Sucursal, SucursalPayload } from '../hooks/useSucursales'
import type { Ruta, RutaPayload } from '../hooks/useRutas'

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
          <Text size="sm" c="dimmed">No podrá eliminarse si tiene camiones asignados.</Text>
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
          <Text size="sm" c="dimmed">{items.length} ruta{items.length !== 1 ? 's' : ''}</Text>
          <Button size="xs" leftSection={<IconPlus size={14} />} onClick={openCreate}>Nueva ruta</Button>
        </Group>

        {isLoading ? <Center py="xl"><Loader /></Center>
        : isError   ? <Alert color="red" title="Error">No se pudieron obtener las rutas.</Alert>
        : items.length === 0 ? <Center py="xl"><Text c="dimmed">No hay rutas registradas.</Text></Center>
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
        title={editing ? `Editar — ${editing.nombre}` : 'Nueva ruta'} centered size="sm">
        <SitioForm
          initial={editing ?? undefined}
          labels={{ nombre: 'Nombre de la ruta', ubicacion: 'Ubicación / Descripción' }}
          isPending={isPending} error={formError}
          onSubmit={handleSubmit} onCancel={() => setFormOpen(false)}
        />
      </Modal>

      <Modal opened={deleting !== null} onClose={() => setDeleting(null)} title="Eliminar ruta" centered size="sm">
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

// ── Página principal ──────────────────────────────────────────────────────────

export default function SitiosYRutas() {
  return (
    <Stack gap="md">
      <div>
        <Text size="xl" fw={600}>Sitios y rutas</Text>
        <Text size="sm" c="dimmed">Gestión de sucursales y rutas de transporte</Text>
      </div>

      <Tabs defaultValue="sucursales" keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="sucursales">Sucursales</Tabs.Tab>
          <Tabs.Tab value="rutas">Rutas</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="sucursales" pt="md">
          <SucursalesPanel />
        </Tabs.Panel>

        <Tabs.Panel value="rutas" pt="md">
          <RutasPanel />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  )
}
