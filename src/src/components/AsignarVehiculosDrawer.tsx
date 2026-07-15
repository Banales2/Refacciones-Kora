// Drawer lateral para gestionar qué vehículos pertenecen a un seguro o a un
// permiso de circulación. Se abre al hacer clic en un renglón del catálogo:
// muestra los vehículos ya asignados (con opción de quitarlos) y un selector
// para agregar más. Es genérico — el panel que lo usa decide el campo
// (seguro_id / permiso_id) y las mutaciones de asignar/quitar.
import { useState } from 'react'
import {
  Drawer, Stack, Group, Text, Badge, Table, Loader, Center, Alert,
  ActionIcon, Button, MultiSelect, Tooltip,
} from '@mantine/core'
import { IconTrash, IconPlus } from '@tabler/icons-react'
import { useVehiculos, vehiculoLabel } from '../hooks/useVehiculos'
import type { VehiculoRow } from '../hooks/useVehiculos'

export interface AsignarVehiculosDrawerProps {
  opened:   boolean
  onClose:  () => void
  titulo:   string
  subtitulo: string
  targetId: number | null
  field:    'seguro_id' | 'permiso_id'
  // Describe a qué seguro/permiso pertenece hoy un vehículo disponible, para
  // avisar que al agregarlo se moverá desde ahí. null si no tiene ninguno.
  actualLabel: (v: VehiculoRow) => string | null
  assign:      (vehiculoIds: number[], onDone: () => void) => void
  assignPending: boolean
  assignError: string | null
  unassign:    (vehiculoId: number) => void
  unassignPendingId: number | null
  // Al hacer clic en un vehículo asignado, navega a su ficha.
  onNavigateVehiculo?: (v: VehiculoRow) => void
}

export function AsignarVehiculosDrawer({
  opened, onClose, titulo, subtitulo, targetId, field,
  actualLabel, assign, assignPending, assignError, unassign, unassignPendingId,
  onNavigateVehiculo,
}: AsignarVehiculosDrawerProps) {
  const [seleccion, setSeleccion] = useState<string[]>([])

  // Solo se piden los vehículos mientras el drawer está abierto.
  const { data, isLoading } = useVehiculos(1, '', undefined, undefined, 100, opened)
  const vehiculos = data?.data ?? []

  const asignados    = vehiculos.filter((v) => v[field] === targetId)
  const disponibles  = vehiculos.filter((v) => v[field] !== targetId)
  const opciones = disponibles.map((v) => {
    const actual = actualLabel(v)
    return {
      value: String(v.id),
      label: actual ? `${vehiculoLabel(v)} — actual: ${actual}` : vehiculoLabel(v),
    }
  })

  function handleAgregar() {
    if (seleccion.length === 0) return
    assign(seleccion.map(Number), () => setSeleccion([]))
  }

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position="right"
      size="lg"
      title={
        <Stack gap={2}>
          <Text fw={700} size="md">{titulo}</Text>
          <Text size="xs" c="dimmed">{subtitulo}</Text>
        </Stack>
      }
      overlayProps={{ backgroundOpacity: 0.3 }}
    >
      {isLoading ? (
        <Center py="xl"><Loader /></Center>
      ) : (
        <Stack gap="lg">
          {/* Agregar */}
          <div>
            <Text size="sm" fw={600} mb={4}>Agregar vehículos</Text>
            <Group align="flex-end" gap="sm" wrap="nowrap">
              <MultiSelect
                flex={1}
                searchable
                clearable
                placeholder="Selecciona uno o más vehículos"
                data={opciones}
                value={seleccion}
                onChange={setSeleccion}
                nothingFoundMessage="Sin vehículos disponibles"
              />
              <Button
                leftSection={<IconPlus size={16} />}
                onClick={handleAgregar}
                loading={assignPending}
                disabled={seleccion.length === 0}
              >
                Agregar
              </Button>
            </Group>
            {assignError && <Alert color="red" mt="xs">{assignError}</Alert>}
          </div>

          {/* Lista de asignados */}
          <div>
            <Group justify="space-between" mb={6}>
              <Text size="sm" fw={600}>Vehículos en esta lista</Text>
              <Badge variant="light">{asignados.length}</Badge>
            </Group>
            {asignados.length === 0 ? (
              <Text c="dimmed" size="sm" py="sm">Aún no hay vehículos asignados.</Text>
            ) : (
              <Table.ScrollContainer minWidth={420}>
                <Table striped highlightOnHover withTableBorder>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Marca / Modelo</Table.Th>
                      <Table.Th>Serie</Table.Th>
                      <Table.Th>Placas</Table.Th>
                      <Table.Th style={{ width: 48 }} />
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {asignados.map((v) => (
                      <Table.Tr
                        key={v.id}
                        // No se cierra el drawer: al cambiar de sección se
                        // desmonta solo, y su id persiste en Layout para
                        // reabrirlo al regresar del detalle del vehículo.
                        onClick={onNavigateVehiculo ? () => onNavigateVehiculo(v) : undefined}
                        style={{ cursor: onNavigateVehiculo ? 'pointer' : undefined }}
                      >
                        <Table.Td fw={500}>{v.marca} {v.modelo}</Table.Td>
                        <Table.Td>{v.serie}</Table.Td>
                        <Table.Td>{v.placas ?? <Text component="span" c="dimmed" size="sm">—</Text>}</Table.Td>
                        <Table.Td onClick={(e) => e.stopPropagation()}>
                          <Tooltip label="Quitar de la lista">
                            <ActionIcon
                              variant="subtle" color="red" size="sm"
                              loading={unassignPendingId === v.id}
                              onClick={() => unassign(v.id)}
                            >
                              <IconTrash size={14} />
                            </ActionIcon>
                          </Tooltip>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            )}
          </div>
        </Stack>
      )}
    </Drawer>
  )
}
