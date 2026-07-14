// Página Calendario: vista mensual con los mantenimientos realizados (azul)
// y las agendas programadas (naranja, marcando traslapes), alertas de
// requerimientos vencidos y por vencer, y el flujo de agendar un
// mantenimiento futuro para cualquier vehículo (que al completarse genera el
// mantenimiento real).
import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import {
  Stack, Text, Card, Group, Badge, Center, Loader, ActionIcon, Modal, SimpleGrid, ThemeIcon, Grid, Divider,
  Button, Select, MultiSelect, Alert, TextInput, Textarea, Tooltip,
} from '@mantine/core'
import { Calendar, DateInput } from '@mantine/dates'
import { useForm } from '@mantine/form'
import { useDebouncedValue } from '@mantine/hooks'
import {
  IconChevronRight, IconAlertTriangle, IconCalendarEvent, IconPlus, IconArrowLeft, IconCheck, IconX,
} from '@tabler/icons-react'
import {
  useMantenimientosCalendario, useRequerimientosVencidos, useRequerimientosPorVencer,
  type RequerimientoVencido, type MantenimientoCalendario,
} from '../hooks/useDashboard'
import {
  useAgendasCalendario, useCreateAgenda, useCancelarAgenda, useCompletarAgenda,
  type AgendaConVehiculo,
} from '../hooks/useAgendasMantenimiento'
import { useRequerimientos, useCreateRequerimiento } from '../hooks/useRequerimientos'
import type { RequerimientoPayload } from '../hooks/useRequerimientos'
import { TIPO_COLORS, TIPO_LABELS } from '../lib/tipoVehiculo'
import MantenimientoDetalleDrawer from '../components/MantenimientoDetalleDrawer'
import { MantenimientoForm, RequerimientoForm } from './Vehiculos'
import { useVehiculos, vehiculoLabel } from '../hooks/useVehiculos'
import type { TipoVehiculo, VehiculoRow } from '../hooks/useVehiculos'
import { useMantenimientos } from '../hooks/useMantenimientos'
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

function toDateLocal(iso: string): Date | null {
  return iso ? new Date(`${iso}T12:00:00`) : null
}
// Acepta Date o string porque Mantine DateInput puede entregar cualquiera de los dos en runtime
function fromDateLocal(d: Date | string | null): string {
  if (!d) return ''
  const nd = d instanceof Date ? d : new Date(d)
  if (isNaN(nd.getTime())) return ''
  const safe = new Date(nd.getTime() + 12 * 60 * 60 * 1000)
  return `${safe.getUTCFullYear()}-${String(safe.getUTCMonth() + 1).padStart(2, '0')}-${String(safe.getUTCDate()).padStart(2, '0')}`
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

// Entre más eventos caen el mismo día, más opaco se pinta el color del cuadro.
const TRASLAPE_RGB   = '253, 126, 20' // mantine orange-6 (agendas traslapadas)
const REALIZADO_RGB  = '34, 139, 230' // mantine blue-6 (mantenimientos realizados)
function overlapAlpha(count: number): number {
  return Math.min(0.28 + (count - 1) * 0.18, 0.95)
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

// ─── Formulario para agendar (sin datos que solo se conocen al completar) ─────

type AgendaFormVals = {
  fecha_inicio:      string
  fecha_fin:         string
  tipo:              string
  tecnico:           string
  observaciones:     string
  requerimiento_ids: string[]
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
  const { data: reqData } = useRequerimientos(vehiculoId)
  const { data: mantData } = useMantenimientos(vehiculoId)
  const lastMant = mantData?.data?.[0] ?? null
  const createReqMut = useCreateRequerimiento(vehiculoId)
  const [nuevoReqOpen, setNuevoReqOpen]   = useState(false)
  const [nuevoReqError, setNuevoReqError] = useState<string | null>(null)

  const reqOptions = (reqData?.data ?? [])
    .filter(r => r.status === 'activo')
    .map(r => ({ value: String(r.id), label: r.nombre }))

  const form = useForm<AgendaFormVals>({
    initialValues: { fecha_inicio: '', fecha_fin: '', tipo: '', tecnico: '', observaciones: '', requerimiento_ids: [] },
    validate: {
      fecha_inicio: (v) => !v ? 'Requerido' : null,
      fecha_fin:    (v, vals) => !v ? 'Requerido' : v < vals.fecha_inicio ? 'No puede ser antes del inicio' : null,
    },
  })

  function handleCrearRequerimiento(payload: RequerimientoPayload) {
    setNuevoReqError(null)
    createReqMut.mutate(payload, {
      onSuccess: (res) => {
        form.setFieldValue('requerimiento_ids', [...form.values.requerimiento_ids, String(res.data.id)])
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
            <DateInput
              label="Inicio" required placeholder="dd/mm/aaaa" valueFormat="DD/MM/YYYY"
              value={toDateLocal(form.values.fecha_inicio)}
              onChange={(d) => form.setFieldValue('fecha_inicio', fromDateLocal(d as Date | null))}
              error={form.errors.fecha_inicio as string}
            />
          </Grid.Col>
          <Grid.Col span={6}>
            <DateInput
              label="Fin" required placeholder="dd/mm/aaaa" valueFormat="DD/MM/YYYY"
              minDate={toDateLocal(form.values.fecha_inicio) ?? undefined}
              value={toDateLocal(form.values.fecha_fin)}
              onChange={(d) => form.setFieldValue('fecha_fin', fromDateLocal(d as Date | null))}
              error={form.errors.fecha_fin as string}
            />
          </Grid.Col>
        </Grid>
        <TextInput label="Tipo" placeholder="Preventivo, Correctivo… (opcional)" {...form.getInputProps('tipo')} />
        <TextInput label="Técnico" placeholder="Nombre del técnico (opcional)" {...form.getInputProps('tecnico')} />
        <div>
          <MultiSelect
            label="Requerimiento(s) que se busca resolver"
            description="Opcional — deja vacío si el motivo es solo tiempo o una revisión general"
            placeholder={reqOptions.length ? 'Selecciona los requerimientos…' : 'Sin requerimientos activos'}
            data={reqOptions}
            searchable
            clearable
            {...form.getInputProps('requerimiento_ids')}
          />
          <Button
            variant="subtle" size="xs" mt={4} leftSection={<IconPlus size={14} />}
            onClick={() => setNuevoReqOpen(true)}
          >
            Crear nuevo requerimiento
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
    </form>
  )
}

export default function Calendario({
  onNavigateVehiculo,
}: {
  onNavigateVehiculo?: (vehiculoId: number) => void
}) {
  const { data: mantData, isLoading } = useMantenimientosCalendario()
  const { data: agendasData } = useAgendasCalendario()
  const { data: vencidosData } = useRequerimientosVencidos()
  const { data: porVencerData } = useRequerimientosPorVencer()
  const [detalleId, setDetalleId] = useState<number | null>(null)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [alertaAbierta, setAlertaAbierta] = useState<'vencidos' | 'porVencer' | null>(null)
  const [cancelarAgenda, setCancelarAgenda] = useState<AgendaConVehiculo | null>(null)
  const [completarAgenda, setCompletarAgenda] = useState<AgendaConVehiculo | null>(null)

  // Memorizados para que conserven identidad entre renders: varios useMemo
  // de abajo dependen de ellos y se recalcularían en cada render si fueran
  // expresiones nuevas (`x?.data ?? []` crea un array distinto cada vez).
  const mantenimientos = useMemo(() => mantData?.data ?? [], [mantData])
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
      tipo:              vals.tipo.trim()          || null,
      tecnico:           vals.tecnico.trim()       || null,
      observaciones:     vals.observaciones.trim() || null,
      requerimiento_ids: vals.requerimiento_ids.map(Number),
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
              `El mantenimiento se registró, pero no se pudieron guardar todas las piezas: ${e.message}\n\n` +
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

  // Cuenta cuántos mantenimientos se realizaron cada día, para graduar la
  // opacidad del azul igual que se hace con el naranja de las agendas.
  const mantenimientoCountPorDia = useMemo(() => {
    const map = new Map<string, number>()
    for (const m of mantenimientos) {
      const d = m.fecha.split('T')[0]
      map.set(d, (map.get(d) ?? 0) + 1)
    }
    return map
  }, [mantenimientos])

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

  const mantenimientosDelDia = useMemo(() => {
    if (!selectedDate) return [] as MantenimientoCalendario[]
    return mantenimientos
      .filter(m => m.fecha.split('T')[0] === selectedDate)
      .sort((a, b) => a.vehiculo_nombre.localeCompare(b.vehiculo_nombre))
  }, [mantenimientos, selectedDate])

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

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end">
        <div>
          <Text size="xl" fw={600}>Calendario</Text>
          <Text size="sm" c="dimmed">Fechas de mantenimiento de toda la flotilla</Text>
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

      {isLoading ? (
        <Center py="xl"><Loader /></Center>
      ) : (
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
                    getDayProps={(dateStr) => {
                      const enRango       = fechasConAgenda.has(dateStr)
                      const mantCount     = mantenimientoCountPorDia.get(dateStr) ?? 0
                      const realizado     = mantCount > 0
                      const clickable     = enRango || realizado
                      const agendaCount   = agendaCountPorDia.get(dateStr) ?? 0
                      const traslape      = agendaCount > 1
                      const titulo = realizado
                        ? `${mantCount} mantenimiento${mantCount !== 1 ? 's' : ''} este día`
                        : traslape ? `${agendaCount} vehículos agendados este día` : undefined
                      return {
                        inRange:      enRango,
                        firstInRange: enRango && !fechasConAgenda.has(addDaysIso(dateStr, -1)),
                        lastInRange:  enRango && !fechasConAgenda.has(addDaysIso(dateStr, 1)),
                        onClick: clickable ? () => setSelectedDate(dateStr) : undefined,
                        title:   titulo,
                        style: {
                          cursor: clickable ? 'pointer' : 'default',
                          // A más eventos el mismo día, más opaco el color del cuadro.
                          ...(mantCount > 1
                            ? { backgroundColor: `rgba(${REALIZADO_RGB}, ${overlapAlpha(mantCount)})`, color: 'var(--mantine-color-white)' }
                            : realizado
                              ? { backgroundColor: 'var(--mantine-color-blue-1)', border: '1px solid var(--mantine-color-blue-4)' }
                              : traslape ? { backgroundColor: `rgba(${TRASLAPE_RGB}, ${overlapAlpha(agendaCount)})` } : {}),
                        },
                      }
                    }}
                  />
                </div>
              </Center>
              <Divider my="sm" />
              <Group gap="lg" justify="center">
                <Group gap={6}>
                  <span style={{ width: 22, height: 14, borderRadius: 4, backgroundColor: 'var(--mantine-color-blue-1)', border: '1px solid var(--mantine-color-blue-4)', display: 'inline-block' }} />
                  <Text size="xs" c="dimmed">Realizado</Text>
                </Group>
                <Group gap={6}>
                  <span style={{ width: 22, height: 14, borderRadius: 4, backgroundColor: 'var(--mantine-color-orange-1)', border: '1px solid var(--mantine-color-orange-4)', display: 'inline-block' }} />
                  <Text size="xs" c="dimmed">Agendado (rango)</Text>
                </Group>
                <Group gap={6}>
                  <span style={{ width: 22, height: 14, borderRadius: 4, backgroundColor: `rgba(${TRASLAPE_RGB}, ${overlapAlpha(4)})`, display: 'inline-block' }} />
                  <Text size="xs" c="dimmed">Traslape</Text>
                </Group>
              </Group>
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
      )}

      {/* ── Detalle del día ── */}
      <Modal
        opened={selectedDate !== null}
        onClose={() => setSelectedDate(null)}
        title={selectedDate ? `Actividad del ${fmtFecha(selectedDate)}` : ''}
        size="md"
      >
        <Stack gap="md">
          {agendasDelDia.length > 0 && (
            <div>
              <Text size="xs" fw={600} c="dimmed" tt="uppercase" mb={4}>
                Agendado{agendasDelDia.length > 1 ? ` (${agendasDelDia.length})` : ''}
              </Text>
              {agendasDelDia.length > 1 && (
                <Alert color="red" variant="light" mb="xs" icon={<IconAlertTriangle size={16} />}>
                  {agendasDelDia.length} vehículos agendados el mismo día — revisa disponibilidad de técnicos y refacciones.
                </Alert>
              )}
              <Stack gap="xs">
                {agendasDelDia.map(a => (
                  <Card key={a.id} withBorder padding="sm" radius="sm">
                    <Group justify="space-between" wrap="nowrap">
                      <Group gap={6} wrap="nowrap">
                        <Badge size="xs" variant="light" color={TIPO_COLORS[a.vehiculo_tipo] ?? 'gray'}>
                          {TIPO_LABELS[a.vehiculo_tipo] ?? a.vehiculo_tipo}
                        </Badge>
                        <Text size="sm" fw={500}>{a.vehiculo_nombre}</Text>
                      </Group>
                      <Text size="sm" c="dimmed">{a.tipo ?? '—'}</Text>
                    </Group>
                  </Card>
                ))}
              </Stack>
            </div>
          )}
          {mantenimientosDelDia.length > 0 && (
            <div>
              <Text size="xs" fw={600} c="dimmed" tt="uppercase" mb={4}>Realizado</Text>
              <Stack gap="xs">
                {mantenimientosDelDia.map(m => (
                  <Card
                    key={m.id} withBorder padding="sm" radius="sm"
                    style={{ cursor: 'pointer' }}
                    onClick={() => { setSelectedDate(null); setDetalleId(m.id) }}
                  >
                    <Group justify="space-between" wrap="nowrap">
                      <Group gap={6} wrap="nowrap">
                        <Badge size="xs" variant="light" color={TIPO_COLORS[m.vehiculo_tipo] ?? 'gray'}>
                          {TIPO_LABELS[m.vehiculo_tipo] ?? m.vehiculo_tipo}
                        </Badge>
                        <Text size="sm" fw={500}>{m.vehiculo_nombre}</Text>
                      </Group>
                      <Text size="sm" c="dimmed">{m.tipo ?? '—'}</Text>
                    </Group>
                  </Card>
                ))}
              </Stack>
            </div>
          )}
          {agendasDelDia.length === 0 && mantenimientosDelDia.length === 0 && (
            <Text c="dimmed" size="sm">Sin actividad este día.</Text>
          )}
        </Stack>
      </Modal>

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
              prefillRequerimientoIds={completarAgenda.requerimiento_ids}
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
