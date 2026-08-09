// Dashboard (Resumen general): tarjetas de métricas del mes, gráficas de
// costos por vehículo e historial de requerimientos, listas de vencidos y
// por vencer, y exportaciones del periodo a Excel (resumen) y PDF (reporte
// de flota completo).
import { Fragment, useMemo, useState } from 'react'
import {
  SimpleGrid, Card, Text, Group, ThemeIcon, Stack, Loader, Center, Table, Divider, Badge, ActionIcon, Collapse,
  Button, SegmentedControl, Alert,
} from '@mantine/core'
import { BarChart, LineChart } from '@mantine/charts'
import { IconChevronRight, IconFileSpreadsheet, IconFileTypePdf, IconAlertTriangle } from '@tabler/icons-react'
import {
  useResumenMes, useRequerimientosVencidos, useRequerimientosPorVencer, useRequerimientosHistorial,
  useDocumentosPorVencer, useIncidenciasAbiertas,
  fetchReporteFlota, type RequerimientoVencido, type ResumenMes, type PeriodoComparacion,
} from '../hooks/useDashboard'
import { SEVERIDAD_META } from '../lib/incidenciaMeta'
import { useSucursales } from '../hooks/useSucursales'
import { exportResumenMesToExcel } from '../lib/exportResumenMes'
import { exportReporteFlotaToPdf } from '../lib/exportReporteFlota'
import { TIPO_COLORS, TIPO_LABELS } from '../lib/tipoVehiculo'

function formatFechaCorta(iso: string) {
  return new Date(`${iso.split('T')[0]}T12:00:00`).toLocaleDateString('es-MX', {
    day: '2-digit', month: 'short',
  })
}

function formatMXN(n: number) {
  return n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })
}

function formatFecha(iso: string) {
  return new Date(`${iso.split('T')[0]}T12:00:00`).toLocaleDateString('es-MX', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

// Etiqueta y color del estado de vencimiento de un documento. Lo ya vencido va
// en rojo; lo que está por vencer, en el color de aviso que use cada documento
// (las licencias de conductor se marcan en amarillo).
function estadoVencimiento(dias: number, colorAviso = 'orange'): { label: string; color: string } {
  if (dias < 0)   return { label: `Vencido hace ${Math.abs(dias)} día${Math.abs(dias) !== 1 ? 's' : ''}`, color: 'red' }
  if (dias === 0) return { label: 'Vence hoy', color: 'red' }
  return { label: `Vence en ${dias} día${dias !== 1 ? 's' : ''}`, color: colorAviso }
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

export default function Dashboard({ onNavigateVehiculo, onNavigatePieza }: {
  onNavigateVehiculo?: (vehiculoId: number) => void
  onNavigatePieza?:    (piezaId: number) => void
}) {
  const { data: resumen, isLoading: loadingResumen } = useResumenMes()
  const { data: vencidosData, isLoading: loadingVencidos } = useRequerimientosVencidos()
  const { data: porVencerData, isLoading: loadingPorVencer } = useRequerimientosPorVencer()
  const { data: historialData, isLoading: loadingHistorial } = useRequerimientosHistorial(12)
  const { data: documentosData, isLoading: loadingDocumentos } = useDocumentosPorVencer()
  const { data: incidenciasData, isLoading: loadingIncidencias } = useIncidenciasAbiertas()
  const { data: sucursalesData } = useSucursales()
  const [exportando, setExportando] = useState<'excel' | 'pdf' | null>(null)
  const [periodoComparacion, setPeriodoComparacion] = useState<PeriodoComparacion>('mes')

  const vencidos = vencidosData?.data ?? []
  const porVencer = porVencerData?.data ?? []
  const incidencias = incidenciasData?.data ?? []
  const incidenciasGraves = incidencias.filter((i) => i.severidad === 'grave')

  // Seguros + permisos + licencias de conductor por vencer, unificados y
  // ordenados por urgencia. `vehiculos` es null en las licencias: no aplican a
  // una unidad sino a la persona.
  const documentosPorVencer = useMemo(() => {
    const doc = documentosData?.data
    const seguros = (doc?.seguros ?? []).map((s) => ({
      key: `s-${s.id}`, tipo: 'Seguro' as const, colorTipo: 'blue', colorAviso: 'orange',
      etiqueta: `${s.poliza} — ${s.compania}`,
      fecha_expiracion: s.fecha_expiracion, dias_restantes: s.dias_restantes, vehiculos: s.vehiculos as number | null,
    }))
    const permisos = (doc?.permisos ?? []).map((p) => ({
      key: `p-${p.id}`, tipo: 'Permiso' as const, colorTipo: 'grape', colorAviso: 'orange',
      etiqueta: p.zona_circulacion,
      fecha_expiracion: p.fecha_expiracion, dias_restantes: p.dias_restantes, vehiculos: p.vehiculos as number | null,
    }))
    const licencias = (doc?.licencias ?? []).map((l) => ({
      key: `l-${l.conductor_id}-${l.tipo}`,
      tipo: l.tipo === 'estatal'    ? ('Licencia estatal'   as const)
          : l.tipo === 'expediente' ? ('Expediente federal' as const)
          :                           ('Licencia federal'   as const),
      colorTipo: 'teal', colorAviso: 'yellow',
      etiqueta: l.numero ? `${l.conductor} — ${l.numero}` : l.conductor,
      fecha_expiracion: l.fecha_expiracion, dias_restantes: l.dias_restantes, vehiculos: null,
    }))
    const tenencias = (doc?.tenencias ?? []).map((t) => ({
      key: `t-${t.vehiculo_id}`, tipo: 'Tenencia' as const, colorTipo: 'indigo', colorAviso: 'orange',
      etiqueta: t.folio ? `${t.vehiculo} — folio ${t.folio}` : t.vehiculo,
      fecha_expiracion: t.fecha_expiracion, dias_restantes: t.dias_restantes, vehiculos: null,
    }))
    return [...seguros, ...permisos, ...licencias, ...tenencias].sort((a, b) => a.dias_restantes - b.dias_restantes)
  }, [documentosData])

  // Unidades sin tenencia o sin seguro. Van aparte de la lista de arriba: no
  // tienen fecha, así que no hay "días restantes" con los cuales ordenarlas ni
  // aparecer entre los vencimientos. Se juntan por vehículo porque a más de una
  // le falta lo mismo… y a algunas les faltan las dos.
  const sinDocumento = useMemo(() => {
    const doc = documentosData?.data
    const porVehiculo = new Map<number, {
      vehiculo_id: number; vehiculo: string; placas: string | null; tipo: string
      tenencia: boolean; seguro: boolean
    }>()
    const registrar = (
      lista: { vehiculo_id: number; vehiculo: string; placas: string | null; tipo: string }[],
      falta: 'tenencia' | 'seguro',
    ) => {
      for (const v of lista) {
        const prev = porVehiculo.get(v.vehiculo_id) ?? { ...v, tenencia: false, seguro: false }
        prev[falta] = true
        porVehiculo.set(v.vehiculo_id, prev)
      }
    }
    registrar(doc?.sin_tenencia ?? [], 'tenencia')
    registrar(doc?.sin_seguro   ?? [], 'seguro')
    // Primero a las que les falta todo.
    return [...porVehiculo.values()].sort((a, b) =>
      Number(b.tenencia) + Number(b.seguro) - (Number(a.tenencia) + Number(a.seguro)) ||
      a.vehiculo.localeCompare(b.vehiculo, 'es-MX'))
  }, [documentosData])

  const totalSinTenencia = documentosData?.data.sin_tenencia.length ?? 0
  const totalSinSeguro   = documentosData?.data.sin_seguro.length   ?? 0

  const licenciasPorVencer = documentosData?.data.licencias ?? []
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

  async function handleExportPdf() {
    setExportando('pdf')
    try {
      const reporte = await fetchReporteFlota(periodoComparacion)
      await exportReporteFlotaToPdf(reporte.data, sucursalesData?.data ?? [])
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
        <Group gap="xs" align="center" wrap="wrap">
          <Button
            variant="default" size="xs"
            leftSection={<IconFileSpreadsheet size={16} />}
            loading={exportando === 'excel'}
            disabled={!resumen || exportando !== null}
            onClick={() => resumen && handleExportExcel(resumen.data)}
          >
            Exportar Excel
          </Button>
          <Group gap={6} align="center" wrap="nowrap">
            <Text size="xs" c="dimmed">Comparar vs:</Text>
            <SegmentedControl
              size="xs"
              value={periodoComparacion}
              onChange={(v) => setPeriodoComparacion(v as PeriodoComparacion)}
              disabled={exportando !== null}
              data={[
                { label: 'Mes pasado',   value: 'mes' },
                { label: 'Semana pasada', value: 'semana' },
              ]}
            />
          </Group>
          <Button
            variant="default" size="xs"
            leftSection={<IconFileTypePdf size={16} />}
            loading={exportando === 'pdf'}
            disabled={exportando !== null}
            onClick={handleExportPdf}
          >
            Exportar PDF
          </Button>
        </Group>
      </Group>

      {/* Aviso arriba de todo: una licencia —o el expediente que la ampara—
          vencida deja al conductor sin poder salir, así que no basta con verla
          en la tabla de más abajo. */}
      {licenciasPorVencer.length > 0 && (() => {
        const vencidas = licenciasPorVencer.filter((l) => l.dias_restantes < 0)
        const hayVencidas = vencidas.length > 0
        const n = hayVencidas ? vencidas.length : licenciasPorVencer.length
        return (
          <Alert
            color={hayVencidas ? 'red' : 'yellow'}
            icon={<IconAlertTriangle size={16} />}
            title={hayVencidas ? 'Documentos de conductor vencidos' : 'Documentos de conductor por vencer'}
          >
            {n} documento{n !== 1 ? 's' : ''} de conductor {hayVencidas
              ? (n !== 1 ? 'ya vencieron' : 'ya venció')
              : (n !== 1 ? 'vencen' : 'vence') + ' en menos de 2 meses'}
            {hayVencidas && licenciasPorVencer.length > vencidas.length &&
              ` y ${licenciasPorVencer.length - vencidas.length} más vencen en menos de 2 meses`}
            . Revísalas en Catálogos → Conductores.
          </Alert>
        )
      })()}

      <SimpleGrid cols={{ base: 1, sm: 2, md: 3, xl: 5 }} spacing="md">
        <StatCard
          label="Mantenimientos del mes"
          value={loadingResumen ? '—' : String(resumen?.data.mantenimientos.count ?? 0)}
          sub={resumen ? formatMXN(resumen.data.mantenimientos.costo_total) : undefined}
          color="teal"
        />
        <StatCard
          label="Refacciones compradas del mes"
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
          label="Incidencias sin atender"
          value={loadingIncidencias ? '—' : String(incidencias.length)}
          sub={incidenciasGraves.length > 0 ? `${incidenciasGraves.length} grave${incidenciasGraves.length !== 1 ? 's' : ''}` : 'Ninguna grave'}
          color={incidenciasGraves.length > 0 ? 'red' : 'yellow'}
        />
        <StatCard
          label="Costo total del mes"
          value={loadingResumen ? '—' : formatMXN(
            (resumen?.data.mantenimientos.costo_total ?? 0) + (resumen?.data.piezas.costo_total ?? 0)
          )}
          sub="Mantenimiento + refacciones"
          color="blue"
        />
      </SimpleGrid>

      {/* ── Seguros, permisos y licencias por vencer ── */}
      <Card withBorder padding="lg" radius="md">
        <Text fw={600} mb={2}>Documentos por vencer</Text>
        <Text size="xs" c="dimmed" mb="md">
          Seguros y permisos ya vencidos o próximos a vencer (dentro de 30 días) y licencias de conductor
          con vigencia dentro de 2 meses. Gestiónalos en Catálogos → Seguros / Permisos / Conductores.
        </Text>
        {loadingDocumentos ? (
          <Center py="xl"><Loader size="sm" /></Center>
        ) : documentosPorVencer.length === 0 ? (
          <Center py="xl"><Text c="dimmed" size="sm">Ningún documento por vencer. Todo en regla.</Text></Center>
        ) : (
          <Table.ScrollContainer minWidth={560}>
            <Table striped withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Tipo</Table.Th>
                  <Table.Th>Documento</Table.Th>
                  <Table.Th>Expiración</Table.Th>
                  <Table.Th>Estado</Table.Th>
                  <Table.Th style={{ textAlign: 'center' }}>Vehículos</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {documentosPorVencer.map((d) => {
                  const est = estadoVencimiento(d.dias_restantes, d.colorAviso)
                  return (
                    <Table.Tr key={d.key}>
                      <Table.Td>
                        <Badge variant="light" color={d.colorTipo} size="sm">{d.tipo}</Badge>
                      </Table.Td>
                      <Table.Td fw={500}>{d.etiqueta}</Table.Td>
                      <Table.Td>{formatFecha(d.fecha_expiracion)}</Table.Td>
                      <Table.Td><Badge variant="light" color={est.color} size="sm">{est.label}</Badge></Table.Td>
                      <Table.Td style={{ textAlign: 'center' }}>
                        {d.vehiculos ?? <Text component="span" c="dimmed" size="sm">—</Text>}
                      </Table.Td>
                    </Table.Tr>
                  )
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Card>

      {/* ── Vehículos sin tenencia o sin seguro ── */}
      <Card withBorder padding="lg" radius="md">
        <Text fw={600} mb={2}>Vehículos sin documentos</Text>
        <Text size="xs" c="dimmed" mb="md">
          Unidades sin tenencia o sin seguro capturado. No aparecen arriba porque no tienen fecha
          de vencimiento que vigilar. La tenencia solo aplica a reparto, tractocamiones y utilitarios.
        </Text>
        {loadingDocumentos ? (
          <Center py="xl"><Loader size="sm" /></Center>
        ) : sinDocumento.length === 0 ? (
          <Center py="xl"><Text c="dimmed" size="sm">Todas las unidades tienen tenencia y seguro.</Text></Center>
        ) : (
          <Stack gap="sm">
            <Alert color="orange" icon={<IconAlertTriangle size={16} />}>
              {totalSinTenencia > 0 && (
                <>
                  <strong>{totalSinTenencia} vehículo{totalSinTenencia !== 1 ? 's' : ''}</strong>
                  {totalSinTenencia !== 1 ? ' están' : ' está'} sin tenencia registrada.
                </>
              )}
              {totalSinTenencia > 0 && totalSinSeguro > 0 && ' '}
              {totalSinSeguro > 0 && (
                <>
                  <strong>{totalSinSeguro} vehículo{totalSinSeguro !== 1 ? 's' : ''}</strong>
                  {totalSinSeguro !== 1 ? ' están' : ' está'} sin seguro asignado.
                </>
              )}
            </Alert>
            <Table.ScrollContainer minWidth={520}>
              <Table striped withTableBorder>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Vehículo</Table.Th>
                    <Table.Th>Placas</Table.Th>
                    <Table.Th>Tipo</Table.Th>
                    <Table.Th>Le falta</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {sinDocumento.map((v) => (
                    <Table.Tr key={v.vehiculo_id}>
                      <Table.Td fw={500}>
                        {onNavigateVehiculo ? (
                          <Text
                            component="button" size="sm" fw={500} c="blue"
                            style={{
                              cursor: 'pointer', background: 'none', border: 'none', padding: 0,
                              textAlign: 'left', textDecoration: 'underline', textUnderlineOffset: 2,
                            }}
                            onClick={() => onNavigateVehiculo(v.vehiculo_id)}
                          >
                            {v.vehiculo}
                          </Text>
                        ) : v.vehiculo}
                      </Table.Td>
                      <Table.Td>{v.placas ?? <Text component="span" c="dimmed" size="sm">—</Text>}</Table.Td>
                      <Table.Td>{TIPO_LABELS[v.tipo] ?? v.tipo}</Table.Td>
                      <Table.Td>
                        <Group gap={6} wrap="nowrap">
                          {v.tenencia && <Badge variant="light" color="indigo" size="sm">Tenencia</Badge>}
                          {v.seguro   && <Badge variant="light" color="red"    size="sm">Seguro</Badge>}
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Stack>
        )}
      </Card>

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
                            onClick={() => onNavigateVehiculo(v.vehiculo_id)}
                          >
                            {v.vehiculo_nombre}
                          </Text>
                        ) : (
                          <Text size="sm" fw={500}>{v.vehiculo_nombre}</Text>
                        )}
                      </Table.Td>
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
        <Text fw={600} mb="xs">Refacciones compradas este mes</Text>
        {loadingResumen ? (
          <Center py="xl"><Loader size="sm" /></Center>
        ) : (resumen?.data.piezas.lotes.length ?? 0) === 0 ? (
          <Center py="xl"><Text c="dimmed" size="sm">Sin compras registradas este mes.</Text></Center>
        ) : (
          <Table.ScrollContainer minWidth={560}>
            <Table striped withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Refacción</Table.Th>
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
                      {onNavigatePieza ? (
                        <Text
                          component="button"
                          size="sm"
                          fw={500}
                          c="blue"
                          style={{
                            cursor: 'pointer', background: 'none', border: 'none', padding: 0,
                            textDecoration: 'underline', textUnderlineOffset: 2,
                          }}
                          onClick={() => onNavigatePieza(l.pieza_id)}
                        >
                          {l.numero_serie}
                        </Text>
                      ) : (
                        <Text size="sm" fw={500}>{l.numero_serie}</Text>
                      )}
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

      {/* ── Incidencias sin atender ── */}
      <Card withBorder padding="lg" radius="md">
        <Text fw={600} mb={2}>Incidencias sin atender</Text>
        <Text size="xs" c="dimmed" mb="md">
          Lo reportado que sigue abierto, de lo más grave a lo más leve. Se cierran solas al
          registrar el mantenimiento que las atiende.
        </Text>
        {loadingIncidencias ? (
          <Center py="xl"><Loader size="sm" /></Center>
        ) : incidencias.length === 0 ? (
          <Text c="dimmed" size="sm" py="sm">No hay incidencias sin atender.</Text>
        ) : (
          <Table.ScrollContainer minWidth={700}>
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Incidencia</Table.Th>
                  <Table.Th>Vehículo</Table.Th>
                  <Table.Th>Categoría</Table.Th>
                  <Table.Th>Severidad</Table.Th>
                  <Table.Th>Reportada</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {incidencias.map((i) => {
                  const sev = SEVERIDAD_META[i.severidad]
                  return (
                    <Table.Tr key={i.id}>
                      <Table.Td fw={500}>{i.nombre}</Table.Td>
                      <Table.Td>
                        {onNavigateVehiculo ? (
                          <Text
                            component="button"
                            size="sm"
                            c="blue"
                            style={{
                              cursor: 'pointer', background: 'none', border: 'none', padding: 0,
                              textDecoration: 'underline', textUnderlineOffset: 2,
                            }}
                            onClick={() => onNavigateVehiculo(i.vehiculo_id)}
                          >
                            {i.vehiculo_nombre}
                          </Text>
                        ) : (
                          <Text size="sm">{i.vehiculo_nombre}</Text>
                        )}
                      </Table.Td>
                      <Table.Td>
                        {i.categoria ?? <Text component="span" c="dimmed" size="sm">—</Text>}
                      </Table.Td>
                      <Table.Td>
                        <Badge variant="light" color={sev.color} size="sm">{sev.label}</Badge>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">
                          {new Date(`${i.fecha.split('T')[0]}T12:00:00`).toLocaleDateString('es-MX', {
                            day: '2-digit', month: 'short', year: 'numeric',
                          })}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  )
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Card>
    </Stack>
  )
}
