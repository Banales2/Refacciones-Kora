import {
  SimpleGrid, Card, Text, Group, ThemeIcon, Stack, Loader, Center, Table, Divider,
} from '@mantine/core'
import { BarChart, LineChart } from '@mantine/charts'
import { useResumenMes, useRequerimientosVencidos, useRequerimientosPorVencer, useRequerimientosHistorial } from '../hooks/useDashboard'

function formatFechaCorta(iso: string) {
  return new Date(`${iso.split('T')[0]}T12:00:00`).toLocaleDateString('es-MX', {
    day: '2-digit', month: 'short',
  })
}

function formatMXN(n: number) {
  return n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 })
}

function formatFecha(iso: string) {
  return new Date(`${iso.split('T')[0]}T12:00:00`).toLocaleDateString('es-MX', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

// ─── Tarjeta de KPI ───────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <Card withBorder padding="lg" radius="md">
      <Group justify="space-between" align="flex-start">
        <Stack gap={4}>
          <Text size="sm" c="dimmed" fw={500}>{label}</Text>
          <Text fz="2rem" fw={700} lh={1}>{value}</Text>
          {sub && <Text size="xs" c="dimmed">{sub}</Text>}
        </Stack>
        <ThemeIcon color={color} variant="light" size="lg" radius="md">
          <span style={{ fontSize: 16 }}>◈</span>
        </ThemeIcon>
      </Group>
    </Card>
  )
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { data: resumen, isLoading: loadingResumen } = useResumenMes()
  const { data: vencidosData, isLoading: loadingVencidos } = useRequerimientosVencidos()
  const { data: porVencerData, isLoading: loadingPorVencer } = useRequerimientosPorVencer()
  const { data: historialData, isLoading: loadingHistorial } = useRequerimientosHistorial(12)

  const vencidos = vencidosData?.data ?? []
  const porVencer = porVencerData?.data ?? []
  const historial = (historialData?.data ?? []).map(h => ({ ...h, fechaLabel: formatFechaCorta(h.fecha) }))

  const vehiculosChartData = (resumen?.data.mantenimientos.por_vehiculo ?? []).map(v => ({
    vehiculo: v.vehiculo_nombre,
    costo:    v.costo_total,
  }))

  return (
    <Stack gap="xl">
      <div>
        <Text size="xl" fw={600}>Resumen general</Text>
        <Text c="dimmed" size="sm">Vista general del sistema</Text>
      </div>

      <SimpleGrid cols={{ base: 1, sm: 2, md: 3, xl: 5 }} spacing="md">
        <StatCard
          label="Mantenimientos del mes"
          value={loadingResumen ? '—' : String(resumen?.data.mantenimientos.count ?? 0)}
          sub={resumen ? formatMXN(resumen.data.mantenimientos.costo_total) : undefined}
          color="teal"
        />
        <StatCard
          label="Piezas compradas del mes"
          value={loadingResumen ? '—' : String(resumen?.data.piezas.count ?? 0)}
          sub={resumen ? formatMXN(resumen.data.piezas.costo_total) : undefined}
          color="violet"
        />
        <StatCard
          label="Requerimientos vencidos"
          value={loadingVencidos ? '—' : String(vencidos.length)}
          sub="Sin cumplir hoy"
          color="red"
        />
        <StatCard
          label="Requerimientos por vencer"
          value={loadingPorVencer ? '—' : String(porVencer.length)}
          sub="Próximos a vencer"
          color="orange"
        />
        <StatCard
          label="Costo total del mes"
          value={loadingResumen ? '—' : formatMXN(
            (resumen?.data.mantenimientos.costo_total ?? 0) + (resumen?.data.piezas.costo_total ?? 0)
          )}
          sub="Mantenimiento + piezas"
          color="blue"
        />
      </SimpleGrid>

      {/* ── Vehículos con mantenimiento este mes ── */}
      <Card withBorder padding="lg" radius="md">
        <Text fw={600} mb="xs">Vehículos con mantenimiento este mes</Text>
        {loadingResumen ? (
          <Center py="xl"><Loader size="sm" /></Center>
        ) : vehiculosChartData.length === 0 ? (
          <Center py="xl"><Text c="dimmed" size="sm">Sin mantenimientos registrados este mes.</Text></Center>
        ) : (
          <Stack gap="md">
            <BarChart
              h={Math.max(220, vehiculosChartData.length * 36)}
              data={vehiculosChartData}
              dataKey="vehiculo"
              series={[{ name: 'costo', color: 'violet.6', label: 'Costo total' }]}
              orientation="vertical"
              yAxisProps={{ width: 140 }}
              valueFormatter={(v) => formatMXN(v)}
              gridAxis="x"
            />
            <Divider />
            <Table.ScrollContainer minWidth={400}>
              <Table striped withTableBorder>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Vehículo</Table.Th>
                    <Table.Th style={{ textAlign: 'center' }}>Mantenimientos</Table.Th>
                    <Table.Th style={{ textAlign: 'right' }}>Costo total</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {(resumen?.data.mantenimientos.por_vehiculo ?? []).map(v => (
                    <Table.Tr key={v.vehiculo_id}>
                      <Table.Td fw={500}>{v.vehiculo_nombre}</Table.Td>
                      <Table.Td style={{ textAlign: 'center' }}>{v.cantidad}</Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>{formatMXN(v.costo_total)}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Stack>
        )}
      </Card>

      {/* ── Piezas compradas este mes ── */}
      <Card withBorder padding="lg" radius="md">
        <Text fw={600} mb="xs">Piezas compradas este mes</Text>
        {loadingResumen ? (
          <Center py="xl"><Loader size="sm" /></Center>
        ) : (resumen?.data.piezas.lotes.length ?? 0) === 0 ? (
          <Center py="xl"><Text c="dimmed" size="sm">Sin compras registradas este mes.</Text></Center>
        ) : (
          <Table.ScrollContainer minWidth={560}>
            <Table striped withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Pieza</Table.Th>
                  <Table.Th>Proveedor</Table.Th>
                  <Table.Th>Fecha</Table.Th>
                  <Table.Th style={{ textAlign: 'center' }}>Cantidad</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Costo unit.</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Subtotal</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {(resumen?.data.piezas.lotes ?? []).map(l => (
                  <Table.Tr key={l.id}>
                    <Table.Td>
                      <Text size="sm" fw={500}>{l.numero_serie}</Text>
                      <Text size="xs" c="dimmed">{l.descripcion}</Text>
                    </Table.Td>
                    <Table.Td>{l.proveedor}</Table.Td>
                    <Table.Td>{formatFecha(l.fecha_compra)}</Table.Td>
                    <Table.Td style={{ textAlign: 'center' }}>{l.cantidad_inicial}</Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>{formatMXN(l.costo_unitario)}</Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>{formatMXN(l.cantidad_inicial * l.costo_unitario)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Card>

      {/* ── Tendencia de requerimientos vencidos ── */}
      <Card withBorder padding="lg" radius="md">
        <Text fw={600} mb={2}>Tendencia de requerimientos sin atender</Text>
        <Text size="xs" c="dimmed" mb="md">
          Se registra un punto por día a partir de hoy — el historial se irá construyendo con el tiempo.
        </Text>
        {loadingHistorial ? (
          <Center py="xl"><Loader size="sm" /></Center>
        ) : historial.length < 2 ? (
          <Center py="xl">
            <Text c="dimmed" size="sm">Aún no hay suficiente historial acumulado para mostrar una tendencia.</Text>
          </Center>
        ) : (
          <LineChart
            h={260}
            data={historial}
            dataKey="fechaLabel"
            series={[
              { name: 'vencidos',   color: 'red.6',    label: 'Vencidos'   },
              { name: 'por_vencer', color: 'orange.6', label: 'Por vencer' },
            ]}
            withLegend
            curveType="linear"
            gridAxis="y"
          />
        )}
      </Card>

      {/* ── Requerimientos vencidos hoy ── */}
      <Card withBorder padding="lg" radius="md">
        <Text fw={600} mb="xs">Requerimientos sin cumplir hoy</Text>
        {loadingVencidos ? (
          <Center py="xl"><Loader size="sm" /></Center>
        ) : vencidos.length === 0 ? (
          <Center py="xl"><Text c="dimmed" size="sm">No hay requerimientos vencidos hoy.</Text></Center>
        ) : (
          <Table.ScrollContainer minWidth={420}>
            <Table striped withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Vehículo</Table.Th>
                  <Table.Th>Requerimiento</Table.Th>
                  <Table.Th>Categoría</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {vencidos.map(v => (
                  <Table.Tr key={v.id}>
                    <Table.Td fw={500}>{v.vehiculo_nombre}</Table.Td>
                    <Table.Td>{v.nombre}</Table.Td>
                    <Table.Td>{v.categoria ?? <Text component="span" c="dimmed" size="sm">—</Text>}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Card>

      {/* ── Requerimientos por vencer ── */}
      <Card withBorder padding="lg" radius="md">
        <Text fw={600} mb="xs">Requerimientos por vencer</Text>
        {loadingPorVencer ? (
          <Center py="xl"><Loader size="sm" /></Center>
        ) : porVencer.length === 0 ? (
          <Center py="xl"><Text c="dimmed" size="sm">No hay requerimientos próximos a vencer.</Text></Center>
        ) : (
          <Table.ScrollContainer minWidth={420}>
            <Table striped withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Vehículo</Table.Th>
                  <Table.Th>Requerimiento</Table.Th>
                  <Table.Th>Categoría</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {porVencer.map(v => (
                  <Table.Tr key={v.id}>
                    <Table.Td fw={500}>{v.vehiculo_nombre}</Table.Td>
                    <Table.Td>{v.nombre}</Table.Td>
                    <Table.Td>{v.categoria ?? <Text component="span" c="dimmed" size="sm">—</Text>}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Card>
    </Stack>
  )
}
