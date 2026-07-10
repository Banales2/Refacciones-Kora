import { useMemo, useState } from 'react'
import { Stack, Text, Card, Group, Badge, Table, Center, Loader, ActionIcon, Tooltip } from '@mantine/core'
import { Calendar } from '@mantine/dates'
import { IconChevronRight } from '@tabler/icons-react'
import { useMantenimientosCalendario } from '../hooks/useDashboard'
import { TIPO_COLORS, TIPO_LABELS } from '../lib/tipoVehiculo'
import MantenimientoDetalleDrawer from '../components/MantenimientoDetalleDrawer'

function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function fmtFecha(iso: string) {
  return new Date(`${iso.split('T')[0]}T12:00:00`).toLocaleDateString('es-MX', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

export default function Calendario({
  onNavigateVehiculo,
}: {
  onNavigateVehiculo?: (vehiculoId: number) => void
}) {
  const { data, isLoading } = useMantenimientosCalendario()
  const [detalleId, setDetalleId] = useState<number | null>(null)
  const items = data?.data ?? []

  const fechasConMantenimiento = useMemo(() => {
    const set = new Set<string>()
    for (const m of items) set.add(m.fecha.split('T')[0])
    return set
  }, [items])

  const proximos = useMemo(() => {
    const hoy = todayIso()
    return items
      .filter(m => m.fecha.split('T')[0] >= hoy)
      .sort((a, b) => a.fecha.localeCompare(b.fecha))
  }, [items])

  return (
    <Stack gap="md">
      <div>
        <Text size="xl" fw={600}>Calendario</Text>
        <Text size="sm" c="dimmed">Fechas de mantenimiento de toda la flotilla</Text>
      </div>

      {isLoading ? (
        <Center py="xl"><Loader /></Center>
      ) : (
        <>
          <Card withBorder padding="lg" radius="md">
            <Center>
              <Calendar
                size="lg"
                static
                renderDay={(dateStr) => {
                  const day = new Date(`${dateStr}T12:00:00`).getDate()
                  const marcado = fechasConMantenimiento.has(dateStr)
                  return (
                    <div style={{ position: 'relative' }}>
                      {day}
                      {marcado && (
                        <div style={{
                          position: 'absolute', bottom: 2, left: '50%', transform: 'translateX(-50%)',
                          width: 5, height: 5, borderRadius: '50%',
                          backgroundColor: 'var(--mantine-color-blue-6)',
                        }} />
                      )}
                    </div>
                  )
                }}
              />
            </Center>
          </Card>

          <Card withBorder padding="lg" radius="md">
            <Text fw={600} mb="xs">Próximos mantenimientos ({proximos.length})</Text>
            {proximos.length === 0 ? (
              <Center py="xl">
                <Text c="dimmed" size="sm">No hay mantenimientos programados.</Text>
              </Center>
            ) : (
              <Table.ScrollContainer minWidth={550}>
                <Table striped highlightOnHover withTableBorder>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Fecha</Table.Th>
                      <Table.Th>Vehículo</Table.Th>
                      <Table.Th>Tipo</Table.Th>
                      <Table.Th>Técnico</Table.Th>
                      <Table.Th style={{ width: 40 }} />
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {proximos.map(m => (
                      <Table.Tr key={m.id} onClick={() => setDetalleId(m.id)} style={{ cursor: 'pointer' }}>
                        <Table.Td fw={500}>{fmtFecha(m.fecha)}</Table.Td>
                        <Table.Td>
                          <Group gap={6} wrap="nowrap">
                            <Badge size="xs" variant="light" color={TIPO_COLORS[m.vehiculo_tipo] ?? 'gray'}>
                              {TIPO_LABELS[m.vehiculo_tipo] ?? m.vehiculo_tipo}
                            </Badge>
                            <Text size="sm">{m.vehiculo_nombre}</Text>
                          </Group>
                        </Table.Td>
                        <Table.Td>{m.tipo ?? <Text component="span" c="dimmed" size="sm">—</Text>}</Table.Td>
                        <Table.Td>{m.tecnico ?? <Text component="span" c="dimmed" size="sm">—</Text>}</Table.Td>
                        <Table.Td onClick={(e) => e.stopPropagation()}>
                          {onNavigateVehiculo && (
                            <Tooltip label="Ver vehículo">
                              <ActionIcon
                                variant="subtle" color="gray" size="sm"
                                onClick={() => onNavigateVehiculo(m.vehiculo_id)}
                              >
                                <IconChevronRight size={14} />
                              </ActionIcon>
                            </Tooltip>
                          )}
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            )}
          </Card>
        </>
      )}

      <MantenimientoDetalleDrawer
        mantenimientoId={detalleId}
        onClose={() => setDetalleId(null)}
      />
    </Stack>
  )
}
