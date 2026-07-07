import { useForm } from '@mantine/form'
import {
  Stack, Grid, TextInput, NumberInput, Select, Divider,
  Badge, Text, Button, Group, Alert,
} from '@mantine/core'
import { DateInput } from '@mantine/dates'
import type { TipoVehiculo, VehiculoRow, VehiculoCreatePayload, VehiculoUpdatePayload } from '../hooks/useVehiculos'
import { useModelos } from '../hooks/useModelos'
import { useSucursales } from '../hooks/useSucursales'
import { useRutas } from '../hooks/useRutas'

const TIPO_META: Record<TipoVehiculo, { label: string; color: string }> = {
  camion:       { label: 'Camión',           color: 'blue'   },
  tractocamion: { label: 'Tractocamión',     color: 'violet' },
  caja_trailer: { label: 'Caja de trailer',  color: 'orange' },
  utilitario:   { label: 'Vehículo unitario',color: 'teal'   },
}

const TIPOS_OPTIONS = Object.entries(TIPO_META).map(([v, m]) => ({ value: v, label: m.label }))

const COMBUSTIBLES = ['Diesel', 'Gasolina', 'Gas LP', 'Gas Natural', 'Eléctrico'].map((c) => ({ value: c, label: c }))
const STATUSES     = ['Activo', 'Inactivo', 'Taller', 'Baja'].map((s) => ({ value: s, label: s }))

type FormVals = {
  tipo:         TipoVehiculo | ''
  vehiculo:     string
  modelo_id:    string
  serie:        string
  combustible:  string
  kilometraje:  number | string
  status:       string
  ubicacion:    string
  sucursal_id:  string
  tonelaje:     number | string
  tenencia:     string
  ruta_id:      string
  pies:         number | string
  fecha_compra: string
}

function init(v?: VehiculoRow): FormVals {
  return {
    tipo:         v?.tipo        ?? '',
    vehiculo:     v?.vehiculo    ?? '',
    modelo_id:    v?.modelo_id   != null ? String(v.modelo_id)   : '',
    serie:        v?.serie       ?? '',
    combustible:  v?.combustible ?? '',
    kilometraje:  v?.kilometraje ?? '',
    status:       v?.status      ?? '',
    ubicacion:    v?.ubicacion   ?? '',
    sucursal_id:  v?.sucursal_id != null ? String(v.sucursal_id) : '',
    tonelaje:     v?.tonelaje    ?? '',
    tenencia:     v?.tenencia    ?? '',
    ruta_id:      v?.ruta_id     != null ? String(v.ruta_id)     : '',
    pies:         v?.pies        ?? '',
    fecha_compra: v?.fecha_compra ? v.fecha_compra.split('T')[0] : '',
  }
}

function toDateLocal(iso: string): Date | null {
  if (!iso) return null
  // T12:00:00 evita que el offset de zona horaria cambie el día
  return new Date(`${iso}T12:00:00`)
}

function fromDateLocal(d: Date | null): string {
  if (!d) return ''
  const nd = d instanceof Date ? d : new Date(d as any)
  if (isNaN(nd.getTime())) return ''
  // +12h sobre medianoche UTC evita el desfase de zona horaria al leer con métodos UTC
  const safe = new Date(nd.getTime() + 12 * 60 * 60 * 1000)
  const year  = safe.getUTCFullYear()
  const month = String(safe.getUTCMonth() + 1).padStart(2, '0')
  const day   = String(safe.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function needsField(tipo: TipoVehiculo | '', check: 'combustible' | 'status' | 'km' | 'sucursal' | 'ruta' | 'tonelaje' | 'pies' | 'ubicacion') {
  const t = tipo
  if (check === 'combustible') return t === 'camion' || t === 'tractocamion' || t === 'utilitario'
  if (check === 'status')      return t === 'camion' || t === 'tractocamion' || t === 'caja_trailer' || t === 'utilitario'
  if (check === 'km')          return t === 'camion' || t === 'tractocamion' || t === 'utilitario'
  if (check === 'sucursal')    return t === 'camion'
  if (check === 'ruta')        return t === 'tractocamion'
  if (check === 'tonelaje')    return t === 'tractocamion'
  if (check === 'pies')        return t === 'caja_trailer'
  if (check === 'ubicacion')   return t === 'camion' || t === 'utilitario'
  return false
}

export interface VehiculoFormProps {
  initial?:   VehiculoRow
  isPending:  boolean
  error:      string | null
  onSubmit:   (payload: VehiculoCreatePayload | VehiculoUpdatePayload, tipo: TipoVehiculo) => void
  onCancel:   () => void
}

export function VehiculoForm({ initial, isPending, error, onSubmit, onCancel }: VehiculoFormProps) {
  const isEdit = !!initial
  const { data: modelosData } = useModelos()
  const { data: sucursalesData } = useSucursales()
  const { data: rutasData } = useRutas()

  const modelosOpts   = (modelosData?.data   ?? []).map((m) => ({ value: String(m.id), label: `${m.marca} ${m.nombre}` }))
  const sucursalesOpts = (sucursalesData?.data ?? []).map((s) => ({ value: String(s.id), label: s.nombre }))
  const rutasOpts      = (rutasData?.data      ?? []).map((r) => ({ value: String(r.id), label: r.nombre }))

  const form = useForm<FormVals>({
    initialValues: init(initial),
    validate: {
      tipo:        (v) => !isEdit && !v ? 'Requerido' : null,
      vehiculo:    (v) => !v.trim() ? 'Requerido' : null,
      modelo_id:   (v) => !v ? 'Requerido' : null,
      serie:       (v) => !v.trim() ? 'Requerido' : null,
      combustible: (v, vals) => needsField(vals.tipo, 'combustible') && !v ? 'Requerido' : null,
      status:      (v, vals) => needsField(vals.tipo, 'status')      && !v ? 'Requerido' : null,
      sucursal_id: (v, vals) => needsField(vals.tipo, 'sucursal')    && !v ? 'Requerido' : null,
      ruta_id:     (v, vals) => needsField(vals.tipo, 'ruta')        && !v ? 'Requerido' : null,
      tonelaje:    (v, vals) => needsField(vals.tipo, 'tonelaje')    && (v === '' || v === null) ? 'Requerido' : null,
      pies:        (v, vals) => needsField(vals.tipo, 'pies')        && (v === '' || v === null) ? 'Requerido' : null,
      kilometraje: (v, vals) => needsField(vals.tipo, 'km')          && (v === '' || v === null) ? 'Requerido' : null,
    },
  })

  const tipo = (isEdit ? initial!.tipo : form.values.tipo) as TipoVehiculo | ''

  function handleSubmit(vals: FormVals) {
    const t = (isEdit ? initial!.tipo : vals.tipo) as TipoVehiculo
    const base = {
      vehiculo:     vals.vehiculo,
      modelo_id:    parseInt(vals.modelo_id),
      serie:        vals.serie,
      fecha_compra: vals.fecha_compra || null,
    }

    let extra: Record<string, unknown> = {}
    if (t === 'camion') {
      extra = {
        combustible: vals.combustible,
        kilometraje: Number(vals.kilometraje),
        status:      vals.status,
        ubicacion:   vals.ubicacion || null,
        sucursal_id: parseInt(vals.sucursal_id),
      }
    } else if (t === 'tractocamion') {
      extra = {
        tonelaje:    Number(vals.tonelaje),
        combustible: vals.combustible,
        tenencia:    vals.tenencia || null,
        kilometraje: Number(vals.kilometraje),
        status:      vals.status,
        ruta_id:     parseInt(vals.ruta_id),
      }
    } else if (t === 'caja_trailer') {
      extra = {
        pies:   Number(vals.pies),
        status: vals.status,
      }
    } else {
      extra = {
        combustible: vals.combustible,
        ubicacion:   vals.ubicacion || null,
        status:      vals.status,
        kilometraje: Number(vals.kilometraje),
      }
    }

    if (isEdit) {
      onSubmit({ ...base, ...extra } as VehiculoUpdatePayload, t)
    } else {
      onSubmit({ tipo: t, ...base, ...extra } as VehiculoCreatePayload, t)
    }
  }

  const tipoMeta = tipo ? TIPO_META[tipo] : null

  return (
    <form onSubmit={form.onSubmit(handleSubmit)}>
      <Stack gap="sm">
        {error && <Alert color="red" title="Error">{error}</Alert>}

        {/* Tipo */}
        {isEdit ? (
          <Group gap="xs" align="center">
            <Text size="sm" fw={500} c="dimmed">Tipo:</Text>
            <Badge color={tipoMeta?.color} variant="light">{tipoMeta?.label}</Badge>
          </Group>
        ) : (
          <Select
            label="Tipo de vehículo"
            placeholder="Selecciona un tipo"
            data={TIPOS_OPTIONS}
            required
            {...form.getInputProps('tipo')}
          />
        )}

        {/* Campos comunes */}
        <Grid>
          <Grid.Col span={8}>
            <TextInput label="Nombre / Identificador" placeholder="Ej. Camión 01" required {...form.getInputProps('vehiculo')} />
          </Grid.Col>
          <Grid.Col span={4}>
            <TextInput label="No. de serie" placeholder="Serie" required {...form.getInputProps('serie')} />
          </Grid.Col>
        </Grid>

        <Select
          label="Marca / Modelo"
          placeholder="Selecciona un modelo"
          data={modelosOpts}
          searchable
          required
          nothingFoundMessage="Sin resultados"
          {...form.getInputProps('modelo_id')}
        />

        <DateInput
          label="Fecha de compra"
          placeholder="dd/mm/aaaa"
          valueFormat="DD/MM/YYYY"
          clearable
          maxDate={new Date()}
          value={toDateLocal(form.values.fecha_compra)}
          onChange={(d) => form.setFieldValue('fecha_compra', fromDateLocal(d as Date | null))}
        />

        {/* Campos condicionales — camion */}
        {(tipo === 'camion') && (
          <>
            <Divider label="Datos del camión" labelPosition="left" />
            <Grid>
              <Grid.Col span={6}>
                <Select label="Combustible" data={COMBUSTIBLES} placeholder="Tipo" required {...form.getInputProps('combustible')} />
              </Grid.Col>
              <Grid.Col span={6}>
                <Select label="Status" data={STATUSES} placeholder="Estado" required {...form.getInputProps('status')} />
              </Grid.Col>
              <Grid.Col span={6}>
                <NumberInput label="Kilometraje" placeholder="0" min={0} required {...form.getInputProps('kilometraje')} />
              </Grid.Col>
              <Grid.Col span={6}>
                <Select label="Sucursal" data={sucursalesOpts} placeholder="Sucursal" required searchable nothingFoundMessage="Sin resultados" {...form.getInputProps('sucursal_id')} />
              </Grid.Col>
              <Grid.Col span={12}>
                <TextInput label="Ubicación" placeholder="Ubicación actual (opcional)" {...form.getInputProps('ubicacion')} />
              </Grid.Col>
            </Grid>
          </>
        )}

        {/* Campos condicionales — tractocamion */}
        {(tipo === 'tractocamion') && (
          <>
            <Divider label="Datos del tractocamión" labelPosition="left" />
            <Grid>
              <Grid.Col span={4}>
                <NumberInput label="Tonelaje" placeholder="Ej. 20" min={1} required {...form.getInputProps('tonelaje')} />
              </Grid.Col>
              <Grid.Col span={4}>
                <Select label="Combustible" data={COMBUSTIBLES} placeholder="Tipo" required {...form.getInputProps('combustible')} />
              </Grid.Col>
              <Grid.Col span={4}>
                <Select label="Status" data={STATUSES} placeholder="Estado" required {...form.getInputProps('status')} />
              </Grid.Col>
              <Grid.Col span={6}>
                <NumberInput label="Kilometraje" placeholder="0" min={0} required {...form.getInputProps('kilometraje')} />
              </Grid.Col>
              <Grid.Col span={6}>
                <Select label="Ruta" data={rutasOpts} placeholder="Ruta asignada" required searchable nothingFoundMessage="Sin resultados" {...form.getInputProps('ruta_id')} />
              </Grid.Col>
              <Grid.Col span={12}>
                <TextInput label="Tenencia" placeholder="Folio de tenencia (opcional)" {...form.getInputProps('tenencia')} />
              </Grid.Col>
            </Grid>
          </>
        )}

        {/* Campos condicionales — caja_trailer */}
        {(tipo === 'caja_trailer') && (
          <>
            <Divider label="Datos de la caja" labelPosition="left" />
            <Grid>
              <Grid.Col span={6}>
                <NumberInput label="Capacidad (pies)" placeholder="Ej. 53" min={1} required {...form.getInputProps('pies')} />
              </Grid.Col>
              <Grid.Col span={6}>
                <Select label="Status" data={STATUSES} placeholder="Estado" required {...form.getInputProps('status')} />
              </Grid.Col>
            </Grid>
          </>
        )}

        {/* Campos condicionales — utilitario */}
        {(tipo === 'utilitario') && (
          <>
            <Divider label="Datos del vehículo" labelPosition="left" />
            <Grid>
              <Grid.Col span={6}>
                <Select label="Combustible" data={COMBUSTIBLES} placeholder="Tipo" required {...form.getInputProps('combustible')} />
              </Grid.Col>
              <Grid.Col span={6}>
                <Select label="Status" data={STATUSES} placeholder="Estado" required {...form.getInputProps('status')} />
              </Grid.Col>
              <Grid.Col span={6}>
                <NumberInput label="Kilometraje" placeholder="0" min={0} required {...form.getInputProps('kilometraje')} />
              </Grid.Col>
              <Grid.Col span={6}>
                <TextInput label="Ubicación" placeholder="Ubicación actual (opcional)" {...form.getInputProps('ubicacion')} />
              </Grid.Col>
            </Grid>
          </>
        )}

        <Group justify="flex-end" mt="xs">
          <Button variant="default" onClick={onCancel} disabled={isPending}>Cancelar</Button>
          <Button type="submit" loading={isPending} disabled={!tipo}>
            {isEdit ? 'Guardar cambios' : 'Crear vehículo'}
          </Button>
        </Group>
      </Stack>
    </form>
  )
}
