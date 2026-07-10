import { Fragment, useMemo, useState } from 'react'
import {
  SimpleGrid, Card, Text, Group, ThemeIcon, Stack, Loader, Center, Table, Divider, Badge, ActionIcon, Collapse,
  Button,
} from '@mantine/core'
import { BarChart, LineChart } from '@mantine/charts'
import { IconChevronRight, IconFileSpreadsheet, IconFileTypePdf } from '@tabler/icons-react'
import {
  useResumenMes, useRequerimientosVencidos, useRequerimientosPorVencer, useRequerimientosHistorial,
  type RequerimientoVencido, type ResumenMes,
} from '../hooks/useDashboard'
import { exportResumenMesToExcel, exportResumenMesToPdf } from '../lib/exportResumenMes'

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

const TIPO_COLORS: Record<string, string> = {
  camion:       'blue',
  tractocamion: 'violet',
  caja_trailer: 'orange',
  utilitario:   'teal',
  montacargas:  'yellow',
}

const TIPO_LABELS: Record<string, string> = {
  camion:       'Camión',
  tractocamion: 'Tractocamión',
  caja_trailer: 'Caja de trailer',
  utilitario:   'Vehículo unitario',
  montacargas:  'Montacargas',
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

// ─── Requerimientos agrupados por vehículo ───────────────────────────────────

interface VehiculoConRequerimientos {
  vehiculo_id:     number
  vehiculo_nombre: string
  requerimientos:  RequerimientoVencido[]
}

function agruparPorVehiculo(items: RequerimientoVencido[]): VehiculoConRequerimientos[] {
  const map = new Map<number, VehiculoConRequerimientos>()
  for (const item of items) {
    const entry = map.get(item.vehiculo_id) ?? {
      vehiculo_id: item.vehiculo_id, vehiculo_nombre: item.vehiculo_nombre, requerimientos: [],
    }
    entry.requerimientos.push(item)
    map.set(item.vehiculo_id, entry)
  }
  return [...map.values()].sort(
    (a, b) => b.requerimientos.length - a.requerimientos.length || a.vehiculo_nombre.localeCompare(b.vehiculo_nombre)
  )
}

function RequerimientosPorVehiculoTable({
  items, color, emptyMessage, onNavigateVehiculo,
}: {
  items: RequerimientoVencido[]
  color: string
  emptyMessage: string
  onNavigateVehiculo?: (vehiculoId: number) => void
}) {
  const [expandido, setExpandido] = useState<Set<number>>(new Set())
  const grupos = useMemo(() => agruparPorVehiculo(items), [items])

  if (grupos.length === 0) {
    return <Center py="xl"><Text c="dimmed" size="sm">{emptyMessage}</Text></Center>
  }

  function toggle(vehiculoId: number) {
    setExpandido(prev => {
      const next = new Set(prev)
      if (next.has(vehiculoId)) next.delete(vehiculoId)
      else next.add(vehiculoId)
      return next
    })
  }

  return (
    <Table.ScrollContainer minWidth={420}>
      <Table striped withTableBorder>
        <Table.Thead>
          <Table.Tr>
            <Table.Th style={{ width: 32 }} />
            <Table.Th>Vehículo</Table.Th>
            <Table.Th style={{ textAlign: 'center' }}>Requerimientos</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {grupos.map(g => {
            const abierto = expandido.has(g.vehiculo_id)
            return (
              <Fragment key={g.vehiculo_id}>
                <Table.Tr style={{ cursor: 'pointer' }} onClick={() => toggle(g.vehiculo_id)}>
                  <Table.Td>
                    <ActionIcon variant="subtle" color="gray" size="sm" aria-label="Expandir">
                      <IconChevronRight
                        size={14}
                        style={{ transform: abierto ? 'rotate(90deg)' : undefined, transition: 'transform 100ms' }}
                      />
                    </ActionIcon>
                  </Table.Td>
                  <Table.Td>
                    {onNavigateVehiculo ? (
                      <Text
                        component="button"
                        size="sm"
                        fw={500}
                        c="blue"
                        style={{
                          cursor: 'pointer', background: 'none', border: 'none', padding: 0,
                          textDecoration: 'underline', textUnderlineOffset: 2,
                        }}
                        onClick={(e) => { e.stopPropagation(); onNavigateVehiculo(g.vehiculo_id) }}
                      >
                        {g.vehiculo_nombre}
                      </Text>
                    ) : (
                      <Text size="sm" fw={500}>{g.vehiculo_nombre}</Text>
                    )}
                  </Table.Td>
                  <Table.Td style={{ textAlign: 'center' }}>
                    <Badge color={color} variant="light">{g.requerimientos.length}</Badge>
                  </Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Td colSpan={3} style={{ padding: abierto ? undefined : 0, border: abierto ? undefined : 'none' }}>
                    <Collapse expanded={abierto}>
                      <Stack gap={4} py="xs" pl="xl">
                        {g.requerimientos.map(r => (
                          <Group key={r.id} justify="space-between" wrap="nowrap">
                            <Text size="sm">{r.nombre}</Text>
                            <Text size="xs" c="dimmed">{r.categoria ?? '—'}</Text>
                          </Group>
                        ))}
                      </Stack>
                    </Collapse>
                  </Table.Td>
                </Table.Tr>
              </Fragment>
            )
          })}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  )
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export default function Dashboard({ onNavigateVehiculo }: { onNavigateVehiculo?: (vehiculoId: number) => void }) {
  const { data: resumen, isLoading: loadingResumen } = useResumenMes()
  const { data: vencidosData, isLoading: loadingVencidos } = useRequerimientosVencidos()
  const { data: porVencerData, isLoading: loadingPorVencer } = useRequerimientosPorVencer()
  const { data: historialData, isLoading: loadingHistorial } = useRequerimientosHistorial(12)
  const [exportando, setExportando] = useState<'excel' | 'pdf' | null>(null)

  const vencidos = vencidosData?.data ?? []
  const porVencer = porVencerData?.data ?? []
  const historial = (historialData?.data ?? []).map(h => ({ ...h, fechaLabel: formatFechaCorta(h.fecha) }))

  const vehiculosChartData = (resumen?.data.mantenimientos.por_vehiculo ?? []).map(v => ({
    vehiculo: v.vehiculo_nombre,
    costo:    v.costo_total,
    color:    `${TIPO_COLORS[v.vehiculo_tipo] ?? 'violet'}.6`,
  }))

  const tiposPresentes = [...new Set(
    (resumen?.data.mantenimientos.por_vehiculo ?? []).map(v => v.vehiculo_tipo)
  )].filter(t => TIPO_COLORS[t])

  async function handleExportExcel(data: ResumenMes) {
    setExportando('excel')
    try {
      await exportResumenMesToExcel(data)
    } catch (e) {
      alert((e as Error).message)
    } finally {
      setExportando(null)
    }
  }

  async function handleExportPdf(data: ResumenMes) {
    setExportando('pdf')
    try {
      await exportResumenMesToPdf(data)
    } catch (e) {
      alert((e as Error).message)
    } finally {
      setExportando(null)
    }
  }

  return (
    <Stack gap="xl">
      <Group justify="space-between" align="flex-end" wrap="wrap">
        <div>
          <Text size="xl" fw={600}>Resumen general</Text>
          <Text c="dimmed" size="sm">Vista general del sistema</Text>
        </div>
        <Group gap="xs">
          <Button
            variant="default" size="xs"
            leftSection={<IconFileSpreadsheet size={16} />}
            loading={exportando === 'excel'}
            disabled={!resumen || exportando !== null}
            onClick={() => resumen && handleExportExcel(resumen.data)}
          >
            Exportar Excel
          </Button>
          <Button
            variant="default" size="xs"
            leftSection={<IconFileTypePdf size={16} />}
            loading={exportando === 'pdf'}
            disabled={!resumen || exportando !== null}
            onClick={() => resumen && handleExportPdf(resumen.data)}
          >
            Exportar PDF
          </Button>
        </Group>
      </Group>

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
            <Group gap="md" justify="center">
              {tiposPresentes.map(t => (
                <Group key={t} gap={6} wrap="nowrap">
                  <span style={{
                    width: 10, height: 10, borderRadius: 2,
                    backgroundColor: `var(--mantine-color-${TIPO_COLORS[t]}-6)`,
                    display: 'inline-block',
                  }} />
                  <Text size="xs" c="dimmed">{TIPO_LABELS[t] ?? t}</Text>
                </Group>
              ))}
            </Group>
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
        <Text fw={600} mb={2}>Vehículos con requerimientos sin cumplir</Text>
        <Text size="xs" c="dimmed" mb="md">
          Haz clic en la fila para ver el detalle, o en el nombre del vehículo para abrir su ficha.
        </Text>
        {loadingVencidos ? (
          <Center py="xl"><Loader size="sm" /></Center>
        ) : (
          <RequerimientosPorVehiculoTable
            items={vencidos}
            color="red"
            emptyMessage="No hay requerimientos vencidos hoy."
            onNavigateVehiculo={onNavigateVehiculo}
          />
        )}
      </Card>

      {/* ── Requerimientos por vencer ── */}
      <Card withBorder padding="lg" radius="md">
        <Text fw={600} mb={2}>Vehículos con requerimientos por vencer</Text>
        <Text size="xs" c="dimmed" mb="md">
          Haz clic en la fila para ver el detalle, o en el nombre del vehículo para abrir su ficha.
        </Text>
        {loadingPorVencer ? (
          <Center py="xl"><Loader size="sm" /></Center>
        ) : (
          <RequerimientosPorVehiculoTable
            items={porVencer}
            color="orange"
            emptyMessage="No hay requerimientos próximos a vencer."
            onNavigateVehiculo={onNavigateVehiculo}
          />
        )}
      </Card>
    </Stack>
  )
}
