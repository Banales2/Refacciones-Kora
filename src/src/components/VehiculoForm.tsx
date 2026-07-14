// Formulario de alta/edición de vehículos: los campos visibles y requeridos
// dependen del tipo (p. ej. ruta para tractocamiones, sucursal para camiones,
// pies para cajas de trailer). En edición el tipo no puede cambiarse.
import { useState } from 'react'
import { useForm } from '@mantine/form'
import {
  Stack, Grid, TextInput, NumberInput, Select, Divider,
  Badge, Text, Button, Group, Alert, Modal,
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
  utilitario:   { label: 'Vehículo utilitario',color: 'teal'   },
  montacargas:  { label: 'Montacargas',      color: 'yellow' },
}

const TIPOS_OPTIONS = Object.entries(TIPO_META).map(([v, m]) => ({ value: v, label: m.label }))

const COMBUSTIBLES = ['Diesel', 'Gasolina', 'Gas LP', 'Gas Natural', 'Eléctrico'].map((c) => ({ value: c, label: c }))
const STATUSES     = ['Activo', 'Inactivo', 'Taller', 'Baja'].map((s) => ({ value: s, label: s }))

type FormVals = {
  tipo:         TipoVehiculo | ''
  modelo_id:    string
  serie:        string
  placas:       string
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
    modelo_id:    v?.modelo_id   != null ? String(v.modelo_id)   : '',
    serie:        v?.serie       ?? '',
    placas:       v?.placas      ?? '',
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

// Acepta Date o string porque Mantine DateInput puede entregar cualquiera de los dos en runtime
function fromDateLocal(d: Date | string | null): string {
  if (!d) return ''
  const nd = d instanceof Date ? d : new Date(d)
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
  if (check === 'combustible') return t === 'camion' || t === 'tractocamion' || t === 'utilitario' || t === 'montacargas'
  if (check === 'status')      return t === 'camion' || t === 'tractocamion' || t === 'caja_trailer' || t === 'utilitario' || t === 'montacargas'
  if (check === 'km')          return t === 'camion' || t === 'tractocamion' || t === 'utilitario'
  if (check === 'sucursal')    return t === 'camion' || t === 'montacargas'
  if (check === 'ruta')        return t === 'tractocamion' || t === 'caja_trailer'
  if (check === 'tonelaje')    return t === 'tractocamion'
  if (check === 'pies')        return t === 'caja_trailer'
  if (check === 'ubicacion')   return t === 'camion' || t === 'utilitario' || t === 'montacargas'
  return false
}

export interface VehiculoFormProps {
  initial?:   VehiculoRow
  isPending:  boolean
  error:      string | null
  onSubmit:   (payload: VehiculoCreatePayload | VehiculoUpdatePayload, tipo: TipoVehiculo) => void
  onCancel:   () => void
  // Al crear desde la ficha de un modelo: el modelo viene fijado y no se puede cambiar.
  lockedModeloId?: number
}

export function VehiculoForm({ initial, isPending, error, onSubmit, onCancel, lockedModeloId }: VehiculoFormProps) {
  const isEdit = !!initial
  const { data: modelosData } = useModelos()
  const { data: sucursalesData } = useSucursales()
  const { data: rutasData } = useRutas()

  const modelosOpts   = (modelosData?.data   ?? []).map((m) => ({ value: String(m.id), label: `${m.marca} ${m.nombre}` }))
  const sucursalesOpts = (sucursalesData?.data ?? []).map((s) => ({ value: String(s.id), label: s.nombre }))
  const rutasOpts      = (rutasData?.data      ?? []).map((r) => ({ value: String(r.id), label: r.nombre }))

  const form = useForm<FormVals>({
    initialValues: {
      ...init(initial),
      ...(lockedModeloId != null ? { modelo_id: String(lockedModeloId) } : {}),
    },
    validate: {
      tipo:        (v) => !isEdit && !v ? 'Requerido' : null,
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

  // Editar el vehículo es la única vía que puede bajar el kilometraje (el resto
  // pasa por avanzarKilometraje en la API, que solo sube), así que se confirma.
  const [pendingVals, setPendingVals] = useState<FormVals | null>(null)
  const kmPrevio = isEdit && needsField(tipo, 'km') && initial!.kilometraje != null
    ? Number(initial!.kilometraje)
    : null

  function handleSubmit(vals: FormVals) {
    const kmNuevo = Number(vals.kilometraje)
    if (kmPrevio != null && !isNaN(kmNuevo) && kmNuevo < kmPrevio) {
      setPendingVals(vals)
      return
    }
    submit(vals)
  }

  function submit(vals: FormVals) {
    const t = (isEdit ? initial!.tipo : vals.tipo) as TipoVehiculo
    const base = {
      modelo_id:    parseInt(vals.modelo_id),
      serie:        vals.serie,
      placas:       vals.placas.trim() || null,
      fecha_compra: vals.fecha_compra || null,
    }

    // Campos que aplican según el tipo de vehículo (el else final cubre 'utilitario')
    let extra: Record<string, unknown>
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
        pies:    Number(vals.pies),
        status:  vals.status,
        ruta_id: parseInt(vals.ruta_id),
      }
    } else if (t === 'montacargas') {
      extra = {
        combustible: vals.combustible,
        ubicacion:   vals.ubicacion || null,
        status:      vals.status,
        sucursal_id: parseInt(vals.sucursal_id),
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

        <Select
          label="Marca / Modelo"
          placeholder="Selecciona un modelo"
          data={modelosOpts}
          searchable={lockedModeloId == null}
          disabled={lockedModeloId != null}
          description={lockedModeloId != null ? 'Fijado por el modelo desde el que se está creando.' : undefined}
          required
          nothingFoundMessage="Sin resultados"
          {...form.getInputProps('modelo_id')}
        />

        {/* Campos comunes */}
        <Grid>
          <Grid.Col span={tipo === 'montacargas' ? 12 : 6}>
            <TextInput label="No. de serie" placeholder="Serie" required {...form.getInputProps('serie')} />
          </Grid.Col>
          {tipo !== 'montacargas' && (
            <Grid.Col span={6}>
              <TextInput label="Placas" placeholder="Ej. ABC-123-A" {...form.getInputProps('placas')} />
            </Grid.Col>
          )}
        </Grid>

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
              <Grid.Col span={12}>
                <Select label="Ruta" data={rutasOpts} placeholder="Ruta asignada" required searchable nothingFoundMessage="Sin resultados" {...form.getInputProps('ruta_id')} />
              </Grid.Col>
            </Grid>
          </>
        )}

        {/* Campos condicionales — montacargas */}
        {(tipo === 'montacargas') && (
          <>
            <Divider label="Datos del montacargas" labelPosition="left" />
            <Grid>
              <Grid.Col span={6}>
                <Select label="Combustible" data={COMBUSTIBLES} placeholder="Tipo" required {...form.getInputProps('combustible')} />
              </Grid.Col>
              <Grid.Col span={6}>
                <Select label="Status" data={STATUSES} placeholder="Estado" required {...form.getInputProps('status')} />
              </Grid.Col>
              <Grid.Col span={6}>
                <Select label="Sucursal" data={sucursalesOpts} placeholder="Sucursal" required searchable nothingFoundMessage="Sin resultados" {...form.getInputProps('sucursal_id')} />
              </Grid.Col>
              <Grid.Col span={6}>
                <TextInput label="Ubicación" placeholder="Ubicación actual (opcional)" {...form.getInputProps('ubicacion')} />
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

      <Modal
        opened={pendingVals !== null}
        onClose={() => setPendingVals(null)}
        title="¿Disminuir el kilometraje?"
        centered
      >
        <Stack gap="md">
          <Text size="sm">
            El kilometraje registrado es{' '}
            <Text span fw={700}>{kmPrevio?.toLocaleString('es-MX')} km</Text> y lo estás
            bajando a{' '}
            <Text span fw={700}>{Number(pendingVals?.kilometraje ?? 0).toLocaleString('es-MX')} km</Text>.
          </Text>
          <Text size="sm" c="dimmed">
            El kilometraje normalmente solo avanza. Corrígelo solo si el valor anterior
            se capturó por error.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setPendingVals(null)} disabled={isPending}>
              Cancelar
            </Button>
            <Button
              color="orange"
              loading={isPending}
              onClick={() => {
                const vals = pendingVals!
                setPendingVals(null)
                submit(vals)
              }}
            >
              Sí, disminuir
            </Button>
          </Group>
        </Stack>
      </Modal>
    </form>
  )
}
