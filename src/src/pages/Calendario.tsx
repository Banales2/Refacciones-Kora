// Página Calendario: vista mensual de toda la actividad de la flota. Cada día
// marca con puntos de color qué ocurrió (mantenimientos, incidencias,
// combustible, compras) y las agendas programadas se pintan como un rango
// naranja, marcando traslapes. Al hacer clic en un día se abre su bitácora
// completa; arriba viven las alertas de requerimientos y el flujo de agendar un
// mantenimiento futuro (que al completarse genera el mantenimiento real).
import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import {
  Stack, Text, Card, Group, Badge, Center, Loader, ActionIcon, Modal, SimpleGrid, ThemeIcon, Grid, Divider,
  Button, Select, MultiSelect, Alert, Textarea, Tooltip,
} from '@mantine/core'
import { Calendar } from '@mantine/dates'
import { FechaInput } from '../components/FechaInput'
import { useForm } from '@mantine/form'
import { useDebouncedValue } from '@mantine/hooks'
import {
  IconChevronRight, IconAlertTriangle, IconCalendarEvent, IconPlus, IconArrowLeft, IconCheck, IconX,
  IconTool, IconGasStation, IconShoppingCart, IconCoin, IconFileCertificate,
} from '@tabler/icons-react'
import DiaDetalleDrawer from '../components/DiaDetalleDrawer'
import { useActividadMes } from '../hooks/useActividadDia'
import type { ActividadDia, Vencimiento } from '../hooks/useActividadDia'
import { VENCIMIENTO_META, urgencia } from '../lib/vencimientoMeta'
import { formatMXN, formatNum } from '../lib/formato'
import {
  useRequerimientosVencidos, useRequerimientosPorVencer,
  type RequerimientoVencido,
} from '../hooks/useDashboard'
import {
  useAgendasCalendario, useCreateAgenda, useCancelarAgenda, useCompletarAgenda,
  type AgendaConVehiculo,
} from '../hooks/useAgendasMantenimiento'
import { useCreateRequerimiento } from '../hooks/useRequerimientos'
import type { RequerimientoPayload } from '../hooks/useRequerimientos'
import { usePendientes, ORIGEN_LABEL } from '../hooks/usePendientes'
import type { OrigenPendiente } from '../hooks/usePendientes'
import { TIPO_COLORS, TIPO_LABELS } from '../lib/tipoVehiculo'
import MantenimientoDetalleDrawer from '../components/MantenimientoDetalleDrawer'
import { MantenimientoForm, RequerimientoForm } from './Vehiculos'
import { useVehiculos, vehiculoLabel } from '../hooks/useVehiculos'
import type { TipoVehiculo, VehiculoRow } from '../hooks/useVehiculos'
import { useMantenimientos } from '../hooks/useMantenimientos'
import { useTecnicos } from '../hooks/useTecnicos'
import type { Tecnico } from '../hooks/useTecnicos'
import NuevoTecnicoModal from '../components/NuevoTecnicoModal'
import type { MantenimientoPayload } from '../hooks/useMantenimientos'
import { useCreateDetallesMtto } from '../hooks/useDetalleMtto'
import type { DetalleMttoPayload } from '../hooks/useDetalleMtto'

interface VehiculoConRequerimientos {
  vehiculo_id:     number
  vehiculo_nombre: string
  requerimientos:  RequerimientoVencido[]
}

// `items` ya viene ordenado por urgencia (más próximo a vencer primero) desde
// el backend; al agrupar por vehículo preservando el orden de primera
// aparición, el vehículo con el requerimiento más urgente queda primero.
function agruparPorVehiculoOrdenado(items: RequerimientoVencido[]): VehiculoConRequerimientos[] {
  const map = new Map<number, VehiculoConRequerimientos>()
  for (const item of items) {
    if (!map.has(item.vehiculo_id)) {
      map.set(item.vehiculo_id, { vehiculo_id: item.vehiculo_id, vehiculo_nombre: item.vehiculo_nombre, requerimientos: [] })
    }
    map.get(item.vehiculo_id)!.requerimientos.push(item)
  }
  return [...map.values()]
}

function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function fmtFecha(iso: string) {
  return new Date(`${iso.split('T')[0]}T12:00:00`).toLocaleDateString('es-MX', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

function fmtDiaCorto(iso: string) {
  const d = new Date(`${iso.split('T')[0]}T12:00:00`)
  return {
    mes: d.toLocaleDateString('es-MX', { month: 'short' }).replace('.', '').toUpperCase(),
    dia: d.getDate(),
  }
}

const TIPO_ORDEN: TipoVehiculo[] = ['tractocamion', 'caja_trailer', 'camion', 'utilitario', 'montacargas']

function vehiculoUbicacion(v: VehiculoRow): string {
  return v.ruta ?? v.sucursal ?? v.ubicacion ?? '—'
}

interface VehiculoOptionData {
  value:     string
  label:     string
  ubicacion: string
  vencidos:  number
  porVencer: number
}

// Expande cada agenda pendiente en el set de días que abarca (inicio..fin) para marcarlos en el calendario.
// Se hace todo en UTC puro (sin pasar por Date locales) para evitar que el
// huso horario del navegador recorra los días hacia adelante o atrás.
function diasEnRango(inicio: string, fin: string): string[] {
  const dias: string[] = []
  let cur = new Date(`${inicio}T00:00:00Z`)
  const end = new Date(`${fin}T00:00:00Z`)
  while (cur <= end) {
    dias.push(cur.toISOString().split('T')[0])
    cur = new Date(cur.getTime() + 24 * 60 * 60 * 1000)
  }
  return dias
}

function addDaysIso(dateStr: string, delta: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + delta)
  return d.toISOString().split('T')[0]
}

// Entre más agendas caen el mismo día, más opaco se pinta el naranja del cuadro.
const TRASLAPE_RGB   = '253, 126, 20' // mantine orange-6 (agendas traslapadas)
function overlapAlpha(count: number): number {
  return Math.min(0.28 + (count - 1) * 0.18, 0.95)
}

// Qué se marca bajo el número de cada día. El fondo del cuadro ya lo ocupan las
// agendas (rango naranja), así que lo ocurrido se señala con puntos: cabe más
// de un tipo por día sin que un color tape al otro.
//
// Son cuatro y no siete a propósito: con más, la fila de puntos no cabe en el
// cuadro y deja de leerse. Los vales van con las recargas (son el mismo gasto
// visto desde el papel) y los traspasos no se marcan — mueven inventario entre
// sucursales pero no son actividad de la flota.
//
// `dia` queda fuera del tipo de la clave: es el único campo de texto del
// resumen y aquí solo se comparan conteos contra cero.
type ClaveConteo = Exclude<keyof ActividadDia, 'dia'>

const MARCAS: { key: ClaveConteo; color: string; label: string }[] = [
  { key: 'mantenimientos',       color: 'blue',   label: 'Mantenimiento' },
  { key: 'incidencias_abiertas', color: 'red',    label: 'Incidencia reportada' },
  { key: 'recargas',             color: 'grape',  label: 'Combustible' },
  { key: 'compras',              color: 'indigo', label: 'Compra de refacciones' },
]

// Resumen textual del día para el tooltip nativo del cuadro: es lo que evita
// tener que abrir el detalle solo para saber si vale la pena abrirlo.
function resumenDia(a: ActividadDia | undefined, agendas: number, vencen: number): string | undefined {
  const partes: string[] = []
  if (vencen > 0)                partes.push(`${vencen} documento${vencen !== 1 ? 's' : ''} vence${vencen !== 1 ? 'n' : ''}`)
  if (agendas > 0)               partes.push(`${agendas} agendado${agendas !== 1 ? 's' : ''}`)
  if (!a) return partes.length ? partes.join(' · ') : undefined
  if (a.mantenimientos > 0)       partes.push(`${a.mantenimientos} mantenimiento${a.mantenimientos !== 1 ? 's' : ''}`)
  if (a.incidencias_abiertas > 0) partes.push(`${a.incidencias_abiertas} incidencia${a.incidencias_abiertas !== 1 ? 's' : ''}`)
  if (a.incidencias_cerradas > 0) partes.push(`${a.incidencias_cerradas} cerrada${a.incidencias_cerradas !== 1 ? 's' : ''}`)
  if (a.recargas > 0)             partes.push(`${a.recargas} recarga${a.recargas !== 1 ? 's' : ''}`)
  if (a.vales > 0)                partes.push(`${a.vales} vale${a.vales !== 1 ? 's' : ''}`)
  if (a.compras > 0)              partes.push(`${a.compras} compra${a.compras !== 1 ? 's' : ''}`)
  if (a.traspasos > 0)            partes.push(`${a.traspasos} traspaso${a.traspasos !== 1 ? 's' : ''}`)
  const gasto = a.mano_obra + a.refacciones + a.combustible
  if (gasto > 0) partes.push(formatMXN(gasto))
  return partes.length ? partes.join(' · ') : undefined
}

// 'YYYY-MM' del mes al que pertenece una fecha ISO.
function mesDe(iso: string): string {
  return iso.slice(0, 7)
}

// '2026-07' → 'julio 2026'. Las tarjetas de resumen lo llevan en la etiqueta:
// decían solo "del mes" y, en un mes con un único día de gasto, la cifra es
// idéntica a la de ese día y no había forma de saber cuál de las dos era.
function nombreMes(mes: string): string {
  const [anio, m] = mes.split('-').map(Number)
  return new Date(anio, m - 1, 15).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })
}

// ─── Tarjeta de alerta (vencidos / por vencer) ────────────────────────────────

function AlertaStat({
  label, count, vehiculos, color, onClick,
}: {
  label: string; count: number; vehiculos: number; color: string; onClick?: () => void
}) {
  return (
    <Card
      withBorder padding="lg" radius="md"
      style={{ cursor: onClick ? 'pointer' : undefined, borderLeft: `4px solid var(--mantine-color-${color}-6)` }}
      onClick={onClick}
    >
      <Group justify="space-between" align="flex-start">
        <Stack gap={4}>
          <Text size="sm" c="dimmed" fw={500}>{label}</Text>
          <Text fz="2rem" fw={700} lh={1}>{count}</Text>
          <Text size="xs" c="dimmed">
            {vehiculos > 0 ? `${vehiculos} vehículo${vehiculos !== 1 ? 's' : ''} — clic para ver` : 'Sin pendientes'}
          </Text>
        </Stack>
        <ThemeIcon color={color} variant="light" size="lg" radius="md">
          <IconAlertTriangle size={20} />
        </ThemeIcon>
      </Group>
    </Card>
  )
}

// ─── Tarjeta de resumen del mes visible ──────────────────────────────────────

// Deliberadamente no reusa StatCard: esa trae delta contra el periodo anterior
// y tooltip de ayuda, y aquí sobran — estas cuatro solo resumen el mes que el
// calendario está mostrando y cambian al pasar de mes.
function ResumenMesCard({
  label, valor, detalle, color, icon: Icono, cargando,
}: {
  label: string; valor: string; detalle: string; color: string; icon: typeof IconCoin; cargando: boolean
}) {
  return (
    <Card withBorder padding="sm" radius="md" style={{ borderLeft: `3px solid var(--mantine-color-${color}-6)` }}>
      <Group justify="space-between" align="flex-start" wrap="nowrap" gap="xs">
        <Stack gap={2} style={{ minWidth: 0 }}>
          <Text size="xs" c="dimmed" fw={600} tt="uppercase" lts={0.3} lineClamp={1}>{label}</Text>
          {cargando ? (
            <Loader size="xs" mt={4} />
          ) : (
            <>
              <Text fz="1.25rem" fw={700} lh={1.15} style={{ fontVariantNumeric: 'tabular-nums' }}>
                {valor}
              </Text>
              <Text size="xs" c="dimmed" lineClamp={1}>{detalle}</Text>
            </>
          )}
        </Stack>
        <ThemeIcon color={color} variant="light" size={32} radius="md">
          <Icono size={18} />
        </ThemeIcon>
      </Group>
    </Card>
  )
}

// ─── Formulario para agendar (sin datos que solo se conocen al completar) ─────

type AgendaFormVals = {
  fecha_inicio:      string
  fecha_fin:         string
  tipo:              string
  tecnico_id:        string
  observaciones:     string
  pendiente_ids:     string[]
}

function AgendaForm({
  vehiculo, isPending, error, onSubmit, onCancel,
}: {
  vehiculo:  VehiculoRow
  isPending: boolean
  error:     string | null
  onSubmit:  (v: AgendaFormVals) => void
  onCancel:  () => void
}) {
  const vehiculoId = vehiculo.id
  const { data: mantData } = useMantenimientos(vehiculoId)
  const lastMant = mantData?.data?.[0] ?? null
  const createReqMut = useCreateRequerimiento(vehiculoId)
  const [nuevoReqOpen, setNuevoReqOpen]   = useState(false)
  const [nuevoReqError, setNuevoReqError] = useState<string | null>(null)

  // Una agenda puede atender pendientes de los dos tipos a la vez, así que el
  // selector viene de la lista combinada y los agrupa por origen.
  const { data: pendientesData } = usePendientes(vehiculoId)
  const pendienteGroups = useMemo(() => {
    const items = pendientesData?.data ?? []
    return (['preventivo', 'incidencia'] as OrigenPendiente[])
      .map(origen => ({
        group: ORIGEN_LABEL[origen],
        items: items
          .filter(p => p.origen === origen)
          .map(p => ({ value: String(p.id), label: p.nombre })),
      }))
      .filter(g => g.items.length > 0)
  }, [pendientesData])
  const hayPendientes = pendienteGroups.length > 0

  // El técnico se elige del catálogo y se guarda por id. Los dados de alta desde
  // aquí se agregan a mano porque el catálogo todavía puede estar refrescándose.
  const { data: tecnicosData } = useTecnicos()
  const [nuevoTecnicoOpen, setNuevoTecnicoOpen] = useState(false)
  const [tecnicosNuevos, setTecnicosNuevos] = useState<Tecnico[]>([])
  const tecnicoOptions = useMemo(() => {
    const base = tecnicosData?.data ?? []
    const ids = new Set(base.map(t => t.id))
    return [...base, ...tecnicosNuevos.filter(t => !ids.has(t.id))]
      .map(t => ({ value: String(t.id), label: t.nombre }))
  }, [tecnicosData, tecnicosNuevos])

  const form = useForm<AgendaFormVals>({
    initialValues: { fecha_inicio: '', fecha_fin: '', tipo: '', tecnico_id: '', observaciones: '', pendiente_ids: [] },
    validate: {
      fecha_inicio: (v) => !v ? 'Requerido' : null,
      fecha_fin:    (v, vals) => !v ? 'Requerido' : v < vals.fecha_inicio ? 'No puede ser antes del inicio' : null,
      tipo:         (v) => !v ? 'Requerido' : null,
      pendiente_ids: (v) => v.length === 0 ? 'Selecciona al menos un requerimiento o incidencia' : null,
      tecnico_id:   (v) => !v ? 'Requerido' : null,
    },
  })

  function handleCrearRequerimiento(payload: RequerimientoPayload) {
    setNuevoReqError(null)
    createReqMut.mutate(payload, {
      onSuccess: (res) => {
        form.setFieldValue('pendiente_ids', [...form.values.pendiente_ids, String(res.data.id)])
        setNuevoReqOpen(false)
      },
      onError: (e: Error) => setNuevoReqError(e.message),
    })
  }

  return (
    <form onSubmit={form.onSubmit(onSubmit)}>
      <Stack gap="sm">
        {error && <Alert color="red" title="Error">{error}</Alert>}
        <Grid>
          <Grid.Col span={6}>
            <FechaInput
              label="Inicio" required
              value={form.values.fecha_inicio}
              onChange={(d) => form.setFieldValue('fecha_inicio', d)}
              error={form.errors.fecha_inicio as string}
            />
          </Grid.Col>
          <Grid.Col span={6}>
            <FechaInput
              label="Fin" required
              minDate={form.values.fecha_inicio || undefined}
              value={form.values.fecha_fin}
              onChange={(d) => form.setFieldValue('fecha_fin', d)}
              error={form.errors.fecha_fin as string}
            />
          </Grid.Col>
        </Grid>
        <Select
          label="Tipo" required
          placeholder="Selecciona el tipo"
          data={[
            { value: 'Preventivo', label: 'Preventivo' },
            { value: 'Correctivo', label: 'Correctivo' },
          ]}
          {...form.getInputProps('tipo')}
          onChange={(v) => form.setFieldValue('tipo', v ?? '')}
        />
        <div>
          <Select
            label="Técnico" required
            placeholder="Selecciona un técnico"
            data={tecnicoOptions}
            searchable
            nothingFoundMessage='Sin coincidencias: usa "Nuevo técnico"'
            {...form.getInputProps('tecnico_id')}
            onChange={(v) => form.setFieldValue('tecnico_id', v ?? '')}
          />
          <Button
            variant="subtle" size="xs" mt={4} leftSection={<IconPlus size={14} />}
            onClick={() => setNuevoTecnicoOpen(true)}
          >
            Nuevo técnico
          </Button>
        </div>
        <div>
          <MultiSelect
            label="Qué se busca resolver"
            description="Requerimientos preventivos e incidencias de esta unidad"
            required
            placeholder={hayPendientes ? 'Selecciona los pendientes…' : 'Esta unidad no tiene nada pendiente'}
            data={pendienteGroups}
            searchable
            clearable
            {...form.getInputProps('pendiente_ids')}
          />
          <Button
            variant="subtle" size="xs" mt={4} leftSection={<IconPlus size={14} />}
            onClick={() => setNuevoReqOpen(true)}
          >
            Crear nuevo requerimiento preventivo
          </Button>
        </div>
        <Textarea label="Notas" autosize minRows={2} placeholder="Detalles del mantenimiento planeado (opcional)" {...form.getInputProps('observaciones')} />
        <Group justify="flex-end" mt="xs">
          <Button variant="default" onClick={onCancel} disabled={isPending}>Cancelar</Button>
          <Button type="submit" loading={isPending}>Agendar</Button>
        </Group>
      </Stack>

      <Modal
        opened={nuevoReqOpen}
        onClose={() => setNuevoReqOpen(false)}
        title="Nuevo requerimiento"
        size="md"
      >
        <RequerimientoForm
          isPending={createReqMut.isPending}
          error={nuevoReqError}
          onSubmit={handleCrearRequerimiento}
          onCancel={() => setNuevoReqOpen(false)}
          vehiculo={vehiculo}
          lastMant={lastMant}
        />
      </Modal>

      <NuevoTecnicoModal
        opened={nuevoTecnicoOpen}
        onClose={() => setNuevoTecnicoOpen(false)}
        onCreated={(tecnico) => {
          setTecnicosNuevos((prev) => [...prev, tecnico])
          form.setFieldValue('tecnico_id', String(tecnico.id))
        }}
      />
    </form>
  )
}

export default function Calendario({
  onNavigateVehiculo,
}: {
  onNavigateVehiculo?: (vehiculoId: number) => void
}) {
  const { data: agendasData } = useAgendasCalendario()
  const { data: vencidosData } = useRequerimientosVencidos()
  const { data: porVencerData } = useRequerimientosPorVencer()
  const [detalleId, setDetalleId] = useState<number | null>(null)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [alertaAbierta, setAlertaAbierta] = useState<'vencidos' | 'porVencer' | null>(null)

  const [cancelarAgenda, setCancelarAgenda] = useState<AgendaConVehiculo | null>(null)
  const [completarAgenda, setCompletarAgenda] = useState<AgendaConVehiculo | null>(null)

  // El mes que se está viendo. El resumen de actividad se pide por mes en vez de
  // traer la flota entera: es lo único que el calendario pinta a la vez, y así
  // cambiar de mes cuesta una consulta acotada.
  const [mesVisible, setMesVisible] = useState(() => mesDe(todayIso()))
  const { data: actividadMesData, isLoading: loadingActividad } = useActividadMes(mesVisible)
  const actividadPorDia = useMemo(() => {
    const map = new Map<string, ActividadDia>()
    for (const d of actividadMesData?.data.dias ?? []) map.set(d.dia, d)
    return map
  }, [actividadMesData])

  // Los vencimientos del mes llegan completos (no agregados por día): se
  // agrupan aquí para marcar el cuadro y, más abajo, listarlos por fecha.
  const vencimientosMes = useMemo<Vencimiento[]>(
    () => actividadMesData?.data.vencimientos ?? [], [actividadMesData])
  const vencimientosPorDia = useMemo(() => {
    const map = new Map<string, Vencimiento[]>()
    for (const v of vencimientosMes) {
      const arr = map.get(v.fecha_expiracion)
      if (arr) arr.push(v)
      else map.set(v.fecha_expiracion, [v])
    }
    return map
  }, [vencimientosMes])

  // Totales del mes visible, para la tira de resumen sobre el calendario.
  const totalesMes = useMemo(() => {
    let manoObra = 0, refacciones = 0, combustible = 0
    let mantenimientos = 0, recargas = 0, incidencias = 0, compras = 0
    for (const d of actividadMesData?.data.dias ?? []) {
      manoObra       += d.mano_obra
      refacciones    += d.refacciones
      combustible    += d.combustible
      mantenimientos += d.mantenimientos
      recargas       += d.recargas
      incidencias    += d.incidencias_abiertas
      compras        += d.compras
    }
    return {
      manoObra, refacciones, combustible,
      total: manoObra + refacciones + combustible,
      mantenimientos, recargas, incidencias, compras,
    }
  }, [actividadMesData])


  // Memorizados para que conserven identidad entre renders: varios useMemo
  // de abajo dependen de ellos y se recalcularían en cada render si fueran
  // expresiones nuevas (`x?.data ?? []` crea un array distinto cada vez).
  const agendas = useMemo(() => agendasData?.data ?? [], [agendasData])
  const agendasPendientes = useMemo(() => agendas.filter(a => a.status === 'pendiente'), [agendas])

  // ── Agendar mantenimiento ──
  const [agendarOpen, setAgendarOpen]           = useState(false)
  // Se guarda el vehículo completo (no solo su id) en el momento en que se
  // selecciona: Mantine Select, al elegir una opción, reescribe el texto de
  // búsqueda con la etiqueta de esa opción (vía onSearchChange), lo que
  // dispara un nuevo fetch server-side con ese texto como filtro. Si
  // dependiéramos de `vehiculosData` (que cambia con ese fetch) para
  // encontrar al vehículo elegido, este puede desaparecer de los resultados
  // y dejar el formulario del paso 2 colgado en el loader.
  const [agendarVehiculo, setAgendarVehiculo]   = useState<VehiculoRow | null>(null)
  const [vehiculoSearch, setVehiculoSearch]     = useState('')
  const [debouncedVehiculoSearch] = useDebouncedValue(vehiculoSearch, 300)
  const { data: vehiculosData, isLoading: loadingVehiculos } =
    useVehiculos(1, debouncedVehiculoSearch, undefined, undefined, 20, agendarOpen)
  const createAgendaMut = useCreateAgenda(agendarVehiculo?.id ?? 0)

  function seleccionarVehiculoAgenda(id: string | null) {
    const found = id ? (vehiculosData?.data ?? []).find(v => String(v.id) === id) ?? null : null
    setAgendarVehiculo(found)
    setVehiculoSearch('')
  }

  const vencidosPorVehiculo = useMemo(() => {
    const map = new Map<number, number>()
    for (const r of vencidosData?.data ?? []) map.set(r.vehiculo_id, (map.get(r.vehiculo_id) ?? 0) + 1)
    return map
  }, [vencidosData])

  const porVencerPorVehiculo = useMemo(() => {
    const map = new Map<number, number>()
    for (const r of porVencerData?.data ?? []) map.set(r.vehiculo_id, (map.get(r.vehiculo_id) ?? 0) + 1)
    return map
  }, [porVencerData])

  const vehiculoOpts = useMemo(() => {
    const porTipo = new Map<TipoVehiculo, VehiculoOptionData[]>()
    for (const v of vehiculosData?.data ?? []) {
      const opt: VehiculoOptionData = {
        value:     String(v.id),
        label:     vehiculoLabel(v),
        ubicacion: vehiculoUbicacion(v),
        vencidos:  vencidosPorVehiculo.get(v.id) ?? 0,
        porVencer: porVencerPorVehiculo.get(v.id) ?? 0,
      }
      if (!porTipo.has(v.tipo)) porTipo.set(v.tipo, [])
      porTipo.get(v.tipo)!.push(opt)
    }
    for (const arr of porTipo.values()) arr.sort((a, b) => a.label.localeCompare(b.label))
    return TIPO_ORDEN
      .filter(t => porTipo.has(t))
      .map(t => ({ group: TIPO_LABELS[t] ?? t, items: porTipo.get(t)! }))
  }, [vehiculosData, vencidosPorVehiculo, porVencerPorVehiculo])

  function cerrarAgendar() {
    setAgendarOpen(false)
    setAgendarVehiculo(null)
    setVehiculoSearch('')
  }

  function handleAgendarSubmit(vals: AgendaFormVals) {
    createAgendaMut.mutate({
      fecha_inicio:      vals.fecha_inicio,
      fecha_fin:         vals.fecha_fin,
      tipo:              vals.tipo,
      tecnico_id:        Number(vals.tecnico_id),
      observaciones:     vals.observaciones.trim() || null,
      pendiente_ids:     vals.pendiente_ids.map(Number),
    }, { onSuccess: cerrarAgendar })
  }

  // ── Cancelar / completar agenda ──
  const cancelarMut  = useCancelarAgenda(cancelarAgenda?.vehiculo_id ?? 0)
  const completarMut = useCompletarAgenda(completarAgenda?.vehiculo_id ?? 0)
  const piezasMut    = useCreateDetallesMtto()

  function handleCompletarSubmit(payload: MantenimientoPayload, piezas: DetalleMttoPayload[]) {
    if (!completarAgenda) return
    completarMut.mutate({ id: completarAgenda.id, payload }, {
      onSuccess: (res) => {
        if (!piezas.length) { setCompletarAgenda(null); return }
        piezasMut.mutate({ mantenimientoId: res.data.id, piezas }, {
          onSuccess: () => setCompletarAgenda(null),
          // El mantenimiento ya quedó registrado: se avisa y se deja su detalle
          // abierto para completar a mano las piezas que no entraron.
          onError: (e: Error) => {
            setCompletarAgenda(null)
            setDetalleId(res.data.id)
            alert(
              `El mantenimiento se registró, pero no se pudieron guardar todas las refacciones: ${e.message}\n\n` +
              'Revisa el detalle del mantenimiento para agregar las que falten.'
            )
          },
        })
      },
    })
  }

  const vencidos = useMemo(() => vencidosData?.data ?? [], [vencidosData])
  const porVencer = useMemo(() => porVencerData?.data ?? [], [porVencerData])
  const vehiculosVencidos = useMemo(() => agruparPorVehiculoOrdenado(vencidos), [vencidos])
  const vehiculosPorVencer = useMemo(() => agruparPorVehiculoOrdenado(porVencer), [porVencer])
  const vehiculosAlerta = alertaAbierta === 'vencidos' ? vehiculosVencidos : vehiculosPorVencer

  // Cuenta cuántas agendas pendientes cubren cada día, para detectar traslapes
  // (2+ vehículos agendados el mismo día).
  const agendaCountPorDia = useMemo(() => {
    const map = new Map<string, number>()
    for (const a of agendasPendientes) {
      for (const d of diasEnRango(a.fecha_inicio.split('T')[0], a.fecha_fin.split('T')[0])) {
        map.set(d, (map.get(d) ?? 0) + 1)
      }
    }
    return map
  }, [agendasPendientes])
  const fechasConAgenda = agendaCountPorDia

  // Ids de agendas cuyo rango de fechas se cruza con el de otra agenda (de
  // cualquier vehículo), para marcarlas en la lista de "Agendas próximas".
  const agendasTraslapadas = useMemo(() => {
    const ids = new Set<number>()
    for (let i = 0; i < agendasPendientes.length; i++) {
      for (let j = i + 1; j < agendasPendientes.length; j++) {
        const a = agendasPendientes[i], b = agendasPendientes[j]
        const aIni = a.fecha_inicio.split('T')[0], aFin = a.fecha_fin.split('T')[0]
        const bIni = b.fecha_inicio.split('T')[0], bFin = b.fecha_fin.split('T')[0]
        if (aIni <= bFin && bIni <= aFin) { ids.add(a.id); ids.add(b.id) }
      }
    }
    return ids
  }, [agendasPendientes])

  const agendasDelDia = useMemo(() => {
    if (!selectedDate) return [] as AgendaConVehiculo[]
    return agendasPendientes
      .filter(a => selectedDate >= a.fecha_inicio.split('T')[0] && selectedDate <= a.fecha_fin.split('T')[0])
      .sort((a, b) => a.vehiculo_nombre.localeCompare(b.vehiculo_nombre))
  }, [agendasPendientes, selectedDate])

  const agendasProximas = useMemo(() => (
    [...agendasPendientes].sort((a, b) => a.fecha_inicio.localeCompare(b.fecha_inicio))
  ), [agendasPendientes])

  const hoy = todayIso()

  // Abrir un día desde las flechas del detalle puede cruzar el borde del mes;
  // el calendario tiene que seguir al día abierto o la vista quedaría mostrando
  // un mes distinto al del panel.
  function abrirDia(fecha: string) {
    setSelectedDate(fecha)
    if (mesDe(fecha) !== mesVisible) setMesVisible(mesDe(fecha))
  }

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end">
        <div>
          <Text size="xl" fw={600}>Calendario</Text>
          <Text size="sm" c="dimmed">
            Toda la actividad de la flota, día por día — haz clic en un día para ver su detalle
          </Text>
        </div>
        <Button leftSection={<IconPlus size={16} />} onClick={() => setAgendarOpen(true)}>
          Agendar mantenimiento
        </Button>
      </Group>

      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        <AlertaStat
          label="Requerimientos vencidos"
          count={vencidos.length}
          vehiculos={vehiculosVencidos.length}
          color="red"
          onClick={vencidos.length > 0 ? () => setAlertaAbierta('vencidos') : undefined}
        />
        <AlertaStat
          label="Requerimientos por vencer"
          count={porVencer.length}
          vehiculos={vehiculosPorVencer.length}
          color="yellow"
          onClick={porVencer.length > 0 ? () => setAlertaAbierta('porVencer') : undefined}
        />
      </SimpleGrid>

      {/* ── Resumen del mes visible ── */}
      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
        <ResumenMesCard
          label={`Gasto de ${nombreMes(mesVisible)}`} icon={IconCoin} color="teal"
          valor={formatMXN(totalesMes.total)}
          detalle={`${formatMXN(totalesMes.manoObra)} mano de obra`}
          cargando={loadingActividad}
        />
        <ResumenMesCard
          label={`Mantenimientos de ${nombreMes(mesVisible)}`} icon={IconTool} color="blue"
          valor={formatNum(totalesMes.mantenimientos)}
          detalle={`${totalesMes.incidencias} incidencia${totalesMes.incidencias !== 1 ? 's' : ''} reportada${totalesMes.incidencias !== 1 ? 's' : ''}`}
          cargando={loadingActividad}
        />
        <ResumenMesCard
          label={`Combustible de ${nombreMes(mesVisible)}`} icon={IconGasStation} color="grape"
          valor={formatMXN(totalesMes.combustible)}
          detalle={`${formatNum(totalesMes.recargas)} recarga${totalesMes.recargas !== 1 ? 's' : ''}`}
          cargando={loadingActividad}
        />
        <ResumenMesCard
          label={`Refacciones de ${nombreMes(mesVisible)}`} icon={IconShoppingCart} color="indigo"
          valor={formatMXN(totalesMes.refacciones)}
          detalle={`${formatNum(totalesMes.compras)} compra${totalesMes.compras !== 1 ? 's' : ''}`}
          cargando={loadingActividad}
        />
      </SimpleGrid>

      <Grid align="stretch">
          <Grid.Col span={{ base: 12, md: 5 }}>
            <Card withBorder padding="lg" radius="md" h="100%">
              <Center>
                {/* El fondo de "en rango" de Mantine usa --mantine-primary-color-light;
                    se sobreescribe localmente para que las agendas se pinten de naranja
                    en vez del color primario del tema, sin afectar al resto de la app. */}
                <div style={{ '--mantine-primary-color-light': 'var(--mantine-color-orange-1)' } as CSSProperties}>
                  <Calendar
                    size="md"
                    highlightToday
                    // El cuadro del día crece para que la fila de puntos quepa
                    // bajo el número sin encimarse ni recortarse.
                    styles={{ day: { height: 44 } }}
                    // Mes controlado: es lo que dice qué resumen pedir, y lo que
                    // permite que el panel de detalle arrastre al calendario
                    // cuando se navega de día en día hasta salirse del mes.
                    date={`${mesVisible}-01`}
                    onDateChange={(d) => setMesVisible(mesDe(String(d)))}
                    getDayProps={(dateStr) => {
                      const enRango     = fechasConAgenda.has(dateStr)
                      const agendaCount = agendaCountPorDia.get(dateStr) ?? 0
                      const traslape    = agendaCount > 1
                      const act         = actividadPorDia.get(dateStr)
                      // Todos los días abren, tengan o no algo registrado: el
                      // panel se navega con flechas de día en día, y que unos
                      // cuadros respondieran al clic y otros no volvería
                      // impredecible dónde se puede entrar.
                      return {
                        inRange:      enRango,
                        firstInRange: enRango && !fechasConAgenda.has(addDaysIso(dateStr, -1)),
                        lastInRange:  enRango && !fechasConAgenda.has(addDaysIso(dateStr, 1)),
                        onClick: () => abrirDia(dateStr),
                        title:   resumenDia(act, agendaCount, vencimientosPorDia.get(dateStr)?.length ?? 0),
                        style: {
                          cursor: 'pointer',
                          // A más agendas el mismo día, más opaco el naranja.
                          ...(traslape
                            ? { backgroundColor: `rgba(${TRASLAPE_RGB}, ${overlapAlpha(agendaCount)})` }
                            : {}),
                        },
                      }
                    }}
                    renderDay={(dateStr) => {
                      const act = actividadPorDia.get(dateStr)
                      const dia = Number(String(dateStr).slice(8, 10))
                      const marcas = MARCAS.filter(m => (act?.[m.key] ?? 0) > 0)
                      // Los vencimientos no vienen del resumen por día, así que
                      // su punto se añade aparte. Va siempre al final para que la
                      // fila no cambie de orden según lo que traiga el día.
                      const vencenHoy = vencimientosPorDia.get(dateStr)?.length ?? 0
                      return (
                        <Stack gap={0} align="center" justify="center" style={{ lineHeight: 1 }}>
                          <span>{dia}</span>
                          {/* La fila de puntos siempre ocupa su alto, tenga o no
                              marcas: si apareciera y desapareciera, los números
                              de los días bailarían de una semana a otra. */}
                          <Group gap={2} justify="center" style={{ height: 5, marginTop: 2 }}>
                            {marcas.map(m => (
                              <span
                                key={m.key}
                                style={{
                                  width: 4, height: 4, borderRadius: '50%',
                                  backgroundColor: `var(--mantine-color-${m.color}-6)`,
                                  display: 'inline-block',
                                }}
                              />
                            ))}
                            {vencenHoy > 0 && (
                              <span
                                style={{
                                  width: 4, height: 4, borderRadius: '50%',
                                  backgroundColor: 'var(--mantine-color-cyan-6)',
                                  display: 'inline-block',
                                }}
                              />
                            )}
                          </Group>
                        </Stack>
                      )
                    }}
                  />
                </div>
              </Center>
              <Divider my="sm" />
              <Stack gap={6}>
                <Group gap="md" justify="center">
                  {MARCAS.map(m => (
                    <Group gap={5} key={m.key}>
                      <span style={{
                        width: 7, height: 7, borderRadius: '50%',
                        backgroundColor: `var(--mantine-color-${m.color}-6)`, display: 'inline-block',
                      }} />
                      <Text size="xs" c="dimmed">{m.label}</Text>
                    </Group>
                  ))}
                  <Group gap={5}>
                    <span style={{
                      width: 7, height: 7, borderRadius: '50%',
                      backgroundColor: 'var(--mantine-color-cyan-6)', display: 'inline-block',
                    }} />
                    <Text size="xs" c="dimmed">Vence un documento</Text>
                  </Group>
                </Group>
                <Group gap="md" justify="center">
                  <Group gap={6}>
                    <span style={{ width: 22, height: 14, borderRadius: 4, backgroundColor: 'var(--mantine-color-orange-1)', border: '1px solid var(--mantine-color-orange-4)', display: 'inline-block' }} />
                    <Text size="xs" c="dimmed">Agendado (rango)</Text>
                  </Group>
                  <Group gap={6}>
                    <span style={{ width: 22, height: 14, borderRadius: 4, backgroundColor: `rgba(${TRASLAPE_RGB}, ${overlapAlpha(4)})`, display: 'inline-block' }} />
                    <Text size="xs" c="dimmed">Traslape</Text>
                  </Group>
                </Group>
              </Stack>
            </Card>
          </Grid.Col>

          <Grid.Col span={{ base: 12, md: 7 }}>
            <Card withBorder padding="lg" radius="md" h="100%">
              <Text fw={600} mb="sm">Agendas próximas ({agendasProximas.length})</Text>
              {agendasProximas.length === 0 ? (
                <Center py="xl" style={{ flexDirection: 'column' }}>
                  <ThemeIcon variant="light" color="gray" size={40} radius="xl" mb="xs">
                    <IconCalendarEvent size={20} />
                  </ThemeIcon>
                  <Text c="dimmed" size="sm">No hay mantenimientos agendados.</Text>
                </Center>
              ) : (
                <Stack gap={6}>
                  {agendasProximas.map(a => {
                    const { mes, dia } = fmtDiaCorto(a.fecha_inicio)
                    const color = TIPO_COLORS[a.vehiculo_tipo] ?? 'gray'
                    const atrasada = a.fecha_fin.split('T')[0] < hoy
                    return (
                      <Group
                        key={a.id}
                        justify="space-between" wrap="nowrap"
                        p="xs"
                        style={{
                          borderRadius: 8,
                          border: '1px solid var(--mantine-color-default-border)',
                          borderLeft: `3px solid var(--mantine-color-${atrasada ? 'red' : color}-6)`,
                        }}
                      >
                        <Group gap="sm" wrap="nowrap">
                          <Stack gap={0} align="center" style={{ minWidth: 42 }}>
                            <Text size="xs" c="dimmed" fw={600}>{mes}</Text>
                            <Text fw={700} size="lg" lh={1.1}>{dia}</Text>
                          </Stack>
                          <div>
                            <Group gap={6} wrap="nowrap">
                              <Text size="sm" fw={500}>{a.vehiculo_nombre}</Text>
                              <Badge size="xs" variant="light" color={color}>
                                {TIPO_LABELS[a.vehiculo_tipo] ?? a.vehiculo_tipo}
                              </Badge>
                              {atrasada && <Badge size="xs" variant="light" color="red">Atrasada</Badge>}
                              {agendasTraslapadas.has(a.id) && (
                                <Tooltip label="Se traslapa con otra agenda">
                                  <Badge size="xs" variant="light" color="red" leftSection={<IconAlertTriangle size={10} />}>
                                    Traslape
                                  </Badge>
                                </Tooltip>
                              )}
                            </Group>
                            <Text size="xs" c="dimmed">
                              {fmtFecha(a.fecha_inicio)} – {fmtFecha(a.fecha_fin)}
                              {a.tipo ? ` · ${a.tipo}` : ''}{a.tecnico ? ` · ${a.tecnico}` : ''}
                            </Text>
                          </div>
                        </Group>
                        <Group gap={4} wrap="nowrap">
                          <Tooltip label="Completar (registrar mantenimiento)">
                            <ActionIcon variant="light" color="green" size="sm" onClick={() => setCompletarAgenda(a)}>
                              <IconCheck size={14} />
                            </ActionIcon>
                          </Tooltip>
                          <Tooltip label="Cancelar agenda">
                            <ActionIcon variant="light" color="red" size="sm" onClick={() => setCancelarAgenda(a)}>
                              <IconX size={14} />
                            </ActionIcon>
                          </Tooltip>
                          {onNavigateVehiculo && (
                            <Tooltip label="Ver vehículo">
                              <ActionIcon variant="subtle" color="gray" size="sm" onClick={() => onNavigateVehiculo(a.vehiculo_id)}>
                                <IconChevronRight size={14} />
                              </ActionIcon>
                            </Tooltip>
                          )}
                        </Group>
                      </Group>
                    )
                  })}
                </Stack>
              )}
            </Card>
          </Grid.Col>
      </Grid>

      {/* ── Detalle del día ── */}
      {/* ── Documentos que vencen en el mes visible ── */}
      <Card withBorder padding="lg" radius="md">
        <Group justify="space-between" align="center" mb="sm" wrap="nowrap">
          <Group gap={8} wrap="nowrap">
            <ThemeIcon color="cyan" variant="light" size="sm" radius="sm">
              <IconFileCertificate size={14} />
            </ThemeIcon>
            <Text fw={600} tt="capitalize">Documentos que vencen en {nombreMes(mesVisible)}</Text>
            <Badge size="xs" variant="light" color="cyan" circle>{vencimientosMes.length}</Badge>
          </Group>
        </Group>
        {loadingActividad ? (
          <Center py="md"><Loader size="sm" /></Center>
        ) : vencimientosMes.length === 0 ? (
          <Text c="dimmed" size="sm">
            Ningún seguro, permiso, tenencia ni licencia vence este mes.
          </Text>
        ) : (
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="xs">
            {vencimientosMes.map(v => {
              const meta = VENCIMIENTO_META[v.tipo]
              const urg  = urgencia(v.fecha_expiracion)
              return (
                <Card
                  key={v.key} withBorder padding="xs" radius="sm"
                  style={{
                    borderLeft: `3px solid var(--mantine-color-${meta.color}-6)`,
                    cursor: 'pointer',
                  }}
                  onClick={() => abrirDia(v.fecha_expiracion)}
                >
                  <Group justify="space-between" wrap="nowrap" align="flex-start" gap="xs">
                    <div style={{ minWidth: 0 }}>
                      <Group gap={6} wrap="nowrap">
                        <Badge size="xs" variant="light" color={meta.color}>{meta.label}</Badge>
                        <Text size="sm" fw={500} truncate>{v.titulo}</Text>
                      </Group>
                      <Text size="xs" c="dimmed" truncate>{v.detalle}</Text>
                    </div>
                    <Stack gap={0} align="flex-end" style={{ flexShrink: 0 }}>
                      <Text size="xs" fw={600}>{fmtFecha(v.fecha_expiracion)}</Text>
                      <Text size="xs" c={urg.color === 'gray' ? 'dimmed' : urg.color}>{urg.texto}</Text>
                    </Stack>
                  </Group>
                </Card>
              )
            })}
          </SimpleGrid>
        )}
      </Card>

      <DiaDetalleDrawer
        fecha={selectedDate}
        agendasDelDia={agendasDelDia}
        onClose={() => setSelectedDate(null)}
        onSelectFecha={abrirDia}
        onNavigateVehiculo={onNavigateVehiculo}
        onVerMantenimiento={(id) => { setSelectedDate(null); setDetalleId(id) }}
      />

      {/* ── Vehículos vencidos / por vencer ── */}
      <Modal
        opened={alertaAbierta !== null}
        onClose={() => setAlertaAbierta(null)}
        title={alertaAbierta === 'vencidos' ? 'Vehículos con requerimientos vencidos' : 'Vehículos con requerimientos por vencer'}
        size="md"
      >
        {vehiculosAlerta.length === 0 ? (
          <Text c="dimmed" size="sm">Nada que mostrar.</Text>
        ) : (
          <Stack gap="xs">
            {vehiculosAlerta.map(v => (
              <Card key={v.vehiculo_id} withBorder padding="sm" radius="sm">
                <Group justify="space-between" wrap="nowrap" align="flex-start">
                  <div>
                    {onNavigateVehiculo ? (
                      <Text
                        component="button" size="sm" fw={500} c="blue"
                        style={{
                          cursor: 'pointer', background: 'none', border: 'none', padding: 0,
                          textDecoration: 'underline', textUnderlineOffset: 2,
                        }}
                        onClick={() => { setAlertaAbierta(null); onNavigateVehiculo(v.vehiculo_id) }}
                      >
                        {v.vehiculo_nombre}
                      </Text>
                    ) : (
                      <Text size="sm" fw={500}>{v.vehiculo_nombre}</Text>
                    )}
                    <Text size="xs" c="dimmed">
                      {v.requerimientos.map(r => r.nombre).join(', ')}
                    </Text>
                  </div>
                  <Badge color={alertaAbierta === 'vencidos' ? 'red' : 'yellow'} variant="light">
                    {v.requerimientos.length}
                  </Badge>
                </Group>
              </Card>
            ))}
          </Stack>
        )}
      </Modal>

      {/* ── Agendar mantenimiento ── */}
      <Modal
        opened={agendarOpen}
        onClose={cerrarAgendar}
        title={agendarVehiculo === null ? 'Agendar mantenimiento' : `Agendar — ${vehiculoLabel(agendarVehiculo)}`}
        size={agendarVehiculo === null ? 'lg' : 'md'}
        closeOnClickOutside={false}
      >
        {agendarVehiculo === null ? (
          <Stack gap="sm">
            <Select
              label="Vehículo"
              placeholder="Escribe la marca, modelo, serie o placas…"
              data={vehiculoOpts}
              searchable
              searchValue={vehiculoSearch}
              onSearchChange={setVehiculoSearch}
              rightSection={loadingVehiculos ? <Loader size="xs" /> : undefined}
              nothingFoundMessage={loadingVehiculos ? 'Buscando…' : 'Sin resultados'}
              onChange={seleccionarVehiculoAgenda}
              maxDropdownHeight={360}
              renderOption={({ option }) => {
                const o = option as unknown as VehiculoOptionData
                return (
                  <Group justify="space-between" wrap="nowrap" gap="md" w="100%">
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <Text size="sm" fw={500} truncate>{o.label}</Text>
                      <Text size="xs" c="dimmed" truncate>{o.ubicacion}</Text>
                    </div>
                    <Group gap={6} wrap="nowrap" justify="flex-end" style={{ minWidth: 56 }}>
                      {o.vencidos > 0 && (
                        <Badge size="sm" color="red" variant="filled" circle>{o.vencidos}</Badge>
                      )}
                      {o.porVencer > 0 && (
                        <Badge size="sm" color="yellow" variant="filled" circle>{o.porVencer}</Badge>
                      )}
                    </Group>
                  </Group>
                )
              }}
            />
          </Stack>
        ) : (
          <Stack gap="xs">
            <Button
              variant="subtle" size="xs" color="gray" leftSection={<IconArrowLeft size={14} />}
              onClick={() => setAgendarVehiculo(null)}
              style={{ alignSelf: 'flex-start' }}
            >
              Cambiar vehículo
            </Button>
            {agendarVehiculo ? (
              <AgendaForm
                vehiculo={agendarVehiculo}
                isPending={createAgendaMut.isPending}
                error={createAgendaMut.error ? (createAgendaMut.error as Error).message : null}
                onSubmit={handleAgendarSubmit}
                onCancel={cerrarAgendar}
              />
            ) : (
              <Center py="md"><Loader size="sm" /></Center>
            )}
          </Stack>
        )}
      </Modal>

      {/* ── Completar agenda (registrar el mantenimiento real) ── */}
      <Modal
        opened={completarAgenda !== null}
        onClose={() => setCompletarAgenda(null)}
        title={completarAgenda ? `Completar mantenimiento — ${completarAgenda.vehiculo_nombre}` : ''}
        size="md"
        closeOnClickOutside={false}
      >
        {completarAgenda && (
          <Stack gap="sm">
            <Alert color="blue" variant="light">
              Agendado del {fmtFecha(completarAgenda.fecha_inicio)} al {fmtFecha(completarAgenda.fecha_fin)}
              {completarAgenda.tipo ? ` · ${completarAgenda.tipo}` : ''}
              {completarAgenda.tecnico ? ` · ${completarAgenda.tecnico}` : ''}
            </Alert>
            <MantenimientoForm
              vehiculoId={completarAgenda.vehiculo_id}
              tipoVehiculo={completarAgenda.vehiculo_tipo as TipoVehiculo}
              prefillPendienteIds={completarAgenda.pendiente_ids}
              isPending={completarMut.isPending || piezasMut.isPending}
              error={completarMut.error ? (completarMut.error as Error).message : null}
              onSubmit={handleCompletarSubmit}
              onCancel={() => setCompletarAgenda(null)}
            />
          </Stack>
        )}
      </Modal>

      {/* ── Confirmar cancelación de agenda ── */}
      <Modal
        opened={cancelarAgenda !== null}
        onClose={() => setCancelarAgenda(null)}
        title="Cancelar agenda" size="sm"
      >
        <Stack gap="md">
          <Text>
            ¿Cancelar el mantenimiento agendado para <strong>{cancelarAgenda?.vehiculo_nombre}</strong>{' '}
            del {cancelarAgenda ? fmtFecha(cancelarAgenda.fecha_inicio) : ''} al {cancelarAgenda ? fmtFecha(cancelarAgenda.fecha_fin) : ''}?
          </Text>
          {cancelarMut.error && <Alert color="red" title="Error">{(cancelarMut.error as Error).message}</Alert>}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setCancelarAgenda(null)} disabled={cancelarMut.isPending}>
              Volver
            </Button>
            <Button
              color="red" loading={cancelarMut.isPending}
              onClick={() => cancelarAgenda && cancelarMut.mutate(cancelarAgenda.id, { onSuccess: () => setCancelarAgenda(null) })}
            >
              Cancelar agenda
            </Button>
          </Group>
        </Stack>
      </Modal>

      <MantenimientoDetalleDrawer
        mantenimientoId={detalleId}
        onClose={() => setDetalleId(null)}
      />
    </Stack>
  )
}
