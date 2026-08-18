// Dashboard (Resumen general).
//
// Era una sola columna con ocho tarjetas apiladas: para llegar a las incidencias
// había que pasar de largo por las gráficas, y todo pesaba lo mismo aunque no
// todo urge igual. Ahora está partido en cuatro pestañas por *qué se va a hacer
// con la información* —ver cómo va el mes, buscar dónde recortar, renovar
// papeles, atender pendientes— y cada pestaña trae en su etiqueta el número de
// cosas que reclaman atención, para no tener que entrar a averiguarlo.
import { Fragment, useMemo, useState } from 'react'
import {
  SimpleGrid, Card, Text, Group, Stack, Loader, Center, Table, Divider, Badge, ActionIcon,
  Collapse, Button, SegmentedControl, Alert, Tabs, Menu,
} from '@mantine/core'
import { BarChart, LineChart } from '@mantine/charts'
import {
  IconChevronRight, IconFileSpreadsheet, IconFileTypePdf, IconAlertTriangle, IconTool,
  IconShoppingCart, IconClockExclamation, IconExclamationCircle, IconCashBanknote,
  IconLayoutDashboard, IconDiscount2, IconCalendarExclamation, IconClipboardList,
  IconDownload,
} from '@tabler/icons-react'
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
import { formatMXN, formatFecha, formatFechaCorta } from '../lib/formato'
import { StatCard } from './StatCard'
import DashboardCostos from './DashboardCostos'

// Etiqueta y color del estado de vencimiento de un documento. Lo ya vencido va
// en rojo; lo que está por vencer, en el color de aviso que use cada documento
// (las licencias de conductor se marcan en amarillo).
function estadoVencimiento(dias: number, colorAviso = 'orange'): { label: string; color: string } {
  if (dias < 0)   return { label: `Vencido hace ${Math.abs(dias)} día${Math.abs(dias) !== 1 ? 's' : ''}`, color: 'red' }
  if (dias === 0) return { label: 'Vence hoy', color: 'red' }
  return { label: `Vence en ${dias} día${dias !== 1 ? 's' : ''}`, color: colorAviso }
}

// ─── Piezas compartidas ──────────────────────────────────────────────────────

function Seccion({ titulo, descripcion, children }: {
  titulo: string; descripcion?: string; children: React.ReactNode
}) {
  return (
    <Card withBorder padding="lg" radius="md">
      <Text fw={600} mb={descripcion ? 2 : 'md'}>{titulo}</Text>
      {descripcion && <Text size="xs" c="dimmed" mb="md">{descripcion}</Text>}
      {children}
    </Card>
  )
}

function LinkVehiculo({ nombre, onClick }: { nombre: string; onClick?: () => void }) {
  if (!onClick) return <Text size="sm" fw={500}>{nombre}</Text>
  return (
    <Text
      component="button" size="sm" fw={500} c="blue"
      style={{
        cursor: 'pointer', background: 'none', border: 'none', padding: 0,
        textAlign: 'left', textDecoration: 'underline', textUnderlineOffset: 2,
      }}
      onClick={onClick}
    >
      {nombre}
    </Text>
  )
}

// Contador al lado del nombre de la pestaña. Sale solo si hay algo que ver: un
// "0" permanente enseña a ignorar el lugar donde después aparecerá un número
// que sí importa.
function ContadorTab({ n, color }: { n: number; color: string }) {
  if (n <= 0) return null
  return <Badge size="sm" circle variant="filled" color={color}>{n}</Badge>
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
                    <LinkVehiculo
                      nombre={g.vehiculo_nombre}
                      onClick={onNavigateVehiculo
                        ? () => onNavigateVehiculo(g.vehiculo_id)
                        : undefined}
                    />
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
  const [tab, setTab] = useState<string | null>('resumen')

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
      etiqueta: t.vehiculo,
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

  // Lo que reclama acción en cada pestaña, para el contador de la etiqueta.
  const nVencimientos = documentosPorVencer.length + sinDocumento.length
  const nPendientes   = vencidos.length + incidencias.length

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
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end" wrap="wrap">
        <div>
          <Text size="xl" fw={600}>Resumen general</Text>
          <Text c="dimmed" size="sm">Vista general del sistema</Text>
        </div>
        {/* Las dos exportaciones y el comparador ocupaban media cabecera y solo
            se usan al cerrar el mes: ahora viven detrás de un botón. */}
        <Menu shadow="md" width={280} position="bottom-end">
          <Menu.Target>
            <Button
              variant="default" size="xs"
              leftSection={<IconDownload size={16} />}
              loading={exportando !== null}
            >
              Exportar
            </Button>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Label>Resumen del periodo</Menu.Label>
            <Menu.Item
              leftSection={<IconFileSpreadsheet size={16} />}
              disabled={!resumen || exportando !== null}
              onClick={() => resumen && handleExportExcel(resumen.data)}
            >
              Excel — costos de los últimos 30 días
            </Menu.Item>
            <Menu.Divider />
            <Menu.Label>Reporte de flota completo</Menu.Label>
            <Menu.Item component="div" closeMenuOnClick={false}>
              <Stack gap={6}>
                <Text size="xs" c="dimmed">Comparar contra:</Text>
                <SegmentedControl
                  size="xs" fullWidth
                  value={periodoComparacion}
                  onChange={(v) => setPeriodoComparacion(v as PeriodoComparacion)}
                  disabled={exportando !== null}
                  data={[
                    { label: 'Mes pasado',    value: 'mes' },
                    { label: 'Semana pasada', value: 'semana' },
                  ]}
                />
              </Stack>
            </Menu.Item>
            <Menu.Item
              leftSection={<IconFileTypePdf size={16} />}
              disabled={exportando !== null}
              onClick={handleExportPdf}
            >
              PDF — reporte de flota
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Group>

      {/* Aviso arriba de todo, fuera de las pestañas: una licencia —o el
          expediente que la ampara— vencida deja al conductor sin poder salir, y
          eso no puede depender de que alguien entre a la pestaña correcta. */}
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

      <Tabs value={tab} onChange={setTab} keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="resumen" leftSection={<IconLayoutDashboard size={16} />}>
            Resumen
          </Tabs.Tab>
          <Tabs.Tab value="costos" leftSection={<IconDiscount2 size={16} />}>
            Costos y ahorro
          </Tabs.Tab>
          <Tabs.Tab
            value="vencimientos"
            leftSection={<IconCalendarExclamation size={16} />}
            rightSection={<ContadorTab n={nVencimientos} color="orange" />}
          >
            Vencimientos
          </Tabs.Tab>
          <Tabs.Tab
            value="pendientes"
            leftSection={<IconClipboardList size={16} />}
            rightSection={<ContadorTab n={nPendientes} color="red" />}
          >
            Pendientes
          </Tabs.Tab>
        </Tabs.List>

        {/* ══ Resumen ══ */}
        <Tabs.Panel value="resumen" pt="lg">
          <Stack gap="lg">
            <SimpleGrid cols={{ base: 1, sm: 2, md: 3, xl: 6 }} spacing="md">
              <StatCard
                label="Mantenimientos"
                value={loadingResumen ? '—' : String(resumen?.data.mantenimientos.count ?? 0)}
                sub={resumen ? formatMXN(resumen.data.mantenimientos.costo_total) : undefined}
                color="teal" icon={IconTool}
                ayuda="Servicios registrados en los últimos 30 días, con su costo de mano de obra más las refacciones que consumieron."
              />
              <StatCard
                label="Refacciones compradas"
                value={loadingResumen ? '—' : String(resumen?.data.piezas.count ?? 0)}
                sub={resumen ? formatMXN(resumen.data.piezas.costo_total) : undefined}
                color="violet" icon={IconShoppingCart}
                ayuda="Lotes de refacción comprados al almacén en los últimos 30 días."
              />
              <StatCard
                label="Requerimientos vencidos"
                value={loadingVencidos ? '—' : String(vencidos.length)}
                sub="Sin cumplir hoy"
                color="red" icon={IconAlertTriangle}
                onClick={() => setTab('pendientes')}
                ayuda="Mantenimientos preventivos cuyo intervalo de kilómetros o meses ya se pasó."
              />
              <StatCard
                label="Requerimientos por vencer"
                value={loadingPorVencer ? '—' : String(porVencer.length)}
                sub="Próximos a vencer"
                color="orange" icon={IconClockExclamation}
                onClick={() => setTab('pendientes')}
                ayuda="Preventivos que están por alcanzar su intervalo. Atenderlos aquí es lo que evita la falla cara."
              />
              <StatCard
                label="Incidencias sin atender"
                value={loadingIncidencias ? '—' : String(incidencias.length)}
                sub={incidenciasGraves.length > 0
                  ? `${incidenciasGraves.length} grave${incidenciasGraves.length !== 1 ? 's' : ''}`
                  : 'Ninguna grave'}
                color={incidenciasGraves.length > 0 ? 'red' : 'yellow'}
                icon={IconExclamationCircle}
                onClick={() => setTab('pendientes')}
                ayuda="Lo reportado que sigue abierto. Se cierran solas al registrar el mantenimiento que las atiende."
              />
              <StatCard
                label="Costo total"
                value={loadingResumen ? '—' : formatMXN(resumen?.data.costo_total_periodo ?? 0)}
                sub="Últimos 30 días"
                color="blue" icon={IconCashBanknote}
                ayuda="Lo que salió de caja: mano de obra más refacciones compradas. Las refacciones consumidas por los servicios no se suman aparte porque ya se pagaron al comprarlas."
              />
            </SimpleGrid>

            <Seccion titulo="Vehículos con mantenimiento (últimos 30 días)">
              {loadingResumen ? (
                <Center py="xl"><Loader size="sm" /></Center>
              ) : vehiculosChartData.length === 0 ? (
                <Center py="xl"><Text c="dimmed" size="sm">Sin mantenimientos registrados en los últimos 30 días.</Text></Center>
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
                              <LinkVehiculo
                                nombre={v.vehiculo_nombre}
                                onClick={onNavigateVehiculo ? () => onNavigateVehiculo(v.vehiculo_id) : undefined}
                              />
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
            </Seccion>

            <Seccion titulo="Refacciones compradas (últimos 30 días)">
              {loadingResumen ? (
                <Center py="xl"><Loader size="sm" /></Center>
              ) : (resumen?.data.piezas.lotes.length ?? 0) === 0 ? (
                <Center py="xl"><Text c="dimmed" size="sm">Sin compras registradas en los últimos 30 días.</Text></Center>
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
                            <LinkVehiculo
                              nombre={l.numero_serie}
                              onClick={onNavigatePieza ? () => onNavigatePieza(l.pieza_id) : undefined}
                            />
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
            </Seccion>
          </Stack>
        </Tabs.Panel>

        {/* ══ Costos y ahorro ══ */}
        <Tabs.Panel value="costos" pt="lg">
          <DashboardCostos
            onNavigateVehiculo={onNavigateVehiculo}
            onNavigatePieza={onNavigatePieza}
          />
        </Tabs.Panel>

        {/* ══ Vencimientos ══ */}
        <Tabs.Panel value="vencimientos" pt="lg">
          <Stack gap="lg">
            <Seccion
              titulo="Documentos por vencer"
              descripcion="Seguros y permisos ya vencidos o próximos a vencer (dentro de 30 días) y licencias de conductor con vigencia dentro de 2 meses. Gestiónalos en Catálogos → Seguros / Permisos / Conductores."
            >
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
            </Seccion>

            <Seccion
              titulo="Vehículos sin documentos"
              descripcion="Unidades sin tenencia o sin seguro capturado. No aparecen arriba porque no tienen fecha de vencimiento que vigilar. La tenencia solo aplica a reparto y utilitarios."
            >
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
                        {totalSinTenencia !== 1 ? ' no tienen' : ' no tiene'} tenencia registrada.
                      </>
                    )}
                    {totalSinTenencia > 0 && totalSinSeguro > 0 && ' '}
                    {totalSinSeguro > 0 && (
                      <>
                        <strong>{totalSinSeguro} vehículo{totalSinSeguro !== 1 ? 's' : ''}</strong>
                        {totalSinSeguro !== 1 ? ' no tienen' : ' no tiene'} seguro asignado.
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
                            <Table.Td>
                              <LinkVehiculo
                                nombre={v.vehiculo}
                                onClick={onNavigateVehiculo ? () => onNavigateVehiculo(v.vehiculo_id) : undefined}
                              />
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
            </Seccion>
          </Stack>
        </Tabs.Panel>

        {/* ══ Pendientes ══ */}
        <Tabs.Panel value="pendientes" pt="lg">
          <Stack gap="lg">
            <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
              <Seccion
                titulo="Vehículos con requerimientos sin cumplir"
                descripcion="Haz clic en la fila para ver el detalle, o en el nombre del vehículo para abrir su ficha."
              >
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
              </Seccion>

              <Seccion
                titulo="Vehículos con requerimientos por vencer"
                descripcion="Haz clic en la fila para ver el detalle, o en el nombre del vehículo para abrir su ficha."
              >
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
              </Seccion>
            </SimpleGrid>

            <Seccion
              titulo="Incidencias sin atender"
              descripcion="Lo reportado que sigue abierto, de lo más grave a lo más leve. Se cierran solas al registrar el mantenimiento que las atiende."
            >
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
                              <LinkVehiculo
                                nombre={i.vehiculo_nombre}
                                onClick={onNavigateVehiculo ? () => onNavigateVehiculo(i.vehiculo_id) : undefined}
                              />
                            </Table.Td>
                            <Table.Td>
                              {i.categoria ?? <Text component="span" c="dimmed" size="sm">—</Text>}
                            </Table.Td>
                            <Table.Td>
                              <Badge variant="light" color={sev.color} size="sm">{sev.label}</Badge>
                            </Table.Td>
                            <Table.Td><Text size="sm">{formatFecha(i.fecha)}</Text></Table.Td>
                          </Table.Tr>
                        )
                      })}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
              )}
            </Seccion>

            <Seccion
              titulo="Tendencia de requerimientos sin atender"
              descripcion="Se registra un punto por día — el historial se va construyendo con el tiempo. Una línea que sube es mantenimiento que se está acumulando, y el preventivo acumulado se cobra después como correctivo."
            >
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
            </Seccion>
          </Stack>
        </Tabs.Panel>
      </Tabs>
    </Stack>
  )
}
