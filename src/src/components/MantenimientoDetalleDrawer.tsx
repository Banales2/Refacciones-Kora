import { useState } from 'react'
import {
  Drawer, Stack, Group, Text, Table, Loader, Center, Alert,
  ActionIcon, Button, Modal, NumberInput, Select,
} from '@mantine/core'
import { useForm } from '@mantine/form'
import { IconPencil, IconTrash, IconPlus } from '@tabler/icons-react'
import {
  useDetalleMtto, useCreateDetalleMtto, useUpdateDetalleMtto, useDeleteDetalleMtto,
} from '../hooks/useDetalleMtto'
import type { DetalleMttoPieza, DetalleMttoPayload } from '../hooks/useDetalleMtto'
import { useLotesDisponibles } from '../hooks/useLotesDisponibles'

function formatMXN(n: number) {
  return n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })
}

// ─── Formulario de detalle ───────────────────────────────────────────────────

type DetalleFormValues = {
  lote_id:        string
  cantidad:       number | string
  costo_unitario: number | string
}

function DetalleForm({
  mode, lockedLabel, initial, maxCantidad: maxCantidadEdit, isPending, error, onSubmit, onCancel,
}: {
  mode:        'create' | 'edit'
  lockedLabel?: string
  initial?:    DetalleFormValues
  maxCantidad?: number
  isPending:   boolean
  error:       string | null
  onSubmit:    (v: DetalleFormValues) => void
  onCancel:    () => void
}) {
  const { data: lotesData } = useLotesDisponibles(mode === 'create')
  const loteOptions = (lotesData?.data ?? []).map((l) => ({
    value: String(l.id),
    label: `${l.numero_serie} — ${l.descripcion} (disp: ${l.cantidad_disponible}, ${formatMXN(l.costo_unitario)})`,
  }))

  const form = useForm<DetalleFormValues>({
    initialValues: initial ?? {
      lote_id: '', cantidad: '', costo_unitario: '',
    },
    validate: {
      lote_id:        (v) => (mode === 'create' && !v ? 'Pieza requerida' : null),
      cantidad:       (v) => (v === '' || Number(v) < 1 ? 'Mínimo 1 unidad' : null),
      costo_unitario: (v) => (v === '' || Number(v) < 0 ? 'Costo inválido' : null),
    },
  })

  const selectedLote = lotesData?.data.find((l) => String(l.id) === form.values.lote_id)
  const maxCantidad = mode === 'create' ? selectedLote?.cantidad_disponible : maxCantidadEdit

  function handleLoteChange(value: string | null) {
    form.setFieldValue('lote_id', value ?? '')
    const lote = lotesData?.data.find((l) => String(l.id) === value)
    if (lote) {
      form.setFieldValue('costo_unitario', lote.costo_unitario)
      if (Number(form.values.cantidad) > lote.cantidad_disponible) {
        form.setFieldValue('cantidad', lote.cantidad_disponible)
      }
    }
  }

  function handleSubmit(values: DetalleFormValues) {
    if (maxCantidad !== undefined && Number(values.cantidad) > maxCantidad) {
      form.setFieldError('cantidad', `Máximo disponible: ${maxCantidad}`)
      return
    }
    onSubmit(values)
  }

  return (
    <form onSubmit={form.onSubmit(handleSubmit)}>
      <Stack gap="sm">
        {error && <Alert color="red" title="Error">{error}</Alert>}
        {mode === 'create' ? (
          <Select
            label="Pieza / lote"
            placeholder="Selecciona la pieza usada"
            data={loteOptions}
            searchable
            value={form.values.lote_id || null}
            onChange={handleLoteChange}
            error={form.errors.lote_id as string}
          />
        ) : (
          <div>
            <Text size="xs" c="dimmed">Pieza</Text>
            <Text size="sm" fw={500}>{lockedLabel}</Text>
          </div>
        )}
        <NumberInput
          label="Cantidad"
          placeholder="0"
          min={1}
          max={maxCantidad}
          clampBehavior="blur"
          allowDecimal={false}
          description={maxCantidad !== undefined ? `Disponible: ${maxCantidad}` : undefined}
          {...form.getInputProps('cantidad')}
        />
        <NumberInput
          label="Costo unitario" placeholder="0.00" min={0} decimalScale={2} prefix="$"
          {...form.getInputProps('costo_unitario')}
        />
        <Group justify="flex-end" mt="xs">
          <Button variant="default" onClick={onCancel} disabled={isPending}>Cancelar</Button>
          <Button type="submit" loading={isPending}>Guardar</Button>
        </Group>
      </Stack>
    </form>
  )
}

// ─── Drawer principal ─────────────────────────────────────────────────────────

interface Props {
  mantenimientoId: number | null
  onClose: () => void
}

export default function MantenimientoDetalleDrawer({ mantenimientoId, onClose }: Props) {
  const [createOpen, setCreateOpen] = useState(false)
  const [editItem, setEditItem]     = useState<DetalleMttoPieza | null>(null)
  const [deleteItem, setDeleteItem] = useState<DetalleMttoPieza | null>(null)

  const { data, isLoading } = useDetalleMtto(mantenimientoId)
  const createMut = useCreateDetalleMtto(mantenimientoId)
  const updateMut = useUpdateDetalleMtto(mantenimientoId)
  const deleteMut = useDeleteDetalleMtto(mantenimientoId)

  function toPayload(values: DetalleFormValues): DetalleMttoPayload {
    return {
      lote_id:        Number(values.lote_id),
      cantidad:        Number(values.cantidad),
      costo_unitario:  Number(values.costo_unitario),
    }
  }

  function handleCreate(values: DetalleFormValues) {
    createMut.mutate(toPayload(values), { onSuccess: () => setCreateOpen(false) })
  }

  function handleUpdate(values: DetalleFormValues) {
    if (!editItem) return
    const { lote_id: _loteId, ...payload } = toPayload(values)
    updateMut.mutate({ id: editItem.id, ...payload }, { onSuccess: () => setEditItem(null) })
  }

  function handleDelete() {
    if (!deleteItem) return
    deleteMut.mutate(deleteItem.id, { onSuccess: () => setDeleteItem(null) })
  }

  const detalles = data?.detalles ?? []
  const piezasTotal = detalles.reduce((s, d) => s + d.cantidad * d.costo_unitario, 0)
  const costoMantenimiento = data?.mantenimiento.costo ?? 0
  const granTotal = piezasTotal + costoMantenimiento

  return (
    <>
      <Drawer
        opened={mantenimientoId !== null}
        onClose={onClose}
        title={<Text fw={700}>Piezas utilizadas en el mantenimiento</Text>}
        position="right"
        size="xl"
        overlayProps={{ backgroundOpacity: 0.3 }}
      >
        {isLoading ? (
          <Center py="xl"><Loader /></Center>
        ) : (
          <Stack gap="md">
            <Group justify="space-between" align="flex-end">
              <Group gap="xl">
                <div>
                  <Text size="xs" c="dimmed" tt="uppercase" fw={600}>Costo piezas</Text>
                  <Text fw={700} size="lg">{formatMXN(piezasTotal)}</Text>
                </div>
                <div>
                  <Text size="xs" c="dimmed" tt="uppercase" fw={600}>Costo mantenimiento</Text>
                  <Text fw={700} size="lg">{formatMXN(costoMantenimiento)}</Text>
                </div>
                <div>
                  <Text size="xs" c="dimmed" tt="uppercase" fw={600}>Total</Text>
                  <Text fw={700} size="lg" c="blue">{formatMXN(granTotal)}</Text>
                </div>
              </Group>
              <Button size="xs" leftSection={<IconPlus size={14} />} onClick={() => setCreateOpen(true)}>
                Agregar pieza
              </Button>
            </Group>

            {!detalles.length ? (
              <Center py="xl">
                <Text c="dimmed">Este mantenimiento no tiene piezas registradas.</Text>
              </Center>
            ) : (
              <Table.ScrollContainer minWidth={560}>
                <Table withTableBorder withColumnBorders striped>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Pieza</Table.Th>
                      <Table.Th style={{ textAlign: 'center' }}>Cantidad</Table.Th>
                      <Table.Th style={{ textAlign: 'right' }}>Costo unit.</Table.Th>
                      <Table.Th style={{ textAlign: 'right' }}>Subtotal</Table.Th>
                      <Table.Th style={{ width: 72 }} />
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {detalles.map((d) => (
                      <Table.Tr key={d.id}>
                        <Table.Td>
                          <Text size="sm" fw={500}>{d.numero_serie}</Text>
                          <Text size="xs" c="dimmed">{d.descripcion}</Text>
                        </Table.Td>
                        <Table.Td style={{ textAlign: 'center' }}>{d.cantidad}</Table.Td>
                        <Table.Td style={{ textAlign: 'right' }}>{formatMXN(d.costo_unitario)}</Table.Td>
                        <Table.Td style={{ textAlign: 'right' }}>{formatMXN(d.cantidad * d.costo_unitario)}</Table.Td>
                        <Table.Td>
                          <Group gap={4} justify="flex-end" wrap="nowrap">
                            <ActionIcon
                              variant="subtle" color="blue" size="sm"
                              aria-label="Editar pieza"
                              onClick={() => setEditItem(d)}
                            >
                              <IconPencil size={14} />
                            </ActionIcon>
                            <ActionIcon
                              variant="subtle" color="red" size="sm"
                              aria-label="Eliminar pieza"
                              onClick={() => setDeleteItem(d)}
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

      <Modal opened={createOpen} onClose={() => setCreateOpen(false)} title="Agregar pieza" centered>
        <DetalleForm
          mode="create"
          isPending={createMut.isPending}
          error={createMut.error ? (createMut.error as Error).message : null}
          onSubmit={handleCreate}
          onCancel={() => setCreateOpen(false)}
        />
      </Modal>

      <Modal opened={editItem !== null} onClose={() => setEditItem(null)} title="Editar pieza" centered>
        {editItem && (
          <DetalleForm
            mode="edit"
            lockedLabel={`${editItem.numero_serie} — ${editItem.descripcion}`}
            maxCantidad={editItem.cantidad + editItem.lote_disponible}
            initial={{
              lote_id:        String(editItem.lote_id),
              cantidad:       editItem.cantidad,
              costo_unitario: editItem.costo_unitario,
            }}
            isPending={updateMut.isPending}
            error={updateMut.error ? (updateMut.error as Error).message : null}
            onSubmit={handleUpdate}
            onCancel={() => setEditItem(null)}
          />
        )}
      </Modal>

      <Modal
        opened={deleteItem !== null} onClose={() => setDeleteItem(null)}
        title="Eliminar pieza" centered size="sm"
      >
        <Stack gap="md">
          <Text>
            ¿Seguro que deseas quitar{' '}
            <Text component="span" fw={700}>{deleteItem?.numero_serie}</Text>
            {' '}de este mantenimiento? El stock se devolverá al lote de origen.
          </Text>
          {deleteMut.error && (
            <Alert color="red" title="Error">{(deleteMut.error as Error).message}</Alert>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDeleteItem(null)} disabled={deleteMut.isPending}>
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
