// Página Piezas: catálogo e inventario de refacciones. Sin búsqueda muestra
// todas las piezas agrupadas por tipo (acordeón); al buscar cambia a una
// tabla paginada. Permite CRUD de piezas (con creación de tipos nuevos
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
  useRefacciones, useTodasLasPiezas, useCreateRefaccion, useUpdateRefaccion, useDeleteRefaccion,
  fetchTodasLasPiezas,
} from '../hooks/useRefacciones'
import type { Pieza, SearchBy } from '../hooks/useRefacciones'
import LotesDrawer from '../components/LotesDrawer'
import { exportPiezasReporteToPdf } from '../lib/exportPiezasReporte'
import { agruparPorTipo, SIN_TIPO } from '../lib/piezasGrupos'
import { useTiposPieza, useCreateTipoPieza } from '../hooks/useTiposPieza'
import { TEXTO_LIBRE, limpiarTextoSimple, limpiarTextoLibre } from '../lib/validaciones'

function stockColor(qty: number) {
  if (qty === 0) return 'red'
  if (qty < 10) return 'orange'
  return 'green'
}


// El tipo indica qué necesidad de un modelo cubre la refacción ("filtro de
// aire") y es obligatorio: sin él la refacción no se puede clasificar ni
// asignar a un vehículo. Se maneja como string porque es el valor del Select;
// '' solo aparece en las piezas anteriores al catálogo de tipos, que al
// editarse quedan obligadas a elegir uno.
type FormValues = { numero_serie: string; descripcion: string; tipo_pieza_id: string }

// Valor centinela del selector de tipo: al elegirlo se crea el tipo escrito.
const CREAR_TIPO = '__crear__'

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
    initialValues: initial ?? { numero_serie: '', descripcion: '', tipo_pieza_id: '' },
    validate: {
      numero_serie: (v) =>
        !v.trim() ? 'Requerido' :
        v.length > 20 ? 'Máximo 20 caracteres' :
        !/^[A-Z0-9-]+$/.test(v) ? 'Solo mayúsculas, números y guiones' : null,
      descripcion: (v) =>
        v.trim().length < 3 ? 'Mínimo 3 caracteres' :
        v.length > 255 ? 'Máximo 255 caracteres' :
        !TEXTO_LIBRE.test(v.trim()) ? 'Contiene caracteres no permitidos' : null,
      tipo_pieza_id: (v) => !v ? 'Requerido' : null,
    },
  })

  const [tipoSearch, setTipoSearch] = useState('')

  const { data: tiposData } = useTiposPieza()
  const crearTipoMut = useCreateTipoPieza()

  const tipoOptions = useMemo(() => {
    const tipos = tiposData?.data ?? []
    const opts = tipos.map((t) => ({ value: String(t.id), label: t.nombre }))
    const nuevo = tipoSearch.trim()
    const yaExiste = tipos.some((t) => t.nombre.toLowerCase() === nuevo.toLowerCase())
    if (nuevo && !yaExiste) {
      opts.unshift({ value: CREAR_TIPO, label: `+ Crear tipo "${nuevo}"` })
    }
    return opts
  }, [tiposData, tipoSearch])

  // El centinela nunca se guarda: se crea el tipo y se deja seleccionado el id
  // real que devuelve el backend.
  function handleTipoChange(value: string | null) {
    if (value !== CREAR_TIPO) { form.setFieldValue('tipo_pieza_id', value ?? ''); return }
    const nombre = tipoSearch.trim()
    if (!nombre) return
    crearTipoMut.mutate(nombre, {
      onSuccess: ({ data: tipo }) => {
        form.setFieldValue('tipo_pieza_id', String(tipo.id))
        setTipoSearch('')
      },
    })
  }

  return (
    <form onSubmit={form.onSubmit(onSubmit)}>
      <Stack gap="sm">
        <TextInput
          label="Número de serie"
          placeholder="EJ-001"
          required
          maxLength={20}
          {...form.getInputProps('numero_serie')}
          styles={{ input: { textTransform: 'uppercase' } }}
          onChange={(e) =>
            // Allowlist: solo mayúsculas, números y guiones
            form.setFieldValue(
              'numero_serie',
              e.currentTarget.value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 20),
            )
          }
        />
        <Textarea
          label="Descripción"
          placeholder="Descripción de la refacción"
          rows={3}
          required
          maxLength={255}
          {...form.getInputProps('descripcion')}
          onChange={(e) => form.setFieldValue('descripcion', limpiarTextoLibre(e.currentTarget.value, 255))}
        />
        <Select
          label="Tipo de pieza"
          description="Qué necesidad del modelo cubre. Determina a qué vehículos puede asignarse la refacción."
          placeholder="Selecciona o escribe para crear un tipo"
          data={tipoOptions}
          searchable
          required
          searchValue={tipoSearch}
          // Allowlist: solo letras, números, espacios y guiones (máx. 40)
          onSearchChange={(v) => setTipoSearch(limpiarTextoSimple(v, 40))}
          nothingFoundMessage="Escribe para crear un tipo nuevo"
          value={form.values.tipo_pieza_id || null}
          onChange={handleTipoChange}
          error={crearTipoMut.error ? (crearTipoMut.error as Error).message : form.errors.tipo_pieza_id}
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
            <Table.Th>Tipo</Table.Th>
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
              <Table.Td>
                {pieza.tipo_pieza
                  ? <Badge variant="light" color="blue" size="sm">{pieza.tipo_pieza}</Badge>
                  : <Text component="span" c="dimmed" size="sm">—</Text>}
              </Table.Td>
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
  const porTipo = agruparPorTipo(piezas)

  const defaultOpen = porTipo.map(({ tipo }) => tipo)

  return (
    <Accordion multiple defaultValue={defaultOpen} variant="separated">
      {porTipo.map(({ tipo, items }) => (
        <Accordion.Item key={tipo} value={tipo}>
          <Accordion.Control>
            <Group justify="space-between" pr="md" wrap="nowrap">
              <Text fw={600} c={tipo === SIN_TIPO ? 'dimmed' : undefined}>{tipo}</Text>
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

export default function Piezas({ initialPiezaId }: { initialPiezaId?: number }) {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [searchBy, setSearchBy] = useState<SearchBy>('all')
  const [debouncedSearch] = useDebouncedValue(search, 400)
  // Al llegar desde el dashboard, se abre directo el drawer de lotes de la pieza.
  const [selectedId, setSelectedId] = useState<number | null>(initialPiezaId ?? null)

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
    useTodasLasPiezas(!searching)

  const createMut = useCreateRefaccion()
  const updateMut = useUpdateRefaccion()
  const deleteMut = useDeleteRefaccion()

  const totalPages = Math.ceil((data?.pagination?.total ?? 0) / (data?.pagination?.pageSize ?? 20))

  // El formulario maneja el tipo como string; la API espera el id. La
  // validación garantiza que no llegue vacío.
  function toPayload({ tipo_pieza_id, ...rest }: FormValues) {
    return { ...rest, tipo_pieza_id: Number(tipo_pieza_id) }
  }

  function handleCreate(values: FormValues) {
    createMut.mutate(toPayload(values), {
      onSuccess: () => setCreateOpen(false),
    })
  }

  function handleUpdate(values: FormValues) {
    if (!editPieza) return
    updateMut.mutate({ id: editPieza.id, ...toPayload(values) }, {
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
            <Text size="xl" fw={600}>Refacciones</Text>
            <Text size="sm" c="dimmed">Catálogo e inventario de refacciones</Text>
          </div>
          <Group gap="sm" align="flex-end">
            {(searching ? data?.pagination?.total : allData?.data?.length) != null && (
              <Text size="sm" c="dimmed">
                {searching ? data?.pagination?.total : allData?.data?.length} refacciones
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
              Nueva refacción
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
              No se pudieron obtener las refacciones. Verifica la conexión.
            </Alert>
          ) : data?.data?.length === 0 ? (
            <Center py="xl">
              <Text c="dimmed">No se encontraron refacciones para "{search}".</Text>
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
            No se pudieron obtener las refacciones. Verifica la conexión.
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
        title="Nueva refacción"
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
        title="Editar refacción"
        centered
      >
        {editPieza && (
          <PiezaForm
            initial={{
              numero_serie:  editPieza.numero_serie,
              descripcion:   editPieza.descripcion,
              tipo_pieza_id: editPieza.tipo_pieza_id != null ? String(editPieza.tipo_pieza_id) : '',
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
        title="Eliminar refacción"
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
