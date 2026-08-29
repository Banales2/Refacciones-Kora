// Drawer de lotes de compra de una pieza: se abre al seleccionar una pieza en
// la página Piezas y permite ver el stock por lote (proveedor, factura, costo,
// cantidades) y dar de alta, editar o eliminar lotes.
//
// Desde aquí sale también el PDF comparativo de proveedores de esa refacción
// —precio vigente de cada uno y en cuántos días entrega—: la pieza abierta es
// justo el momento en que se decide a quién comprarle, y hasta ahora esa
// comparación solo existía para el catálogo completo.
import { useState } from 'react'
import {
  Drawer, Stack, Group, Text, Badge, Table, Loader, Center, Alert,
  ActionIcon, Button, Modal, Tooltip,
} from '@mantine/core'
import { IconPencil, IconTrash, IconPlus, IconFileTypePdf } from '@tabler/icons-react'
import {
  useLotes, useCreateLote, useUpdateLote, useDeleteLote,
} from '../hooks/useLotes'
import type { Lote, LotePayload } from '../hooks/useLotes'
import { useComparativaPieza } from '../hooks/usePreciosProveedor'
import { exportComparativaPiezaPdf } from '../lib/reportes/comparativaPieza'
import LoteForm from './LoteForm'
import type { LoteFormValues } from './LoteForm'

function stockColor(qty: number) {
  if (qty === 0) return 'red'
  if (qty < 10) return 'orange'
  return 'green'
}

function formatMXN(n: number) {
  return n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-MX', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

function toDateInputValue(iso: string) {
  return iso.substring(0, 10)
}

// ─── Drawer principal ─────────────────────────────────────────────────────────

interface Props {
  piezaId: number | null
  onClose: () => void
}


export default function LotesDrawer({ piezaId, onClose }: Props) {
  const [createOpen, setCreateOpen] = useState(false)
  const [editLote, setEditLote] = useState<Lote | null>(null)
  const [deleteLote, setDeleteLote] = useState<Lote | null>(null)
  const [generando, setGenerando]   = useState(false)

  const { data, isLoading } = useLotes(piezaId)
  // La comparativa se pide junto con los lotes y no al pulsar el botón: así el
  // drawer ya sabe si hay algo que comparar y puede decirlo antes de que
  // alguien genere un PDF vacío.
  const { data: comparativa, isLoading: cargandoComparativa } = useComparativaPieza(piezaId)
  const createMut = useCreateLote()
  const updateMut = useUpdateLote()
  const deleteMut = useDeleteLote()

  function toPayload(values: LoteFormValues): LotePayload {
    return {
      proveedor_id: parseInt(values.proveedor_id),
      // Vacío al editar: el formulario no pide la sucursal en ese caso y la API
      // no la acepta en el update.
      sucursal_id: values.sucursal_id ? parseInt(values.sucursal_id) : undefined,
      fecha_compra: values.fecha_compra,
      costo_unitario: Number(values.costo_unitario),
      cantidad_inicial: Number(values.cantidad_inicial),
      num_factura: values.num_factura.trim(),
      comprado_por: values.comprado_por.trim(),
    }
  }

  function handleCreate(values: LoteFormValues) {
    createMut.mutate(
      { piezaId: piezaId!, ...toPayload(values) },
      { onSuccess: () => setCreateOpen(false) }
    )
  }

  function handleUpdate(values: LoteFormValues) {
    if (!editLote) return
    // La sucursal se queda fuera: la de recepción ya no cambia, y para mover
    // piezas está el traspaso.
    const { sucursal_id: _omitida, ...payload } = toPayload(values)
    void _omitida
    updateMut.mutate(
      { id: editLote.id, ...payload },
      { onSuccess: () => setEditLote(null) }
    )
  }

  function handleDelete() {
    if (!deleteLote) return
    deleteMut.mutate(deleteLote.id, { onSuccess: () => setDeleteLote(null) })
  }

  const stockTotal = data?.lotes.reduce((s, l) => s + l.cantidad_disponible, 0) ?? 0
  const cotizaciones = comparativa?.data.fila?.precios.length ?? 0

  async function generarComparativa() {
    if (!comparativa) return
    setGenerando(true)
    try { await exportComparativaPiezaPdf(comparativa.data) }
    finally { setGenerando(false) }
  }

  return (
    <>
      <Drawer
        opened={piezaId !== null}
        onClose={onClose}
        title={
          data ? (
            <Stack gap={2}>
              <Text fw={700} size="md">{data.pieza.numero_serie}</Text>
              <Text size="xs" c="dimmed">{data.pieza.descripcion}</Text>
            </Stack>
          ) : (
            <Text fw={700}>Historial de lotes</Text>
          )
        }
        position="right"
        size="xl"
        overlayProps={{ backgroundOpacity: 0.3 }}
      >
        {isLoading ? (
          <Center py="xl"><Loader /></Center>
        ) : (
          <Stack gap="md">
            {/* Resumen + botón nuevo */}
            <Group justify="space-between" align="flex-end">
              <Group gap="xl">
                <div>
                  <Text size="xs" c="dimmed" tt="uppercase" fw={600}>Lotes</Text>
                  <Text fw={700} size="lg">{data?.lotes.length ?? 0}</Text>
                </div>
                <div>
                  <Text size="xs" c="dimmed" tt="uppercase" fw={600}>Stock total</Text>
                  <Badge color={stockColor(stockTotal)} variant="light" size="lg">
                    {stockTotal}
                  </Badge>
                </div>
              </Group>
              <Group gap="xs">
                <Tooltip
                  label={
                    cotizaciones === 0
                      ? 'Ningún proveedor tiene precio registrado para esta refacción'
                      : `Precio y tiempo de entrega de ${cotizaciones} proveedor${cotizaciones !== 1 ? 'es' : ''}`
                  }
                >
                  {/* El <span> es lo que sostiene el tooltip cuando el botón va
                      deshabilitado: un botón inerte no dispara eventos. */}
                  <span>
                    <Button
                      size="xs"
                      variant="light"
                      leftSection={<IconFileTypePdf size={14} />}
                      loading={generando}
                      disabled={cargandoComparativa || cotizaciones === 0}
                      onClick={generarComparativa}
                    >
                      Comparar proveedores
                    </Button>
                  </span>
                </Tooltip>
                <Button
                  size="xs"
                  leftSection={<IconPlus size={14} />}
                  onClick={() => setCreateOpen(true)}
                >
                  Nuevo lote
                </Button>
              </Group>
            </Group>

            {!data?.lotes.length ? (
              <Center py="xl">
                <Text c="dimmed">Esta refacción no tiene lotes registrados.</Text>
              </Center>
            ) : (
              <Table.ScrollContainer minWidth={840}>
                <Table withTableBorder withColumnBorders striped>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Fecha compra</Table.Th>
                      <Table.Th>Proveedor</Table.Th>
                      <Table.Th>Factura</Table.Th>
                      <Table.Th>Compró</Table.Th>
                      <Table.Th>Autorizó</Table.Th>
                      <Table.Th style={{ textAlign: 'right' }}>Costo unit.</Table.Th>
                      <Table.Th style={{ textAlign: 'center' }}>Inicial</Table.Th>
                      <Table.Th style={{ textAlign: 'center' }}>Disponible</Table.Th>
                      <Table.Th style={{ width: 72 }} />
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {data?.lotes.map((lote) => (
                      <Table.Tr key={lote.id}>
                        <Table.Td>{formatDate(lote.fecha_compra)}</Table.Td>
                        <Table.Td>{lote.proveedor}</Table.Td>
                        <Table.Td c="dimmed">{lote.num_factura ?? '—'}</Table.Td>
                        <Table.Td>{lote.comprado_por || '—'}</Table.Td>
                        <Table.Td>{lote.autorizado_por || '—'}</Table.Td>
                        <Table.Td style={{ textAlign: 'right' }}>
                          {formatMXN(lote.costo_unitario)}
                        </Table.Td>
                        <Table.Td style={{ textAlign: 'center' }}>{lote.cantidad_inicial}</Table.Td>
                        <Table.Td style={{ textAlign: 'center' }}>
                          <Badge color={stockColor(lote.cantidad_disponible)} variant="light" size="sm">
                            {lote.cantidad_disponible}
                          </Badge>
                        </Table.Td>
                        <Table.Td>
                          <Group gap={4} justify="flex-end" wrap="nowrap">
                            <ActionIcon
                              variant="subtle"
                              color="blue"
                              size="sm"
                              aria-label="Editar lote"
                              onClick={() => setEditLote(lote)}
                            >
                              <IconPencil size={14} />
                            </ActionIcon>
                            <ActionIcon
                              variant="subtle"
                              color="red"
                              size="sm"
                              aria-label="Eliminar lote"
                              onClick={() => setDeleteLote(lote)}
                            >
                              <IconTrash size={14} />
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
        )}
      </Drawer>

      {/* Modal: nuevo lote */}
      <Modal opened={createOpen} onClose={() => setCreateOpen(false)} title="Nuevo lote" centered>
        <LoteForm
          isPending={createMut.isPending}
          error={createMut.error ? (createMut.error as Error).message : null}
          onSubmit={handleCreate}
          onCancel={() => setCreateOpen(false)}
        />
      </Modal>

      {/* Modal: editar lote */}
      <Modal opened={editLote !== null} onClose={() => setEditLote(null)} title="Editar lote" centered>
        {editLote && (
          <LoteForm
            initial={{
              proveedor_id: String(editLote.proveedor_id),
              // El formulario no muestra este campo al editar, pero el tipo lo
              // pide; se conserva el valor original.
              sucursal_id: editLote.sucursal_id != null ? String(editLote.sucursal_id) : '',
              fecha_compra: toDateInputValue(editLote.fecha_compra),
              costo_unitario: editLote.costo_unitario,
              cantidad_inicial: editLote.cantidad_inicial,
              num_factura: editLote.num_factura ?? '',
              comprado_por: editLote.comprado_por,
            }}
            autorizadoPor={editLote.autorizado_por}
            isPending={updateMut.isPending}
            error={updateMut.error ? (updateMut.error as Error).message : null}
            onSubmit={handleUpdate}
            onCancel={() => setEditLote(null)}
          />
        )}
      </Modal>

      {/* Modal: confirmar eliminación */}
      <Modal
        opened={deleteLote !== null}
        onClose={() => setDeleteLote(null)}
        title="Eliminar lote"
        centered
        size="sm"
      >
        <Stack gap="md">
          <Text>
            ¿Seguro que deseas eliminar el lote del{' '}
            <Text component="span" fw={700}>
              {deleteLote ? formatDate(deleteLote.fecha_compra) : ''}
            </Text>
            {' '}de{' '}
            <Text component="span" fw={700}>{deleteLote?.proveedor}</Text>?
            Esta acción no se puede deshacer.
          </Text>
          {deleteMut.error && (
            <Alert color="red" title="Error">
              {(deleteMut.error as Error).message}
            </Alert>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDeleteLote(null)} disabled={deleteMut.isPending}>
              Cancelar
            </Button>
            <Button color="red" onClick={handleDelete} loading={deleteMut.isPending}>
              Eliminar
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  )
}
