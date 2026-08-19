// Página Proveedores: catálogo de proveedores de refacciones (CRUD).
// Se muestra como pestaña dentro de Catálogos (SitiosYRutas).
//
// El clic en un renglón abre el detalle del proveedor (ProveedorDetalle), que
// es donde se registran y comparan los precios que da por cada refacción. El
// detalle sustituye a la lista en la misma pestaña, con su propio "volver": la
// navegación de la app es por estado, no por rutas.
import { useState } from 'react'
import {
  Stack, Group, Text, Table, Loader, Center, Alert,
  Button, ActionIcon, Modal, Menu, Tooltip,
} from '@mantine/core'
import {
  IconPencil, IconTrash, IconPlus, IconFileTypePdf, IconFileSpreadsheet, IconScale,
} from '@tabler/icons-react'
import {
  useProveedores, useCreateProveedor, useUpdateProveedor, useDeleteProveedor,
} from '../hooks/useProveedores'
import type { Proveedor } from '../hooks/useProveedores'
import ProveedorForm from '../components/ProveedorForm'
import ProveedorDetalle from './ProveedorDetalle'
import { useComparativaPrecios } from '../hooks/usePreciosProveedor'
import {
  exportComparativaPreciosPdf, exportComparativaPreciosExcel,
} from '../lib/reportes/comparativaPrecios'

export default function Proveedores() {
  const [createOpen, setCreateOpen]       = useState(false)
  const [editProveedor, setEditProveedor] = useState<Proveedor | null>(null)
  const [deleteProveedor, setDeleteProveedor] = useState<Proveedor | null>(null)
  // Proveedor cuyo detalle está abierto; null = la lista.
  const [detalleId, setDetalleId] = useState<number | null>(null)

  const { data, isLoading, isError } = useProveedores()
  // La comparativa cruza todas las refacciones contra todos los proveedores. Se
  // carga aqui —y no dentro del detalle de uno— porque la pregunta que contesta
  // es de compras en general: "de todo lo que compramos, que conviene mover".
  const { data: comparativa } = useComparativaPrecios()
  const [generando, setGenerando] = useState<'pdf' | 'excel' | null>(null)

  async function generarComparativa(formato: 'pdf' | 'excel') {
    if (!comparativa) return
    setGenerando(formato)
    try {
      await (formato === 'pdf' ? exportComparativaPreciosPdf : exportComparativaPreciosExcel)(comparativa.data)
    } catch (e) {
      alert((e as Error).message)
    } finally {
      setGenerando(null)
    }
  }

  const createMut = useCreateProveedor()
  const updateMut = useUpdateProveedor()
  const deleteMut = useDeleteProveedor()

  const proveedores = data?.data ?? []

  // Se busca en la lista en vez de guardar el objeto: así el detalle refleja
  // una edición del proveedor sin tener que cerrarlo y volver a abrirlo.
  const detalle = proveedores.find((p) => p.id === detalleId) ?? null
  if (detalle) {
    return <ProveedorDetalle proveedor={detalle} onBack={() => setDetalleId(null)} />
  }

  return (
    <>
      <Stack gap="md">
        {/* El título lo pone Catálogos (SitiosYRutas); aquí sólo el conteo y el
            alta, como en los demás paneles. */}
        <Group justify="space-between">
          {proveedores.length > 0 ? (
            <Text size="sm" c="dimmed">
              {proveedores.length} proveedores · abre uno para ver y comparar sus precios
            </Text>
          ) : <span />}
          <Group gap="xs">
            {/* La comparativa vive junto al catalogo de proveedores y no dentro
                de uno: comparar precios es justamente mirar a todos a la vez. */}
            <Menu shadow="md" position="bottom-end" width={300}>
              <Menu.Target>
                <Tooltip
                  label={comparativa && comparativa.data.piezas.length === 0
                    ? 'Todavia no hay precios capturados que comparar'
                    : 'Cada refaccion con el precio vigente de todos los proveedores'}
                >
                  <Button
                    size="xs" variant="default"
                    leftSection={<IconScale size={14} />}
                    loading={generando !== null}
                    disabled={!comparativa}
                  >
                    Comparativa de precios
                  </Button>
                </Tooltip>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>
                  {comparativa
                    ? `${comparativa.data.totales.refacciones} refacciones · ` +
                      `${comparativa.data.totales.comparables} comparables`
                    : 'Cargando…'}
                </Menu.Label>
                <Menu.Item
                  leftSection={<IconFileTypePdf size={16} />}
                  onClick={() => generarComparativa('pdf')}
                >
                  PDF — para negociar
                </Menu.Item>
                <Menu.Item
                  leftSection={<IconFileSpreadsheet size={16} />}
                  onClick={() => generarComparativa('excel')}
                >
                  Excel — tabla por proveedor
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
            <Button
              size="xs"
              leftSection={<IconPlus size={14} />}
              onClick={() => setCreateOpen(true)}
            >
              Nuevo proveedor
            </Button>
          </Group>
        </Group>

        {isLoading ? (
          <Center py="xl"><Loader /></Center>
        ) : isError ? (
          <Alert color="red" title="Error al cargar">
            No se pudieron obtener los proveedores. Verifica la conexión.
          </Alert>
        ) : proveedores.length === 0 ? (
          <Center py="xl">
            <Text c="dimmed">No hay proveedores registrados.</Text>
          </Center>
        ) : (
          <Table.ScrollContainer minWidth={560}>
            <Table striped highlightOnHover withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Nombre</Table.Th>
                  <Table.Th>Contacto</Table.Th>
                  <Table.Th style={{ width: 140 }}>No. Teléfono</Table.Th>
                  <Table.Th style={{ width: 80 }} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {proveedores.map((p) => (
                  <Table.Tr
                    key={p.id}
                    onClick={() => setDetalleId(p.id)}
                    style={{ cursor: 'pointer' }}
                  >
                    <Table.Td fw={500}>{p.nombre}</Table.Td>
                    <Table.Td c={p.contacto ? undefined : 'dimmed'}>
                      {p.contacto ?? '—'}
                    </Table.Td>
                    <Table.Td c={p.telefono ? undefined : 'dimmed'}>
                      {p.telefono ?? '—'}
                    </Table.Td>
                    <Table.Td>
                      <Group gap={4} justify="flex-end" wrap="nowrap">
                        <ActionIcon
                          variant="subtle"
                          color="blue"
                          aria-label="Editar"
                          onClick={(e) => { e.stopPropagation(); setEditProveedor(p) }}
                        >
                          <IconPencil size={16} />
                        </ActionIcon>
                        <ActionIcon
                          variant="subtle"
                          color="red"
                          aria-label="Eliminar"
                          onClick={(e) => { e.stopPropagation(); setDeleteProveedor(p) }}
                        >
                          <IconTrash size={16} />
                        </ActionIcon>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Stack>

      {/* Modal: nuevo proveedor */}
      <Modal
        opened={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Nuevo proveedor"
        centered
        size="sm"
      >
        <ProveedorForm
          isPending={createMut.isPending}
          error={createMut.error ? (createMut.error as Error).message : null}
          onSubmit={(payload) =>
            createMut.mutate(payload, { onSuccess: () => setCreateOpen(false) })
          }
          onCancel={() => setCreateOpen(false)}
        />
      </Modal>

      {/* Modal: editar proveedor */}
      <Modal
        opened={editProveedor !== null}
        onClose={() => setEditProveedor(null)}
        title="Editar proveedor"
        centered
        size="sm"
      >
        {editProveedor && (
          <ProveedorForm
            initial={editProveedor}
            isPending={updateMut.isPending}
            error={updateMut.error ? (updateMut.error as Error).message : null}
            onSubmit={(payload) =>
              updateMut.mutate(
                { id: editProveedor.id, payload },
                { onSuccess: () => setEditProveedor(null) }
              )
            }
            onCancel={() => setEditProveedor(null)}
          />
        )}
      </Modal>

      {/* Modal: confirmar eliminación */}
      <Modal
        opened={deleteProveedor !== null}
        onClose={() => setDeleteProveedor(null)}
        title="Eliminar proveedor"
        centered
        size="sm"
      >
        <Stack gap="md">
          <Text>
            ¿Seguro que deseas eliminar{' '}
            <Text component="span" fw={700}>{deleteProveedor?.nombre}</Text>?
          </Text>
          <Text size="sm" c="dimmed">
            No podrá eliminarse si tiene lotes registrados.
          </Text>
          {deleteMut.error && (
            <Alert color="red" title="Error">
              {(deleteMut.error as Error).message}
            </Alert>
          )}
          <Group justify="flex-end">
            <Button
              variant="default"
              onClick={() => setDeleteProveedor(null)}
              disabled={deleteMut.isPending}
            >
              Cancelar
            </Button>
            <Button
              color="red"
              loading={deleteMut.isPending}
              onClick={() =>
                deleteMut.mutate(deleteProveedor!.id, {
                  onSuccess: () => setDeleteProveedor(null),
                })
              }
            >
              Eliminar
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  )
}
