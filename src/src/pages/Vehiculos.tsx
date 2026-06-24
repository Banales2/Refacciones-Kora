import { useState, useEffect } from 'react'
import {
  Stack, Group, Text, TextInput, Table, Badge,
  Pagination, Loader, Center, Alert, Button,
  Modal, ActionIcon, Tooltip,
} from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import {
  useVehiculos, useCreateVehiculo, useUpdateVehiculo, useDeleteVehiculo,
} from '../hooks/useVehiculos'
import type { TipoVehiculo, VehiculoRow, VehiculoCreatePayload, VehiculoUpdatePayload } from '../hooks/useVehiculos'
import { VehiculoForm } from '../components/VehiculoForm'

const TIPOS: { value: TipoVehiculo; label: string; color: string }[] = [
  { value: 'camion',       label: 'Camión',            color: 'blue'   },
  { value: 'tractocamion', label: 'Tractocamión',      color: 'violet' },
  { value: 'caja_trailer', label: 'Caja de trailer',   color: 'orange' },
  { value: 'utilitario',   label: 'Vehículo unitario', color: 'teal'   },
]

function statusColor(s: string) {
  const v = s.toLowerCase()
  if (v === 'activo')   return 'green'
  if (v === 'inactivo') return 'red'
  if (v === 'taller')   return 'orange'
  return 'gray'
}

export default function Vehiculos() {
  const [page, setPage]   = useState(1)
  const [search, setSearch] = useState('')
  const [debouncedSearch] = useDebouncedValue(search, 400)
  const [tipo, setTipo]   = useState<TipoVehiculo | undefined>(undefined)

  // modal state
  const [formOpen,   setFormOpen]   = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [editing,    setEditing]    = useState<VehiculoRow | null>(null)
  const [deleting,   setDeleting]   = useState<VehiculoRow | null>(null)
  const [formError,  setFormError]  = useState<string | null>(null)

  useEffect(() => { setPage(1) }, [debouncedSearch, tipo])

  const { data, isLoading, isError } = useVehiculos(page, debouncedSearch, tipo)
  const totalPages = Math.ceil(
    (data?.pagination?.total ?? 0) / (data?.pagination?.pageSize ?? 20)
  )

  const createMut = useCreateVehiculo()
  const updateMut = useUpdateVehiculo()
  const deleteMut = useDeleteVehiculo()

  function toggleTipo(t: TipoVehiculo) {
    setTipo((prev) => (prev === t ? undefined : t))
  }

  function openCreate() {
    setEditing(null)
    setFormError(null)
    setFormOpen(true)
  }

  function openEdit(v: VehiculoRow) {
    setEditing(v)
    setFormError(null)
    setFormOpen(true)
  }

  function openDelete(v: VehiculoRow) {
    setDeleting(v)
    setDeleteOpen(true)
  }

  function handleFormSubmit(payload: VehiculoCreatePayload | VehiculoUpdatePayload) {
    setFormError(null)
    if (editing) {
      updateMut.mutate(
        { id: editing.id, payload: payload as VehiculoUpdatePayload },
        {
          onSuccess: () => setFormOpen(false),
          onError:   (e: Error) => setFormError(e.message),
        }
      )
    } else {
      createMut.mutate(payload as VehiculoCreatePayload, {
        onSuccess: () => setFormOpen(false),
        onError:   (e: Error) => setFormError(e.message),
      })
    }
  }

  function handleDelete() {
    if (!deleting) return
    deleteMut.mutate(deleting.id, {
      onSuccess: () => setDeleteOpen(false),
      onError:   (e: Error) => alert(e.message),
    })
  }

  const isPending = createMut.isPending || updateMut.isPending

  return (
    <Stack gap="md">
      {/* Encabezado */}
      <Group justify="space-between" align="flex-end">
        <div>
          <Text size="xl" fw={600}>Vehículos</Text>
          <Text size="sm" c="dimmed">Camiones y tractocamiones</Text>
        </div>
        <Group gap="sm">
          {data?.pagination && (
            <Text size="sm" c="dimmed">{data.pagination.total} vehículos</Text>
          )}
          <Button size="sm" onClick={openCreate}>+ Nuevo vehículo</Button>
        </Group>
      </Group>

      {/* Búsqueda */}
      <TextInput
        placeholder="Buscar por nombre, marca, modelo o serie…"
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

      {/* Filtros por tipo */}
      <Group gap="xs">
        {TIPOS.map((t) => (
          <Button
            key={t.value}
            size="sm"
            color={t.color}
            variant={tipo === t.value ? 'filled' : 'light'}
            onClick={() => toggleTipo(t.value)}
          >
            {t.label}
          </Button>
        ))}
      </Group>

      {/* Contenido */}
      {isLoading ? (
        <Center py="xl"><Loader /></Center>
      ) : isError ? (
        <Alert color="red" title="Error al cargar">
          No se pudieron obtener los vehículos. Verifica la conexión.
        </Alert>
      ) : data?.data?.length === 0 ? (
        <Center py="xl">
          <Text c="dimmed">
            No se encontraron vehículos
            {tipo ? ` de tipo "${TIPOS.find((t) => t.value === tipo)?.label}"` : ''}
            {search ? ` para "${search}"` : ''}.
          </Text>
        </Center>
      ) : (
        <Table.ScrollContainer minWidth={650}>
          <Table striped highlightOnHover withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Vehículo</Table.Th>
                <Table.Th>Tipo</Table.Th>
                <Table.Th>Marca / Modelo</Table.Th>
                <Table.Th>Serie</Table.Th>
                <Table.Th style={{ textAlign: 'center' }}>Status</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Kilometraje</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data?.data?.map((v) => {
                const tipoInfo = TIPOS.find((t) => t.value === v.tipo)!
                return (
                  <Table.Tr key={v.id}>
                    <Table.Td fw={500}>{v.vehiculo}</Table.Td>
                    <Table.Td>
                      <Badge color={tipoInfo.color} variant="light" size="sm">
                        {tipoInfo.label}
                      </Badge>
                    </Table.Td>
                    <Table.Td c="dimmed">{v.marca} {v.modelo}</Table.Td>
                    <Table.Td>{v.serie}</Table.Td>
                    <Table.Td style={{ textAlign: 'center' }}>
                      {v.status ? (
                        <Badge color={statusColor(v.status)} variant="light" size="sm">
                          {v.status}
                        </Badge>
                      ) : (
                        <Text c="dimmed" size="sm">—</Text>
                      )}
                    </Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>
                      {v.kilometraje !== null
                        ? `${v.kilometraje.toLocaleString('es-MX')} km`
                        : <Text component="span" c="dimmed" size="sm">—</Text>
                      }
                    </Table.Td>
                    <Table.Td>
                      <Group gap={4} justify="flex-end" wrap="nowrap">
                        <Tooltip label="Editar">
                          <ActionIcon variant="subtle" color="blue" size="sm" onClick={() => openEdit(v)}>
                            ✏️
                          </ActionIcon>
                        </Tooltip>
                        <Tooltip label="Eliminar">
                          <ActionIcon variant="subtle" color="red" size="sm" onClick={() => openDelete(v)}>
                            🗑️
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

      {/* Paginación */}
      {totalPages > 1 && (
        <Group justify="center">
          <Pagination total={totalPages} value={page} onChange={setPage} size="sm" />
        </Group>
      )}

      {/* Modal crear / editar */}
      <Modal
        opened={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? `Editar — ${editing.vehiculo}` : 'Nuevo vehículo'}
        size="lg"
        closeOnClickOutside={false}
      >
        <VehiculoForm
          initial={editing ?? undefined}
          isPending={isPending}
          error={formError}
          onSubmit={handleFormSubmit}
          onCancel={() => setFormOpen(false)}
        />
      </Modal>

      {/* Modal eliminar */}
      <Modal
        opened={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Eliminar vehículo"
        size="sm"
      >
        <Stack gap="md">
          <Text>
            ¿Eliminar <strong>{deleting?.vehiculo}</strong>? Esta acción no se puede deshacer.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDeleteOpen(false)} disabled={deleteMut.isPending}>
              Cancelar
            </Button>
            <Button color="red" onClick={handleDelete} loading={deleteMut.isPending}>
              Eliminar
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  )
}
