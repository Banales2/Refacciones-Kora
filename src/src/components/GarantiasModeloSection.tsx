// Catálogo de garantías de un modelo: lo que trae de fábrica cada unidad que se
// dé de alta con él.
//
// Vive junto a la plantilla de requerimientos porque las dos cosas se leen
// juntas: la plantilla dice qué servicios hay que hacerle a la unidad, y este
// catálogo dice cuáles de esos servicios existen solo mientras haya garantía
// que perder.
import { useState } from 'react'
import {
  Stack, Group, Text, Table, Badge, Button, Modal, Alert, Loader, Center,
  ActionIcon, Tooltip, Divider,
} from '@mantine/core'
import { IconPlus, IconPencil, IconTrash, IconShieldCheck } from '@tabler/icons-react'
import {
  useGarantiasModelo, useCreateGarantiaModelo, useUpdateGarantiaModelo, useDeleteGarantiaModelo,
  textoCobertura,
} from '../hooks/useGarantias'
import type { GarantiaModelo, GarantiaModeloPayload } from '../hooks/useGarantias'
import GarantiaForm from './GarantiaForm'

const TRIGGER_LABEL: Record<string, string> = {
  km:    'Por kilometraje',
  meses: 'Por tiempo',
  ambos: 'Lo que pase primero',
}

export default function GarantiasModeloSection({
  modeloId, soportaKm,
}: {
  modeloId:  number
  /** Un modelo que solo genera cajas de trailer o montacargas no lleva odómetro. */
  soportaKm: boolean
}) {
  const [formOpen, setFormOpen]   = useState(false)
  const [editing, setEditing]     = useState<GarantiaModelo | null>(null)
  const [deleting, setDeleting]   = useState<GarantiaModelo | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const { data, isLoading } = useGarantiasModelo(modeloId)
  const items     = data?.data ?? []
  const createMut = useCreateGarantiaModelo(modeloId)
  const updateMut = useUpdateGarantiaModelo(modeloId)
  const deleteMut = useDeleteGarantiaModelo(modeloId)

  function openCreate() { setEditing(null); setFormError(null); setFormOpen(true) }
  function openEdit(g: GarantiaModelo) { setEditing(g); setFormError(null); setFormOpen(true) }

  function handleSubmit(payload: GarantiaModeloPayload) {
    setFormError(null)
    const opts = {
      onSuccess: () => setFormOpen(false),
      onError:   (e: Error) => setFormError(e.message),
    }
    if (editing) updateMut.mutate({ id: editing.id, payload }, opts)
    else         createMut.mutate(payload, opts)
  }

  return (
    <>
      <Divider
        label={
          <Group gap="xs">
            <IconShieldCheck size={14} />
            <Text size="sm" fw={500}>Garantías del modelo ({items.length})</Text>
            <Tooltip label="Agregar garantía">
              <ActionIcon variant="light" color="blue" size="xs" onClick={openCreate}>
                <IconPlus size={12} />
              </ActionIcon>
            </Tooltip>
          </Group>
        }
        labelPosition="left"
      />

      {isLoading ? (
        <Center py="md"><Loader size="sm" /></Center>
      ) : items.length === 0 ? (
        <Center py="md">
          <Stack align="center" gap="xs">
            <Text c="dimmed" size="sm" ta="center">
              Este modelo no tiene garantías definidas. Al agregarlas se copian a todas sus
              unidades, contando desde la fecha de compra de cada una.
            </Text>
            <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={openCreate}>
              Agregar garantía
            </Button>
          </Stack>
        </Center>
      ) : (
        <Table.ScrollContainer minWidth={520}>
          <Table striped highlightOnHover withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Garantía</Table.Th>
                <Table.Th>Se pierde</Table.Th>
                <Table.Th>Cobertura</Table.Th>
                <Table.Th style={{ textAlign: 'center' }}>Activa</Table.Th>
                <Table.Th style={{ width: 80 }} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {items.map((g) => (
                <Table.Tr key={g.id}>
                  <Table.Td>
                    <Text size="sm" fw={500}>{g.nombre}</Text>
                    {g.descripcion && <Text size="xs" c="dimmed">{g.descripcion}</Text>}
                  </Table.Td>
                  <Table.Td>
                    <Badge size="sm" variant="light">{TRIGGER_LABEL[g.trigger_mode]}</Badge>
                  </Table.Td>
                  <Table.Td><Text size="sm">{textoCobertura(g)}</Text></Table.Td>
                  <Table.Td style={{ textAlign: 'center' }}>
                    <Badge variant="dot" color={g.activo ? 'green' : 'gray'} size="sm">
                      {g.activo ? 'Sí' : 'No'}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Group gap={4} justify="flex-end" wrap="nowrap">
                      <Tooltip label="Editar">
                        <ActionIcon variant="subtle" color="blue" size="sm" onClick={() => openEdit(g)}>
                          <IconPencil size={14} />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label="Eliminar">
                        <ActionIcon variant="subtle" color="red" size="sm" onClick={() => setDeleting(g)}>
                          <IconTrash size={14} />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}

      <Modal
        opened={formOpen} onClose={() => setFormOpen(false)}
        title={editing ? 'Editar garantía del modelo' : 'Nueva garantía del modelo'}
        centered size="md"
      >
        <GarantiaForm
          modo="modelo"
          initial={editing ?? undefined}
          soportaKm={soportaKm}
          isPending={createMut.isPending || updateMut.isPending}
          error={formError}
          onSubmit={handleSubmit}
          onCancel={() => setFormOpen(false)}
        />
      </Modal>

      <Modal
        opened={deleting !== null} onClose={() => setDeleting(null)}
        title="Eliminar garantía del modelo" centered size="sm"
      >
        <Stack gap="md">
          <Text>¿Eliminar <strong>{deleting?.nombre}</strong>?</Text>
          <Alert color="orange" title="Se va de todas las unidades" variant="light">
            Todos los vehículos de este modelo pierden esta garantía, y los requerimientos
            que existían por ella vuelven a pedirse para siempre. Si lo que quieres es dejar
            de darla solo en las unidades nuevas, desactívala en lugar de borrarla.
          </Alert>
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
    </>
  )
}
