// Página Modelos: catálogo de marcas/modelos de vehículos con su plantilla de
// requerimientos (mantenimientos periódicos que heredan los vehículos del
// modelo). Lista + vista de detalle con CRUD de plantilla.
import { useState, useMemo } from 'react'
import {
  Stack, Group, Text, TextInput, Textarea, Table, Badge,
  Loader, Center, Alert, Button, ActionIcon,
  Modal, Tooltip, Divider, Grid, Paper, Select, MultiSelect, Switch, NumberInput,
  Autocomplete,
} from '@mantine/core'
import { useForm } from '@mantine/form'
import { useDebouncedValue } from '@mantine/hooks'
import { IconPencil, IconTrash, IconPlus, IconArrowLeft, IconChevronRight } from '@tabler/icons-react'
import {
  useModelos, useCreateModelo, useUpdateModelo, useDeleteModelo,
} from '../hooks/useModelos'
import {
  usePlantillaModelo, useCreatePlantilla, useUpdatePlantilla, useDeletePlantilla,
} from '../hooks/usePlantilla'
import { useCategoriaOptions } from '../hooks/useCategoriaOptions'
import { useVehiculos, useCreateVehiculo, useDeleteVehiculo, vehiculoLabel } from '../hooks/useVehiculos'
import {
  useTiposPiezaModelo, useAddTiposPiezaModelo, useRemoveTipoPiezaModelo,
  useRenameEtiquetaModelo,
} from '../hooks/useTiposPiezaModelo'
import EtiquetaEditable from '../components/EtiquetaEditable'
import { useTiposPieza, useCreateTipoPieza } from '../hooks/useTiposPieza'
import type { Modelo, ModeloPayload } from '../hooks/useModelos'
import type { PlantillaRequerimiento, PlantillaPayload, TriggerMode } from '../hooks/usePlantilla'
import type {
  TipoVehiculo, VehiculoRow, VehiculoCreatePayload, VehiculoUpdatePayload,
} from '../hooks/useVehiculos'
import { VehiculoForm } from '../components/VehiculoForm'
import {
  TEXTO_SIMPLE, TEXTO_LIBRE, ANIO_MODELO,
  limpiarTextoSimple, limpiarTextoLibre, limpiarAnioModelo, KM_MAX, validarKm,
} from '../lib/validaciones'

// ── Helpers ───────────────────────────────────────────────────────────────────

const TIPOS: Record<TipoVehiculo, { label: string; color: string }> = {
  camion:       { label: 'Unidad de reparto', color: 'blue'   },
  tractocamion: { label: 'Tractocamión',      color: 'violet' },
  caja_trailer: { label: 'Caja de trailer',   color: 'orange' },
  utilitario:   { label: 'Vehículo utilitario', color: 'teal'   },
  montacargas:  { label: 'Montacargas',       color: 'yellow' },
}

const TIPOS_VEHICULO_OPTIONS = (Object.keys(TIPOS) as TipoVehiculo[])
  .map((t) => ({ value: t, label: TIPOS[t].label }))

// Tipos de vehículo que llevan kilometraje. Los que no (caja_trailer,
// montacargas) no admiten requerimientos por kilometraje.
const KM_TIPOS: TipoVehiculo[] = ['camion', 'tractocamion', 'utilitario']

// Un modelo admite requerimientos por km solo si está restringido a tipos que
// llevan kilometraje. Si no tiene restricción (permite todos, incluidos
// montacargas/caja sin km) o si alguno de sus tipos permitidos no lleva km, no
// se ofrecen disparadores por kilometraje: un vehículo sin km no podría cumplirlos.
function modeloSoportaKm(tiposPermitidos: TipoVehiculo[]) {
  return tiposPermitidos.length > 0 && tiposPermitidos.every((t) => KM_TIPOS.includes(t))
}

const TRIGGER_META: Record<TriggerMode, { label: string; color: string }> = {
  km:    { label: 'Kilometraje',  color: 'blue'   },
  meses: { label: 'Tiempo',       color: 'green'  },
  ambos: { label: 'Km + tiempo',  color: 'orange' },
}

function statusColor(s: string) {
  const v = s.toLowerCase()
  if (v === 'activo')   return 'green'
  if (v === 'inactivo') return 'red'
  if (v === 'taller')   return 'orange'
  return 'gray'
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('es-MX', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function fmtIntervalo(item: PlantillaRequerimiento) {
  const parts: string[] = []
  if (item.intervalo_km)    parts.push(`${item.intervalo_km.toLocaleString('es-MX')} km`)
  if (item.intervalo_meses) parts.push(`${item.intervalo_meses} mes${item.intervalo_meses !== 1 ? 'es' : ''}`)
  return parts.join(' / ') || '—'
}

// ── Formulario de modelo ──────────────────────────────────────────────────────

function ModeloForm({
  initial, isPending, error, onSubmit, onCancel,
}: {
  initial?: Modelo
  isPending: boolean
  error: string | null
  onSubmit: (payload: ModeloPayload) => void
  onCancel: () => void
}) {
  const isEdit = !!initial
  const AÑO_MAX = new Date().getFullYear() + 1
  const { data: modelosData } = useModelos()
  const modelos = modelosData?.data
  const form = useForm({
    initialValues: {
      marca:            initial?.marca ?? '',
      nombre:           initial?.nombre ?? '',
      anio:             initial?.anio ?? '',
      tipos_permitidos: (initial?.tipos_permitidos ?? []) as TipoVehiculo[],
    },
    validate: {
      marca: (v) =>
        !v.trim() ? 'Requerido' :
        v.length > 40 ? 'Máximo 40 caracteres' :
        !TEXTO_SIMPLE.test(v.trim()) ? 'Solo letras, números, espacios y guiones' : null,
      nombre: (v) =>
        !v.trim() ? 'Requerido' :
        v.length > 40 ? 'Máximo 40 caracteres' :
        !TEXTO_SIMPLE.test(v.trim()) ? 'Solo letras, números, espacios y guiones' : null,
      anio: (v) => {
        const s = v.trim()
        if (!s) return 'Requerido'
        if (!ANIO_MODELO.test(s)) return 'Usa AAAA o AAAA-versión (ej. 2024 o 2024-1)'
        const n = Number(s.slice(0, 4))
        if (n < 1950 || n > AÑO_MAX) return `El año debe estar entre 1950 y ${AÑO_MAX}`
        return null
      },
    },
  })

  // Marcas y nombres ya existentes, para sugerirlos (sin impedir escribir uno
  // nuevo). Los nombres se acotan a la marca elegida; si es una marca nueva o
  // sin coincidencias, se ofrecen todos.
  const marcasOpts = useMemo(
    () => [...new Set((modelos ?? []).map((m) => m.marca))].sort((a, b) => a.localeCompare(b, 'es-MX')),
    [modelos]
  )
  const marcaActual = form.values.marca.trim().toLowerCase()
  const nombresOpts = useMemo(() => {
    const delaMarca = (modelos ?? []).filter((m) => m.marca.toLowerCase() === marcaActual)
    const base = delaMarca.length ? delaMarca : (modelos ?? [])
    return [...new Set(base.map((m) => m.nombre))].sort((a, b) => a.localeCompare(b, 'es-MX'))
  }, [modelos, marcaActual])

  return (
    <form onSubmit={form.onSubmit((v) => onSubmit({
      marca: v.marca, nombre: v.nombre, anio: v.anio.trim(), tipos_permitidos: v.tipos_permitidos,
    }))}>
      <Stack gap="sm">
        <Autocomplete
          label="Marca" placeholder="Ej. Kenworth" required
          maxLength={40}
          data={marcasOpts}
          {...form.getInputProps('marca')}
          onChange={(v) => form.setFieldValue('marca', limpiarTextoSimple(v, 40))}
        />
        <Group grow align="flex-start">
          <Autocomplete
            label="Nombre de modelo" placeholder="Ej. T680" required
            maxLength={40}
            data={nombresOpts}
            {...form.getInputProps('nombre')}
            onChange={(v) => form.setFieldValue('nombre', limpiarTextoSimple(v, 40))}
          />
          <TextInput
            label="Año" placeholder="Ej. 2024" required
            maxLength={6}
            inputMode="numeric"
            {...form.getInputProps('anio')}
            onChange={(e) => form.setFieldValue('anio', limpiarAnioModelo(e.currentTarget.value))}
          />
        </Group>
        <MultiSelect
          label="Tipos de vehículo permitidos"
          description="Qué tipos se pueden crear con este modelo. Vacío = todos permitidos."
          placeholder={form.values.tipos_permitidos.length ? undefined : 'Todos los tipos'}
          data={TIPOS_VEHICULO_OPTIONS}
          clearable
          {...form.getInputProps('tipos_permitidos')}
        />

        {isEdit && initial && (
          <>
            <Divider mt={4} />
            <Stack gap={6}>
              <Grid>
                <Grid.Col span={6}>
                  <Text size="xs" c="dimmed">Creado</Text>
                  <Text size="sm">{fmtDate(initial.created_at)}</Text>
                </Grid.Col>
                <Grid.Col span={6}>
                  <Text size="xs" c="dimmed">Última modificación</Text>
                  <Text size="sm">{fmtDate(initial.updated_at)}</Text>
                </Grid.Col>
              </Grid>
            </Stack>
          </>
        )}

        {error && <Alert color="red" title="Error">{error}</Alert>}
        <Group justify="flex-end" mt="xs">
          <Button variant="default" onClick={onCancel} disabled={isPending}>Cancelar</Button>
          <Button type="submit" loading={isPending}>
            {isEdit ? 'Guardar cambios' : 'Crear modelo'}
          </Button>
        </Group>
      </Stack>
    </form>
  )
}

// ── Formulario de plantilla ───────────────────────────────────────────────────

function PlantillaForm({
  initial, isPending, error, onSubmit, onCancel, soportaKm,
}: {
  initial?: PlantillaRequerimiento
  isPending: boolean
  error: string | null
  onSubmit: (payload: PlantillaPayload) => void
  onCancel: () => void
  // Si el modelo no genera vehículos con kilometraje, no se ofrecen los
  // disparadores por km (solo por tiempo).
  soportaKm: boolean
}) {
  const form = useForm({
    initialValues: {
      nombre:          initial?.nombre ?? '',
      descripcion:     initial?.descripcion ?? '',
      categoria:       initial?.categoria ?? '',
      trigger_mode:    (initial?.trigger_mode ?? (soportaKm ? 'km' : 'meses')) as TriggerMode,
      intervalo_km:    initial?.intervalo_km ?? (null as number | null),
      intervalo_meses: initial?.intervalo_meses ?? (null as number | null),
      activo:          initial?.activo ?? true,
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
      intervalo_km: (v, vals) =>
        (vals.trigger_mode === 'km' || vals.trigger_mode === 'ambos') && !v ? 'Requerido' : validarKm(v),
      intervalo_meses: (v, vals) =>
        (vals.trigger_mode === 'meses' || vals.trigger_mode === 'ambos') && !v ? 'Requerido' : null,
    },
  })

  const mode = form.values.trigger_mode

  const { options: categoriaOptions, setSearch: setCategoriaSearch } =
    useCategoriaOptions(form.values.categoria, initial?.categoria)

  function handleSubmit(vals: typeof form.values) {
    onSubmit({
      nombre:          vals.nombre.trim(),
      descripcion:     vals.descripcion.trim(),
      categoria:       vals.categoria.trim(),
      trigger_mode:    vals.trigger_mode,
      intervalo_km:    (mode === 'km'    || mode === 'ambos') ? vals.intervalo_km    : null,
      intervalo_meses: (mode === 'meses' || mode === 'ambos') ? vals.intervalo_meses : null,
      activo:          vals.activo,
    })
  }

  return (
    <form onSubmit={form.onSubmit(handleSubmit)}>
      <Stack gap="sm">
        <TextInput
          label="Nombre" placeholder="Ej. Cambio de filtro de aceite"
          required maxLength={40}
          {...form.getInputProps('nombre')}
          onChange={(e) => form.setFieldValue('nombre', limpiarTextoSimple(e.currentTarget.value, 40))}
        />
        <Textarea
          label="Descripción" placeholder="Instrucciones o detalles adicionales"
          required autosize minRows={2} maxLength={255}
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
          onChange={(v) => { form.setFieldValue('categoria', v ?? ''); setCategoriaSearch('') }}
        />
        <Select
          label="Disparador" required
          description={soportaKm ? undefined : 'Para disparadores por kilometraje, restringe el modelo a tipos con km (unidad de reparto, tractocamión o utilitario).'}
          data={soportaKm ? [
            { value: 'km',    label: 'Por kilometraje' },
            { value: 'meses', label: 'Por tiempo (meses)' },
            { value: 'ambos', label: 'Kilometraje y tiempo' },
          ] : [
            { value: 'meses', label: 'Por tiempo (meses)' },
          ]}
          {...form.getInputProps('trigger_mode')}
        />
        {(mode === 'km' || mode === 'ambos') && (
          <NumberInput
            label="Intervalo de kilometraje" required min={1} max={KM_MAX}
            suffix=" km" thousandSeparator=","
            allowDecimal={false} allowNegative={false} clampBehavior="strict"
            {...form.getInputProps('intervalo_km')}
          />
        )}
        {(mode === 'meses' || mode === 'ambos') && (
          <NumberInput
            label="Intervalo en meses" required min={1}
            suffix=" meses"
            allowDecimal={false} allowNegative={false}
            {...form.getInputProps('intervalo_meses')}
          />
        )}
        <Switch label="Activo" {...form.getInputProps('activo', { type: 'checkbox' })} />

        {error && <Alert color="red" title="Error">{error}</Alert>}
        <Group justify="flex-end" mt="xs">
          <Button variant="default" onClick={onCancel} disabled={isPending}>Cancelar</Button>
          <Button type="submit" loading={isPending}>
            {initial ? 'Guardar cambios' : 'Crear requerimiento preventivo'}
          </Button>
        </Group>
      </Stack>
    </form>
  )
}

// ── Sección plantilla ─────────────────────────────────────────────────────────

function PlantillaSection({ modeloId, tiposPermitidos }: { modeloId: number; tiposPermitidos: TipoVehiculo[] }) {
  const soportaKm = modeloSoportaKm(tiposPermitidos)
  const [formOpen, setFormOpen]   = useState(false)
  const [editing, setEditing]     = useState<PlantillaRequerimiento | null>(null)
  const [deleting, setDeleting]   = useState<PlantillaRequerimiento | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const { data, isLoading } = usePlantillaModelo(modeloId)
  const items      = data?.data ?? []
  const createMut  = useCreatePlantilla(modeloId)
  const updateMut  = useUpdatePlantilla(modeloId)
  const deleteMut  = useDeletePlantilla(modeloId)

  function openCreate() { setEditing(null); setFormError(null); setFormOpen(true) }
  function openEdit(item: PlantillaRequerimiento) { setEditing(item); setFormError(null); setFormOpen(true) }

  function handleSubmit(payload: PlantillaPayload) {
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
            <Text size="sm" fw={500}>Plantilla de requerimientos preventivos ({items.length})</Text>
            <Tooltip label="Agregar requerimiento preventivo">
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
            <Text c="dimmed" size="sm">No hay requerimientos preventivos definidos para este modelo.</Text>
            <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={openCreate}>
              Agregar requerimiento preventivo
            </Button>
          </Stack>
        </Center>
      ) : (
        <Table.ScrollContainer minWidth={500}>
          <Table striped highlightOnHover withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Nombre</Table.Th>
                <Table.Th>Categoría</Table.Th>
                <Table.Th>Disparador</Table.Th>
                <Table.Th>Intervalo</Table.Th>
                <Table.Th style={{ textAlign: 'center' }}>Activo</Table.Th>
                <Table.Th style={{ width: 80 }} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {items.map((item) => {
                const tm = TRIGGER_META[item.trigger_mode]
                return (
                  <Table.Tr key={item.id}>
                    <Table.Td fw={500}>{item.nombre}</Table.Td>
                    <Table.Td>
                      {item.categoria ?? <Text component="span" c="dimmed" size="sm">—</Text>}
                    </Table.Td>
                    <Table.Td>
                      <Badge variant="light" color={tm.color} size="sm">{tm.label}</Badge>
                    </Table.Td>
                    <Table.Td><Text size="sm">{fmtIntervalo(item)}</Text></Table.Td>
                    <Table.Td style={{ textAlign: 'center' }}>
                      <Badge variant="dot" color={item.activo ? 'green' : 'gray'} size="sm">
                        {item.activo ? 'Sí' : 'No'}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Group gap={4} justify="flex-end">
                        <Tooltip label="Editar">
                          <ActionIcon variant="subtle" color="blue" size="sm" onClick={() => openEdit(item)}>
                            <IconPencil size={14} />
                          </ActionIcon>
                        </Tooltip>
                        <Tooltip label="Eliminar">
                          <ActionIcon variant="subtle" color="red" size="sm" onClick={() => setDeleting(item)}>
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
      )}

      <Modal
        opened={formOpen} onClose={() => setFormOpen(false)}
        title={editing ? 'Editar requerimiento preventivo' : 'Nuevo requerimiento preventivo de plantilla'}
        centered size="md"
      >
        <PlantillaForm
          initial={editing ?? undefined}
          isPending={createMut.isPending || updateMut.isPending}
          error={formError}
          soportaKm={soportaKm}
          onSubmit={handleSubmit}
          onCancel={() => setFormOpen(false)}
        />
      </Modal>

      <Modal
        opened={deleting !== null} onClose={() => setDeleting(null)}
        title="Eliminar requerimiento preventivo de plantilla" centered size="sm"
      >
        <Stack gap="md">
          <Text>¿Estás seguro de eliminar <strong>{deleting?.nombre}</strong>?</Text>
          <Alert color="orange" title="Atención" variant="light">
            Todos los vehículos con este modelo perderán este requerimiento preventivo.
          </Alert>
          {deleteMut.error && <Alert color="red" title="Error">{(deleteMut.error as Error).message}</Alert>}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDeleting(null)} disabled={deleteMut.isPending}>Cancelar</Button>
            <Button color="red" loading={deleteMut.isPending}
              onClick={() => deleteMut.mutate(deleting!.id, { onSuccess: () => setDeleting(null) })}>
              Sí, eliminar
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  )
}

// ── Sección de tipos de pieza del modelo (relación n-n informativa) ───────────

// Valor centinela del selector: al elegirlo se crea el tipo que el usuario
// escribió, en vez de asignar uno existente.
const CREAR_TIPO = '__crear__'

function TiposPiezaModeloSection({ modeloId }: { modeloId: number }) {
  const [seleccion, setSeleccion] = useState<string[]>([])
  const [busqueda, setBusqueda]   = useState('')
  const [etiqueta, setEtiqueta]   = useState('')
  const { data, isLoading }       = useTiposPiezaModelo(modeloId)
  const { data: tiposData }       = useTiposPieza()
  const addMut    = useAddTiposPiezaModelo()
  const removeMut = useRemoveTipoPiezaModelo()
  const renameMut = useRenameEtiquetaModelo()
  const crearMut  = useCreateTipoPieza()

  // Memoizado porque el `?? []` daría un arreglo nuevo en cada render y con él
  // se recalcularían los useMemo que dependen de la lista.
  const asignados = useMemo(() => data?.data ?? [], [data])

  // Ningún tipo se filtra: el modelo puede pedir el mismo varias veces mientras
  // cada renglón lleve una etiqueta distinta. Lo que ya está se marca en la
  // opción para que se vea con qué etiquetas se pidió y no se repita una.
  const opciones = useMemo(() => {
    const todos = tiposData?.data ?? []
    const opts = todos.map((t) => {
      const puestos = asignados
        .filter((a) => a.id === t.id)
        .map((a) => a.etiqueta || 'sin etiqueta')
      return {
        value: String(t.id),
        label: puestos.length ? `${t.nombre} — ya: ${puestos.join(', ')}` : t.nombre,
      }
    })

    const nuevo = busqueda.trim()
    const yaExiste = todos.some((t) => t.nombre.toLowerCase() === nuevo.toLowerCase())
    if (nuevo && !yaExiste) {
      opts.unshift({ value: CREAR_TIPO, label: `+ Crear tipo "${nuevo}"` })
    }
    return opts
  }, [tiposData, asignados, busqueda])

  // Repetir un tipo exige etiqueta nueva: sin ella el backend rechaza el alta.
  // Se avisa antes de mandarla para que el error no llegue después del clic.
  const choque = useMemo(() => {
    const et = etiqueta.trim()
    const ya = asignados.find(
      (a) => seleccion.includes(String(a.id)) && a.etiqueta === et
    )
    if (!ya) return null
    return et === ''
      ? `Este modelo ya pide ${ya.nombre}. Ponle una etiqueta para pedirlo otra vez.`
      : `Este modelo ya pide ${ya.nombre} con la etiqueta "${et}".`
  }, [asignados, seleccion, etiqueta])

  // Crear se resuelve al instante: el centinela no puede quedarse en la
  // selección porque no es un id que el backend pueda recibir.
  function handleChange(values: string[]) {
    if (!values.includes(CREAR_TIPO)) { setSeleccion(values); return }
    const nombre = busqueda.trim()
    if (!nombre) return
    crearMut.mutate(nombre, {
      onSuccess: ({ data: tipo }) => {
        setSeleccion([...values.filter((v) => v !== CREAR_TIPO), String(tipo.id)])
        setBusqueda('')
      },
    })
  }

  function handleAgregar() {
    if (seleccion.length === 0 || choque) return
    addMut.mutate(
      { modeloId, tipoIds: seleccion.map(Number), etiqueta: etiqueta.trim() },
      { onSuccess: () => { setSeleccion([]); setEtiqueta('') } },
    )
  }

  return (
    <>
      <Divider
        label={<Text size="sm" fw={500}>Tipos de pieza del modelo ({asignados.length})</Text>}
        labelPosition="left"
      />
      <Text size="xs" c="dimmed">
        Qué necesita este modelo, sin decir cuál: un filtro de aire, una batería… La refacción concreta
        que usa cada unidad se captura en el vehículo. Es informativo: no afecta el inventario.
        Si el modelo lleva dos piezas del mismo tipo, agrégalo dos veces con una etiqueta distinta
        (delantero / trasero): cada renglón lleva su propia refacción e historial en cada unidad.
      </Text>

      <Group align="flex-end" gap="sm" wrap="nowrap">
        <MultiSelect
          flex={1}
          searchable clearable
          placeholder="Selecciona o escribe para crear un tipo"
          data={opciones}
          value={seleccion}
          onChange={handleChange}
          searchValue={busqueda}
          // Allowlist: solo letras, números, espacios y guiones (máx. 40)
          onSearchChange={(v) => setBusqueda(limpiarTextoSimple(v, 40))}
          nothingFoundMessage="Escribe para crear un tipo nuevo"
        />
        <TextInput
          w={200}
          label="Etiqueta"
          description="Opcional"
          placeholder="Delantero, trasero…"
          value={etiqueta}
          onChange={(e) => setEtiqueta(limpiarTextoSimple(e.currentTarget.value, 40))}
        />
        <Button
          leftSection={<IconPlus size={16} />}
          onClick={handleAgregar}
          loading={addMut.isPending || crearMut.isPending}
          disabled={seleccion.length === 0 || choque !== null}
        >
          Agregar
        </Button>
      </Group>
      {choque && <Alert color="yellow" variant="light">{choque}</Alert>}
      {crearMut.error && <Alert color="red">{(crearMut.error as Error).message}</Alert>}
      {addMut.error   && <Alert color="red">{(addMut.error   as Error).message}</Alert>}
      {removeMut.error && <Alert color="red">{(removeMut.error as Error).message}</Alert>}
      {renameMut.error && <Alert color="red">{(renameMut.error as Error).message}</Alert>}

      {isLoading ? (
        <Center py="md"><Loader size="sm" /></Center>
      ) : asignados.length === 0 ? (
        <Text c="dimmed" size="sm" py="sm">Este modelo no tiene tipos de pieza registrados.</Text>
      ) : (
        <Table.ScrollContainer minWidth={360}>
          <Table striped highlightOnHover withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Tipo de pieza</Table.Th>
                <Table.Th style={{ width: 180 }}>Etiqueta</Table.Th>
                <Table.Th style={{ width: 48 }} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {/* La clave es el renglón, no el tipo: el mismo tipo puede aparecer
                  varias veces con etiquetas distintas. */}
              {asignados.map((t) => (
                <Table.Tr key={`${t.id}|${t.etiqueta}`}>
                  <Table.Td fw={500}>{t.nombre}</Table.Td>
                  <Table.Td>
                    <EtiquetaEditable
                      etiqueta={t.etiqueta}
                      isPending={
                        renameMut.isPending &&
                        renameMut.variables?.tipoId === t.id &&
                        renameMut.variables?.etiqueta === t.etiqueta
                      }
                      onGuardar={(etiquetaNueva) => renameMut.mutate({
                        modeloId, tipoId: t.id, etiqueta: t.etiqueta, etiquetaNueva,
                      })}
                    />
                  </Table.Td>
                  <Table.Td>
                    <Tooltip label="Quitar del modelo (borra la refacción que sus vehículos tenían elegida para este renglón)">
                      <ActionIcon
                        variant="subtle" color="red" size="sm"
                        loading={
                          removeMut.isPending &&
                          removeMut.variables?.tipoId === t.id &&
                          removeMut.variables?.etiqueta === t.etiqueta
                        }
                        onClick={() => removeMut.mutate({ modeloId, tipoId: t.id, etiqueta: t.etiqueta })}
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
    </>
  )
}

// ── Vista de detalle ──────────────────────────────────────────────────────────

function ModeloDetalle({
  modelo, onBack, onEdit, onDelete, onNavigateVehiculo,
}: {
  modelo: Modelo
  onBack: () => void
  onEdit: (m: Modelo) => void
  onDelete: (m: Modelo) => void
  onNavigateVehiculo?: (v: VehiculoRow) => void
}) {
  const { data, isLoading, isError } = useVehiculos(1, '', undefined, modelo.id)
  const vehiculos = data?.data ?? []

  const [vehiculoFormOpen, setVehiculoFormOpen] = useState(false)
  const [vehiculoError, setVehiculoError] = useState<string | null>(null)
  const createVehiculoMut = useCreateVehiculo()

  // Baja de un vehículo del modelo. Al borrarse se invalida la query de
  // vehículos, así que la tabla de aquí se refresca sola.
  const [deletingVehiculo, setDeletingVehiculo] = useState<VehiculoRow | null>(null)
  const deleteVehiculoMut = useDeleteVehiculo()

  function openCreateVehiculo() {
    setVehiculoError(null)
    setVehiculoFormOpen(true)
  }

  function handleCreateVehiculo(payload: VehiculoCreatePayload | VehiculoUpdatePayload) {
    setVehiculoError(null)
    createVehiculoMut.mutate(payload as VehiculoCreatePayload, {
      onSuccess: () => setVehiculoFormOpen(false),
      onError:   (e: Error) => setVehiculoError(e.message),
    })
  }

  return (
    <Stack gap="md">
      {/* Navegación */}
      <Group gap="xs">
        <ActionIcon variant="subtle" color="gray" onClick={onBack}>
          <IconArrowLeft size={18} />
        </ActionIcon>
        <Text size="sm" c="dimmed">Modelos</Text>
        <Text size="sm" c="dimmed">/</Text>
        <Text size="sm">{modelo.marca} {modelo.nombre}</Text>
      </Group>

      {/* Datos del modelo */}
      <Paper withBorder p="md" radius="md">
        <Group justify="space-between" align="flex-start">
          <Stack gap={4}>
            <Group gap="sm" align="baseline">
              <Text size="xl" fw={700}>{modelo.nombre}</Text>
              <Badge variant="light" color="gray" size="lg">{modelo.marca}</Badge>
              {modelo.anio != null && <Badge variant="light" color="blue" size="lg">{modelo.anio}</Badge>}
            </Group>
            <Grid mt={4}>
              <Grid.Col span={{ base: 12, sm: 6 }}>
                <Text size="xs" c="dimmed">Creado</Text>
                <Text size="sm">{fmtDate(modelo.created_at)}</Text>
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 6 }}>
                <Text size="xs" c="dimmed">Última modificación</Text>
                <Text size="sm">{fmtDate(modelo.updated_at)}</Text>
              </Grid.Col>
              <Grid.Col span={12}>
                <Text size="xs" c="dimmed">Tipos de vehículo permitidos</Text>
                {(modelo.tipos_permitidos ?? []).length === 0 ? (
                  <Text size="sm" c="dimmed">Todos</Text>
                ) : (
                  <Group gap={4} mt={2}>
                    {(modelo.tipos_permitidos ?? []).map((t) => (
                      <Badge key={t} variant="light" color={TIPOS[t]?.color} size="sm">
                        {TIPOS[t]?.label ?? t}
                      </Badge>
                    ))}
                  </Group>
                )}
              </Grid.Col>
            </Grid>
          </Stack>
          <Group gap="xs" wrap="nowrap">
            <Tooltip label="Editar modelo">
              <ActionIcon variant="light" color="blue" size="lg" onClick={() => onEdit(modelo)}>
                <IconPencil size={16} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Eliminar modelo">
              <ActionIcon variant="light" color="red" size="lg"
                aria-label="Eliminar modelo" onClick={() => onDelete(modelo)}>
                <IconTrash size={16} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>
      </Paper>

      {/* Plantilla de requerimientos preventivos */}
      <PlantillaSection modeloId={modelo.id} tiposPermitidos={modelo.tipos_permitidos ?? []} />

      {/* Piezas específicas del modelo */}
      <TiposPiezaModeloSection modeloId={modelo.id} />

      {/* Vehículos asignados */}
      <Divider
        label={
          <Group gap="xs">
            <Text size="sm" fw={500}>Vehículos asignados ({vehiculos.length})</Text>
            <Tooltip label="Agregar vehículo de este modelo">
              <ActionIcon variant="light" color="blue" size="xs" onClick={openCreateVehiculo}>
                <IconPlus size={12} />
              </ActionIcon>
            </Tooltip>
          </Group>
        }
        labelPosition="left"
      />

      {isLoading ? (
        <Center py="xl"><Loader /></Center>
      ) : isError ? (
        <Alert color="red" title="Error">No se pudieron cargar los vehículos.</Alert>
      ) : vehiculos.length === 0 ? (
        <Center py="xl">
          <Text c="dimmed">No hay vehículos asignados a este modelo.</Text>
        </Center>
      ) : (
        <Table.ScrollContainer minWidth={500}>
          <Table striped highlightOnHover withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Serie</Table.Th>
                <Table.Th>Tipo</Table.Th>
                <Table.Th>Placas</Table.Th>
                <Table.Th style={{ textAlign: 'center' }}>Status</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Kilometraje</Table.Th>
                <Table.Th style={{ width: 40 }} />
                {onNavigateVehiculo && <Table.Th style={{ width: 32 }} />}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {vehiculos.map((v) => {
                const t = TIPOS[v.tipo]
                return (
                  <Table.Tr
                    key={v.id}
                    onClick={() => onNavigateVehiculo?.(v)}
                    style={{ cursor: onNavigateVehiculo ? 'pointer' : undefined }}
                  >
                    <Table.Td fw={500}>{v.serie}</Table.Td>
                    <Table.Td>
                      <Badge color={t.color} variant="light" size="sm">{t.label}</Badge>
                    </Table.Td>
                    <Table.Td>{v.placas ?? (v.tipo === 'montacargas' ? '' : <Text component="span" c="dimmed" size="sm">—</Text>)}</Table.Td>
                    <Table.Td style={{ textAlign: 'center' }}>
                      {v.status
                        ? <Badge color={statusColor(v.status)} variant="light" size="sm">{v.status}</Badge>
                        : <Text c="dimmed" size="sm">—</Text>}
                    </Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>
                      {v.kilometraje !== null
                        ? `${v.kilometraje.toLocaleString('es-MX')} km`
                        : <Text component="span" c="dimmed" size="sm">—</Text>}
                    </Table.Td>
                    <Table.Td>
                      <Tooltip label="Eliminar vehículo">
                        <ActionIcon
                          variant="subtle" color="red" size="sm"
                          aria-label="Eliminar vehículo"
                          // El renglón navega al vehículo: sin esto, borrar
                          // abriría también su ficha.
                          onClick={(e) => { e.stopPropagation(); setDeletingVehiculo(v) }}
                        >
                          <IconTrash size={14} />
                        </ActionIcon>
                      </Tooltip>
                    </Table.Td>
                    {onNavigateVehiculo && (
                      <Table.Td>
                        <IconChevronRight size={14} color="var(--mantine-color-dimmed)" />
                      </Table.Td>
                    )}
                  </Table.Tr>
                )
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}

      <Modal
        opened={vehiculoFormOpen}
        onClose={() => setVehiculoFormOpen(false)}
        title={`Nuevo vehículo — ${modelo.marca} ${modelo.nombre}`}
        size="lg"
        closeOnClickOutside={false}
      >
        <VehiculoForm
          lockedModeloId={modelo.id}
          isPending={createVehiculoMut.isPending}
          error={vehiculoError}
          onSubmit={handleCreateVehiculo}
          onCancel={() => setVehiculoFormOpen(false)}
        />
      </Modal>

      <Modal
        opened={deletingVehiculo !== null}
        onClose={() => setDeletingVehiculo(null)}
        title="Eliminar vehículo"
        centered
        size="sm"
      >
        <Stack gap="md">
          <Text>
            ¿Eliminar{' '}
            <strong>{deletingVehiculo ? vehiculoLabel(deletingVehiculo) : ''}</strong>?
            Esta acción no se puede deshacer.
          </Text>
          <Text size="sm" c="dimmed">
            Sus requerimientos preventivos se eliminan automáticamente. No podrá
            eliminarse si tiene mantenimientos, recargas o vales registrados.
          </Text>
          {deleteVehiculoMut.error && (
            <Alert color="red" title="Error">
              {(deleteVehiculoMut.error as Error).message}
            </Alert>
          )}
          <Group justify="flex-end">
            <Button
              variant="default"
              onClick={() => setDeletingVehiculo(null)}
              disabled={deleteVehiculoMut.isPending}
            >
              Cancelar
            </Button>
            <Button
              color="red"
              loading={deleteVehiculoMut.isPending}
              onClick={() =>
                deleteVehiculoMut.mutate(deletingVehiculo!.id, {
                  onSuccess: () => setDeletingVehiculo(null),
                })
              }
            >
              Eliminar
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  )
}

// ── Lista de modelos ──────────────────────────────────────────────────────────

export default function Modelos({
  onNavigateVehiculo, openId, onOpenIdChange,
}: {
  onNavigateVehiculo?: (v: VehiculoRow) => void
  // Modelo cuyo detalle está abierto; vive en Layout para poder regresar
  // exactamente a él al volver desde un vehículo.
  openId?:         number | null
  onOpenIdChange?: (id: number | null) => void
}) {
  const [search, setSearch]       = useState('')
  const [debounced]               = useDebouncedValue(search, 300)
  const [formOpen, setFormOpen]   = useState(false)
  const [editing, setEditing]     = useState<Modelo | null>(null)
  const [deleting, setDeleting]   = useState<Modelo | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const { data, isLoading, isError } = useModelos()
  const createMut = useCreateModelo()
  const updateMut = useUpdateModelo()
  const deleteMut = useDeleteModelo()

  // El modelo abierto se deriva del id conservado por Layout.
  const selected = (data?.data ?? []).find((m) => m.id === openId) ?? null

  function openCreate() { setEditing(null); setFormError(null); setFormOpen(true) }
  function openEdit(m: Modelo, e?: React.MouseEvent) {
    e?.stopPropagation()
    setEditing(m); setFormError(null); setFormOpen(true)
  }
  function openDelete(m: Modelo, e: React.MouseEvent) {
    e.stopPropagation(); setDeleting(m)
  }
  function handleSubmit(payload: ModeloPayload) {
    setFormError(null)
    if (editing) {
      updateMut.mutate({ id: editing.id, payload }, {
        // El detalle abierto se deriva de la lista, que se refresca al invalidar
        // la query; no hay que re-sincronizar 'selected' a mano.
        onSuccess: () => setFormOpen(false),
        onError: (e: Error) => setFormError(e.message),
      })
    } else {
      createMut.mutate(payload, {
        onSuccess: () => setFormOpen(false),
        onError:   (e: Error) => setFormError(e.message),
      })
    }
  }

  // Vista de detalle
  if (selected) {
    return (
      <>
        <ModeloDetalle
          modelo={selected}
          onBack={() => onOpenIdChange?.(null)}
          onEdit={(m) => openEdit(m)}
          onDelete={(m) => setDeleting(m)}
          onNavigateVehiculo={onNavigateVehiculo}
        />
        <Modal
          opened={formOpen} onClose={() => setFormOpen(false)}
          title={`Editar — ${editing?.marca} ${editing?.nombre}`}
          centered size="sm"
        >
          <ModeloForm
            initial={editing ?? undefined}
            isPending={updateMut.isPending} error={formError}
            onSubmit={handleSubmit} onCancel={() => setFormOpen(false)}
          />
        </Modal>

        {/* El modal de baja se repite aquí porque el detalle sale por este
            return y no alcanza el de la lista. Al borrarlo ya no hay ficha
            que mostrar, así que se cierra el detalle. */}
        <Modal
          opened={deleting !== null} onClose={() => setDeleting(null)}
          title="Eliminar modelo" centered size="sm"
        >
          <Stack gap="md">
            <Text>¿Eliminar <strong>{deleting?.marca} {deleting?.nombre}</strong>? Esta acción no se puede deshacer.</Text>
            <Text size="sm" c="dimmed">No podrá eliminarse si tiene vehículos asignados.</Text>
            {deleteMut.error && <Alert color="red" title="Error">{(deleteMut.error as Error).message}</Alert>}
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setDeleting(null)} disabled={deleteMut.isPending}>Cancelar</Button>
              <Button color="red" loading={deleteMut.isPending}
                onClick={() => deleteMut.mutate(deleting!.id, {
                  onSuccess: () => { setDeleting(null); onOpenIdChange?.(null) },
                })}>
                Eliminar
              </Button>
            </Group>
          </Stack>
        </Modal>
      </>
    )
  }

  const modelos = (data?.data ?? []).filter((m) => {
    if (!debounced) return true
    const q = debounced.toLowerCase()
    return m.marca.toLowerCase().includes(q) || m.nombre.toLowerCase().includes(q)
  })
  const marcas = [...new Set(modelos.map((m) => m.marca))].sort()
  const isPending = createMut.isPending || updateMut.isPending

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end">
        <div>
          <Text size="xl" fw={600}>Modelos de vehículos</Text>
          <Text size="sm" c="dimmed">Catálogo de marcas y modelos</Text>
        </div>
        <Group gap="sm">
          {data?.data && (
            <Text size="sm" c="dimmed">
              {modelos.length} modelo{modelos.length !== 1 ? 's' : ''}
              {marcas.length > 0 && ` · ${marcas.length} marca${marcas.length !== 1 ? 's' : ''}`}
            </Text>
          )}
          <Button leftSection={<IconPlus size={16} />} onClick={openCreate}>
            Nuevo modelo
          </Button>
        </Group>
      </Group>

      <TextInput
        placeholder="Buscar por marca o modelo…"
        value={search}
        onChange={(e) => setSearch(e.currentTarget.value)}
        rightSection={
          search ? (
            <Text
              component="button" size="xs" c="dimmed"
              style={{ cursor: 'pointer', background: 'none', border: 'none', padding: 0 }}
              onClick={() => setSearch('')}
            >✕</Text>
          ) : null
        }
      />

      {isLoading ? (
        <Center py="xl"><Loader /></Center>
      ) : isError ? (
        <Alert color="red" title="Error al cargar">No se pudieron obtener los modelos.</Alert>
      ) : modelos.length === 0 ? (
        <Center py="xl">
          <Text c="dimmed">
            {search ? `No hay modelos para "${search}".` : 'No hay modelos registrados.'}
          </Text>
        </Center>
      ) : (
        <Table.ScrollContainer minWidth={560}>
          <Table striped highlightOnHover withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Marca</Table.Th>
                <Table.Th>Modelo</Table.Th>
                <Table.Th>Año</Table.Th>
                <Table.Th>Tipos permitidos</Table.Th>
                <Table.Th>Creado</Table.Th>
                <Table.Th style={{ width: 100 }} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {modelos.map((m) => (
                <Table.Tr
                  key={m.id}
                  onClick={() => onOpenIdChange?.(m.id)}
                  style={{ cursor: 'pointer' }}
                >
                  <Table.Td>
                    <Badge variant="light" color="gray" size="sm">{m.marca}</Badge>
                  </Table.Td>
                  <Table.Td fw={500}>{m.nombre}</Table.Td>
                  <Table.Td>{m.anio ?? <Text component="span" c="dimmed" size="sm">—</Text>}</Table.Td>
                  <Table.Td>
                    {(m.tipos_permitidos ?? []).length === 0 ? (
                      <Text size="sm" c="dimmed">Todos</Text>
                    ) : (
                      <Group gap={4}>
                        {m.tipos_permitidos.map((t) => (
                          <Badge key={t} variant="light" color={TIPOS[t]?.color} size="sm">
                            {TIPOS[t]?.label ?? t}
                          </Badge>
                        ))}
                      </Group>
                    )}
                  </Table.Td>
                  <Table.Td c="dimmed">
                    <Text size="sm">
                      {new Date(m.created_at).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Group gap={4} justify="flex-end" wrap="nowrap">
                      <Tooltip label="Editar">
                        <ActionIcon variant="subtle" color="blue" size="sm" onClick={(e) => openEdit(m, e)}>
                          <IconPencil size={14} />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label="Eliminar">
                        <ActionIcon variant="subtle" color="red" size="sm" onClick={(e) => openDelete(m, e)}>
                          <IconTrash size={14} />
                        </ActionIcon>
                      </Tooltip>
                      <IconChevronRight size={14} color="var(--mantine-color-dimmed)" />
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}

      <Modal
        opened={formOpen} onClose={() => setFormOpen(false)}
        title={editing ? `Editar — ${editing.marca} ${editing.nombre}` : 'Nuevo modelo'}
        centered size="sm"
      >
        <ModeloForm
          initial={editing ?? undefined}
          isPending={isPending} error={formError}
          onSubmit={handleSubmit} onCancel={() => setFormOpen(false)}
        />
      </Modal>

      <Modal
        opened={deleting !== null} onClose={() => setDeleting(null)}
        title="Eliminar modelo" centered size="sm"
      >
        <Stack gap="md">
          <Text>¿Eliminar <strong>{deleting?.marca} {deleting?.nombre}</strong>? Esta acción no se puede deshacer.</Text>
          <Text size="sm" c="dimmed">No podrá eliminarse si tiene vehículos asignados.</Text>
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
    </Stack>
  )
}
