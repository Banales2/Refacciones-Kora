// Página Proveedores: catálogo simple de proveedores de refacciones (CRUD).
// Se muestra como pestaña dentro de Catálogos (SitiosYRutas).
import { useState } from 'react'
import {
  Stack, Group, Text, Table, Loader, Center, Alert,
  Button, ActionIcon, Modal,
} from '@mantine/core'
import { IconPencil, IconTrash, IconPlus } from '@tabler/icons-react'
import {
  useProveedores, useCreateProveedor, useUpdateProveedor, useDeleteProveedor,
} from '../hooks/useProveedores'
import type { Proveedor } from '../hooks/useProveedores'
import ProveedorForm from '../components/ProveedorForm'

export default function Proveedores() {
  const [createOpen, setCreateOpen]       = useState(false)
  const [editProveedor, setEditProveedor] = useState<Proveedor | null>(null)
  const [deleteProveedor, setDeleteProveedor] = useState<Proveedor | null>(null)

  const { data, isLoading, isError } = useProveedores()
  const createMut = useCreateProveedor()
  const updateMut = useUpdateProveedor()
  const deleteMut = useDeleteProveedor()

  const proveedores = data?.data ?? []

  return (
    <>
      <Stack gap="md">
        <Group justify="space-between" align="flex-end">
          <div>
            <Text size="xl" fw={600}>Proveedores</Text>
            <Text size="sm" c="dimmed">Gestión de proveedores de refacciones</Text>
          </div>
          <Group gap="sm" align="flex-end">
            {proveedores.length > 0 && (
              <Text size="sm" c="dimmed">{proveedores.length} proveedores</Text>
            )}
            <Button
              leftSection={<IconPlus size={16} />}
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
                  <Table.Tr key={p.id}>
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
                          onClick={() => setEditProveedor(p)}
                        >
                          <IconPencil size={16} />
                        </ActionIcon>
                        <ActionIcon
                          variant="subtle"
                          color="red"
                          aria-label="Eliminar"
                          onClick={() => setDeleteProveedor(p)}
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
