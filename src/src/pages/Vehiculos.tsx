// Página Vehículos: administración de la flota. La vista de lista agrupa por
// ubicación (rutas / sucursales / unitarios) y tipo, con búsqueda paginada,
// edición rápida de kilometraje, alta/edición/baja y reporte PDF del
// inventario. La vista de detalle de un vehículo concentra sus datos, sus
// mantenimientos realizados y sus requerimientos (recurrentes y únicos).
// Exporta también MantenimientoForm y RequerimientoForm, reutilizados por el
// Calendario.
import { useState, useEffect, useMemo, useRef } from 'react'
import {
  Stack, Group, Text, TextInput, Textarea, Table, Badge,
  Pagination, Loader, Center, Alert, Button, Select, MultiSelect,
  Modal, ActionIcon, Tooltip, NumberInput,
  Divider, Grid, Paper, SegmentedControl, Accordion, Drawer,
} from '@mantine/core'
import { useForm } from '@mantine/form'
import { useDebouncedValue } from '@mantine/hooks'
import { IconPencil, IconTrash, IconPlus, IconArrowLeft, IconChevronRight, IconAlertTriangle, IconFileTypePdf } from '@tabler/icons-react'
import {
  useVehiculos, useVehiculo, useCreateVehiculo, useUpdateVehiculo, useDeleteVehiculo, vehiculoLabel,
  fetchTodosLosVehiculos,
} from '../hooks/useVehiculos'
import { useSucursales } from '../hooks/useSucursales'
import type { Sucursal } from '../hooks/useSucursales'
import { exportVehiculosReporteToPdf } from '../lib/exportVehiculosReporte'
import {
  TEXTO_SIMPLE, TEXTO_LIBRE, limpiarTextoSimple, limpiarTextoLibre,
} from '../lib/validaciones'
import {
  useMantenimientos, useCreateMantenimiento, useUpdateMantenimiento, useDeleteMantenimiento,
} from '../hooks/useMantenimientos'
import type { Mantenimiento, MantenimientoPayload } from '../hooks/useMantenimientos'
import { DateInput } from '@mantine/dates'
import {
  useRequerimientos, useCreateRequerimiento, useUpdateRequerimiento, useDeleteRequerimiento,
  useRequerimientoCategorias,
} from '../hooks/useRequerimientos'
import type { TipoVehiculo, VehiculoRow, VehiculoCreatePayload, VehiculoUpdatePayload } from '../hooks/useVehiculos'
import type { RequerimientoExclusivo, RequerimientoPayload, TriggerMode, TipoReq, StatusReq } from '../hooks/useRequerimientos'
import { VehiculoForm } from '../components/VehiculoForm'
import MantenimientoDetalleDrawer from '../components/MantenimientoDetalleDrawer'
import RecargasSection from '../components/RecargasSection'
import { useLotesDisponibles } from '../hooks/useLotesDisponibles'
import { usePiezasVehiculo, useSetPiezaVehiculo, useRemovePiezaVehiculo } from '../hooks/usePiezasVehiculo'
import { useAddTiposPiezaVehiculo, useRemoveTipoPiezaVehiculo } from '../hooks/useTiposPiezaVehiculo'
import { useTiposPieza } from '../hooks/useTiposPieza'
import { useTodasLasPiezas } from '../hooks/useRefacciones'
import { useTecnicos } from '../hooks/useTecnicos'
import { useCreateDetallesMtto } from '../hooks/useDetalleMtto'
import type { DetalleMttoPayload } from '../hooks/useDetalleMtto'

// ── Constantes ────────────────────────────────────────────────────────────────

const TIPOS: { value: TipoVehiculo; label: string; color: string }[] = [
  { value: 'camion',       label: 'Unidad de reparto', color: 'blue'   },
  { value: 'tractocamion', label: 'Tractocamión',      color: 'violet' },
  { value: 'caja_trailer', label: 'Caja de trailer',   color: 'orange' },
  { value: 'utilitario',   label: 'Vehículo utilitario', color: 'teal'   },
  { value: 'montacargas',  label: 'Montacargas',       color: 'yellow' },
]

function sinKilometraje(tipo: TipoVehiculo): boolean {
  return tipo === 'caja_trailer' || tipo === 'montacargas'
}

const TRIGGER_META: Record<TriggerMode, { label: string; color: string }> = {
  km:    { label: 'Kilometraje', color: 'blue'   },
  meses: { label: 'Tiempo',      color: 'green'  },
  ambos: { label: 'Km + tiempo', color: 'orange' },
}

const TIPO_META: Record<TipoReq, { label: string; color: string }> = {
  recurrente: { label: 'Recurrente', color: 'indigo' },
  unica:      { label: 'Única',      color: 'cyan'   },
}

const STATUS_META: Record<StatusReq, { label: string; color: string }> = {
  activo:     { label: 'Activo',      color: 'blue'  },
  completado: { label: 'Completado',  color: 'green' },
  pausado:    { label: 'Pausado',     color: 'yellow' },
  cancelado:  { label: 'Cancelado',   color: 'red'    },
}

function tipoInfo(t: TipoVehiculo) {
  return TIPOS.find((x) => x.value === t)!
}

function statusColor(s: string) {
  const v = s.toLowerCase()
  if (v === 'activo')   return 'green'
  if (v === 'inactivo') return 'red'
  if (v === 'taller')   return 'orange'
  return 'gray'
}

// El intervalo por tiempo puede medirse en días o meses (según la unidad
// elegida), para requerimientos recurrentes o únicos.
function usaDias(unidad: 'dias' | 'meses') {
  return unidad === 'dias'
}

function fmtIntervalo(item: RequerimientoExclusivo) {
  const parts: string[] = []
  if (item.intervalo_km)    parts.push(`${item.intervalo_km.toLocaleString('es-MX')} km`)
  if (item.intervalo_meses) parts.push(`${item.intervalo_meses} mes${item.intervalo_meses !== 1 ? 'es' : ''}`)
  if (item.intervalo_dias)  parts.push(`${item.intervalo_dias} día${item.intervalo_dias !== 1 ? 's' : ''}`)
  return parts.join(' / ') || '—'
}

// ── Formulario de requerimiento ───────────────────────────────────────────────

function fmtShort(iso: string | null | undefined) {
  if (!iso) return null
  return new Date(`${iso.split('T')[0]}T12:00:00`).toLocaleDateString('es-MX', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

function formatMXN(n: number) {
  return n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })
}

function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Un mantenimiento programado a futuro todavía no cuenta como referencia/cumplimiento:
// solo se toma en cuenta una vez que su fecha llega a hoy (o ya pasó).
function linkedMantenimiento(requerimientoId: number, mantenimientos: Mantenimiento[]): Mantenimiento | undefined {
  const hoy = todayIso()
  return mantenimientos.find(
    m => m.requerimiento_ids.includes(requerimientoId) && m.fecha && m.fecha.split('T')[0] <= hoy
  )
}

export function RequerimientoForm({
  initial, isPending, error, onSubmit, onCancel, vehiculo, lastMant,
}: {
  initial?:   RequerimientoExclusivo
  isPending:  boolean
  error:      string | null
  onSubmit:   (p: RequerimientoPayload) => void
  onCancel:   () => void
  vehiculo?:  VehiculoRow
  lastMant?:  Mantenimiento | null
}) {
  const isEdit    = !!initial
  const soloTiempo = vehiculo?.tipo === 'montacargas'
  const form = useForm({
    initialValues: {
      nombre:          initial?.nombre ?? '',
      descripcion:     initial?.descripcion ?? '',
      categoria:       initial?.categoria ?? '',
      trigger_mode:    (initial?.trigger_mode ?? (soloTiempo ? 'meses' : 'ambos')) as TriggerMode,
      tipo:            (initial?.tipo ?? 'recurrente') as TipoReq,
      intervalo_km:     initial?.intervalo_km ?? (null as number | null),
      // Un solo campo numérico para el intervalo por tiempo; la unidad decide si
      // se guarda como días o meses. Se inicializa con el que venga poblado.
      intervalo_tiempo: (initial?.intervalo_dias ?? initial?.intervalo_meses) ?? (null as number | null),
      unidad_tiempo:    (initial?.intervalo_dias != null ? 'dias' : 'meses') as 'dias' | 'meses',
      status:          (initial?.status ?? 'activo') as StatusReq,
      fecha_reporte:   initial?.fecha_reporte?.split('T')[0] ?? todayIso(),
      desde:           'ahora' as 'ahora' | 'ultimo',
    },
    validate: {
      nombre: (v) =>
        !v.trim() ? 'Requerido' :
        v.length > 40 ? 'Máximo 40 caracteres' :
        !TEXTO_SIMPLE.test(v.trim()) ? 'Solo letras, números, espacios y guiones' : null,
      descripcion: (v) =>
        !v || !v.trim() ? 'Requerido' :
        v.length > 255 ? 'Máximo 255 caracteres' :
        !TEXTO_LIBRE.test(v.trim()) ? 'Contiene caracteres no permitidos' : null,
      categoria: (v) =>
        !v || !v.trim() ? 'Requerido' :
        v.length > 30 ? 'Máximo 30 caracteres' :
        !TEXTO_SIMPLE.test(v.trim()) ? 'Solo letras, números, espacios y guiones' : null,
      fecha_reporte: (v) => !v ? 'Requerido' : null,
      intervalo_km: (v, vals) =>
        (vals.trigger_mode === 'km' || vals.trigger_mode === 'ambos') && !v ? 'Requerido' : null,
      intervalo_tiempo: (v, vals) =>
        (vals.trigger_mode === 'meses' || vals.trigger_mode === 'ambos') && !v ? 'Requerido' : null,
    },
  })

  const mode  = form.values.trigger_mode
  const desde = form.values.desde

  // Categorías: las ya usadas en la flota, más la del requerimiento que se edita
  // (por si fue eliminada del resto) y la que el usuario esté escribiendo, que
  // se ofrece como opción para crearla.
  const { data: categoriasData } = useRequerimientoCategorias()
  const [categoriaSearch, setCategoriaSearch] = useState('')

  // Se saca de `initial` antes del useMemo: dentro, el compilador de React
  // infiere el objeto completo como dependencia y no coincide con la lista
  // manual (que solo mira la categoría), lo que le impide optimizar el hook.
  const categoriaInicial = initial?.categoria

  const categoriaOptions = useMemo(() => {
    const existentes = new Set(categoriasData?.data ?? [])
    if (categoriaInicial) existentes.add(categoriaInicial)

    const opts = [...existentes].sort((a, b) => a.localeCompare(b, 'es-MX'))
      .map((c) => ({ value: c, label: c }))

    const nueva = categoriaSearch.trim()
    const yaExiste = [...existentes].some((c) => c.toLowerCase() === nueva.toLowerCase())
    if (nueva && !yaExiste) {
      opts.unshift({ value: nueva, label: `+ Crear categoría "${nueva}"` })
    }
    return opts
  }, [categoriasData, categoriaInicial, categoriaSearch])

  // Baseline preview
  const baselineKm   = desde === 'ahora' ? (vehiculo?.kilometraje ?? null)  : (lastMant?.km_actual  ?? null)
  const baselineDate = desde === 'ahora' ? todayIso()
    : lastMant?.fecha?.split('T')[0] ?? vehiculo?.fecha_compra?.split('T')[0] ?? null

  function handleSubmit(vals: typeof form.values) {
    let fecha_inicio: string | null
    let km_inicio: number | null

    if (!isEdit) {
      // Siempre se guarda un baseline como registro, aunque después no se use.
      // Si se pide "último mantenimiento" y sí lo hay, se toma de ahí; en
      // cualquier otro caso se usan los datos actuales del vehículo (hoy + km).
      if (vals.desde === 'ultimo' && lastMant) {
        fecha_inicio = lastMant.fecha?.split('T')[0] ?? null
        km_inicio    = lastMant.km_actual ?? null
      } else {
        fecha_inicio = todayIso()
        km_inicio    = vehiculo?.kilometraje ?? null
      }
    } else {
      // Al editar no se recalcula: se conserva el baseline con el que se creó.
      fecha_inicio = initial!.fecha_inicio?.split('T')[0] ?? null
      km_inicio    = initial!.km_inicio ?? null
    }

    const time  = mode === 'meses' || mode === 'ambos'
    const dias  = usaDias(vals.unidad_tiempo)

    onSubmit({
      nombre:          vals.nombre.trim(),
      descripcion:     vals.descripcion.trim(),
      categoria:       vals.categoria?.trim()    || null,
      trigger_mode:    vals.trigger_mode,
      tipo:            vals.tipo,
      intervalo_km:    (mode === 'km'    || mode === 'ambos') ? vals.intervalo_km : null,
      intervalo_meses: (time && !dias) ? vals.intervalo_tiempo : null,
      intervalo_dias:  (time &&  dias) ? vals.intervalo_tiempo : null,
      status:          vals.status,
      fecha_inicio,
      km_inicio,
      fecha_reporte:   vals.fecha_reporte || null,
    })
  }

  return (
    <form onSubmit={form.onSubmit(handleSubmit)}>
      <Stack gap="sm">
        <TextInput
          label="Nombre" placeholder="Ej. Cambio de filtro de aceite" required
          maxLength={40}
          {...form.getInputProps('nombre')}
          onChange={(e) => form.setFieldValue('nombre', limpiarTextoSimple(e.currentTarget.value, 40))}
        />
        <Textarea
          label="Descripción" required autosize minRows={2}
          maxLength={255}
          {...form.getInputProps('descripcion')}
          onChange={(e) => form.setFieldValue('descripcion', limpiarTextoLibre(e.currentTarget.value, 255))}
        />
        <Select
          label="Categoría" required
          placeholder="Selecciona o escribe para crear una categoría"
          data={categoriaOptions}
          searchable
          onSearchChange={(v) => setCategoriaSearch(limpiarTextoSimple(v, 30))}
          nothingFoundMessage="Escribe para crear una nueva categoría"
          maxLength={30}
          {...form.getInputProps('categoria')}
          onChange={(v) => form.setFieldValue('categoria', v ?? '')}
        />
        <DateInput
          label="Fecha de reporte" required
          description="Cuándo se encontró/reportó el requerimiento"
          placeholder="dd/mm/aaaa" valueFormat="DD/MM/YYYY"
          maxDate={hoyIso()}
          value={form.values.fecha_reporte || null}
          onChange={(d) => form.setFieldValue('fecha_reporte', d ?? '')}
          error={form.errors.fecha_reporte as string}
        />
        <Select
          label="Tipo" required
          data={[
            { value: 'recurrente', label: 'Recurrente — se repite periódicamente' },
            { value: 'unica',      label: 'Única — se realiza una sola vez' },
          ]}
          {...form.getInputProps('tipo')}
        />
        <Select
          label="Disparador" required
          data={
            soloTiempo
              ? [{ value: 'meses', label: 'Por tiempo (meses)' }]
              : [
                  { value: 'km',    label: 'Por kilometraje' },
                  { value: 'meses', label: 'Por tiempo (meses)' },
                  { value: 'ambos', label: 'Kilometraje y tiempo' },
                ]
          }
          disabled={soloTiempo}
          description={soloTiempo ? 'Los montacargas solo dan seguimiento por tiempo.' : undefined}
          {...form.getInputProps('trigger_mode')}
        />
        {(mode === 'km' || mode === 'ambos') && (
          <NumberInput
            label="Intervalo de kilometraje" required min={1}
            suffix=" km" thousandSeparator=","
            allowDecimal={false} allowNegative={false}
            {...form.getInputProps('intervalo_km')}
          />
        )}
        {(mode === 'meses' || mode === 'ambos') && (
          <Group align="flex-end" gap="sm" grow>
            <NumberInput
              label={form.values.tipo === 'unica' ? 'Caduca en' : 'Intervalo'} required min={1}
              allowDecimal={false} allowNegative={false}
              {...form.getInputProps('intervalo_tiempo')}
            />
            <Select
              label="Unidad"
              data={[
                { value: 'dias',  label: 'Días' },
                { value: 'meses', label: 'Meses' },
              ]}
              allowDeselect={false}
              {...form.getInputProps('unidad_tiempo')}
            />
          </Group>
        )}
        <Select
          label="Status" required
          data={[
            { value: 'activo',     label: 'Activo' },
            { value: 'completado', label: 'Completado' },
            { value: 'pausado',    label: 'Pausado' },
            { value: 'cancelado',  label: 'Cancelado' },
          ]}
          {...form.getInputProps('status')}
        />

        {!isEdit && (
          <Stack gap={6}>
            <Text size="sm" fw={500}>Conteo a partir de</Text>
            <SegmentedControl
              fullWidth
              data={[
                { value: 'ahora',  label: 'Ahora' },
                { value: 'ultimo', label: 'Último mantenimiento / compra' },
              ]}
              {...form.getInputProps('desde')}
            />
            <Text size="xs" c="dimmed">
              {baselineDate
                ? <>Referencia: <strong>{fmtShort(baselineDate)}</strong>
                    {baselineKm != null && <>, <strong>{baselineKm.toLocaleString('es-MX')} km</strong></>}
                  </>
                : 'Sin fecha de referencia disponible — el vencimiento se calculará cuando se registre un mantenimiento.'}
            </Text>
          </Stack>
        )}

        {error && <Alert color="red" title="Error">{error}</Alert>}
        <Group justify="flex-end" mt="xs">
          <Button variant="default" onClick={onCancel} disabled={isPending}>Cancelar</Button>
          <Button type="submit" loading={isPending}>
            {isEdit ? 'Guardar cambios' : 'Crear requerimiento'}
          </Button>
        </Group>
      </Stack>
    </form>
  )
}

// ── Lógica de vencimiento ─────────────────────────────────────────────────────

function isOverdue(
  req:          RequerimientoExclusivo,
  vehiculo:     VehiculoRow,
  mantenimientos: Mantenimiento[],
): boolean {
  if (req.status !== 'activo') return false

  const now = new Date()

  // Solo el mantenimiento explícitamente vinculado a este requerimiento resetea su baseline
  const linkedMant = linkedMantenimiento(req.id, mantenimientos) ?? null

  const baseKm =
    linkedMant?.km_actual ??
    req.km_inicio          ??
    0

  const baseFechaStr =
    linkedMant?.fecha?.split('T')[0]     ??
    req.fecha_inicio?.split('T')[0]      ??
    vehiculo.fecha_compra?.split('T')[0] ??
    null
  const baseFecha = baseFechaStr ? new Date(`${baseFechaStr}T12:00:00`) : null

  if (req.trigger_mode === 'km' || req.trigger_mode === 'ambos') {
    if (req.intervalo_km != null && vehiculo.kilometraje != null) {
      if (vehiculo.kilometraje - baseKm >= req.intervalo_km) return true
    }
  }

  if (req.trigger_mode === 'meses' || req.trigger_mode === 'ambos') {
    if (req.intervalo_dias != null && baseFecha) {
      const days = Math.floor((now.getTime() - baseFecha.getTime()) / 86_400_000)
      if (days >= req.intervalo_dias) return true
    }
    if (req.intervalo_meses != null && baseFecha) {
      const months =
        (now.getFullYear() - baseFecha.getFullYear()) * 12 +
        (now.getMonth() - baseFecha.getMonth())
      if (months >= req.intervalo_meses) return true
    }
  }

  return false
}

function isWarning(
  req:            RequerimientoExclusivo,
  vehiculo:       VehiculoRow,
  mantenimientos: Mantenimiento[],
): boolean {
  if (req.status !== 'activo') return false
  if (isOverdue(req, vehiculo, mantenimientos)) return false

  const now        = new Date()
  const linkedMant = linkedMantenimiento(req.id, mantenimientos) ?? null

  const baseKm =
    linkedMant?.km_actual ??
    req.km_inicio          ??
    0

  const baseFechaStr =
    linkedMant?.fecha?.split('T')[0]     ??
    req.fecha_inicio?.split('T')[0]      ??
    vehiculo.fecha_compra?.split('T')[0] ??
    null
  const baseFecha = baseFechaStr ? new Date(`${baseFechaStr}T12:00:00`) : null

  if (req.trigger_mode === 'km' || req.trigger_mode === 'ambos') {
    if (req.intervalo_km != null && vehiculo.kilometraje != null) {
      const elapsed = vehiculo.kilometraje - baseKm
      if (elapsed >= req.intervalo_km * 0.75) return true
    }
  }

  if (req.trigger_mode === 'meses' || req.trigger_mode === 'ambos') {
    if (req.intervalo_dias != null && baseFecha) {
      const days = Math.floor((now.getTime() - baseFecha.getTime()) / 86_400_000)
      if (days >= req.intervalo_dias * 0.75) return true
    }
    if (req.intervalo_meses != null && baseFecha) {
      const months =
        (now.getFullYear() - baseFecha.getFullYear()) * 12 +
        (now.getMonth()    - baseFecha.getMonth())
      if (months >= req.intervalo_meses - 1) return true
    }
  }

  return false
}

// ── Sección de requerimientos ─────────────────────────────────────────────────

function RequerimientoTable({
  items, mantenimientos, overdueIds, warnIds, onOpenDetalle, onEdit, onDelete,
}: {
  items:          RequerimientoExclusivo[]
  mantenimientos: Mantenimiento[]
  overdueIds:     Set<number>
  warnIds:        Set<number>
  onOpenDetalle:  (item: RequerimientoExclusivo) => void
  onEdit:         (item: RequerimientoExclusivo) => void
  onDelete:       (item: RequerimientoExclusivo) => void
}) {
  return (
    <Table.ScrollContainer minWidth={600}>
      <Table striped highlightOnHover withTableBorder>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Nombre</Table.Th>
            <Table.Th>Categoría</Table.Th>
            <Table.Th>Tipo</Table.Th>
            <Table.Th>Disparador</Table.Th>
            <Table.Th>Intervalo</Table.Th>
            <Table.Th>Referencia</Table.Th>
            <Table.Th style={{ textAlign: 'center' }}>Status</Table.Th>
            <Table.Th style={{ width: 80 }} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {items.map((item) => {
            const overdue     = overdueIds.has(item.id)
            const warn        = !overdue && warnIds.has(item.id)
            const linked      = linkedMantenimiento(item.id, mantenimientos)
            const baseDateStr = linked?.fecha?.split('T')[0] ?? item.fecha_inicio?.split('T')[0] ?? null
            const baseKmVal   = linked?.km_actual ?? item.km_inicio ?? null
            const datePart    = fmtShort(baseDateStr) ?? '—'
            const kmPart      = baseKmVal != null ? `${baseKmVal.toLocaleString('es-MX')} km` : '—'
            const baseDisplay =
              item.trigger_mode === 'meses' ? datePart :
              item.trigger_mode === 'km'    ? kmPart :
              `${datePart} / ${kmPart}`
            return (
            <Table.Tr
              key={item.id}
              onClick={() => onOpenDetalle(item)}
              style={{
                cursor: 'pointer',
                backgroundColor:
                  overdue ? 'var(--mantine-color-red-0)'    :
                  warn    ? 'var(--mantine-color-yellow-0)' :
                  undefined,
              }}
            >
              <Table.Td fw={500}>
                <Group gap={6} wrap="nowrap">
                  {overdue && <IconAlertTriangle size={14} color="var(--mantine-color-red-6)"    />}
                  {warn    && <IconAlertTriangle size={14} color="var(--mantine-color-yellow-7)" />}
                  <span style={
                    overdue ? { color: 'var(--mantine-color-red-7)'    } :
                    warn    ? { color: 'var(--mantine-color-yellow-8)' } :
                    undefined
                  }>
                    {item.nombre}
                  </span>
                  {item.plantilla_origen_id && (
                    <Text component="span" size="xs" c="dimmed">(del modelo)</Text>
                  )}
                </Group>
              </Table.Td>
              <Table.Td>{item.categoria ?? <Text component="span" c="dimmed" size="sm">—</Text>}</Table.Td>
              <Table.Td>
                <Badge variant="light" color={TIPO_META[item.tipo].color} size="sm">
                  {TIPO_META[item.tipo].label}
                </Badge>
              </Table.Td>
              <Table.Td>
                <Badge variant="light" color={TRIGGER_META[item.trigger_mode].color} size="sm">
                  {TRIGGER_META[item.trigger_mode].label}
                </Badge>
              </Table.Td>
              <Table.Td><Text size="sm">{fmtIntervalo(item)}</Text></Table.Td>
              <Table.Td>
                <Text size="sm" c={baseDisplay === '—' ? 'dimmed' : undefined}>
                  {baseDisplay}
                </Text>
              </Table.Td>
              <Table.Td style={{ textAlign: 'center' }}>
                <Badge variant="light" color={STATUS_META[item.status].color} size="sm">
                  {STATUS_META[item.status].label}
                </Badge>
              </Table.Td>
              <Table.Td onClick={(e) => e.stopPropagation()}>
                <Group gap={4} justify="flex-end">
                  <Tooltip label="Editar">
                    <ActionIcon variant="subtle" color="blue" size="sm" onClick={() => onEdit(item)}>
                      <IconPencil size={14} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label="Eliminar">
                    <ActionIcon variant="subtle" color="red" size="sm" onClick={() => onDelete(item)}>
                      <IconTrash size={14} />
                    </ActionIcon>
                  </Tooltip>
                </Group>
              </Table.Td>
            </Table.Tr>
            )
          })}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  )
}

function UnicosSection({
  items, mantenimientos, overdueIds, warnIds, onOpenDetalle, onEdit, onDelete,
}: {
  items:          RequerimientoExclusivo[]
  mantenimientos: Mantenimiento[]
  overdueIds:     Set<number>
  warnIds:        Set<number>
  onOpenDetalle:  (item: RequerimientoExclusivo) => void
  onEdit:         (item: RequerimientoExclusivo) => void
  onDelete:       (item: RequerimientoExclusivo) => void
}) {
  const completados = items.filter(i => i.status === 'completado')
  const pendientes  = items.filter(i => i.status !== 'completado')

  function fechaReferencia(item: RequerimientoExclusivo): string | null {
    const linked = linkedMantenimiento(item.id, mantenimientos)
    return linked?.fecha ?? item.fecha_inicio ?? null
  }

  const { sinFecha, anios } = groupByYearMonth(completados, fechaReferencia)
  const anioMasReciente = anios[0]?.[0]

  return (
    <Stack gap="md">
      <div>
        <Text size="sm" fw={500} c="dimmed" mb={4}>Pendientes ({pendientes.length})</Text>
        {pendientes.length === 0 ? (
          <Text c="dimmed" size="sm">Sin requerimientos únicos pendientes.</Text>
        ) : (
          <RequerimientoTable
            items={pendientes} mantenimientos={mantenimientos}
            overdueIds={overdueIds} warnIds={warnIds}
            onOpenDetalle={onOpenDetalle} onEdit={onEdit} onDelete={onDelete}
          />
        )}
      </div>

      <div>
        <Text size="sm" fw={500} c="dimmed" mb={4}>Completados ({completados.length})</Text>
        {completados.length === 0 ? (
          <Text c="dimmed" size="sm">Sin requerimientos únicos completados.</Text>
        ) : (
          <Stack gap="sm">
            <Accordion multiple defaultValue={anioMasReciente != null ? [String(anioMasReciente)] : []} variant="separated">
              {anios.map(([anio, porMes]) => {
                const totalAnio = [...porMes.values()].reduce((s, arr) => s + arr.length, 0)
                return (
                  <Accordion.Item key={anio} value={String(anio)}>
                    <Accordion.Control>
                      <Group justify="space-between" pr="md" wrap="nowrap">
                        <Text fw={600}>{anio}</Text>
                        <Badge variant="light" color="gray">{totalAnio}</Badge>
                      </Group>
                    </Accordion.Control>
                    <Accordion.Panel>
                      <Stack gap="md">
                        {[...porMes.entries()].map(([mes, mesItems]) => (
                          <div key={mes}>
                            <Text size="sm" fw={500} c="dimmed" mb={4} tt="capitalize">{MESES[mes]}</Text>
                            <RequerimientoTable
                              items={mesItems} mantenimientos={mantenimientos}
                              overdueIds={overdueIds} warnIds={warnIds}
                              onOpenDetalle={onOpenDetalle} onEdit={onEdit} onDelete={onDelete}
                            />
                          </div>
                        ))}
                      </Stack>
                    </Accordion.Panel>
                  </Accordion.Item>
                )
              })}
            </Accordion>
            {sinFecha.length > 0 && (
              <div>
                <Text size="sm" fw={500} c="dimmed" mb={4}>Sin fecha de referencia</Text>
                <RequerimientoTable
                  items={sinFecha} mantenimientos={mantenimientos}
                  overdueIds={overdueIds} warnIds={warnIds}
                  onOpenDetalle={onOpenDetalle} onEdit={onEdit} onDelete={onDelete}
                />
              </div>
            )}
          </Stack>
        )}
      </div>
    </Stack>
  )
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('es-MX', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function RequerimientoDetalleDrawer({
  item, mantenimientos, overdueIds, warnIds, onClose, onEdit,
}: {
  item:           RequerimientoExclusivo | null
  mantenimientos: Mantenimiento[]
  overdueIds:     Set<number>
  warnIds:        Set<number>
  onClose:        () => void
  onEdit:         (item: RequerimientoExclusivo) => void
}) {
  const overdue = item ? overdueIds.has(item.id) : false
  const warn    = item ? !overdue && warnIds.has(item.id) : false

  const linked      = item ? linkedMantenimiento(item.id, mantenimientos) : undefined
  const baseDateStr = item ? (linked?.fecha?.split('T')[0] ?? item.fecha_inicio?.split('T')[0] ?? null) : null
  const baseKmVal   = item ? (linked?.km_actual ?? item.km_inicio ?? null) : null
  const referencia  = item
    ? [fmtShort(baseDateStr), baseKmVal != null ? `${baseKmVal.toLocaleString('es-MX')} km` : null]
        .filter(Boolean).join(' / ') || null
    : null

  return (
    <Drawer
      opened={item !== null}
      onClose={onClose}
      title={<Text fw={700}>Detalle del requerimiento</Text>}
      position="right"
      size="md"
      overlayProps={{ backgroundOpacity: 0.3 }}
    >
      {item && (
        <Stack gap="md">
          <Group justify="space-between" align="flex-start" wrap="nowrap">
            <Group gap={8} wrap="wrap">
              <Text size="xl" fw={700}>{item.nombre}</Text>
              <Badge variant="light" color={TIPO_META[item.tipo].color}>{TIPO_META[item.tipo].label}</Badge>
              <Badge variant="light" color={STATUS_META[item.status].color}>{STATUS_META[item.status].label}</Badge>
              {item.plantilla_origen_id && <Badge variant="light" color="grape">Requerimiento del modelo</Badge>}
            </Group>
            <Tooltip label="Editar">
              <ActionIcon variant="light" color="blue" onClick={() => onEdit(item)}>
                <IconPencil size={16} />
              </ActionIcon>
            </Tooltip>
          </Group>

          {overdue && (
            <Alert color="red" title="Vencido" icon={<IconAlertTriangle size={16} />}>
              Este requerimiento ya superó su intervalo de mantenimiento.
            </Alert>
          )}
          {warn && (
            <Alert color="yellow" title="Próximo a vencer" icon={<IconAlertTriangle size={16} />}>
              Este requerimiento está próximo a vencer.
            </Alert>
          )}

          <div>
            <Text size="xs" c="dimmed" tt="uppercase" fw={600} mb={4}>Descripción</Text>
            <Text size="sm">
              {item.descripcion ?? <Text component="span" c="dimmed">Sin descripción.</Text>}
            </Text>
          </div>

          <Grid gap="md">
            <Grid.Col span={6}><InfoItem label="Categoría" value={item.categoria} /></Grid.Col>
            <Grid.Col span={6}><InfoItem label="Disparador" value={TRIGGER_META[item.trigger_mode].label} /></Grid.Col>
            <Grid.Col span={6}><InfoItem label="Intervalo" value={fmtIntervalo(item)} /></Grid.Col>
            <Grid.Col span={6}><InfoItem label="Referencia" value={referencia} /></Grid.Col>
            <Grid.Col span={6}><InfoItem label="Fecha de inicio" value={fmtShort(item.fecha_inicio)} /></Grid.Col>
            <Grid.Col span={6}><InfoItem label="Fecha de reporte" value={fmtShort(item.fecha_reporte)} /></Grid.Col>
            <Grid.Col span={6}>
              <InfoItem
                label="Kilometraje de inicio"
                value={item.km_inicio != null ? `${item.km_inicio.toLocaleString('es-MX')} km` : null}
              />
            </Grid.Col>
            <Grid.Col span={6}><InfoItem label="Creado" value={fmtDateTime(item.created_at)} /></Grid.Col>
            <Grid.Col span={6}><InfoItem label="Última actualización" value={fmtDateTime(item.updated_at)} /></Grid.Col>
          </Grid>
        </Stack>
      )}
    </Drawer>
  )
}

function RequerimientosSection({ vehiculo, mantenimientos, overdueIds = new Set<number>(), warnIds = new Set<number>() }: {
  vehiculo:       VehiculoRow
  mantenimientos: Mantenimiento[]
  overdueIds?:    Set<number>
  warnIds?:       Set<number>
}) {
  const vehiculoId = vehiculo.id
  const lastMant   = mantenimientos[0] ?? null

  const [formOpen, setFormOpen]     = useState(false)
  const [editing, setEditing]       = useState<RequerimientoExclusivo | null>(null)
  const [deleting, setDeleting]     = useState<RequerimientoExclusivo | null>(null)
  const [formError, setFormError]   = useState<string | null>(null)
  const [detalleItem, setDetalleItem] = useState<RequerimientoExclusivo | null>(null)

  const { data, isLoading } = useRequerimientos(vehiculoId)
  const rawItems  = data?.data ?? []
  const items     = [...rawItems].sort((a, b) => {
    const esPlantilla = (r: RequerimientoExclusivo) => r.plantilla_origen_id != null ? 0 : 1
    const porPlantilla = esPlantilla(a) - esPlantilla(b)
    if (porPlantilla !== 0) return porPlantilla
    const inactive = (s: string) => s === 'completado' || s === 'cancelado' ? 1 : 0
    return inactive(a.status) - inactive(b.status)
  })
  const createMut = useCreateRequerimiento(vehiculoId)
  const updateMut = useUpdateRequerimiento(vehiculoId)
  const deleteMut = useDeleteRequerimiento(vehiculoId)

  function openCreate() { setEditing(null); setFormError(null); setFormOpen(true) }
  function openEdit(item: RequerimientoExclusivo) { setEditing(item); setFormError(null); setFormOpen(true) }

  function handleSubmit(payload: RequerimientoPayload) {
    setFormError(null)
    if (editing) {
      updateMut.mutate({ id: editing.id, payload }, {
        onSuccess: () => setFormOpen(false),
        onError:   (e: Error) => setFormError(e.message),
      })
    } else {
      createMut.mutate(payload, {
        onSuccess: () => setFormOpen(false),
        onError:   (e: Error) => setFormError(e.message),
      })
    }
  }

  return (
    <>
      <Divider
        label={
          <Group gap="xs">
            <Text size="sm" fw={500}>Requerimientos exclusivos ({items.length})</Text>
            <Tooltip label="Agregar requerimiento">
              <ActionIcon variant="light" color="blue" size="xs" onClick={openCreate}>
                <IconPlus size={12} />
              </ActionIcon>
            </Tooltip>
          </Group>
        }
        labelPosition="left"
      />

      {isLoading ? (
        <Center py="md"><Loader size="sm" /></Center>
      ) : items.length === 0 ? (
        <Center py="md">
          <Stack align="center" gap="xs">
            <Text c="dimmed" size="sm">No hay requerimientos exclusivos para este vehículo.</Text>
            <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={openCreate}>
              Agregar requerimiento
            </Button>
          </Stack>
        </Center>
      ) : (
        (() => {
          const recurrentes = items.filter(i => i.tipo === 'recurrente')
          const unicos      = items.filter(i => i.tipo === 'unica')
          return (
            <Stack gap="md">
              <div>
                <Text size="sm" fw={500} c="dimmed" mb={4}>Recurrentes ({recurrentes.length})</Text>
                {recurrentes.length === 0 ? (
                  <Text c="dimmed" size="sm">Sin requerimientos recurrentes.</Text>
                ) : (
                  <RequerimientoTable
                    items={recurrentes} mantenimientos={mantenimientos}
                    overdueIds={overdueIds} warnIds={warnIds}
                    onOpenDetalle={setDetalleItem} onEdit={openEdit} onDelete={setDeleting}
                  />
                )}
              </div>

              <Accordion defaultValue={null} variant="separated">
                <Accordion.Item value="unicos">
                  <Accordion.Control>
                    <Group justify="space-between" pr="md" wrap="nowrap">
                      <Text fw={600}>Únicos</Text>
                      <Badge variant="light" color="gray">{unicos.length}</Badge>
                    </Group>
                  </Accordion.Control>
                  <Accordion.Panel>
                    {unicos.length === 0 ? (
                      <Text c="dimmed" size="sm">Sin requerimientos únicos.</Text>
                    ) : (
                      <UnicosSection
                        items={unicos} mantenimientos={mantenimientos}
                        overdueIds={overdueIds} warnIds={warnIds}
                        onOpenDetalle={setDetalleItem} onEdit={openEdit} onDelete={setDeleting}
                      />
                    )}
                  </Accordion.Panel>
                </Accordion.Item>
              </Accordion>
            </Stack>
          )
        })()
      )}

      <Modal
        opened={formOpen} onClose={() => setFormOpen(false)}
        title={editing ? 'Editar requerimiento' : 'Nuevo requerimiento exclusivo'}
        centered size="md"
      >
        <RequerimientoForm
          initial={editing ?? undefined}
          isPending={createMut.isPending || updateMut.isPending}
          error={formError}
          onSubmit={handleSubmit}
          onCancel={() => setFormOpen(false)}
          vehiculo={vehiculo}
          lastMant={lastMant}
        />
      </Modal>

      <Modal
        opened={deleting !== null} onClose={() => setDeleting(null)}
        title="Eliminar requerimiento" centered size="sm"
      >
        <Stack gap="md">
          <Text>¿Eliminar <strong>{deleting?.nombre}</strong>? Esta acción no se puede deshacer.</Text>
          {deleteMut.error && <Alert color="red" title="Error">{(deleteMut.error as Error).message}</Alert>}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDeleting(null)} disabled={deleteMut.isPending}>Cancelar</Button>
            <Button color="red" loading={deleteMut.isPending}
              onClick={() => deleteMut.mutate(deleting!.id, { onSuccess: () => setDeleting(null) })}>
              Eliminar
            </Button>
          </Group>
        </Stack>
      </Modal>

      <RequerimientoDetalleDrawer
        item={detalleItem}
        mantenimientos={mantenimientos}
        overdueIds={overdueIds}
        warnIds={warnIds}
        onClose={() => setDetalleItem(null)}
        onEdit={(item) => { setDetalleItem(null); openEdit(item) }}
      />
    </>
  )
}

// ── Sección mantenimientos ────────────────────────────────────────────────────

// Fecha local de hoy en "YYYY-MM-DD" (construirla con métodos UTC recorrería
// el día en zonas horarias detrás de UTC).
function hoyIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

type MantForm = {
  fecha:             string
  tipo:              string
  tecnico_id:        string
  costo:             number | string
  km_actual:         number | string
  observaciones:     string
  requerimiento_ids: string[]
  // Piezas usadas, capturadas al registrar. Puede quedar vacío: hay
  // mantenimientos que no consumen refacciones.
  piezas:            PiezaLinea[]
}

type PiezaLinea = {
  lote_id:        string
  cantidad:       number | string
  costo_unitario: number | string
}

function initMant(m?: Mantenimiento, prefillRequerimientoIds?: number[], kmVehiculo?: number | null): MantForm {
  return {
    fecha:             m?.fecha?.split('T')[0] ?? '',
    tipo:              m?.tipo          ?? '',
    tecnico_id:        m?.tecnico_id != null ? String(m.tecnico_id) : '',
    costo:             m?.costo         ?? '',
    // Al registrar se parte del odómetro actual del vehículo; se ajusta si la
    // lectura real del taller es otra.
    km_actual:         m?.km_actual     ?? kmVehiculo ?? '',
    observaciones:     m?.observaciones ?? '',
    requerimiento_ids: m?.requerimiento_ids?.map(String) ?? prefillRequerimientoIds?.map(String) ?? [],
    piezas:            [],
  }
}

export function MantenimientoForm({
  vehiculoId, tipoVehiculo, initial, prefillRequerimientoIds, isPending, error, onSubmit, onCancel,
}: {
  vehiculoId:               number
  tipoVehiculo?:            TipoVehiculo
  initial?:                 Mantenimiento
  prefillRequerimientoIds?: number[]
  isPending:                boolean
  error:                    string | null
  onSubmit:                 (p: MantenimientoPayload, piezas: DetalleMttoPayload[]) => void
  onCancel:                 () => void
}) {
  const tieneKilometraje = tipoVehiculo !== 'montacargas' && tipoVehiculo !== 'caja_trailer'
  const { data: reqData } = useRequerimientos(vehiculoId)
  const linkedIds = new Set(initial?.requerimiento_ids ?? prefillRequerimientoIds ?? [])
  const reqOptions = (reqData?.data ?? [])
    .filter(r => r.status === 'activo' || linkedIds.has(r.id))
    .map(r => ({ value: String(r.id), label: r.status !== 'activo' ? `${r.nombre} (completado)` : r.nombre }))

  // Las piezas solo se capturan al registrar. Al editar se gestionan desde el
  // detalle del mantenimiento, que ya permite agregarlas, cambiarlas y quitarlas
  // devolviendo el stock al lote.
  const isEdit = !!initial
  const { data: lotesData } = useLotesDisponibles(!isEdit)
  const lotes = lotesData?.data ?? []

  // El odómetro actual del vehículo precarga el campo de kilometraje al registrar.
  const { data: vehiculoData } = useVehiculo(isEdit ? undefined : vehiculoId)
  const kmVehiculo = vehiculoData?.data.kilometraje ?? null

  // El técnico se guarda por id contra el catálogo. Si el técnico se eliminó,
  // el mantenimiento queda sin técnico y hay que elegir otro al editarlo.
  const { data: tecnicosData } = useTecnicos()
  const tecnicoOptions = useMemo(
    () => (tecnicosData?.data ?? []).map((t) => ({ value: String(t.id), label: t.nombre })),
    [tecnicosData]
  )

  const form = useForm<MantForm>({
    initialValues: initMant(initial, prefillRequerimientoIds, kmVehiculo),
    validate: {
      fecha:             (v) => !v ? 'Requerido' : null,
      tipo:              (v) => !v ? 'Requerido' : null,
      tecnico_id:        (v) => !v ? 'Requerido' : null,
      km_actual:         (v) => tieneKilometraje && (v === '' || v === null) ? 'Requerido' : null,
      costo:             (v) => v === '' || v === null ? 'Requerido' : null,
      observaciones:     (v) =>
        !v.trim() ? 'Requerido' :
        v.length > 255 ? 'Máximo 255 caracteres' :
        !TEXTO_LIBRE.test(v.trim()) ? 'Contiene caracteres no permitidos' : null,
      requerimiento_ids: (v) => v.length === 0 ? 'Selecciona al menos un requerimiento' : null,
      piezas: {
        lote_id:  (v: string) => !v ? 'Selecciona la refacción' : null,
        cantidad: (v: number | string, vals: MantForm, path: string) => {
          if (v === '' || Number(v) < 1) return 'Mínimo 1'
          const linea = vals.piezas[Number(path.split('.')[1])]
          const lote = lotes.find(l => String(l.id) === linea?.lote_id)
          if (lote && Number(v) > lote.cantidad_disponible) return `Máx. ${lote.cantidad_disponible}`
          return null
        },
        costo_unitario: (v: number | string) => (v === '' || Number(v) < 0 ? 'Costo inválido' : null),
      },
    },
  })

  // initialValues solo se aplica al montar, y el vehículo llega después: en
  // cuanto resuelve se precarga el km, salvo que el usuario ya haya escrito uno.
  const kmPrecargado = useRef(false)
  useEffect(() => {
    if (isEdit || kmPrecargado.current || kmVehiculo == null) return
    kmPrecargado.current = true
    if (form.values.km_actual === '') form.setFieldValue('km_actual', kmVehiculo)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kmVehiculo, isEdit])

  const piezas = form.values.piezas

  // Un lote ya elegido no se ofrece en las demás líneas: evita capturar dos
  // veces la misma pieza y que la suma de cantidades rebase el stock.
  function loteOptions(idx: number) {
    const usados = new Set(piezas.filter((_, i) => i !== idx).map(p => p.lote_id))
    return lotes
      .filter(l => !usados.has(String(l.id)))
      .map(l => ({
        value: String(l.id),
        label: `${l.numero_serie} — ${l.descripcion} (disp: ${l.cantidad_disponible}, ${formatMXN(l.costo_unitario)})`,
      }))
  }

  function setLote(idx: number, value: string | null) {
    form.setFieldValue(`piezas.${idx}.lote_id`, value ?? '')
    const lote = lotes.find(l => String(l.id) === value)
    // El costo del lote es solo el valor de arranque: se puede ajustar a mano.
    if (lote) form.setFieldValue(`piezas.${idx}.costo_unitario`, lote.costo_unitario)
  }

  const totalPiezas = piezas.reduce(
    (s, p) => s + (Number(p.cantidad) || 0) * (Number(p.costo_unitario) || 0), 0
  )

  function handleSubmit(vals: MantForm) {
    onSubmit(
      {
        fecha:             vals.fecha,
        tipo:              vals.tipo.trim()          || null,
        tecnico_id:        Number(vals.tecnico_id),
        costo:             vals.costo !== '' ? Number(vals.costo) : 0,
        km_actual:         vals.km_actual !== '' ? Number(vals.km_actual) : 0,
        observaciones:     vals.observaciones.trim(),
        requerimiento_ids: vals.requerimiento_ids.map(Number),
      },
      vals.piezas.map(p => ({
        lote_id:        Number(p.lote_id),
        cantidad:       Number(p.cantidad),
        costo_unitario: Number(p.costo_unitario),
      })),
    )
  }

  return (
    <form onSubmit={form.onSubmit(handleSubmit)}>
      <Stack gap="sm">
        {error && <Alert color="red" title="Error">{error}</Alert>}
        <Grid>
          <Grid.Col span={6}>
            <DateInput
              label="Fecha" required
              placeholder="dd/mm/aaaa" valueFormat="DD/MM/YYYY"
              clearable maxDate={hoyIso()}
              value={form.values.fecha || null}
              onChange={(d) => form.setFieldValue('fecha', d ?? '')}
              error={form.errors.fecha as string}
            />
          </Grid.Col>
          <Grid.Col span={6}>
            <Select
              label="Tipo" required
              placeholder="Selecciona el tipo"
              data={[
                { value: 'Preventivo', label: 'Preventivo' },
                { value: 'Correctivo', label: 'Correctivo' },
              ]}
              {...form.getInputProps('tipo')}
            />
          </Grid.Col>
          <Grid.Col span={6}>
            <Select
              label="Técnico" required
              placeholder="Selecciona un técnico"
              data={tecnicoOptions}
              searchable
              nothingFoundMessage="Registra técnicos en Catálogos"
              {...form.getInputProps('tecnico_id')}
              onChange={(v) => form.setFieldValue('tecnico_id', v ?? '')}
            />
          </Grid.Col>
          {tieneKilometraje && (
            <Grid.Col span={3}>
              <NumberInput
                label="Kilometraje" placeholder="0" min={0} required
                allowDecimal={false} allowNegative={false}
                description={!isEdit && kmVehiculo != null
                  ? `Actual: ${kmVehiculo.toLocaleString('es-MX')} km`
                  : undefined}
                {...form.getInputProps('km_actual')}
              />
            </Grid.Col>
          )}
          <Grid.Col span={tieneKilometraje ? 3 : 6}>
            <NumberInput
              label="Costo de mano de obra" placeholder="0.00" min={0} decimalScale={2} prefix="$" required
              {...form.getInputProps('costo')}
            />
          </Grid.Col>
          <Grid.Col span={12}>
            <Textarea
              label="Observaciones" autosize minRows={2} required maxLength={255}
              {...form.getInputProps('observaciones')}
              onChange={(e) => form.setFieldValue('observaciones', limpiarTextoLibre(e.currentTarget.value, 255))}
            />
          </Grid.Col>
          <Grid.Col span={12}>
            <MultiSelect
              label="Requerimientos que cumple este mantenimiento"
              required
              placeholder={reqOptions.length ? 'Selecciona los requerimientos…' : 'Sin requerimientos activos'}
              data={reqOptions}
              searchable
              clearable
              {...form.getInputProps('requerimiento_ids')}
            />
          </Grid.Col>
        </Grid>

        {!isEdit && (
          <>
            <Divider
              label={
                <Group gap="xs">
                  <Text size="sm" fw={500}>Refacciones usadas ({piezas.length})</Text>
                  <Text size="xs" c="dimmed">opcional</Text>
                </Group>
              }
              labelPosition="left"
            />

            {piezas.length === 0 ? (
              <Text size="sm" c="dimmed">
                Este mantenimiento no usa refacciones. Agrégalas si se consumieron refacciones del inventario.
              </Text>
            ) : (
              <Stack gap="xs">
                {piezas.map((_, idx) => (
                  <Grid key={idx} align="flex-start" gap="xs">
                    <Grid.Col span={6}>
                      <Select
                        label={idx === 0 ? 'Refacción / lote' : undefined}
                        placeholder="Selecciona la refacción"
                        data={loteOptions(idx)}
                        searchable
                        value={piezas[idx].lote_id || null}
                        onChange={(v) => setLote(idx, v)}
                        error={form.errors[`piezas.${idx}.lote_id`]}
                      />
                    </Grid.Col>
                    <Grid.Col span={2}>
                      <NumberInput
                        label={idx === 0 ? 'Cantidad' : undefined}
                        placeholder="0" min={1} allowDecimal={false}
                        {...form.getInputProps(`piezas.${idx}.cantidad`)}
                      />
                    </Grid.Col>
                    <Grid.Col span={3}>
                      <NumberInput
                        label={idx === 0 ? 'Costo unit.' : undefined}
                        placeholder="0.00" min={0} decimalScale={2} prefix="$"
                        {...form.getInputProps(`piezas.${idx}.costo_unitario`)}
                      />
                    </Grid.Col>
                    <Grid.Col span={1}>
                      <ActionIcon
                        variant="subtle" color="red"
                        mt={idx === 0 ? 25 : 4}
                        aria-label="Quitar refacción"
                        onClick={() => form.removeListItem('piezas', idx)}
                      >
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Grid.Col>
                  </Grid>
                ))}
              </Stack>
            )}

            <Group justify="space-between">
              <Button
                variant="light" size="xs" leftSection={<IconPlus size={14} />}
                onClick={() => form.insertListItem('piezas', { lote_id: '', cantidad: 1, costo_unitario: '' })}
              >
                Agregar refacción
              </Button>
              {piezas.length > 0 && (
                <Text size="sm" c="dimmed">
                  Total refacciones: <Text component="span" fw={600}>
                    {totalPiezas.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })}
                  </Text>
                </Text>
              )}
            </Group>
          </>
        )}

        <Group justify="flex-end" mt="xs">
          <Button variant="default" onClick={onCancel} disabled={isPending}>Cancelar</Button>
          <Button type="submit" loading={isPending}>{initial ? 'Guardar cambios' : 'Registrar'}</Button>
        </Group>
      </Stack>
    </form>
  )
}

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

function groupByYearMonth<T>(
  items: T[], getFecha: (item: T) => string | null | undefined
): { sinFecha: T[]; anios: Array<[number, Map<number, T[]>]> } {
  const sorted = [...items].sort((a, b) => (getFecha(b) ?? '').localeCompare(getFecha(a) ?? ''))
  const sinFecha: T[] = []
  const porAnio = new Map<number, Map<number, T[]>>()
  for (const item of sorted) {
    const fecha = getFecha(item)
    if (!fecha) { sinFecha.push(item); continue }
    const d = new Date(`${fecha.split('T')[0]}T12:00:00`)
    const y = d.getFullYear()
    const mo = d.getMonth()
    if (!porAnio.has(y)) porAnio.set(y, new Map())
    const months = porAnio.get(y)!
    if (!months.has(mo)) months.set(mo, [])
    months.get(mo)!.push(item)
  }
  return { sinFecha, anios: [...porAnio.entries()] }
}

function MantenimientoTable({
  items, mostrarKm = true, onOpenDetalle, onEdit, onDelete,
}: {
  items:         Mantenimiento[]
  mostrarKm?:    boolean
  onOpenDetalle: (id: number) => void
  onEdit:        (m: Mantenimiento) => void
  onDelete:      (m: Mantenimiento) => void
}) {
  function fmtFecha(iso: string | null) {
    if (!iso) return '—'
    return new Date(`${iso.split('T')[0]}T12:00:00`).toLocaleDateString('es-MX', {
      day: '2-digit', month: 'short', year: 'numeric',
    })
  }

  return (
    <Table.ScrollContainer minWidth={500}>
      <Table striped highlightOnHover withTableBorder>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Fecha</Table.Th>
            <Table.Th>Tipo</Table.Th>
            <Table.Th>Técnico</Table.Th>
            {mostrarKm && <Table.Th style={{ textAlign: 'right' }}>Kilometraje</Table.Th>}
            <Table.Th style={{ textAlign: 'right' }}>Costo total</Table.Th>
            <Table.Th style={{ width: 80 }} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {items.map((m) => {
            const programado = !!m.fecha && m.fecha.split('T')[0] > todayIso()
            return (
            <Table.Tr key={m.id} onClick={() => onOpenDetalle(m.id)} style={{ cursor: 'pointer' }}>
              <Table.Td fw={500}>
                <Group gap={6} wrap="nowrap">
                  {fmtFecha(m.fecha)}
                  {programado && <Badge size="xs" variant="light" color="blue">Programado</Badge>}
                </Group>
              </Table.Td>
              <Table.Td>{m.tipo ?? <Text component="span" c="dimmed" size="sm">—</Text>}</Table.Td>
              <Table.Td>{m.tecnico ?? <Text component="span" c="dimmed" size="sm">—</Text>}</Table.Td>
              {mostrarKm && (
                <Table.Td style={{ textAlign: 'right' }}>
                  {m.km_actual ? `${m.km_actual.toLocaleString('es-MX')} km` : <Text component="span" c="dimmed" size="sm">—</Text>}
                </Table.Td>
              )}
              <Table.Td style={{ textAlign: 'right' }}>
                {m.costo || m.piezas_total ? (
                  <Tooltip
                    label={`Mantenimiento: ${formatMXN(m.costo)} + Refacciones: ${formatMXN(m.piezas_total)}`}
                    disabled={!m.piezas_total}
                  >
                    <Text component="span" size="sm">
                      {formatMXN(m.costo + m.piezas_total)}
                    </Text>
                  </Tooltip>
                ) : <Text component="span" c="dimmed" size="sm">—</Text>}
              </Table.Td>
              <Table.Td onClick={(e) => e.stopPropagation()}>
                <Group gap={4} justify="flex-end">
                  <Tooltip label="Editar">
                    <ActionIcon variant="subtle" color="blue" size="sm" onClick={() => onEdit(m)}>
                      <IconPencil size={14} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label="Eliminar">
                    <ActionIcon variant="subtle" color="red" size="sm" onClick={() => onDelete(m)}>
                      <IconTrash size={14} />
                    </ActionIcon>
                  </Tooltip>
                </Group>
              </Table.Td>
            </Table.Tr>
            )
          })}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  )
}

function MantenimientosSection({ vehiculoId, tipoVehiculo }: { vehiculoId: number; tipoVehiculo?: TipoVehiculo }) {
  const [formOpen, setFormOpen]     = useState(false)
  const [editing, setEditing]       = useState<Mantenimiento | null>(null)
  const [deleting, setDeleting]     = useState<Mantenimiento | null>(null)
  const [formError, setFormError]   = useState<string | null>(null)
  const [detalleId, setDetalleId]   = useState<number | null>(null)

  const { data, isLoading } = useMantenimientos(vehiculoId)
  const items      = data?.data ?? []
  const createMut  = useCreateMantenimiento(vehiculoId)
  const updateMut  = useUpdateMantenimiento(vehiculoId)
  const deleteMut  = useDeleteMantenimiento(vehiculoId)
  const piezasMut  = useCreateDetallesMtto()

  function openCreate() { setEditing(null); setFormError(null); setFormOpen(true) }
  function openEdit(m: Mantenimiento) { setEditing(m); setFormError(null); setFormOpen(true) }

  function handleSubmit(payload: MantenimientoPayload, piezas: DetalleMttoPayload[]) {
    setFormError(null)
    if (editing) {
      updateMut.mutate({ id: editing.id, payload }, {
        onSuccess: () => setFormOpen(false),
        onError:   (e: Error) => setFormError(e.message),
      })
      return
    }
    createMut.mutate(payload, {
      onSuccess: (res) => {
        if (!piezas.length) { setFormOpen(false); return }
        piezasMut.mutate({ mantenimientoId: res.data.id, piezas }, {
          onSuccess: () => setFormOpen(false),
          // El mantenimiento ya quedó registrado: no se puede "deshacer" el alta,
          // así que se abre su detalle para completar a mano las piezas que faltaron.
          onError: (e: Error) => {
            setFormOpen(false)
            setDetalleId(res.data.id)
            setFormError(null)
            alert(
              `El mantenimiento se registró, pero no se pudieron guardar todas las refacciones: ${e.message}\n\n` +
              'Revisa el detalle del mantenimiento para agregar las que falten.'
            )
          },
        })
      },
      onError: (e: Error) => setFormError(e.message),
    })
  }

  function fmtFecha(iso: string | null) {
    if (!iso) return '—'
    return new Date(`${iso.split('T')[0]}T12:00:00`).toLocaleDateString('es-MX', {
      day: '2-digit', month: 'short', year: 'numeric',
    })
  }

  return (
    <>
      <Divider
        label={
          <Group gap="xs">
            <Text size="sm" fw={500}>Mantenimientos ({items.length})</Text>
            <Tooltip label="Registrar mantenimiento">
              <ActionIcon variant="light" color="blue" size="xs" onClick={openCreate}>
                <IconPlus size={12} />
              </ActionIcon>
            </Tooltip>
          </Group>
        }
        labelPosition="left"
      />

      {isLoading ? (
        <Center py="md"><Loader size="sm" /></Center>
      ) : items.length === 0 ? (
        <Center py="md">
          <Stack align="center" gap="xs">
            <Text c="dimmed" size="sm">No hay mantenimientos registrados.</Text>
            <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={openCreate}>
              Registrar mantenimiento
            </Button>
          </Stack>
        </Center>
      ) : (
        (() => {
          const { anios } = groupByYearMonth(items, m => m.fecha)
          const anioMasReciente = anios[0]?.[0]
          return (
            <Accordion multiple defaultValue={anioMasReciente != null ? [String(anioMasReciente)] : []} variant="separated">
              {anios.map(([anio, porMes]) => {
                const totalAnio = [...porMes.values()].reduce((s, arr) => s + arr.length, 0)
                return (
                  <Accordion.Item key={anio} value={String(anio)}>
                    <Accordion.Control>
                      <Group justify="space-between" pr="md" wrap="nowrap">
                        <Text fw={600}>{anio}</Text>
                        <Badge variant="light" color="gray">{totalAnio}</Badge>
                      </Group>
                    </Accordion.Control>
                    <Accordion.Panel>
                      <Stack gap="md">
                        {[...porMes.entries()].map(([mes, mesItems]) => (
                          <div key={mes}>
                            <Text size="sm" fw={500} c="dimmed" mb={4} tt="capitalize">{MESES[mes]}</Text>
                            <MantenimientoTable
                              items={mesItems}
                              mostrarKm={!tipoVehiculo || !sinKilometraje(tipoVehiculo)}
                              onOpenDetalle={setDetalleId} onEdit={openEdit} onDelete={setDeleting}
                            />
                          </div>
                        ))}
                      </Stack>
                    </Accordion.Panel>
                  </Accordion.Item>
                )
              })}
            </Accordion>
          )
        })()
      )}

      <Modal
        opened={formOpen} onClose={() => setFormOpen(false)}
        title={editing ? 'Editar mantenimiento' : 'Registrar mantenimiento'}
        centered size="md"
      >
        <MantenimientoForm
          vehiculoId={vehiculoId}
          tipoVehiculo={tipoVehiculo}
          initial={editing ?? undefined}
          isPending={createMut.isPending || updateMut.isPending || piezasMut.isPending}
          error={formError}
          onSubmit={handleSubmit}
          onCancel={() => setFormOpen(false)}
        />
      </Modal>

      <Modal
        opened={deleting !== null} onClose={() => setDeleting(null)}
        title="Eliminar mantenimiento" centered size="sm"
      >
        <Stack gap="md">
          <Text>¿Eliminar el mantenimiento del <strong>{fmtFecha(deleting?.fecha ?? null)}</strong>?</Text>
          {deleteMut.error && <Alert color="red" title="Error">{(deleteMut.error as Error).message}</Alert>}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDeleting(null)} disabled={deleteMut.isPending}>Cancelar</Button>
            <Button color="red" loading={deleteMut.isPending}
              onClick={() => deleteMut.mutate(deleting!.id, { onSuccess: () => setDeleting(null) })}>
              Eliminar
            </Button>
          </Group>
        </Stack>
      </Modal>

      <MantenimientoDetalleDrawer
        mantenimientoId={detalleId}
        onClose={() => setDetalleId(null)}
        onEdit={(m) => { setDetalleId(null); openEdit(m) }}
      />
    </>
  )
}

// ── Vista de detalle ──────────────────────────────────────────────────────────

function InfoItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <Text size="xs" c="dimmed">{label}</Text>
      <Text size="sm">{value ?? <Text component="span" c="dimmed">—</Text>}</Text>
    </div>
  )
}

// Refacción que usa este vehículo para cada tipo de pieza que necesita. Los
// tipos salen del modelo (se gestionan allá), más los que se agreguen aquí para
// esta unidad sola. Lo que se decide en ambos casos es cuál refacción cubre cada
// uno: dos unidades del mismo modelo pueden usar filtros de aire distintos.
function PiezasVehiculoSection({ vehiculoId }: { vehiculoId: number }) {
  const { data, isLoading } = usePiezasVehiculo(vehiculoId)
  const { data: piezasData } = useTodasLasPiezas()
  const { data: tiposData } = useTiposPieza()
  const setMut       = useSetPiezaVehiculo()
  const removeMut    = useRemovePiezaVehiculo()
  const addTipoMut   = useAddTiposPiezaVehiculo()
  const quitaTipoMut = useRemoveTipoPiezaVehiculo()

  const [nuevoTipo, setNuevoTipo] = useState<string | null>(null)

  const filas  = data?.data ?? []
  const piezas = piezasData?.data ?? []

  // Solo se ofrecen refacciones marcadas con ese tipo en el catálogo: el backend
  // rechaza cualquier otra.
  function opcionesDeTipo(tipoId: number) {
    return piezas
      .filter((p) => p.tipo_pieza_id === tipoId)
      .map((p) => ({ value: String(p.id), label: `${p.numero_serie} · ${p.descripcion}` }))
  }

  // Los tipos que el vehículo ya necesita no se vuelven a ofrecer, vengan del
  // modelo o de la propia unidad.
  const tipoOptions = useMemo(() => {
    const yaEstan = new Set(filas.map((f) => f.tipo_pieza_id))
    return (tiposData?.data ?? [])
      .filter((t) => !yaEstan.has(t.id))
      .map((t) => ({ value: String(t.id), label: t.nombre }))
  }, [tiposData, filas])

  function handleChange(tipoId: number, value: string | null) {
    if (value) setMut.mutate({ vehiculoId, tipoId, piezaId: Number(value) })
    else       removeMut.mutate({ vehiculoId, tipoId })
  }

  function handleAgregarTipo() {
    if (!nuevoTipo) return
    addTipoMut.mutate(
      { vehiculoId, tipoIds: [Number(nuevoTipo)] },
      { onSuccess: () => setNuevoTipo(null) }
    )
  }

  const sinCapturar = filas.filter((f) => f.pieza_id == null).length

  return (
    <>
      <Divider
        label={<Text size="sm" fw={500}>Piezas de este vehículo ({filas.length})</Text>}
        labelPosition="left"
      />
      <Text size="xs" c="dimmed">
        Qué refacción usa esta unidad para cada tipo que necesita. Los tipos del modelo se gestionan
        desde el modelo; aquí puedes agregar los que solo requiera esta unidad. Es informativo: no
        afecta el inventario.
      </Text>
      {setMut.error       && <Alert color="red">{(setMut.error as Error).message}</Alert>}
      {removeMut.error    && <Alert color="red">{(removeMut.error as Error).message}</Alert>}
      {addTipoMut.error   && <Alert color="red">{(addTipoMut.error as Error).message}</Alert>}
      {quitaTipoMut.error && <Alert color="red">{(quitaTipoMut.error as Error).message}</Alert>}

      <Group gap="xs" align="flex-end">
        <Select
          size="xs"
          style={{ flex: 1 }}
          searchable
          placeholder="Agrega un tipo que solo necesita este vehículo"
          data={tipoOptions}
          value={nuevoTipo}
          onChange={setNuevoTipo}
          disabled={addTipoMut.isPending}
          nothingFoundMessage="No hay más tipos en el catálogo"
        />
        <Button
          size="xs"
          variant="light"
          leftSection={<IconPlus size={14} />}
          disabled={!nuevoTipo}
          loading={addTipoMut.isPending}
          onClick={handleAgregarTipo}
        >
          Agregar
        </Button>
      </Group>

      {isLoading ? (
        <Center py="md"><Loader size="sm" /></Center>
      ) : filas.length === 0 ? (
        <Text c="dimmed" size="sm" py="sm">
          Este vehículo no necesita ningún tipo de pieza todavía: su modelo no tiene tipos registrados
          y no le has agregado ninguno propio.
        </Text>
      ) : (
        <>
          {sinCapturar > 0 && (
            <Text size="xs" c="dimmed">
              {sinCapturar} tipo(s) sin refacción asignada.
            </Text>
          )}
          <Table.ScrollContainer minWidth={520}>
            <Table striped withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th style={{ width: '35%' }}>Tipo de pieza</Table.Th>
                  <Table.Th>Refacción que usa</Table.Th>
                  <Table.Th style={{ width: 40 }} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {filas.map((f) => {
                  const opciones = opcionesDeTipo(f.tipo_pieza_id)
                  const propio   = f.origen === 'vehiculo'
                  const pendiente =
                    (setMut.isPending    && setMut.variables?.tipoId    === f.tipo_pieza_id) ||
                    (removeMut.isPending && removeMut.variables?.tipoId === f.tipo_pieza_id)
                  return (
                    <Table.Tr key={f.tipo_pieza_id}>
                      <Table.Td>
                        <Group gap={6} wrap="nowrap">
                          <Text size="sm" fw={500}>{f.tipo_nombre}</Text>
                          {propio && (
                            <Badge size="xs" variant="light" color="teal">Solo este vehículo</Badge>
                          )}
                        </Group>
                      </Table.Td>
                      <Table.Td>
                        <Select
                          size="xs"
                          searchable clearable
                          disabled={pendiente}
                          placeholder={
                            opciones.length
                              ? 'Selecciona la refacción'
                              : 'Sin refacciones de este tipo en el catálogo'
                          }
                          data={opciones}
                          value={f.pieza_id != null ? String(f.pieza_id) : null}
                          onChange={(v) => handleChange(f.tipo_pieza_id, v)}
                          nothingFoundMessage="Marca refacciones con este tipo desde el catálogo"
                        />
                      </Table.Td>
                      <Table.Td>
                        {/* Los tipos del modelo se quitan desde el modelo: hacerlo
                            aquí afectaría a toda la flota de ese modelo. */}
                        {propio && (
                          <ActionIcon
                            variant="subtle"
                            color="red"
                            aria-label={`Quitar ${f.tipo_nombre} de este vehículo`}
                            loading={
                              quitaTipoMut.isPending &&
                              quitaTipoMut.variables?.tipoId === f.tipo_pieza_id
                            }
                            onClick={() => quitaTipoMut.mutate({ vehiculoId, tipoId: f.tipo_pieza_id })}
                          >
                            <IconTrash size={14} />
                          </ActionIcon>
                        )}
                      </Table.Td>
                    </Table.Tr>
                  )
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </>
      )}
    </>
  )
}

function VehiculoDetalle({
  vehiculo, onBack, backLabel, onEdit, onDelete, onVehiculoUpdate,
}: {
  vehiculo: VehiculoRow
  onBack: () => void
  // Etiqueta de la sección de origen (p. ej. "Dashboard"). Si viene, el botón de
  // regreso vuelve ahí; si no, regresa a la lista de vehículos.
  backLabel?: string
  onEdit: (v: VehiculoRow) => void
  onDelete: (v: VehiculoRow) => void
  onVehiculoUpdate: (v: VehiculoRow) => void
}) {
  const ti = tipoInfo(vehiculo.tipo)

  const { data: reqData  } = useRequerimientos(vehiculo.id)
  const { data: mantData } = useMantenimientos(vehiculo.id)

  const updateKmMut = useUpdateVehiculo()
  const [editingKm, setEditingKm] = useState(false)
  const [kmDraft, setKmDraft]     = useState<number | ''>(vehiculo.kilometraje ?? '')

  function startEditKm() {
    setKmDraft(vehiculo.kilometraje ?? '')
    setEditingKm(true)
  }

  function saveKm() {
    if (kmDraft === '' || Number(kmDraft) === vehiculo.kilometraje) { setEditingKm(false); return }
    updateKmMut.mutate({ id: vehiculo.id, payload: { kilometraje: Number(kmDraft) } }, {
      onSuccess: (res) => { setEditingKm(false); onVehiculoUpdate(res.data) },
      onError:   () => setEditingKm(false),
    })
  }

  const { overdueIds, warnIds } = useMemo(() => {
    const reqs  = reqData?.data  ?? []
    const mants = mantData?.data ?? []
    const overdueIds = new Set<number>()
    const warnIds    = new Set<number>()
    for (const req of reqs) {
      if      (isOverdue(req, vehiculo, mants))  overdueIds.add(req.id)
      else if (isWarning(req, vehiculo, mants))  warnIds.add(req.id)
    }
    return { overdueIds, warnIds }
  }, [reqData, mantData, vehiculo])

  return (
    <Stack gap="md">
      {/* Navegación */}
      <Group gap="xs">
        <Tooltip label={backLabel ? `Regresar a ${backLabel}` : 'Regresar a Vehículos'}>
          <ActionIcon variant="subtle" color="gray" onClick={onBack}>
            <IconArrowLeft size={18} />
          </ActionIcon>
        </Tooltip>
        <Text size="sm" c="dimmed" style={{ cursor: 'pointer' }} onClick={onBack}>
          {backLabel ?? 'Vehículos'}
        </Text>
        <Text size="sm" c="dimmed">/</Text>
        <Text size="sm">{vehiculoLabel(vehiculo)}</Text>
      </Group>

      {overdueIds.size > 0 && (
        <Alert color="red" title="Mantenimiento requerido" icon={<IconAlertTriangle size={16} />}>
          Se requiere mantenimiento en{' '}
          <strong>{overdueIds.size} requerimiento{overdueIds.size !== 1 ? 's' : ''}</strong>.
        </Alert>
      )}
      {warnIds.size > 0 && (
        <Alert color="yellow" title="Próximo a vencer" icon={<IconAlertTriangle size={16} />}>
          <strong>{warnIds.size} requerimiento{warnIds.size !== 1 ? 's' : ''}</strong>{' '}
          {warnIds.size !== 1 ? 'están próximos a' : 'está próximo a'} vencer (menos de 1 mes o menos del 25% del intervalo de km restante).
        </Alert>
      )}
      {vehiculo.seguro_id === null && (
        <Alert color="red" title="Sin seguro" icon={<IconAlertTriangle size={16} />}>
          Este vehículo no tiene un seguro asignado. Asígnale uno desde el botón de editar.
        </Alert>
      )}

      {/* Ficha */}
      <Paper withBorder p="md" radius="md">
        <Group justify="space-between" align="flex-start">
          <Stack gap={6}>
            <Group gap="sm" align="center">
              <Text size="xl" fw={700}>{vehiculoLabel(vehiculo)}</Text>
              <Badge color={ti.color} variant="light" size="lg">{ti.label}</Badge>
              {vehiculo.status && (
                <Badge color={statusColor(vehiculo.status)} variant="filled" size="sm">
                  {vehiculo.status}
                </Badge>
              )}
            </Group>
            <Grid mt={4} gap="md">
              <Grid.Col span={{ base: 6, sm: 3 }}>
                <InfoItem label="Marca / Modelo" value={`${vehiculo.marca} ${vehiculo.modelo}`} />
              </Grid.Col>
              <Grid.Col span={{ base: 6, sm: 3 }}>
                <InfoItem label="Año del modelo" value={vehiculo.modelo_anio != null ? String(vehiculo.modelo_anio) : null} />
              </Grid.Col>
              <Grid.Col span={{ base: 6, sm: 3 }}>
                <InfoItem label="Serie" value={vehiculo.serie} />
              </Grid.Col>
              {vehiculo.tipo !== 'montacargas' && (
                <Grid.Col span={{ base: 6, sm: 3 }}>
                  <InfoItem label="Placas" value={vehiculo.placas} />
                </Grid.Col>
              )}
              <Grid.Col span={{ base: 6, sm: 3 }}>
                <InfoItem
                  label="Seguro"
                  value={vehiculo.seguro_id !== null
                    ? `${vehiculo.seguro_poliza} — ${vehiculo.seguro_compania}`
                    : null}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 6, sm: 3 }}>
                <InfoItem
                  label="Permiso de circulación"
                  value={vehiculo.permiso_id !== null
                    ? `${vehiculo.permiso_zona} (expira ${vehiculo.permiso_expiracion})`
                    : null}
                />
              </Grid.Col>
              {vehiculo.kilometraje !== null && (
                <Grid.Col span={{ base: 6, sm: 3 }}>
                  {editingKm ? (
                    <NumberInput
                      label="Kilometraje" size="xs" autoFocus min={0} suffix=" km" thousandSeparator=","
                      value={kmDraft}
                      onChange={(v) => setKmDraft(v as number | '')}
                      onBlur={saveKm}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter')  { e.preventDefault(); saveKm() }
                        if (e.key === 'Escape') setEditingKm(false)
                      }}
                    />
                  ) : (
                    <Tooltip label="Doble clic para editar" openDelay={400}>
                      <div onDoubleClick={startEditKm} style={{ cursor: 'pointer' }}>
                        <InfoItem label="Kilometraje" value={`${vehiculo.kilometraje.toLocaleString('es-MX')} km`} />
                      </div>
                    </Tooltip>
                  )}
                </Grid.Col>
              )}
              {vehiculo.combustible && (
                <Grid.Col span={{ base: 6, sm: 3 }}>
                  <InfoItem label="Combustible" value={vehiculo.combustible} />
                </Grid.Col>
              )}
              {(vehiculo.tipo === 'camion' || vehiculo.tipo === 'montacargas') && vehiculo.sucursal && (
                <Grid.Col span={{ base: 6, sm: 3 }}>
                  <InfoItem label="Sucursal" value={vehiculo.sucursal} />
                </Grid.Col>
              )}
              {vehiculo.tipo === 'tractocamion' && (
                <>
                  {vehiculo.ruta && (
                    <Grid.Col span={{ base: 6, sm: 3 }}>
                      <InfoItem label="Traslado" value={vehiculo.ruta} />
                    </Grid.Col>
                  )}
                  {vehiculo.tonelaje !== null && (
                    <Grid.Col span={{ base: 6, sm: 3 }}>
                      <InfoItem label="Tonelaje" value={`${vehiculo.tonelaje} ton`} />
                    </Grid.Col>
                  )}
                  {vehiculo.tenencia && (
                    <Grid.Col span={{ base: 6, sm: 3 }}>
                      <InfoItem label="Tenencia" value={vehiculo.tenencia} />
                    </Grid.Col>
                  )}
                </>
              )}
              {vehiculo.tipo === 'caja_trailer' && vehiculo.pies !== null && (
                <Grid.Col span={{ base: 6, sm: 3 }}>
                  <InfoItem label="Pies" value={`${vehiculo.pies} pies`} />
                </Grid.Col>
              )}
              {vehiculo.ubicacion && (
                <Grid.Col span={{ base: 6, sm: 4 }}>
                  <InfoItem label="Ubicación" value={vehiculo.ubicacion} />
                </Grid.Col>
              )}
              {vehiculo.fecha_compra && (
                <Grid.Col span={{ base: 6, sm: 3 }}>
                  <InfoItem
                    label="Fecha de compra"
                    value={new Date(vehiculo.fecha_compra).toLocaleDateString('es-MX', {
                      day: '2-digit', month: 'short', year: 'numeric',
                    })}
                  />
                </Grid.Col>
              )}
            </Grid>
          </Stack>
          <Group gap="xs" wrap="nowrap">
            <Tooltip label="Editar vehículo">
              <ActionIcon variant="light" color="blue" size="lg" onClick={() => onEdit(vehiculo)}>
                <IconPencil size={16} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Eliminar vehículo">
              <ActionIcon variant="light" color="red" size="lg"
                aria-label="Eliminar vehículo" onClick={() => onDelete(vehiculo)}>
                <IconTrash size={16} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>
      </Paper>

      {/* Refacción que usa esta unidad por cada tipo que pide su modelo */}
      <PiezasVehiculoSection vehiculoId={vehiculo.id} />

      {/* Requerimientos exclusivos */}
      <RequerimientosSection
        vehiculo={vehiculo}
        mantenimientos={mantData?.data ?? []}
        overdueIds={overdueIds}
        warnIds={warnIds}
      />

      {/* Mantenimientos */}
      <MantenimientosSection vehiculoId={vehiculo.id} tipoVehiculo={vehiculo.tipo} />

      {/* Recargas de combustible */}
      <RecargasSection vehiculoId={vehiculo.id} />
    </Stack>
  )
}

// ── Tabla reutilizable de vehículos ────────────────────────────────────────────

function tipoOrden(t: TipoVehiculo): number {
  return TIPOS.findIndex((x) => x.value === t)
}

function compareVehiculos(a: VehiculoRow, b: VehiculoRow): number {
  const porTipo = tipoOrden(a.tipo) - tipoOrden(b.tipo)
  if (porTipo !== 0) return porTipo
  const porModelo = `${a.marca} ${a.modelo}`.localeCompare(`${b.marca} ${b.modelo}`, 'es-MX')
  if (porModelo !== 0) return porModelo
  return a.serie.localeCompare(b.serie, 'es-MX', { numeric: true })
}

interface KmEditProps {
  editingKmId:    number | null
  kmDraft:        number | ''
  setKmDraft:     (v: number | '') => void
  startEditKm:    (v: VehiculoRow, e: React.MouseEvent) => void
  saveKm:         (v: VehiculoRow) => void
  setEditingKmId: (id: number | null) => void
}

function VehiculosTable({
  items, showTipo = false, extraColumn, onSelect, onEdit, onDelete, km,
}: {
  items:        VehiculoRow[]
  showTipo?:    boolean
  extraColumn?: { header: string; render: (v: VehiculoRow) => string | null }
  onSelect:     (v: VehiculoRow) => void
  onEdit:       (v: VehiculoRow, e?: React.MouseEvent) => void
  onDelete:     (v: VehiculoRow, e: React.MouseEvent) => void
  km:           KmEditProps
}) {
  if (items.length === 0) {
    return <Text c="dimmed" size="sm" py="sm">Sin vehículos en este grupo.</Text>
  }
  const sorted = [...items].sort(compareVehiculos)
  return (
    <Table.ScrollContainer minWidth={showTipo ? 750 : 650}>
      <Table striped highlightOnHover withTableBorder>
        <Table.Thead>
          <Table.Tr>
            {showTipo && <Table.Th>Tipo</Table.Th>}
            <Table.Th>Marca / Modelo</Table.Th>
            <Table.Th>Serie</Table.Th>
            <Table.Th>Placas</Table.Th>
            {extraColumn && <Table.Th>{extraColumn.header}</Table.Th>}
            <Table.Th style={{ textAlign: 'center' }}>Status</Table.Th>
            <Table.Th style={{ textAlign: 'right', width: 140 }}>Kilometraje</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {sorted.map((v) => {
            const ti = tipoInfo(v.tipo)
            return (
              <Table.Tr key={v.id} onClick={() => onSelect(v)} style={{ cursor: 'pointer' }}>
                {showTipo && (
                  <Table.Td>
                    <Badge color={ti.color} variant="light" size="sm">{ti.label}</Badge>
                  </Table.Td>
                )}
                <Table.Td fw={500}>
                  <Group gap={6} wrap="nowrap">
                    <span>{v.marca} {v.modelo}</span>
                    {v.seguro_id === null && (
                      <Tooltip label="Sin seguro asignado">
                        <IconAlertTriangle size={16} color="var(--mantine-color-red-6)" />
                      </Tooltip>
                    )}
                  </Group>
                </Table.Td>
                <Table.Td>{v.serie}</Table.Td>
                <Table.Td>{v.placas ?? (v.tipo === 'montacargas' ? '' : <Text component="span" c="dimmed" size="sm">—</Text>)}</Table.Td>
                {extraColumn && (
                  <Table.Td>{extraColumn.render(v) ?? <Text component="span" c="dimmed" size="sm">—</Text>}</Table.Td>
                )}
                <Table.Td style={{ textAlign: 'center' }}>
                  {v.status
                    ? <Badge color={statusColor(v.status)} variant="light" size="sm">{v.status}</Badge>
                    : <Text c="dimmed" size="sm">—</Text>}
                </Table.Td>
                <Table.Td
                  style={{ textAlign: 'right', width: 140 }}
                  onClick={sinKilometraje(v.tipo) ? undefined : (e) => e.stopPropagation()}
                  onDoubleClick={sinKilometraje(v.tipo) ? undefined : (e) => km.startEditKm(v, e)}
                >
                  {km.editingKmId === v.id ? (
                    <NumberInput
                      autoFocus size="xs" min={0} thousandSeparator="," hideControls
                      value={km.kmDraft}
                      onChange={(val) => km.setKmDraft(val as number | '')}
                      onBlur={() => km.saveKm(v)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter')  { e.preventDefault(); km.saveKm(v) }
                        if (e.key === 'Escape') km.setEditingKmId(null)
                      }}
                      styles={{ input: { textAlign: 'right' } }}
                    />
                  ) : sinKilometraje(v.tipo) ? null : (
                    <Tooltip label="Doble clic para editar" openDelay={400}>
                      <span>
                        {v.kilometraje !== null
                          ? `${v.kilometraje.toLocaleString('es-MX')} km`
                          : <Text component="span" c="dimmed" size="sm">—</Text>}
                      </span>
                    </Tooltip>
                  )}
                </Table.Td>
                <Table.Td>
                  <Group gap={4} justify="flex-end" wrap="nowrap">
                    <Tooltip label="Editar">
                      <ActionIcon variant="subtle" color="blue" size="sm" onClick={(e) => onEdit(v, e)}>
                        <IconPencil size={14} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label="Eliminar">
                      <ActionIcon variant="subtle" color="red" size="sm" onClick={(e) => onDelete(v, e)}>
                        <IconTrash size={14} />
                      </ActionIcon>
                    </Tooltip>
                    <IconChevronRight size={14} color="var(--mantine-color-dimmed)" />
                  </Group>
                </Table.Td>
              </Table.Tr>
            )
          })}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  )
}

// ── Vista agrupada (Rutas / Sucursales / Unitarios) ────────────────────────────

// Encabezado de cada grupo del acordeón: nombre del grupo + conteo de vehículos.
// Vive a nivel de módulo para no recrearse en cada render del acordeón.
function GroupHeader({ label, count }: { label: string; count: number }) {
  return (
    <Group justify="space-between" pr="md" wrap="nowrap">
      <Text fw={600}>{label}</Text>
      <Badge variant="light" color="gray">{count}</Badge>
    </Group>
  )
}

function VehiculosAgrupados({
  vehiculos, sucursales, onSelect, onEdit, onDelete, km,
}: {
  vehiculos:  VehiculoRow[]
  sucursales: Sucursal[]
  onSelect:   (v: VehiculoRow) => void
  onEdit:     (v: VehiculoRow, e?: React.MouseEvent) => void
  onDelete:   (v: VehiculoRow, e: React.MouseEvent) => void
  km:         KmEditProps
}) {
  const rutas       = vehiculos.filter(v => v.tipo === 'tractocamion' || v.tipo === 'caja_trailer')
  const conSucursal = vehiculos.filter(v => v.tipo === 'camion' || v.tipo === 'montacargas')
  const unitarios   = vehiculos.filter(v => v.tipo === 'utilitario')
  const porSucursal = sucursales.map(s => ({ sucursal: s, items: conSucursal.filter(v => v.sucursal_id === s.id) }))
  const sinSucursal = conSucursal.filter(v => !sucursales.some(s => s.id === v.sucursal_id))

  const defaultOpen = [
    'rutas',
    ...porSucursal.map(({ sucursal }) => `suc-${sucursal.id}`),
    ...(sinSucursal.length ? ['sin-sucursal'] : []),
    'unitarios',
  ]

  return (
    <Accordion key={sucursales.map(s => s.id).join(',')} multiple defaultValue={defaultOpen} variant="separated">
      <Accordion.Item value="rutas">
        <Accordion.Control><GroupHeader label="Traslados" count={rutas.length} /></Accordion.Control>
        <Accordion.Panel>
          <VehiculosTable
            items={rutas} showTipo
            extraColumn={{ header: 'Traslado', render: v => v.ruta }}
            onSelect={onSelect} onEdit={onEdit} onDelete={onDelete} km={km}
          />
        </Accordion.Panel>
      </Accordion.Item>

      {porSucursal.map(({ sucursal, items }) => (
        <Accordion.Item key={sucursal.id} value={`suc-${sucursal.id}`}>
          <Accordion.Control><GroupHeader label={sucursal.nombre} count={items.length} /></Accordion.Control>
          <Accordion.Panel>
            <VehiculosTable items={items} showTipo onSelect={onSelect} onEdit={onEdit} onDelete={onDelete} km={km} />
          </Accordion.Panel>
        </Accordion.Item>
      ))}

      {sinSucursal.length > 0 && (
        <Accordion.Item value="sin-sucursal">
          <Accordion.Control><GroupHeader label="Sin sucursal" count={sinSucursal.length} /></Accordion.Control>
          <Accordion.Panel>
            <VehiculosTable items={sinSucursal} showTipo onSelect={onSelect} onEdit={onEdit} onDelete={onDelete} km={km} />
          </Accordion.Panel>
        </Accordion.Item>
      )}

      <Accordion.Item value="unitarios">
        <Accordion.Control><GroupHeader label="Vehículos utilitarios" count={unitarios.length} /></Accordion.Control>
        <Accordion.Panel>
          <VehiculosTable
            items={unitarios}
            extraColumn={{ header: 'Ubicación', render: v => v.ubicacion }}
            onSelect={onSelect} onEdit={onEdit} onDelete={onDelete} km={km}
          />
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  )
}

// ── Lista de vehículos ────────────────────────────────────────────────────────

export default function Vehiculos({
  initialVehiculo, initialVehiculoId, onBack, backLabel,
}: {
  initialVehiculo?:   VehiculoRow
  initialVehiculoId?: number
  // Cuando se llegó al detalle desde otra sección (Dashboard, Calendario,
  // Catálogos…), onBack regresa exactamente ahí y backLabel la nombra.
  onBack?:    () => void
  backLabel?: string
}) {
  const [page, setPage]         = useState(1)
  const [search, setSearch]     = useState('')
  const [debouncedSearch]       = useDebouncedValue(search, 400)
  const [selected, setSelected] = useState<VehiculoRow | null>(initialVehiculo ?? null)
  // True mientras se muestra el vehículo con el que se entró desde otra sección;
  // se apaga en cuanto el usuario elige otro vehículo de la lista.
  const [externalEntry, setExternalEntry] = useState(!!(initialVehiculo || initialVehiculoId))
  const searching = debouncedSearch.length > 0

  // Elegir un vehículo de la lista: deja de ser una entrada externa, así que el
  // botón de regreso vuelve a la lista y ya no a la sección de origen.
  function selectFromList(v: VehiculoRow) {
    setExternalEntry(false)
    setSelected(v)
  }

  function handleDetailBack() {
    if (externalEntry && onBack) onBack()
    else setSelected(null)
  }

  const [pendingId]      = useState(initialVehiculo ? undefined : initialVehiculoId)
  const { data: pendingVehiculoData } = useVehiculo(pendingId)
  const appliedPendingId = useRef(false)

  useEffect(() => {
    if (pendingVehiculoData && !appliedPendingId.current) {
      appliedPendingId.current = true
      setSelected(pendingVehiculoData.data)
    }
  }, [pendingVehiculoData])

  // Se borró el vehículo con el que se entró desde otra sección. Sin esto, el
  // guard de abajo volvería a mostrar el loader esperando una ficha que ya no
  // existe. Se marca desde el manejador de la baja, no durante el render.
  const [pendingBorrado, setPendingBorrado] = useState(false)

  const [formOpen,   setFormOpen]   = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [editing,    setEditing]    = useState<VehiculoRow | null>(null)
  const [deleting,   setDeleting]   = useState<VehiculoRow | null>(null)
  const [formError,  setFormError]  = useState<string | null>(null)

  // Al cambiar la búsqueda se vuelve a la página 1. Se ajusta durante el
  // render (patrón recomendado por React) en vez de en un efecto, para no
  // disparar un render extra con la página vieja.
  const [prevBusqueda, setPrevBusqueda] = useState(debouncedSearch)
  if (prevBusqueda !== debouncedSearch) {
    setPrevBusqueda(debouncedSearch)
    setPage(1)
  }

  const { data, isLoading, isError } = useVehiculos(page, debouncedSearch, undefined, undefined, undefined, searching)
  const totalPages = Math.ceil(
    (data?.pagination?.total ?? 0) / (data?.pagination?.pageSize ?? 20)
  )

  const { data: allData, isLoading: allLoading, isError: allError } =
    useVehiculos(1, '', undefined, undefined, 100, !searching)
  const { data: sucursalesData } = useSucursales()

  const createMut = useCreateVehiculo()
  const updateMut = useUpdateVehiculo()
  const deleteMut = useDeleteVehiculo()

  const [exportando, setExportando] = useState(false)

  async function handleExportPdf() {
    setExportando(true)
    try {
      const vehiculosRes = await fetchTodosLosVehiculos()
      await exportVehiculosReporteToPdf(vehiculosRes.data, sucursalesData?.data ?? [])
    } catch (e) {
      alert((e as Error).message)
    } finally {
      setExportando(false)
    }
  }

  const [editingKmId, setEditingKmId] = useState<number | null>(null)
  const [kmDraft, setKmDraft]         = useState<number | ''>('')

  function startEditKm(v: VehiculoRow, e: React.MouseEvent) {
    e.stopPropagation()
    setKmDraft(v.kilometraje ?? '')
    setEditingKmId(v.id)
  }

  function saveKm(v: VehiculoRow) {
    if (kmDraft === '' || Number(kmDraft) === v.kilometraje) { setEditingKmId(null); return }
    updateMut.mutate({ id: v.id, payload: { kilometraje: Number(kmDraft) } }, {
      onSuccess: () => setEditingKmId(null),
      onError:   () => setEditingKmId(null),
    })
  }

  const kmEdit: KmEditProps = { editingKmId, kmDraft, setKmDraft, startEditKm, saveKm, setEditingKmId }

  function openCreate() { setEditing(null); setFormError(null); setFormOpen(true) }

  function openEdit(v: VehiculoRow, e?: React.MouseEvent) {
    e?.stopPropagation()
    setEditing(v); setFormError(null); setFormOpen(true)
  }

  function openDelete(v: VehiculoRow, e: React.MouseEvent) {
    e.stopPropagation(); setDeleting(v); setDeleteOpen(true)
  }

  function handleFormSubmit(payload: VehiculoCreatePayload | VehiculoUpdatePayload) {
    setFormError(null)
    if (editing) {
      updateMut.mutate(
        { id: editing.id, payload: payload as VehiculoUpdatePayload },
        {
          onSuccess: (res) => {
            setFormOpen(false)
            if (selected?.id === editing.id) setSelected(res.data)
          },
          onError: (e: Error) => setFormError(e.message),
        }
      )
    } else {
      createMut.mutate(payload as VehiculoCreatePayload, {
        // Tras crearlo se abre su ficha, para seguir capturando sus datos
        // (requerimientos, mantenimientos) sin tener que buscarlo en la lista.
        onSuccess: (res) => {
          setFormOpen(false)
          setSelected(res.data)
        },
        onError:   (e: Error) => setFormError(e.message),
      })
    }
  }

  function handleDelete() {
    if (!deleting) return
    deleteMut.mutate(deleting.id, {
      onSuccess: () => {
        setDeleteOpen(false)
        // Si se borró el vehículo que estaba abierto ya no hay ficha que
        // mostrar: se sale por la misma vía que el botón de regreso.
        if (selected?.id === deleting.id) {
          setPendingBorrado(true)
          handleDetailBack()
        }
      },
      onError:   (e: Error) => alert(e.message),
    })
  }

  const isPending = createMut.isPending || updateMut.isPending

  // ── Esperando el vehículo referenciado desde otra pantalla ──
  if (pendingId !== undefined && !selected && !pendingBorrado) {
    return <Center py="xl"><Loader /></Center>
  }

  // ── Vista detalle ──
  if (selected) {
    return (
      <>
        <VehiculoDetalle
          vehiculo={selected}
          onBack={handleDetailBack}
          backLabel={externalEntry ? backLabel : undefined}
          onEdit={(v) => openEdit(v)}
          onDelete={(v) => { setDeleting(v); setDeleteOpen(true) }}
          onVehiculoUpdate={(v) => setSelected(v)}
        />
        <Modal
          opened={formOpen} onClose={() => setFormOpen(false)}
          title={`Editar — ${editing ? vehiculoLabel(editing) : ''}`}
          size="lg" closeOnClickOutside={false}
        >
          <VehiculoForm
            initial={editing ?? undefined}
            isPending={updateMut.isPending} error={formError}
            onSubmit={handleFormSubmit} onCancel={() => setFormOpen(false)}
          />
        </Modal>

        {/* El modal de baja se repite aquí porque la vista de detalle sale por
            este return y no llega al de la lista. Al confirmar, handleDelete
            limpia `selected` y la pantalla regresa sola al listado. */}
        <Modal opened={deleteOpen} onClose={() => setDeleteOpen(false)}
          title="Eliminar vehículo" centered size="sm">
          <Stack gap="md">
            <Text>¿Eliminar <strong>{deleting ? vehiculoLabel(deleting) : ''}</strong>? Esta acción no se puede deshacer.</Text>
            <Text size="sm" c="dimmed">
              Sus requerimientos exclusivos se eliminan automáticamente. No podrá
              eliminarse si tiene mantenimientos, recargas o vales registrados.
            </Text>
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setDeleteOpen(false)} disabled={deleteMut.isPending}>Cancelar</Button>
              <Button color="red" onClick={handleDelete} loading={deleteMut.isPending}>Eliminar</Button>
            </Group>
          </Stack>
        </Modal>
      </>
    )
  }

  // ── Vista lista ──
  const totalVehiculos = searching ? data?.pagination?.total : allData?.data?.length

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end">
        <div>
          <Text size="xl" fw={600}>Vehículos</Text>
          <Text size="sm" c="dimmed">Por traslado, sucursal y vehículos utilitarios</Text>
        </div>
        <Group gap="sm">
          {totalVehiculos != null && (
            <Text size="sm" c="dimmed">{totalVehiculos} vehículos</Text>
          )}
          <Button
            size="sm" variant="default"
            leftSection={<IconFileTypePdf size={16} />}
            loading={exportando}
            onClick={handleExportPdf}
          >
            Generar reporte
          </Button>
          <Button size="sm" onClick={openCreate}>+ Nuevo vehículo</Button>
        </Group>
      </Group>

      <TextInput
        placeholder="Buscar por nombre, marca, modelo, serie o placas…"
        value={search}
        onChange={(e) => setSearch(e.currentTarget.value)}
        rightSection={
          search ? (
            <Text component="button" size="xs" c="dimmed"
              style={{ cursor: 'pointer', background: 'none', border: 'none', padding: 0 }}
              onClick={() => setSearch('')}>✕</Text>
          ) : null
        }
      />

      {searching ? (
        isLoading ? (
          <Center py="xl"><Loader /></Center>
        ) : isError ? (
          <Alert color="red" title="Error al cargar">No se pudieron obtener los vehículos.</Alert>
        ) : data?.data?.length === 0 ? (
          <Center py="xl">
            <Text c="dimmed">No se encontraron vehículos para "{search}".</Text>
          </Center>
        ) : (
          <>
            <VehiculosTable
              items={data?.data ?? []} showTipo
              onSelect={selectFromList} onEdit={openEdit} onDelete={openDelete} km={kmEdit}
            />
            {totalPages > 1 && (
              <Group justify="center">
                <Pagination total={totalPages} value={page} onChange={setPage} size="sm" />
              </Group>
            )}
          </>
        )
      ) : allLoading ? (
        <Center py="xl"><Loader /></Center>
      ) : allError ? (
        <Alert color="red" title="Error al cargar">No se pudieron obtener los vehículos.</Alert>
      ) : (
        <VehiculosAgrupados
          vehiculos={allData?.data ?? []}
          sucursales={sucursalesData?.data ?? []}
          onSelect={selectFromList} onEdit={openEdit} onDelete={openDelete} km={kmEdit}
        />
      )}

      <Modal opened={formOpen} onClose={() => setFormOpen(false)}
        title={editing ? `Editar — ${vehiculoLabel(editing)}` : 'Nuevo vehículo'}
        size="lg" closeOnClickOutside={false}>
        <VehiculoForm
          initial={editing ?? undefined}
          isPending={isPending} error={formError}
          onSubmit={handleFormSubmit} onCancel={() => setFormOpen(false)}
        />
      </Modal>

      <Modal opened={deleteOpen} onClose={() => setDeleteOpen(false)}
        title="Eliminar vehículo" size="sm">
        <Stack gap="md">
          <Text>¿Eliminar <strong>{deleting ? vehiculoLabel(deleting) : ''}</strong>? Esta acción no se puede deshacer.</Text>
          <Text size="sm" c="dimmed">Los requerimientos exclusivos se eliminarán automáticamente.</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDeleteOpen(false)} disabled={deleteMut.isPending}>Cancelar</Button>
            <Button color="red" onClick={handleDelete} loading={deleteMut.isPending}>Eliminar</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  )
}
