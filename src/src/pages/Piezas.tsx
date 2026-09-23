// Página Piezas: catálogo e inventario de refacciones. Sin búsqueda muestra
// todas las piezas agrupadas por tipo (acordeón); al buscar cambia a una
// tabla paginada. Permite CRUD de piezas (con creación de tipos nuevos
// desde el formulario), generar el reporte PDF del inventario y abrir el
// drawer de lotes de compra de cada pieza.
import { useState } from 'react'
import {
  Stack, Group, Text, TextInput, Table, Badge,
  Pagination, Alert, Loader, Center,
  Button, ActionIcon, Modal, Select, Accordion, Switch,
} from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import {
  IconPencil, IconPlus, IconFileTypePdf, IconReceipt, IconTags,
  IconArchive, IconArchiveOff,
} from '@tabler/icons-react'
import {
  useRefacciones, useTodasLasPiezas, useCreateRefaccion, useUpdateRefaccion,
  fetchTodasLasPiezas,
} from '../hooks/useRefacciones'
import { usePermisos } from '../hooks/usePermisos'
import type { Pieza, SearchBy } from '../hooks/useRefacciones'
import { MARCA_FALTANTE } from '../hooks/useRefacciones'
import ArchivarCatalogoModal from '../components/ArchivarCatalogoModal'
import LotesDrawer from '../components/LotesDrawer'
import FacturasDrawer from '../components/FacturasDrawer'
import TiposPiezaDrawer from '../components/TiposPiezaDrawer'
import { exportPiezasReporteToPdf } from '../lib/exportPiezasReporte'
import { agruparPorTipo, SIN_TIPO } from '../lib/piezasGrupos'
import PiezaForm from '../components/PiezaForm'
import type { PiezaFormValues } from '../components/PiezaForm'

function stockColor(qty: number) {
  if (qty === 0) return 'red'
  if (qty < 10) return 'orange'
  return 'green'
}


function PiezasTable({
  items, onSelect, onEdit, onArchivar,
}: {
  items:    Pieza[]
  onSelect: (id: number) => void
  onEdit:   (p: Pieza) => void
  onArchivar: (p: Pieza) => void
}) {
  // El practicante da de alta refacciones pero no las corrige, así que la
  // columna de acciones se le queda vacía en vez de ofrecerle botones que la
  // API le va a negar con un 403.
  const { puedeEditar } = usePermisos()
  return (
    <Table.ScrollContainer minWidth={480}>
      <Table striped highlightOnHover withTableBorder>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>No. serie</Table.Th>
            <Table.Th>Descripción</Table.Th>
            <Table.Th>Marca</Table.Th>
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
              <Table.Td fw={500} c={pieza.archivado_en ? 'dimmed' : undefined}>
                <Group gap={6} wrap="nowrap">
                  {pieza.numero_serie}
                  {pieza.archivado_en && (
                    <Badge variant="light" color="gray" size="xs">Archivada</Badge>
                  )}
                </Group>
              </Table.Td>
              <Table.Td c="dimmed">{pieza.descripcion}</Table.Td>
              <Table.Td>
                {/* El centinela se señala en vez de mostrarse como una marca
                    más: es trabajo por hacer, no el nombre del fabricante. */}
                {pieza.marca === MARCA_FALTANTE
                  ? <Badge variant="light" color="orange" size="sm">Falta marca</Badge>
                  : <Text size="sm">{pieza.marca}</Text>}
              </Table.Td>
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
                  {puedeEditar && (
                    <>
                      <ActionIcon variant="subtle" color="blue" aria-label="Editar" onClick={() => onEdit(pieza)}>
                        <IconPencil size={16} />
                      </ActionIcon>
                      <ActionIcon
                        variant="subtle"
                        color={pieza.archivado_en ? 'teal' : 'orange'}
                        aria-label={pieza.archivado_en ? 'Restaurar' : 'Archivar'}
                        onClick={() => onArchivar(pieza)}
                      >
                        {pieza.archivado_en ? <IconArchiveOff size={16} /> : <IconArchive size={16} />}
                      </ActionIcon>
                    </>
                  )}
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
  piezas, onSelect, onEdit, onArchivar,
}: {
  piezas:   Pieza[]
  onSelect: (id: number) => void
  onEdit:   (p: Pieza) => void
  onArchivar: (p: Pieza) => void
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
            <PiezasTable items={items} onSelect={onSelect} onEdit={onEdit} onArchivar={onArchivar} />
          </Accordion.Panel>
        </Accordion.Item>
      ))}
    </Accordion>
  )
}

export default function Piezas({ initialPiezaId }: { initialPiezaId?: number }) {
  // El responsable de sucursal consulta el catálogo: ni altas, ni tipos, ni
  // facturas, que son de compras.
  const { puedeDarDeAlta } = usePermisos()
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [searchBy, setSearchBy] = useState<SearchBy>('all')
  const [debouncedSearch] = useDebouncedValue(search, 400)
  // Al llegar desde el dashboard, se abre directo el drawer de lotes de la pieza.
  const [selectedId, setSelectedId] = useState<number | null>(initialPiezaId ?? null)

  const [createOpen, setCreateOpen] = useState(false)
  const [facturasOpen, setFacturasOpen] = useState(false)
  const [tiposOpen, setTiposOpen] = useState(false)
  const [editPieza, setEditPieza] = useState<Pieza | null>(null)
  // Refacción que se está por archivar (o restaurar). No hay borrado.
  const [archivando, setArchivando] = useState<Pieza | null>(null)
  // Las archivadas se ocultan por defecto; el switch las trae para restaurarlas.
  const [verArchivados, setVerArchivados] = useState(false)
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
  const { data, isLoading, isError } =
    useRefacciones(page, debouncedSearch, searchBy, undefined, searching, verArchivados)
  const { data: allData, isLoading: allLoading, isError: allError } =
    useTodasLasPiezas(!searching)

  const createMut = useCreateRefaccion()
  const updateMut = useUpdateRefaccion()

  const totalPages = Math.ceil((data?.pagination?.total ?? 0) / (data?.pagination?.pageSize ?? 20))

  // El formulario maneja el tipo como string; la API espera el id. La
  // validación garantiza que no llegue vacío.
  function toPayload({ tipo_pieza_id, ...rest }: PiezaFormValues) {
    return { ...rest, tipo_pieza_id: Number(tipo_pieza_id) }
  }

  function handleCreate(values: PiezaFormValues) {
    createMut.mutate(toPayload(values), {
      onSuccess: () => setCreateOpen(false),
    })
  }

  function handleUpdate(values: PiezaFormValues) {
    if (!editPieza) return
    updateMut.mutate({ id: editPieza.id, ...toPayload(values) }, {
      onSuccess: () => setEditPieza(null),
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
            {/* Las compras vistas por factura, no por refacción: es donde se
                cuadra contra el papel y donde se le pone el IVA a una compra
                vieja sin ir lote por lote. */}
            {puedeDarDeAlta && (
              <Button
                variant="default"
                leftSection={<IconReceipt size={16} />}
                onClick={() => setFacturasOpen(true)}
              >
                Facturas
              </Button>
            )}
            {/* El catálogo de tipos: hasta ahora solo se podían crear al vuelo
                desde el formulario de una refacción, así que un nombre mal
                escrito se quedaba así. Y es donde se decide qué tipos se
                rastrean pieza por pieza. */}
            {puedeDarDeAlta && (
              <Button
                variant="default"
                leftSection={<IconTags size={16} />}
                onClick={() => setTiposOpen(true)}
              >
                Tipos de pieza
              </Button>
            )}
            <Button
              variant="default"
              leftSection={<IconFileTypePdf size={16} />}
              loading={exportando}
              onClick={handleExportPdf}
            >
              Generar reporte
            </Button>
            <Switch
              size="sm" label="Ver archivadas"
              checked={verArchivados}
              onChange={(e) => setVerArchivados(e.currentTarget.checked)}
            />
            {puedeDarDeAlta && (
              <Button
                leftSection={<IconPlus size={16} />}
                onClick={() => setCreateOpen(true)}
              >
                Nueva refacción
              </Button>
            )}
          </Group>
        </Group>

        {/* Búsqueda */}
        <Group gap="xs" wrap="nowrap">
          <Select
            data={[
              { value: 'all', label: 'Todo' },
              { value: 'numero_serie', label: 'No. serie' },
              { value: 'descripcion', label: 'Descripción' },
              { value: 'tipo_pieza', label: 'Tipo' },
              { value: 'marca', label: 'Marca' },
            ]}
            value={searchBy}
            onChange={(v) => setSearchBy((v as SearchBy) ?? 'all')}
            w={150}
            allowDeselect={false}
          />
          <TextInput
            style={{ flex: 1 }}
            placeholder={
              searchBy === 'numero_serie' ? 'Buscar por número de serie…'
              : searchBy === 'descripcion' ? 'Buscar por descripción…'
              : searchBy === 'tipo_pieza' ? 'Buscar por tipo de refacción…'
              : searchBy === 'marca' ? 'Buscar por marca…'
              : 'Buscar por número de serie, descripción, tipo o marca…'
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
                onSelect={setSelectedId} onEdit={setEditPieza} onArchivar={setArchivando}
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
            onSelect={setSelectedId} onEdit={setEditPieza} onArchivar={setArchivando}
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
              marca:         editPieza.marca,
              tipo_pieza_id: editPieza.tipo_pieza_id != null ? String(editPieza.tipo_pieza_id) : '',
            }}
            isPending={updateMut.isPending}
            error={updateMut.error ? (updateMut.error as Error).message : null}
            onSubmit={handleUpdate}
            onCancel={() => setEditPieza(null)}
          />
        )}
      </Modal>

      <ArchivarCatalogoModal
        recurso="refacciones" item={archivando && { ...archivando, nombre: archivando.numero_serie }}
        etiqueta="la refacción"
        onClose={() => setArchivando(null)}
      />

      <LotesDrawer piezaId={selectedId} onClose={() => setSelectedId(null)} />

      <FacturasDrawer opened={facturasOpen} onClose={() => setFacturasOpen(false)} />
      <TiposPiezaDrawer opened={tiposOpen} onClose={() => setTiposOpen(false)} />
    </>
  )
}
