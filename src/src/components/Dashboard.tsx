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
  Collapse, Button, Alert, Tabs, Tooltip,
} from '@mantine/core'
import { BarChart, LineChart } from '@mantine/charts'
import {
  IconChevronRight, IconAlertTriangle, IconTool,
  IconShoppingCart, IconClockExclamation, IconExclamationCircle, IconCashBanknote,
  IconLayoutDashboard, IconDiscount2, IconCalendarExclamation, IconClipboardList,
  IconReportAnalytics, IconCalendar, IconArrowsExchange, IconTags, IconCoin,
  IconClipboardCheck, IconMessageReport,
} from '@tabler/icons-react'
import {
  useResumenMes, usePreventivosVencidos, usePreventivosPorVencer, useHistorialPreventivos,
  useDocumentosPorVencer, useIncidenciasAbiertas, useAnalisisCostos,
  usePendientesAlmacen,
  type ServicioPreventivo, type VentanaCostos, type TraspasoPendienteDash,
} from '../hooks/useDashboard'
import { useResumenChequeos } from '../hooks/useChequeos'
import { SEVERIDAD_META } from '../lib/incidenciaMeta'
import { useSucursales } from '../hooks/useSucursales'
import { unificarDocumentos, agruparSinDocumento, estadoVencimiento } from '../lib/documentosDashboard'
import type { DestinoDocumento } from '../lib/documentosDashboard'
import { TIPO_COLORS, TIPO_LABELS } from '../lib/tipoVehiculo'
import { formatMXN, formatFecha, formatFechaCorta } from '../lib/formato'
import { StatCard } from './StatCard'
import DashboardCostos from './DashboardCostos'
import ReportesDashboardModal from './ReportesDashboardModal'
import DashboardFugas from './DashboardFugas'
import Calendario from '../pages/Calendario'

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

/**
 * Una sección que arranca cerrada y se abre a propósito.
 *
 * Para las listas que son largas por naturaleza: las unidades sin chequeo son
 * una por vehículo del patio, así que desplegadas empujan fuera de la pantalla
 * todo lo que va debajo. Lo que se necesita de reojo es el número —cuántas
 * faltan—, y el detalle solo cuando alguien va a actuar sobre él.
 */
function SeccionPlegable({ titulo, descripcion, contador, color, children }: {
  titulo: string
  descripcion?: string
  /** El número que se lee sin abrir. */
  contador: number
  color: string
  children: React.ReactNode
}) {
  const [abierta, setAbierta] = useState(false)
  const vacia = contador === 0

  return (
    <Card withBorder padding="lg" radius="md">
      <Group
        justify="space-between"
        wrap="nowrap"
        // Una sección vacía no se abre: no hay nada que ver y el clic que no
        // hace nada se siente roto.
        style={{ cursor: vacia ? 'default' : 'pointer' }}
        onClick={() => !vacia && setAbierta((v) => !v)}
      >
        <Group gap="xs" wrap="nowrap">
          <Text fw={600}>{titulo}</Text>
          <Badge color={vacia ? 'teal' : color} variant="light">{contador}</Badge>
        </Group>
        {!vacia && (
          <IconChevronRight
            size={18}
            style={{
              transform: abierta ? 'rotate(90deg)' : undefined,
              transition: 'transform 150ms ease',
              color: 'var(--mantine-color-dimmed)',
            }}
          />
        )}
      </Group>
      {descripcion && <Text size="xs" c="dimmed" mt={2}>{descripcion}</Text>}
      <Collapse expanded={abierta}>
        <div style={{ paddingTop: 'var(--mantine-spacing-md)' }}>{children}</div>
      </Collapse>
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

interface VehiculoConPreventivos {
  vehiculo_id:     number
  vehiculo_nombre: string
  servicios:       ServicioPreventivo[]
}

function agruparPorVehiculo(items: ServicioPreventivo[]): VehiculoConPreventivos[] {
  const map = new Map<number, VehiculoConPreventivos>()
  for (const item of items) {
    const entry = map.get(item.vehiculo_id) ?? {
      vehiculo_id: item.vehiculo_id, vehiculo_nombre: item.vehiculo_nombre, servicios: [],
    }
    entry.servicios.push(item)
    map.set(item.vehiculo_id, entry)
  }
  return [...map.values()].sort(
    (a, b) => b.servicios.length - a.servicios.length || a.vehiculo_nombre.localeCompare(b.vehiculo_nombre)
  )
}

function PreventivosPorVehiculoTable({
  items, color, emptyMessage, onNavigateVehiculo,
}: {
  items: ServicioPreventivo[]
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
            <Table.Th style={{ textAlign: 'center' }}>Servicios</Table.Th>
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
                    <Group gap={6} wrap="nowrap">
                      <LinkVehiculo
                        nombre={g.vehiculo_nombre}
                        onClick={onNavigateVehiculo
                          ? () => onNavigateVehiculo(g.vehiculo_id)
                          : undefined}
                      />
                      {/* La unidad sigue en garantía y ya trae algo atrasado. Va
                          en el renglón del vehículo y no en cada servicio
                          porque lo que está en juego es de la unidad entera. */}
                      {g.servicios.some(r => r.garantia_en_riesgo) && (
                        <Tooltip
                          label="Sigue en garantía y trae servicios del fabricante atrasados: se puede perder"
                          multiline w={240}
                        >
                          <Badge size="xs" color="red" variant="filled">Garantía en riesgo</Badge>
                        </Tooltip>
                      )}
                    </Group>
                  </Table.Td>
                  <Table.Td style={{ textAlign: 'center' }}>
                    <Badge color={color} variant="light">{g.servicios.length}</Badge>
                  </Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Td colSpan={3} style={{ padding: abierto ? undefined : 0, border: abierto ? undefined : 'none' }}>
                    <Collapse expanded={abierto}>
                      <Stack gap={4} py="xs" pl="xl">
                        {g.servicios.map(r => (
                          <Group key={`${r.tipo}-${r.id}`} justify="space-between" wrap="nowrap">
                            <Group gap={6} wrap="nowrap">
                              {/* La visita completa que toca por kilometraje, o
                                  un renglón que venció por su propio límite de
                                  meses sin arrastrar al resto. */}
                              {r.tipo === 'operacion' && (
                                <Badge size="xs" variant="light" color="grape">Por tiempo</Badge>
                              )}
                              <Text size="sm">{r.nombre}</Text>
                            </Group>
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

// Mercancía que salió de una sucursal y sigue sin llegar a ninguna. Se ordena
// por antigüedad —la manda así la API— porque el problema no es que exista un
// traspaso pendiente, sino que lleve semanas siéndolo: esas piezas no están en
// el inventario de nadie y nadie las echa de menos hasta que hacen falta.
function TraspasosPendientesTable({ items }: { items: TraspasoPendienteDash[] }) {
  if (items.length === 0) {
    return <Text c="dimmed" size="sm" py="md">No hay traspasos esperando aceptación.</Text>
  }
  return (
    <Table.ScrollContainer minWidth={520}>
      <Table striped withTableBorder>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Refacción</Table.Th>
            <Table.Th>Movimiento</Table.Th>
            <Table.Th ta="right">Cantidad</Table.Th>
            <Table.Th ta="right">En camino</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {items.map((t) => (
            <Table.Tr key={t.id}>
              <Table.Td>
                <Text size="sm" fw={500}>{t.numero_serie}</Text>
                <Text size="xs" c="dimmed">{t.descripcion}</Text>
              </Table.Td>
              <Table.Td>
                <Text size="xs">{t.origen} &rarr; {t.destino}</Text>
                {t.autorizado_por && (
                  <Text size="xs" c="dimmed">Autorizó: {t.autorizado_por}</Text>
                )}
              </Table.Td>
              <Table.Td ta="right"><Text size="sm" fw={500}>{t.cantidad}</Text></Table.Td>
              <Table.Td ta="right">
                {/* Una semana es el umbral: por debajo suele ser un traspaso en
                    curso; por encima, uno que a nadie le tocó aceptar. */}
                <Badge size="sm" variant="light" color={t.dias >= 7 ? 'red' : 'yellow'}>
                  {t.dias === 0 ? 'Hoy' : `${t.dias} día${t.dias !== 1 ? 's' : ''}`}
                </Badge>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  )
}

export default function Dashboard({ onNavigateVehiculo, onNavigatePieza, onNavigateDocumento }: {
  onNavigateVehiculo?: (vehiculoId: number) => void
  onNavigatePieza?:    (piezaId: number) => void
  /** Lleva al catálogo donde se renueva el documento del renglón. */
  onNavigateDocumento?: (destino: DestinoDocumento) => void
}) {
  const { data: resumen, isLoading: loadingResumen } = useResumenMes()
  const { data: vencidosData, isLoading: loadingVencidos } = usePreventivosVencidos()
  const { data: porVencerData, isLoading: loadingPorVencer } = usePreventivosPorVencer()
  const { data: historialData, isLoading: loadingHistorial } = useHistorialPreventivos(12)
  const { data: documentosData, isLoading: loadingDocumentos } = useDocumentosPorVencer()
  const { data: incidenciasData, isLoading: loadingIncidencias } = useIncidenciasAbiertas()
  const { data: sucursalesData } = useSucursales()
  const { data: almacenData, isLoading: loadingAlmacen } = usePendientesAlmacen()
  const { data: chequeos, isLoading: loadingChequeos } = useResumenChequeos()
  const [tab, setTab] = useState<string | null>('resumen')
  const [reportesAbierto, setReportesAbierto] = useState(false)
  // La ventana del análisis de costos vive aquí y no dentro de la pestaña
  // porque el reporte —que se pide desde la cabecera— tiene que salir del mismo
  // periodo que se está viendo. React Query deduplica la consulta entre ambos.
  const [ventanaCostos, setVentanaCostos] = useState<VentanaCostos>(90)
  const { data: analisisData } = useAnalisisCostos(ventanaCostos)

  const traspasosPendientes = almacenData?.data.traspasos ?? []
  const sinMarca            = almacenData?.data.refacciones_sin_marca ?? 0

  const vencidos = vencidosData?.data ?? []
  const porVencer = porVencerData?.data ?? []
  const incidencias = incidenciasData?.data ?? []
  const incidenciasGraves = incidencias.filter((i) => i.severidad === 'grave')

  const faltanChequeo   = chequeos?.data.faltan.length ?? 0
  const reportesSinLeer = chequeos?.data.por_revisar.length ?? 0

  // La unificación de las cuatro listas y el agrupado de las unidades sin
  // documento viven en lib/documentosDashboard: los reportes de esta pestaña
  // usan exactamente lo mismo, y así la hoja impresa no puede decir otra cosa
  // que la pantalla.
  const documentosPorVencer = useMemo(() => unificarDocumentos(documentosData?.data), [documentosData])
  const sinDocumento        = useMemo(() => agruparSinDocumento(documentosData?.data), [documentosData])

  const totalSinTenencia = documentosData?.data.sin_tenencia.length ?? 0
  const totalSinSeguro   = documentosData?.data.sin_seguro.length   ?? 0

  const licenciasPorVencer = documentosData?.data.licencias ?? []
  const historial = (historialData?.data ?? []).map(h => ({ ...h, fechaLabel: formatFechaCorta(h.fecha) }))

  // Lo que el reporte de la pestaña Pendientes necesita, en un solo objeto. Sin
  // useMemo a propósito: las tres listas ya se rearman en cada render por el
  // `?? []`, así que memorizarlo no evitaría nada y solo lo haría parecer
  // estable. Su único consumidor es el modal de reportes, que lo lee al pulsar.
  const datosPendientes = {
    vencidos, porVencer, incidencias, historial: historialData?.data ?? [],
  }

  // Lo que reclama acción en cada pestaña, para el contador de la etiqueta.
  const nVencimientos = documentosPorVencer.length + sinDocumento.length
  // Los traspasos cuentan aquí: mientras nadie los acepte, esa mercancía no
  // está en ningún inventario. Las refacciones sin marca no, porque son una
  // deuda de captura que no crece sola y taparía a lo que sí urge.
  const nPendientes   = vencidos.length + incidencias.length + traspasosPendientes.length

  const vehiculosChartData = (resumen?.data.mantenimientos.por_vehiculo ?? []).map(v => ({
    vehiculo: v.vehiculo_nombre,
    costo:    v.costo_total,
    color:    `${TIPO_COLORS[v.vehiculo_tipo] ?? 'violet'}.6`,
  }))

  const tiposPresentes = [...new Set(
    (resumen?.data.mantenimientos.por_vehiculo ?? []).map(v => v.vehiculo_tipo)
  )].filter(t => TIPO_COLORS[t])

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end" wrap="wrap">
        <div>
          <Text size="xl" fw={600}>Resumen general</Text>
          <Text c="dimmed" size="sm">Vista general del sistema</Text>
        </div>
        {/* Los dos botones sueltos de Excel y PDF sacaban siempre lo mismo sin
            importar la pestaña. Ahora es un solo punto de entrada y la elección
            —qué se reporta y de qué parte de la flota— se hace adentro. */}
        <Button
          variant="default" size="sm"
          leftSection={<IconReportAnalytics size={16} />}
          onClick={() => setReportesAbierto(true)}
        >
          Reportes
        </Button>
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
          <Tabs.Tab value="fugas" leftSection={<IconCoin size={16} />}>
            Fugas
          </Tabs.Tab>
          <Tabs.Tab value="calendario" leftSection={<IconCalendar size={16} />}>
            Calendario
          </Tabs.Tab>
        </Tabs.List>

        {/* ══ Resumen ══ */}
        <Tabs.Panel value="resumen" pt="lg">
          <Stack gap="lg">
            <SimpleGrid cols={{ base: 1, sm: 2, md: 3, xl: 6 }} spacing="md">
              {/* Las dos del chequeo diario van primero porque son las únicas
                  que se resuelven hoy mismo: la cobertura dice si el chequeo se
                  está haciendo, y los reportes sin leer dicen si sirve de algo.
                  Las dos tienen que estar en cero al cerrar el día. */}
              <StatCard
                label="Chequeos de hoy"
                value={loadingChequeos ? '—' : `${chequeos?.data.revisadas ?? 0}/${chequeos?.data.total ?? 0}`}
                sub={faltanChequeo > 0
                  ? `Faltan ${faltanChequeo} unidad${faltanChequeo !== 1 ? 'es' : ''}`
                  : 'Toda la flota revisada'}
                color={faltanChequeo > 0 ? 'orange' : 'teal'}
                icon={IconClipboardCheck}
                onClick={() => setTab('pendientes')}
                ayuda="Unidades activas con su chequeo diario capturado. Se hace antes de salir: la declaración del chofer más la revisión de lo que se ve."
              />
              <StatCard
                label="Reportes sin leer"
                value={loadingChequeos ? '—' : String(reportesSinLeer)}
                sub={reportesSinLeer > 0 ? 'Anotado en el chequeo' : 'Todo revisado'}
                color={reportesSinLeer > 0 ? 'red' : 'teal'}
                icon={IconMessageReport}
                onClick={() => setTab('pendientes')}
                ayuda="Lo que se anotó en el chequeo diario y nadie ha revisado todavía, de cualquier día: la bandeja se vacía, no rota. No se convierte en incidencia solo, alguien decide si hay que atenderlo."
              />
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
                label="Preventivos vencidos"
                value={loadingVencidos ? '—' : String(vencidos.length)}
                sub="Sin cumplir hoy"
                color="red" icon={IconAlertTriangle}
                onClick={() => setTab('pendientes')}
                ayuda="Servicios del programa de mantenimiento preventivo cuyo intervalo de kilómetros o meses ya se pasó."
              />
              <StatCard
                label="Preventivos por vencer"
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
              <StatCard
                label="Traspasos por aceptar"
                value={loadingAlmacen ? '—' : String(traspasosPendientes.length)}
                sub={traspasosPendientes.length > 0
                  ? `El más viejo, hace ${traspasosPendientes[0].dias} día(s)`
                  : 'Nada en camino'}
                color="yellow" icon={IconArrowsExchange}
                onClick={() => setTab('pendientes')}
                ayuda="Mercancía que salió de una sucursal y espera que la de destino la acepte. Mientras tanto no aparece en ningún inventario."
              />
              <StatCard
                label="Refacciones sin marca"
                value={loadingAlmacen ? '—' : String(sinMarca)}
                sub={sinMarca > 0 ? 'Falta capturarla' : 'Catálogo completo'}
                color="orange" icon={IconTags}
                ayuda="Refacciones activas que siguen con «Marca Faltante». Se arreglan en Refacciones, editando cada una. Sin marca, comparar precios entre proveedores compara cosas que no son iguales."
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
                  <Table striped withTableBorder highlightOnHover={!!onNavigateDocumento}>
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
            ventana={ventanaCostos}
            onVentanaChange={setVentanaCostos}
            onNavigateVehiculo={onNavigateVehiculo}
            onNavigatePieza={onNavigatePieza}
          />
        </Tabs.Panel>

        {/* ══ Vencimientos ══ */}
        <Tabs.Panel value="vencimientos" pt="lg">
          <Stack gap="lg">
            <Seccion
              titulo="Documentos por vencer"
              descripcion={onNavigateDocumento
                ? 'Seguros y permisos ya vencidos o próximos a vencer (dentro de 30 días) y licencias de conductor con vigencia dentro de 2 meses. Haz clic en un renglón para abrir el documento en su catálogo.'
                : 'Seguros y permisos ya vencidos o próximos a vencer (dentro de 30 días) y licencias de conductor con vigencia dentro de 2 meses. Gestiónalos en Catálogos → Seguros / Permisos / Conductores.'}
            >
              {loadingDocumentos ? (
                <Center py="xl"><Loader size="sm" /></Center>
              ) : documentosPorVencer.length === 0 ? (
                <Center py="xl"><Text c="dimmed" size="sm">Ningún documento por vencer. Todo en regla.</Text></Center>
              ) : (
                <Table.ScrollContainer minWidth={560}>
                  <Table striped withTableBorder highlightOnHover={!!onNavigateDocumento}>
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
                        // La tenencia no tiene catálogo propio: su renglón abre
                        // la ficha de la unidad, que es donde se captura.
                        return (
                          <Table.Tr
                            key={d.key}
                            onClick={onNavigateDocumento ? () => onNavigateDocumento(d.destino) : undefined}
                            style={onNavigateDocumento ? { cursor: 'pointer' } : undefined}
                          >
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
              descripcion="Unidades sin tenencia registrada o sin póliza vigente —sin seguro asignado, o con el suyo ya vencido—. No aparecen arriba porque lo que falta no tiene fecha que vigilar. La tenencia solo aplica a reparto y utilitarios."
            >
              {loadingDocumentos ? (
                <Center py="xl"><Loader size="sm" /></Center>
              ) : sinDocumento.length === 0 ? (
                <Center py="xl"><Text c="dimmed" size="sm">Todas las unidades tienen tenencia y seguro vigente.</Text></Center>
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
                        {totalSinSeguro !== 1 ? ' no tienen' : ' no tiene'} seguro vigente.
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
                titulo="Vehículos con preventivos atrasados"
                descripcion="Haz clic en la fila para ver el detalle, o en el nombre del vehículo para abrir su ficha."
              >
                {loadingVencidos ? (
                  <Center py="xl"><Loader size="sm" /></Center>
                ) : (
                  <PreventivosPorVehiculoTable
                    items={vencidos}
                    color="red"
                    emptyMessage="No hay servicios preventivos vencidos hoy."
                    onNavigateVehiculo={onNavigateVehiculo}
                  />
                )}
              </Seccion>

              <Seccion
                titulo="Vehículos con preventivos por vencer"
                descripcion="Haz clic en la fila para ver el detalle, o en el nombre del vehículo para abrir su ficha."
              >
                {loadingPorVencer ? (
                  <Center py="xl"><Loader size="sm" /></Center>
                ) : (
                  <PreventivosPorVehiculoTable
                    items={porVencer}
                    color="orange"
                    emptyMessage="No hay servicios preventivos próximos a vencer."
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
              titulo="Tendencia del programa preventivo sin atender"
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

            <Seccion
              titulo="Traspasos esperando aceptación"
              descripcion="Salieron del almacén de origen y no han entrado al de destino, así que ahora mismo no están en el inventario de ninguna sucursal. Se aceptan o se rechazan en Inventario → Traspasos."
            >
              {loadingAlmacen ? (
                <Center py="xl"><Loader size="sm" /></Center>
              ) : (
                <TraspasosPendientesTable items={traspasosPendientes} />
              )}
            </Seccion>

            {sinMarca > 0 && (
              <Alert color="orange" variant="light" icon={<IconTags size={16} />}
                title={`${sinMarca} refacción${sinMarca !== 1 ? 'es' : ''} sin marca capturada`}>
                {sinMarca !== 1 ? 'Siguen' : 'Sigue'} marcadas como «Marca Faltante», que no es lo
                mismo que una refacción genérica sin marca. Se corrigen en Refacciones —la barra de
                búsqueda ya filtra por marca— y hasta entonces comparar precios entre proveedores
                compara cosas que pueden no ser iguales.
              </Alert>
            )}
            {/* El chequeo diario, al final y plegado. Es una línea por unidad
                del patio: desplegado empuja fuera de la pantalla todo lo demás
                de esta pestaña, y lo que se necesita de reojo es el número. El
                recorrido de verdad se hace desde Chequeo de flotilla, no aquí. */}
            <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
              <SeccionPlegable
                titulo="Unidades sin chequeo de hoy"
                descripcion={faltanChequeo === 0
                  ? 'Toda la flota activa lleva su chequeo de hoy.'
                  : 'Ábrelo para ver cuáles. Haz clic en una unidad para ir a su ficha.'}
                contador={faltanChequeo}
                color="orange"
              >
                {loadingChequeos ? (
                  <Center py="xl"><Loader size="sm" /></Center>
                ) : (
                  <Stack gap={4}>
                    {(chequeos?.data.faltan ?? []).map((u) => (
                      <Group
                        key={u.vehiculo_id}
                        gap="xs"
                        wrap="nowrap"
                        style={{ cursor: onNavigateVehiculo ? 'pointer' : undefined }}
                        onClick={() => onNavigateVehiculo?.(u.vehiculo_id)}
                      >
                        <Badge size="xs" variant="light" color={TIPO_COLORS[u.tipo as keyof typeof TIPO_COLORS]}>
                          {TIPO_LABELS[u.tipo as keyof typeof TIPO_LABELS] ?? u.tipo}
                        </Badge>
                        <Text size="sm" lineClamp={1}>{u.nombre}</Text>
                        {u.placas && <Text size="xs" c="dimmed">{u.placas}</Text>}
                      </Group>
                    ))}
                  </Stack>
                )}
              </SeccionPlegable>

              <SeccionPlegable
                titulo="Reportes sin revisar"
                descripcion={reportesSinLeer === 0
                  ? 'No hay reportes pendientes de revisar.'
                  : 'Lo que se anotó en el chequeo y nadie ha leído. Se revisa desde la ficha del vehículo.'}
                contador={reportesSinLeer}
                color="red"
              >
                {loadingChequeos ? (
                  <Center py="xl"><Loader size="sm" /></Center>
                ) : (
                  <Stack gap="xs">
                    {(chequeos?.data.por_revisar ?? []).map((c) => (
                      <Card
                        key={c.id}
                        withBorder
                        radius="sm"
                        padding="xs"
                        style={{ cursor: onNavigateVehiculo ? 'pointer' : undefined }}
                        onClick={() => onNavigateVehiculo?.(c.vehiculo_id)}
                      >
                        <Group justify="space-between" wrap="nowrap" gap="xs">
                          <Text size="sm" fw={500} lineClamp={1}>{c.vehiculo_nombre}</Text>
                          <Text size="xs" c="dimmed">{c.revisado_por}</Text>
                        </Group>
                        <Text size="sm" c="dimmed" lineClamp={2}>{c.declaracion}</Text>
                      </Card>
                    ))}
                  </Stack>
                )}
              </SeccionPlegable>
            </SimpleGrid>
          </Stack>
        </Tabs.Panel>

        {/* ══ Fugas ══ */}
        {/* Aparte de Costos a propósito: esa pestaña mide lo que se gastó y si
            se pagó de más; esta busca lo que se pierde sin aparecer como gasto.
            Sus consultas son pesadas, y el `keepMounted={false}` del <Tabs> hace
            que solo corran al abrir la pestaña. */}
        <Tabs.Panel value="fugas" pt="lg">
          <DashboardFugas />
        </Tabs.Panel>

        {/* ══ Calendario ══ */}
        {/* Vivía en la barra lateral. Se movió aquí porque lo que el calendario
            contesta —qué pasó y qué viene este mes— es la misma pregunta que el
            resto del tablero, y separarlo obligaba a saltar de sección para
            cruzar un vencimiento con su fecha. El `keepMounted={false}` del
            <Tabs> hace que solo se monte al abrir la pestaña, así que no le
            cuesta nada a las demás. */}
        <Tabs.Panel value="calendario" pt="lg">
          <Calendario onNavigateVehiculo={onNavigateVehiculo} />
        </Tabs.Panel>
      </Tabs>

      <ReportesDashboardModal
        opened={reportesAbierto}
        onClose={() => setReportesAbierto(false)}
        tab={tab ?? 'resumen'}
        resumen={resumen?.data}
        documentos={documentosData?.data}
        pendientes={datosPendientes}
        analisis={analisisData?.data}
        sucursales={sucursalesData?.data ?? []}
      />
    </Stack>
  )
}
