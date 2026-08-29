// Garantías de una unidad: qué le queda cubierto, hasta cuándo y cuántos
// servicios preventivos existen solo por eso.
//
// La vigencia no se guarda, la calcula la API contra la fecha de arranque y el
// odómetro de hoy; aquí solo se pinta. Cuando una garantía se acaba, los
// requerimientos atados a ella dejan de pedirse solos: por eso la tabla dice
// cuántos cuelgan de cada una.
import { useState } from 'react'
import {
  Stack, Group, Text, Table, Badge, Button, Modal, Alert, Loader, Center,
  ActionIcon, Tooltip, Paper, Divider,
} from '@mantine/core'
import { IconPlus, IconPencil, IconTrash, IconShieldCheck } from '@tabler/icons-react'
import {
  useGarantiasVehiculo, useCreateGarantiaVehiculo, useUpdateGarantiaVehiculo,
  useDeleteGarantiaVehiculo, textoCobertura, etiquetaGarantia,
} from '../hooks/useGarantias'
import type { GarantiaVehiculo, GarantiaVehiculoPayload } from '../hooks/useGarantias'
import { formatFecha } from '../lib/formato'
import GarantiaForm from './GarantiaForm'

/** "hasta el 14 mar 2027" / "hasta los 100,000 km" / las dos. */
function textoLimite(g: GarantiaVehiculo): string {
  const partes: string[] = []
  if (g.estado.vence_el) partes.push(formatFecha(g.estado.vence_el))
  if (g.estado.vence_a_los_km != null) {
    partes.push(`${g.estado.vence_a_los_km.toLocaleString('es-MX')} km`)
  }
  return partes.length ? partes.join(' o ') : '—'
}

export default function GarantiasVehiculoSection({
  vehiculoId, fechaCompra, soportaKm,
}: {
  vehiculoId:  number
  fechaCompra: string | null
  /** Cajas de trailer y montacargas no llevan odómetro: sus garantías solo vencen por tiempo. */
  soportaKm:   boolean
}) {
  const [formOpen, setFormOpen]   = useState(false)
  const [editing, setEditing]     = useState<GarantiaVehiculo | null>(null)
  const [deleting, setDeleting]   = useState<GarantiaVehiculo | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const { data, isLoading } = useGarantiasVehiculo(vehiculoId)
  const items     = data?.data ?? []
  const createMut = useCreateGarantiaVehiculo(vehiculoId)
  const updateMut = useUpdateGarantiaVehiculo(vehiculoId)
  const deleteMut = useDeleteGarantiaVehiculo(vehiculoId)

  function openCreate() { setEditing(null); setFormError(null); setFormOpen(true) }
  function openEdit(g: GarantiaVehiculo) { setEditing(g); setFormError(null); setFormOpen(true) }

  function handleSubmit(payload: GarantiaVehiculoPayload) {
    setFormError(null)
    const opts = {
      onSuccess: () => setFormOpen(false),
      onError:   (e: Error) => setFormError(e.message),
    }
    if (editing) updateMut.mutate({ id: editing.id, payload }, opts)
    else         createMut.mutate(payload, opts)
  }

  const vigentes = items.filter((g) => g.estado.vigente).length

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="sm">
        <Group justify="space-between" align="center">
          <Group gap="xs">
            <IconShieldCheck size={18} />
            <Text size="sm" fw={500}>
              Garantías ({items.length}{items.length > 0 ? `, ${vigentes} vigente${vigentes === 1 ? '' : 's'}` : ''})
            </Text>
          </Group>
          <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={openCreate}>
            Agregar garantía
          </Button>
        </Group>

        {isLoading ? (
          <Center py="md"><Loader size="sm" /></Center>
        ) : items.length === 0 ? (
          <Text c="dimmed" size="sm">
            Esta unidad no tiene garantías registradas. Las del modelo se copian solas al dar
            de alta el vehículo; aquí se agregan las que se compraron aparte.
          </Text>
        ) : (
          <Table.ScrollContainer minWidth={720}>
            <Table striped highlightOnHover withTableBorder verticalSpacing="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Garantía</Table.Th>
                  <Table.Th>Estado</Table.Th>
                  <Table.Th>Cobertura</Table.Th>
                  <Table.Th>Desde</Table.Th>
                  <Table.Th>Vence</Table.Th>
                  <Table.Th style={{ textAlign: 'center' }}>Servicios</Table.Th>
                  <Table.Th style={{ width: 80 }} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {items.map((g) => {
                  const et = etiquetaGarantia(g)
                  return (
                    <Table.Tr key={g.id} opacity={g.estado.vigente ? 1 : 0.65}>
                      <Table.Td>
                        <Group gap={6} wrap="nowrap">
                          <Text size="sm" fw={500}>{g.nombre}</Text>
                          {g.garantia_origen_id != null && (
                            <Tooltip label="Viene del catálogo del modelo">
                              <Badge size="xs" variant="light" color="grape">Del modelo</Badge>
                            </Tooltip>
                          )}
                        </Group>
                        {g.folio && <Text size="xs" c="dimmed">Folio {g.folio}</Text>}
                      </Table.Td>
                      <Table.Td>
                        <Tooltip label={g.motivo_cancelacion ?? et.detalle}>
                          <Badge color={et.color} variant="light" size="sm">{et.label}</Badge>
                        </Tooltip>
                      </Table.Td>
                      <Table.Td><Text size="sm">{textoCobertura(g)}</Text></Table.Td>
                      <Table.Td>
                        <Text size="sm" c={g.fecha_inicio ? undefined : 'dimmed'}>
                          {g.fecha_inicio ? formatFecha(g.fecha_inicio) : 'Sin fecha'}
                        </Text>
                      </Table.Td>
                      <Table.Td><Text size="sm">{textoLimite(g)}</Text></Table.Td>
                      <Table.Td style={{ textAlign: 'center' }}>
                        <Tooltip
                          label={g.requerimientos === 0
                            ? 'Ningún requerimiento preventivo depende de esta garantía'
                            : `${g.requerimientos} requerimiento${g.requerimientos === 1 ? '' : 's'} preventivo${g.requerimientos === 1 ? '' : 's'} existe${g.requerimientos === 1 ? '' : 'n'} por esta garantía`}
                        >
                          <Badge
                            size="sm"
                            variant={g.requerimientos ? 'light' : 'outline'}
                            color={g.requerimientos ? 'blue' : 'gray'}
                          >
                            {g.requerimientos}
                          </Badge>
                        </Tooltip>
                      </Table.Td>
                      <Table.Td>
                        <Group gap={4} justify="flex-end" wrap="nowrap">
                          <Tooltip label="Editar">
                            <ActionIcon variant="subtle" color="blue" size="sm" onClick={() => openEdit(g)}>
                              <IconPencil size={14} />
                            </ActionIcon>
                          </Tooltip>
                          <Tooltip
                            label={g.garantia_origen_id != null
                              ? 'Viene del modelo: cancélala en vez de borrarla'
                              : 'Eliminar'}
                          >
                            <ActionIcon
                              variant="subtle" color="red" size="sm"
                              disabled={g.garantia_origen_id != null}
                              onClick={() => setDeleting(g)}
                            >
                              <IconTrash size={14} />
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

        {items.some((g) => !g.estado.vigente && g.requerimientos > 0) && (
          <>
            <Divider />
            <Text size="xs" c="dimmed">
              Los requerimientos preventivos que existían por una garantía ya vencida dejan de
              pedirse: siguen en la lista de abajo, en gris, para que quede el rastro de por qué
              se hacían.
            </Text>
          </>
        )}
      </Stack>

      <Modal
        opened={formOpen} onClose={() => setFormOpen(false)}
        title={editing ? `Editar garantía — ${editing.nombre}` : 'Nueva garantía'}
        centered size="md"
      >
        <GarantiaForm
          modo="vehiculo"
          initial={editing ?? undefined}
          fechaCompra={fechaCompra}
          soportaKm={soportaKm}
          isPending={createMut.isPending || updateMut.isPending}
          error={formError}
          onSubmit={handleSubmit}
          onCancel={() => setFormOpen(false)}
        />
      </Modal>

      <Modal
        opened={deleting !== null} onClose={() => setDeleting(null)}
        title="Eliminar garantía" centered size="sm"
      >
        <Stack gap="md">
          <Text>¿Eliminar <strong>{deleting?.nombre}</strong> de esta unidad?</Text>
          {(deleting?.requerimientos ?? 0) > 0 && (
            <Alert color="orange" title="Hay servicios colgando de ella" variant="light">
              {deleting?.requerimientos} requerimiento(s) preventivo(s) existen por esta garantía.
              Al borrarla se sueltan y vuelven a pedirse para siempre. Si la unidad la perdió,
              cancélala con su fecha y motivo en lugar de eliminarla.
            </Alert>
          )}
          {deleteMut.error && <Alert color="red" title="Error">{(deleteMut.error as Error).message}</Alert>}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDeleting(null)} disabled={deleteMut.isPending}>
              Cancelar
            </Button>
            <Button color="red" loading={deleteMut.isPending}
              onClick={() => deleteMut.mutate(deleting!.id, { onSuccess: () => setDeleting(null) })}>
              Sí, eliminar
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Paper>
  )
}
