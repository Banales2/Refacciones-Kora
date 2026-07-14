// Drawer de lotes de compra de una pieza: se abre al seleccionar una pieza en
// la página Piezas y permite ver el stock por lote (proveedor, factura, costo,
// cantidades) y dar de alta, editar o eliminar lotes.
import { useState } from 'react'
import {
  Drawer, Stack, Group, Text, Badge, Table, Loader, Center, Alert,
  ActionIcon, Button, Modal, TextInput, NumberInput, Select,
} from '@mantine/core'
import { useForm } from '@mantine/form'
import { IconPencil, IconTrash, IconPlus } from '@tabler/icons-react'
import {
  useLotes, useCreateLote, useUpdateLote, useDeleteLote,
} from '../hooks/useLotes'
import type { Lote, LotePayload } from '../hooks/useLotes'
import { useProveedores } from '../hooks/useProveedores'

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

function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ─── Formulario de lote ──────────────────────────────────────────────────────

type LoteFormValues = {
  proveedor_id: string
  fecha_compra: string
  costo_unitario: number | string
  cantidad_inicial: number | string
  num_factura: string
}

function LoteForm({
  initial,
  isPending,
  error,
  onSubmit,
  onCancel,
}: {
  initial?: LoteFormValues
  isPending: boolean
  error: string | null
  onSubmit: (v: LoteFormValues) => void
  onCancel: () => void
}) {
  const hoy = todayIso()
  const { data: provData } = useProveedores()
  const proveedores = (provData?.data ?? []).map((p) => ({
    value: String(p.id),
    label: p.nombre,
  }))

  const form = useForm<LoteFormValues>({
    initialValues: initial ?? {
      proveedor_id: '',
      fecha_compra: '',
      costo_unitario: '',
      cantidad_inicial: '',
      num_factura: '',
    },
    validate: {
      proveedor_id: (v) => (!v ? 'Proveedor requerido' : null),
      fecha_compra: (v) => {
        if (!v) return 'Fecha requerida'
        if (v > hoy) return 'No puede ser una fecha futura'
        return null
      },
      costo_unitario: (v) => (v === '' || Number(v) <= 0 ? 'Debe ser mayor a 0' : null),
      cantidad_inicial: (v) =>
        v === '' || !Number.isInteger(Number(v)) || Number(v) < 1
          ? 'Mínimo 1 unidad entera'
          : null,
    },
  })

  return (
    <form onSubmit={form.onSubmit(onSubmit)}>
      <Stack gap="sm">
        <Select
          label="Proveedor"
          placeholder="Selecciona un proveedor"
          data={proveedores}
          searchable
          required
          {...form.getInputProps('proveedor_id')}
        />
        <TextInput
          label="Fecha de compra"
          type="date"
          required
          max={hoy}
          {...form.getInputProps('fecha_compra')}
        />
        <NumberInput
          label="Costo unitario"
          placeholder="0.00"
          min={0.01}
          decimalScale={2}
          prefix="$"
          required
          {...form.getInputProps('costo_unitario')}
        />
        <NumberInput
          label="Cantidad inicial"
          placeholder="0"
          min={1}
          allowDecimal={false}
          required
          {...form.getInputProps('cantidad_inicial')}
        />
        <TextInput
          label="Núm. factura"
          placeholder="Opcional"
          {...form.getInputProps('num_factura')}
        />
        {error && (
          <Alert color="red" title="Error">{error}</Alert>
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

// ─── Drawer principal ─────────────────────────────────────────────────────────

interface Props {
  piezaId: number | null
  onClose: () => void
}

export default function LotesDrawer({ piezaId, onClose }: Props) {
  const [createOpen, setCreateOpen] = useState(false)
  const [editLote, setEditLote] = useState<Lote | null>(null)
  const [deleteLote, setDeleteLote] = useState<Lote | null>(null)

  const { data, isLoading } = useLotes(piezaId)
  const createMut = useCreateLote()
  const updateMut = useUpdateLote()
  const deleteMut = useDeleteLote()

  function toPayload(values: LoteFormValues): LotePayload {
    return {
      proveedor_id: parseInt(values.proveedor_id),
      fecha_compra: values.fecha_compra,
      costo_unitario: Number(values.costo_unitario),
      cantidad_inicial: Number(values.cantidad_inicial),
      num_factura: values.num_factura.trim() || null,
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
    updateMut.mutate(
      { id: editLote.id, ...toPayload(values) },
      { onSuccess: () => setEditLote(null) }
    )
  }

  function handleDelete() {
    if (!deleteLote) return
    deleteMut.mutate(deleteLote.id, { onSuccess: () => setDeleteLote(null) })
  }

  const stockTotal = data?.lotes.reduce((s, l) => s + l.cantidad_disponible, 0) ?? 0

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
              <Button
                size="xs"
                leftSection={<IconPlus size={14} />}
                onClick={() => setCreateOpen(true)}
              >
                Nuevo lote
              </Button>
            </Group>

            {!data?.lotes.length ? (
              <Center py="xl">
                <Text c="dimmed">Esta pieza no tiene lotes registrados.</Text>
              </Center>
            ) : (
              <Table.ScrollContainer minWidth={560}>
                <Table withTableBorder withColumnBorders striped>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Fecha compra</Table.Th>
                      <Table.Th>Proveedor</Table.Th>
                      <Table.Th>Factura</Table.Th>
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
              fecha_compra: toDateInputValue(editLote.fecha_compra),
              costo_unitario: editLote.costo_unitario,
              cantidad_inicial: editLote.cantidad_inicial,
              num_factura: editLote.num_factura ?? '',
            }}
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
