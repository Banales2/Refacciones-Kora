import { useState } from 'react'
import {
  Stack, Group, Text, TextInput, Table, Badge,
  Loader, Center, Alert, Button, ActionIcon,
  Modal, Tooltip,
} from '@mantine/core'
import { useForm } from '@mantine/form'
import { useDebouncedValue } from '@mantine/hooks'
import { IconPencil, IconTrash, IconPlus } from '@tabler/icons-react'
import {
  useModelos, useCreateModelo, useUpdateModelo, useDeleteModelo,
} from '../hooks/useModelos'
import type { Modelo, ModeloPayload } from '../hooks/useModelos'

function ModeloForm({
  initial,
  isPending,
  error,
  onSubmit,
  onCancel,
}: {
  initial?: Modelo
  isPending: boolean
  error: string | null
  onSubmit: (payload: ModeloPayload) => void
  onCancel: () => void
}) {
  const form = useForm({
    initialValues: {
      marca:  initial?.marca  ?? '',
      nombre: initial?.nombre ?? '',
    },
    validate: {
      marca:  (v) => !v.trim() ? 'Requerido' : v.length > 80 ? 'Máximo 80 caracteres' : null,
      nombre: (v) => !v.trim() ? 'Requerido' : v.length > 80 ? 'Máximo 80 caracteres' : null,
    },
  })

  return (
    <form onSubmit={form.onSubmit((v) => onSubmit({ marca: v.marca, nombre: v.nombre }))}>
      <Stack gap="sm">
        <TextInput label="Marca" placeholder="Ej. Kenworth" required {...form.getInputProps('marca')} />
        <TextInput label="Modelo" placeholder="Ej. T680" required {...form.getInputProps('nombre')} />
        {error && <Alert color="red" title="Error">{error}</Alert>}
        <Group justify="flex-end" mt="xs">
          <Button variant="default" onClick={onCancel} disabled={isPending}>Cancelar</Button>
          <Button type="submit" loading={isPending}>Guardar</Button>
        </Group>
      </Stack>
    </form>
  )
}

export default function Modelos() {
  const [search, setSearch]       = useState('')
  const [debounced]               = useDebouncedValue(search, 300)
  const [formOpen, setFormOpen]   = useState(false)
  const [editing, setEditing]     = useState<Modelo | null>(null)
  const [deleting, setDeleting]   = useState<Modelo | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const { data, isLoading, isError } = useModelos()
  const createMut = useCreateModelo()
  const updateMut = useUpdateModelo()
  const deleteMut = useDeleteModelo()

  const modelos = (data?.data ?? []).filter((m) => {
    if (!debounced) return true
    const q = debounced.toLowerCase()
    return m.marca.toLowerCase().includes(q) || m.nombre.toLowerCase().includes(q)
  })

  const marcas = [...new Set(modelos.map((m) => m.marca))].sort()

  function openCreate() {
    setEditing(null)
    setFormError(null)
    setFormOpen(true)
  }

  function openEdit(m: Modelo) {
    setEditing(m)
    setFormError(null)
    setFormOpen(true)
  }

  function handleSubmit(payload: ModeloPayload) {
    setFormError(null)
    if (editing) {
      updateMut.mutate(
        { id: editing.id, payload },
        { onSuccess: () => setFormOpen(false), onError: (e: Error) => setFormError(e.message) }
      )
    } else {
      createMut.mutate(payload, {
        onSuccess: () => setFormOpen(false),
        onError:   (e: Error) => setFormError(e.message),
      })
    }
  }

  function handleDelete() {
    if (!deleting) return
    deleteMut.mutate(deleting.id, {
      onSuccess: () => setDeleting(null),
      onError:   (e: Error) => alert(e.message),
    })
  }

  const isPending = createMut.isPending || updateMut.isPending

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end">
        <div>
          <Text size="xl" fw={600}>Modelos de vehículos</Text>
          <Text size="sm" c="dimmed">Catálogo de marcas y modelos</Text>
        </div>
        <Group gap="sm">
          {data?.data && (
            <Text size="sm" c="dimmed">
              {modelos.length} modelo{modelos.length !== 1 ? 's' : ''}
              {marcas.length > 0 && ` · ${marcas.length} marca${marcas.length !== 1 ? 's' : ''}`}
            </Text>
          )}
          <Button leftSection={<IconPlus size={16} />} onClick={openCreate}>
            Nuevo modelo
          </Button>
        </Group>
      </Group>

      <TextInput
        placeholder="Buscar por marca o modelo…"
        value={search}
        onChange={(e) => setSearch(e.currentTarget.value)}
        rightSection={
          search ? (
            <Text
              component="button"
              size="xs"
              c="dimmed"
              style={{ cursor: 'pointer', background: 'none', border: 'none', padding: 0 }}
              onClick={() => setSearch('')}
            >
              ✕
            </Text>
          ) : null
        }
      />

      {isLoading ? (
        <Center py="xl"><Loader /></Center>
      ) : isError ? (
        <Alert color="red" title="Error al cargar">
          No se pudieron obtener los modelos. Verifica la conexión.
        </Alert>
      ) : modelos.length === 0 ? (
        <Center py="xl">
          <Text c="dimmed">
            {search ? `No hay modelos para "${search}".` : 'No hay modelos registrados.'}
          </Text>
        </Center>
      ) : (
        <Table.ScrollContainer minWidth={360}>
          <Table striped highlightOnHover withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Marca</Table.Th>
                <Table.Th>Modelo</Table.Th>
                <Table.Th style={{ width: 80 }} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {modelos.map((m) => (
                <Table.Tr key={m.id}>
                  <Table.Td>
                    <Badge variant="light" color="gray" size="sm">{m.marca}</Badge>
                  </Table.Td>
                  <Table.Td fw={500}>{m.nombre}</Table.Td>
                  <Table.Td>
                    <Group gap={4} justify="flex-end" wrap="nowrap">
                      <Tooltip label="Editar">
                        <ActionIcon variant="subtle" color="blue" size="sm" onClick={() => openEdit(m)}>
                          <IconPencil size={14} />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label="Eliminar">
                        <ActionIcon variant="subtle" color="red" size="sm" onClick={() => setDeleting(m)}>
                          <IconTrash size={14} />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}

      {/* Modal crear / editar */}
      <Modal
        opened={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? `Editar — ${editing.marca} ${editing.nombre}` : 'Nuevo modelo'}
        centered
        size="sm"
      >
        <ModeloForm
          initial={editing ?? undefined}
          isPending={isPending}
          error={formError}
          onSubmit={handleSubmit}
          onCancel={() => setFormOpen(false)}
        />
      </Modal>

      {/* Modal eliminar */}
      <Modal
        opened={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Eliminar modelo"
        centered
        size="sm"
      >
        <Stack gap="md">
          <Text>
            ¿Eliminar <strong>{deleting?.marca} {deleting?.nombre}</strong>?
            Esta acción no se puede deshacer.
          </Text>
          <Text size="sm" c="dimmed">
            No podrá eliminarse si tiene vehículos asignados.
          </Text>
          {deleteMut.error && (
            <Alert color="red" title="Error">{(deleteMut.error as Error).message}</Alert>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDeleting(null)} disabled={deleteMut.isPending}>
              Cancelar
            </Button>
            <Button color="red" loading={deleteMut.isPending} onClick={handleDelete}>
              Eliminar
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  )
}
