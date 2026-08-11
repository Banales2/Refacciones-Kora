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
import { useUsuarioActual } from '../hooks/useUsuarioActual'
import { TEXTO_SIMPLE, limpiarTextoSimple } from '../lib/validaciones'
import { FechaInput } from './FechaInput'

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
  comprado_por: string
}

function LoteForm({
  initial,
  autorizadoPor,
  isPending,
  error,
  onSubmit,
  onCancel,
}: {
  initial?: LoteFormValues
  /** Sólo al editar: quien autorizó la compra en su momento. */
  autorizadoPor?: string
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

  // Sólo informativo: el valor real lo pone la API con la cuenta de la sesión.
  // Al editar se muestra el autorizador original, que no cambia.
  const { data: usuario } = useUsuarioActual()
  const autoriza = autorizadoPor ?? usuario?.data.nombre ?? ''

  const form = useForm<LoteFormValues>({
    initialValues: initial ?? {
      proveedor_id: '',
      fecha_compra: '',
      costo_unitario: '',
      cantidad_inicial: '',
      num_factura: '',
      comprado_por: '',
    },
    validate: {
      proveedor_id: (v) => (!v ? 'Proveedor requerido' : null),
      fecha_compra: (v) => {
        if (!v) return 'Fecha requerida'
        if (v > hoy) return 'No puede ser una fecha futura'
        return null
      },
      costo_unitario: (v) => {
        if (v === '' || Number(v) <= 0) return 'Debe ser mayor a 0'
        if (Number(v) > 200000) return 'No puede ser mayor a $200,000'
        return null
      },
      cantidad_inicial: (v) => {
        if (v === '' || !Number.isInteger(Number(v)) || Number(v) < 1)
          return 'Mínimo 1 unidad entera'
        if (Number(v) > 999) return 'Máximo 999 unidades'
        return null
      },
      num_factura: (v) => {
        if (!v.trim()) return 'No. factura requerido'
        if (v.trim().length > 30) return 'Máximo 30 caracteres'
        if (!/^[A-Za-z0-9-]+$/.test(v.trim())) return 'Solo letras, números y guiones'
        return null
      },
      comprado_por: (v) => {
        if (!v.trim()) return 'Requerido'
        if (v.trim().length > 120) return 'Máximo 120 caracteres'
        if (!TEXTO_SIMPLE.test(v.trim())) return 'Solo letras, números, espacios y guiones'
        return null
      },
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
        <FechaInput
          label="Fecha de compra"
          required
          maxDate={hoy}
          value={form.values.fecha_compra}
          onChange={(d) => form.setFieldValue('fecha_compra', d)}
          error={form.errors.fecha_compra as string}
        />
        <NumberInput
          label="Costo unitario"
          placeholder="0.00"
          min={0.01}
          max={200000}
          clampBehavior="strict"
          decimalScale={2}
          prefix="$"
          required
          {...form.getInputProps('costo_unitario')}
        />
        <NumberInput
          label="Cantidad inicial"
          placeholder="0"
          min={1}
          max={999}
          clampBehavior="strict"
          allowDecimal={false}
          required
          {...form.getInputProps('cantidad_inicial')}
        />
        <TextInput
          label="No. factura"
          placeholder="Ej. A-12345"
          maxLength={30}
          required
          {...form.getInputProps('num_factura')}
          onChange={(e) =>
            // Allowlist: solo letras, números y guiones
            form.setFieldValue('num_factura', e.currentTarget.value.replace(/[^A-Za-z0-9-]/g, ''))
          }
        />
        <TextInput
          label="Comprado por"
          placeholder="Quién hizo la compra"
          description="El empleado que realizó la compra"
          maxLength={120}
          required
          {...form.getInputProps('comprado_por')}
          onChange={(e) =>
            form.setFieldValue('comprado_por', limpiarTextoSimple(e.currentTarget.value, 120))
          }
        />
        <TextInput
          label="Autorizado por"
          value={autoriza}
          disabled
          description={autorizadoPor
            ? 'Quien registró la compra; no cambia al editarla'
            : 'Se registra automáticamente con tu cuenta: registrarla es autorizarla'}
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
