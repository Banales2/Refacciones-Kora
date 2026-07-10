import { useState, useEffect } from 'react'
import {
  Stack, Group, Text, TextInput, Table, Badge,
  Pagination, Alert, Loader, Center,
  Button, ActionIcon, Modal, Textarea, Select, Accordion,
} from '@mantine/core'
import { useForm } from '@mantine/form'
import { useDebouncedValue } from '@mantine/hooks'
import { IconPencil, IconTrash, IconPlus } from '@tabler/icons-react'
import {
  useRefacciones, useCreateRefaccion, useUpdateRefaccion, useDeleteRefaccion,
} from '../hooks/useRefacciones'
import type { Pieza, SearchBy } from '../hooks/useRefacciones'
import LotesDrawer from '../components/LotesDrawer'

const CATEGORIAS = [
  'Filtros', 'Aceites y lubricantes', 'Frenos', 'Llantas', 'Eléctrico',
  'Suspensión y dirección', 'Motor', 'Transmisión y embrague', 'Refrigeración', 'Otros',
]
const CATEGORIA_OPTIONS = CATEGORIAS.map((c) => ({ value: c, label: c }))

function stockColor(qty: number) {
  if (qty === 0) return 'red'
  if (qty < 10) return 'orange'
  return 'green'
}


type FormValues = { numero_serie: string; descripcion: string; categoria: string }

function PiezaForm({
  initial,
  isPending,
  error,
  onSubmit,
  onCancel,
}: {
  initial?: FormValues
  isPending: boolean
  error: string | null
  onSubmit: (v: FormValues) => void
  onCancel: () => void
}) {
  const form = useForm<FormValues>({
    initialValues: initial ?? { numero_serie: '', descripcion: '', categoria: '' },
    validate: {
      numero_serie: (v) =>
        !v.trim() ? 'Requerido' :
        v.length > 80 ? 'Máximo 80 caracteres' :
        !/^[A-Z0-9-]+$/.test(v) ? 'Solo mayúsculas, números y guiones' : null,
      descripcion: (v) =>
        v.trim().length < 3 ? 'Mínimo 3 caracteres' :
        v.length > 300 ? 'Máximo 300 caracteres' : null,
      categoria: (v) => !v ? 'Requerido' : null,
    },
  })

  return (
    <form onSubmit={form.onSubmit(onSubmit)}>
      <Stack gap="sm">
        <TextInput
          label="Número de serie"
          placeholder="EJ-001"
          required
          {...form.getInputProps('numero_serie')}
          styles={{ input: { textTransform: 'uppercase' } }}
          onChange={(e) =>
            form.setFieldValue('numero_serie', e.currentTarget.value.toUpperCase())
          }
        />
        <Textarea
          label="Descripción"
          placeholder="Descripción de la pieza"
          rows={3}
          required
          {...form.getInputProps('descripcion')}
        />
        <Select
          label="Categoría"
          placeholder="Selecciona una categoría"
          data={CATEGORIA_OPTIONS}
          searchable
          required
          {...form.getInputProps('categoria')}
        />
        {error && (
          <Alert color="red" title="Error">
            {error}
          </Alert>
        )}
        <Group justify="flex-end" mt="xs">
          <Button variant="default" onClick={onCancel} disabled={isPending}>
            Cancelar
          </Button>
          <Button type="submit" loading={isPending}>
            Guardar
          </Button>
        </Group>
      </Stack>
    </form>
  )
}

function PiezasTable({
  items, onSelect, onEdit, onDelete,
}: {
  items:    Pieza[]
  onSelect: (id: number) => void
  onEdit:   (p: Pieza) => void
  onDelete: (p: Pieza) => void
}) {
  return (
    <Table.ScrollContainer minWidth={480}>
      <Table striped highlightOnHover withTableBorder>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Número de serie</Table.Th>
            <Table.Th>Descripción</Table.Th>
            <Table.Th style={{ textAlign: 'center' }}>En stock</Table.Th>
            <Table.Th style={{ width: 80 }} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {items.map((pieza) => (
            <Table.Tr
              key={pieza.id}
              onClick={() => onSelect(pieza.id)}
              style={{ cursor: 'pointer' }}
            >
              <Table.Td fw={500}>{pieza.numero_serie}</Table.Td>
              <Table.Td c="dimmed">{pieza.descripcion}</Table.Td>
              <Table.Td style={{ textAlign: 'center' }}>
                <Badge color={stockColor(pieza.cantidad_total)} variant="light" size="sm">
                  {pieza.cantidad_total}
                </Badge>
              </Table.Td>
              <Table.Td onClick={(e) => e.stopPropagation()} style={{ textAlign: 'right' }}>
                <Group gap={4} justify="flex-end" wrap="nowrap">
                  <ActionIcon variant="subtle" color="blue" aria-label="Editar" onClick={() => onEdit(pieza)}>
                    <IconPencil size={16} />
                  </ActionIcon>
                  <ActionIcon variant="subtle" color="red" aria-label="Eliminar" onClick={() => onDelete(pieza)}>
                    <IconTrash size={16} />
                  </ActionIcon>
                </Group>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  )
}

function PiezasAgrupadas({
  piezas, onSelect, onEdit, onDelete,
}: {
  piezas:   Pieza[]
  onSelect: (id: number) => void
  onEdit:   (p: Pieza) => void
  onDelete: (p: Pieza) => void
}) {
  const porCategoria = CATEGORIAS
    .map((cat) => ({ categoria: cat, items: piezas.filter((p) => p.categoria === cat) }))
    .filter(({ items }) => items.length > 0)

  const otras = piezas.filter((p) => !CATEGORIAS.includes(p.categoria))
  if (otras.length > 0) porCategoria.push({ categoria: 'Sin clasificar', items: otras })

  const defaultOpen = porCategoria.map(({ categoria }) => categoria)

  return (
    <Accordion multiple defaultValue={defaultOpen} variant="separated">
      {porCategoria.map(({ categoria, items }) => (
        <Accordion.Item key={categoria} value={categoria}>
          <Accordion.Control>
            <Group justify="space-between" pr="md" wrap="nowrap">
              <Text fw={600}>{categoria}</Text>
              <Badge variant="light" color="gray">{items.length}</Badge>
            </Group>
          </Accordion.Control>
          <Accordion.Panel>
            <PiezasTable items={items} onSelect={onSelect} onEdit={onEdit} onDelete={onDelete} />
          </Accordion.Panel>
        </Accordion.Item>
      ))}
    </Accordion>
  )
}

export default function Piezas() {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [searchBy, setSearchBy] = useState<SearchBy>('all')
  const [debouncedSearch] = useDebouncedValue(search, 400)
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [editPieza, setEditPieza] = useState<Pieza | null>(null)
  const [deletePieza, setDeletePieza] = useState<Pieza | null>(null)

  useEffect(() => { setPage(1) }, [debouncedSearch, searchBy])

  const searching = debouncedSearch.length > 0
  const { data, isLoading, isError } = useRefacciones(page, debouncedSearch, searchBy, undefined, searching)
  const { data: allData, isLoading: allLoading, isError: allError } =
    useRefacciones(1, '', 'all', 100, !searching)

  const createMut = useCreateRefaccion()
  const updateMut = useUpdateRefaccion()
  const deleteMut = useDeleteRefaccion()

  const totalPages = Math.ceil((data?.pagination?.total ?? 0) / (data?.pagination?.pageSize ?? 20))

  function handleCreate(values: FormValues) {
    createMut.mutate(values, {
      onSuccess: () => setCreateOpen(false),
    })
  }

  function handleUpdate(values: FormValues) {
    if (!editPieza) return
    updateMut.mutate({ id: editPieza.id, ...values }, {
      onSuccess: () => setEditPieza(null),
    })
  }

  function handleDelete() {
    if (!deletePieza) return
    deleteMut.mutate(deletePieza.id, {
      onSuccess: () => setDeletePieza(null),
    })
  }

  return (
    <>
      <Stack gap="md">
        {/* Encabezado */}
        <Group justify="space-between" align="flex-end">
          <div>
            <Text size="xl" fw={600}>Piezas</Text>
            <Text size="sm" c="dimmed">Catálogo e inventario de refacciones</Text>
          </div>
          <Group gap="sm" align="flex-end">
            {(searching ? data?.pagination?.total : allData?.data?.length) != null && (
              <Text size="sm" c="dimmed">
                {searching ? data?.pagination?.total : allData?.data?.length} piezas
              </Text>
            )}
            <Button
              leftSection={<IconPlus size={16} />}
              onClick={() => setCreateOpen(true)}
            >
              Nueva pieza
            </Button>
          </Group>
        </Group>

        {/* Búsqueda */}
        <Group gap="xs" wrap="nowrap">
          <Select
            data={[
              { value: 'all', label: 'Todo' },
              { value: 'numero_serie', label: 'Núm. serie' },
              { value: 'descripcion', label: 'Descripción' },
            ]}
            value={searchBy}
            onChange={(v) => setSearchBy((v as SearchBy) ?? 'all')}
            w={140}
            allowDeselect={false}
          />
          <TextInput
            style={{ flex: 1 }}
            placeholder={
              searchBy === 'numero_serie' ? 'Buscar por número de serie…'
              : searchBy === 'descripcion' ? 'Buscar por descripción…'
              : 'Buscar por número de serie o descripción…'
            }
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            leftSection={<span style={{ fontSize: 14 }}>🔍</span>}
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
        </Group>

        {/* Estado de carga / error / vacío */}
        {searching ? (
          isLoading ? (
            <Center py="xl"><Loader /></Center>
          ) : isError ? (
            <Alert color="red" title="Error al cargar">
              No se pudieron obtener las piezas. Verifica la conexión.
            </Alert>
          ) : data?.data?.length === 0 ? (
            <Center py="xl">
              <Text c="dimmed">No se encontraron piezas para "{search}".</Text>
            </Center>
          ) : (
            <>
              <PiezasTable
                items={data?.data ?? []}
                onSelect={setSelectedId} onEdit={setEditPieza} onDelete={setDeletePieza}
              />
              {totalPages > 1 && (
                <Group justify="center">
                  <Pagination total={totalPages} value={page} onChange={setPage} size="sm" />
                </Group>
              )}
            </>
          )
        ) : allLoading ? (
          <Center py="xl"><Loader /></Center>
        ) : allError ? (
          <Alert color="red" title="Error al cargar">
            No se pudieron obtener las piezas. Verifica la conexión.
          </Alert>
        ) : (
          <PiezasAgrupadas
            piezas={allData?.data ?? []}
            onSelect={setSelectedId} onEdit={setEditPieza} onDelete={setDeletePieza}
          />
        )}
      </Stack>

      {/* Modal: nueva pieza */}
      <Modal
        opened={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Nueva pieza"
        centered
      >
        <PiezaForm
          isPending={createMut.isPending}
          error={createMut.error ? (createMut.error as Error).message : null}
          onSubmit={handleCreate}
          onCancel={() => setCreateOpen(false)}
        />
      </Modal>

      {/* Modal: editar pieza */}
      <Modal
        opened={editPieza !== null}
        onClose={() => setEditPieza(null)}
        title="Editar pieza"
        centered
      >
        {editPieza && (
          <PiezaForm
            initial={{
              numero_serie: editPieza.numero_serie,
              descripcion:  editPieza.descripcion,
              categoria:    editPieza.categoria,
            }}
            isPending={updateMut.isPending}
            error={updateMut.error ? (updateMut.error as Error).message : null}
            onSubmit={handleUpdate}
            onCancel={() => setEditPieza(null)}
          />
        )}
      </Modal>

      {/* Modal: confirmar eliminación */}
      <Modal
        opened={deletePieza !== null}
        onClose={() => setDeletePieza(null)}
        title="Eliminar pieza"
        centered
        size="sm"
      >
        <Stack gap="md">
          <Text>
            ¿Seguro que deseas eliminar{' '}
            <Text component="span" fw={700}>{deletePieza?.numero_serie}</Text>?
            Esta acción no se puede deshacer.
          </Text>
          {deleteMut.error && (
            <Alert color="red" title="Error">
              {(deleteMut.error as Error).message}
            </Alert>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDeletePieza(null)} disabled={deleteMut.isPending}>
              Cancelar
            </Button>
            <Button color="red" onClick={handleDelete} loading={deleteMut.isPending}>
              Eliminar
            </Button>
          </Group>
        </Stack>
      </Modal>

      <LotesDrawer piezaId={selectedId} onClose={() => setSelectedId(null)} />
    </>
  )
}
