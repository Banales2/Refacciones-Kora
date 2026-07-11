// Página Piezas: catálogo e inventario de refacciones. Sin búsqueda muestra
// todas las piezas agrupadas por categoría (acordeón); al buscar cambia a una
// tabla paginada. Permite CRUD de piezas (con creación de categorías nuevas
// desde el formulario), generar el reporte PDF del inventario y abrir el
// drawer de lotes de compra de cada pieza.
import { useState, useMemo } from 'react'
import {
  Stack, Group, Text, TextInput, Table, Badge,
  Pagination, Alert, Loader, Center,
  Button, ActionIcon, Modal, Textarea, Select, Accordion,
} from '@mantine/core'
import { useForm } from '@mantine/form'
import { useDebouncedValue } from '@mantine/hooks'
import { IconPencil, IconTrash, IconPlus, IconFileTypePdf } from '@tabler/icons-react'
import {
  useRefacciones, useCreateRefaccion, useUpdateRefaccion, useDeleteRefaccion, fetchTodasLasPiezas,
} from '../hooks/useRefacciones'
import type { Pieza, SearchBy } from '../hooks/useRefacciones'
import LotesDrawer from '../components/LotesDrawer'
import { exportPiezasReporteToPdf } from '../lib/exportPiezasReporte'
import { CATEGORIAS } from '../lib/piezasCategorias'

function stockColor(qty: number) {
  if (qty === 0) return 'red'
  if (qty < 10) return 'orange'
  return 'green'
}


type FormValues = { numero_serie: string; descripcion: string; categoria: string }

function PiezaForm({
  initial,
  categoriasDisponibles,
  isPending,
  error,
  onSubmit,
  onCancel,
}: {
  initial?: FormValues
  categoriasDisponibles: string[]
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
      categoria: (v) =>
        !v.trim() ? 'Requerido' :
        v.length > 60 ? 'Máximo 60 caracteres' : null,
    },
  })

  const [categoriaSearch, setCategoriaSearch] = useState('')

  const categoriaOptions = useMemo(() => {
    const opts = categoriasDisponibles.map((c) => ({ value: c, label: c }))
    const nueva = categoriaSearch.trim()
    const yaExiste = categoriasDisponibles.some((c) => c.toLowerCase() === nueva.toLowerCase())
    if (nueva && !yaExiste) {
      opts.unshift({ value: nueva, label: `+ Crear categoría "${nueva}"` })
    }
    return opts
  }, [categoriasDisponibles, categoriaSearch])

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
          placeholder="Selecciona o escribe para crear una categoría"
          data={categoriaOptions}
          searchable
          onSearchChange={setCategoriaSearch}
          nothingFoundMessage="Escribe para crear una nueva categoría"
          required
          maxLength={60}
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
  const conocidas = CATEGORIAS
    .map((cat) => ({ categoria: cat, items: piezas.filter((p) => p.categoria === cat) }))
    .filter(({ items }) => items.length > 0)

  // Categorías creadas por el usuario (no están en la lista fija): cada una
  // forma su propio grupo, ordenadas alfabéticamente al final.
  const extraCategorias = Array.from(
    new Set(piezas.filter((p) => !CATEGORIAS.includes(p.categoria)).map((p) => p.categoria))
  ).sort((a, b) => a.localeCompare(b, 'es-MX'))
  const extras = extraCategorias.map((cat) => ({ categoria: cat, items: piezas.filter((p) => p.categoria === cat) }))

  const porCategoria = [...conocidas, ...extras]

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
  const [exportando, setExportando] = useState(false)

  // Al cambiar la búsqueda o el campo de búsqueda se vuelve a la página 1.
  // Se ajusta durante el render (patrón recomendado por React) en vez de en
  // un efecto, para no disparar un render extra con la página vieja.
  const [prevBusqueda, setPrevBusqueda] = useState({ debouncedSearch, searchBy })
  if (prevBusqueda.debouncedSearch !== debouncedSearch || prevBusqueda.searchBy !== searchBy) {
    setPrevBusqueda({ debouncedSearch, searchBy })
    setPage(1)
  }

  const searching = debouncedSearch.length > 0
  const { data, isLoading, isError } = useRefacciones(page, debouncedSearch, searchBy, undefined, searching)
  const { data: allData, isLoading: allLoading, isError: allError } =
    useRefacciones(1, '', 'all', 100, !searching)

  const createMut = useCreateRefaccion()
  const updateMut = useUpdateRefaccion()
  const deleteMut = useDeleteRefaccion()

  const totalPages = Math.ceil((data?.pagination?.total ?? 0) / (data?.pagination?.pageSize ?? 20))

  const categoriasDisponibles = useMemo(() => {
    const set = new Set(CATEGORIAS)
    for (const p of allData?.data ?? data?.data ?? []) set.add(p.categoria)
    if (editPieza) set.add(editPieza.categoria)
    return Array.from(set)
  }, [allData, data, editPieza])

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

  async function handleExportPdf() {
    setExportando(true)
    try {
      const piezas = await fetchTodasLasPiezas()
      await exportPiezasReporteToPdf(piezas.data)
    } catch (e) {
      alert((e as Error).message)
    } finally {
      setExportando(false)
    }
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
              variant="default"
              leftSection={<IconFileTypePdf size={16} />}
              loading={exportando}
              onClick={handleExportPdf}
            >
              Generar reporte
            </Button>
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
          categoriasDisponibles={categoriasDisponibles}
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
            categoriasDisponibles={categoriasDisponibles}
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
