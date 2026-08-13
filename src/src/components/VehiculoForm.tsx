// Formulario de alta/edición de vehículos: los campos visibles y requeridos
// dependen del tipo (p. ej. ruta para tractocamiones, sucursal para camiones,
// pies para cajas de trailer). En edición el tipo no puede cambiarse.
import { useState, useEffect } from 'react'
import { useForm } from '@mantine/form'
import {
  Stack, Grid, TextInput, NumberInput, Select, Divider,
  Badge, Text, Button, Group, Alert, Modal,
} from '@mantine/core'
import { FechaInput } from './FechaInput'
import type { TipoVehiculo, VehiculoRow, VehiculoCreatePayload, VehiculoUpdatePayload } from '../hooks/useVehiculos'
import { useModelos } from '../hooks/useModelos'
import { useSucursales } from '../hooks/useSucursales'
import { useRutas } from '../hooks/useRutas'
import { useSeguros } from '../hooks/useSeguros'
import { usePermisosCirculacion } from '../hooks/usePermisosCirculacion'
import { CODIGO, limpiarCodigo, KM_MAX, validarKm } from '../lib/validaciones'
import { hoyIso } from '../lib/fechas'
import { llevaPermiso, llevaSeguro } from '../lib/tipoVehiculo'

const TIPO_META: Record<TipoVehiculo, { label: string; color: string }> = {
  camion:       { label: 'Unidad de reparto', color: 'blue'   },
  tractocamion: { label: 'Tractocamión',     color: 'violet' },
  caja_trailer: { label: 'Caja de trailer',  color: 'orange' },
  utilitario:   { label: 'Vehículo utilitario',color: 'teal'   },
  montacargas:  { label: 'Montacargas',      color: 'yellow' },
}

const TIPOS_OPTIONS = Object.entries(TIPO_META).map(([v, m]) => ({ value: v, label: m.label }))

// Los únicos tipos que pagan tenencia. Las cajas de trailer y los montacargas
// no, por eso el bloque no se les muestra y sus tablas no tienen las columnas.
const TIPOS_CON_TENENCIA: TipoVehiculo[] = ['camion', 'tractocamion', 'utilitario']

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
  tenencia:            string
  tenencia_expiracion: string
  ruta_id:      string
  pies:         number | string
  fecha_compra: string
  seguro_id:    string
  permiso_id:   string
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
    tenencia:            v?.tenencia ?? '',
    tenencia_expiracion: v?.tenencia_expiracion ? v.tenencia_expiracion.split('T')[0] : '',
    ruta_id:      v?.ruta_id     != null ? String(v.ruta_id)     : '',
    pies:         v?.pies        ?? '',
    fecha_compra: v?.fecha_compra ? v.fecha_compra.split('T')[0] : '',
    seguro_id:    v?.seguro_id   != null ? String(v.seguro_id)   : '',
    permiso_id:   v?.permiso_id  != null ? String(v.permiso_id)  : '',
  }
}

function needsField(tipo: TipoVehiculo | '', check: 'combustible' | 'status' | 'km' | 'sucursal' | 'ruta' | 'tonelaje' | 'pies' | 'ubicacion' | 'placas' | 'seguro' | 'permiso') {
  const t = tipo
  if (check === 'seguro')      return t !== '' && llevaSeguro(t)
  if (check === 'permiso')     return t !== '' && llevaPermiso(t)
  if (check === 'placas')      return t !== '' && t !== 'montacargas'
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
  const { data: segurosData } = useSeguros()
  const { data: permisosData } = usePermisosCirculacion()

  const modelosOpts   = (modelosData?.data   ?? []).map((m) => ({ value: String(m.id), label: `${m.marca} ${m.nombre}${m.anio ? ` ${m.anio}` : ''}` }))
  const sucursalesOpts = (sucursalesData?.data ?? []).map((s) => ({ value: String(s.id), label: s.nombre }))
  const rutasOpts      = (rutasData?.data      ?? []).map((r) => ({ value: String(r.id), label: r.nombre }))
  const segurosOpts    = (segurosData?.data    ?? []).map((s) => ({ value: String(s.id), label: `${s.poliza} — ${s.compania}` }))
  const permisosOpts   = (permisosData?.data   ?? []).map((p) => ({ value: String(p.id), label: `${p.zona_circulacion} (expira ${p.fecha_expiracion})` }))

  const form = useForm<FormVals>({
    initialValues: {
      ...init(initial),
      ...(lockedModeloId != null ? { modelo_id: String(lockedModeloId) } : {}),
    },
    validate: {
      tipo:        (v) => !isEdit && !v ? 'Requerido' : null,
      modelo_id:   (v) => !v ? 'Requerido' : null,
      serie: (v) =>
        !v.trim() ? 'Requerido' :
        v.length > 20 ? 'Máximo 20 caracteres' :
        !CODIGO.test(v.trim()) ? 'Solo mayúsculas, números y guiones' : null,
      placas: (v, vals) =>
        needsField(vals.tipo, 'placas') && !v.trim() ? 'Requerido' :
        !v.trim() ? null :
        v.length > 10 ? 'Máximo 10 caracteres' :
        !CODIGO.test(v.trim()) ? 'Solo mayúsculas, números y guiones' : null,
      fecha_compra: (v) => !v ? 'Requerido' : null,
      combustible: (v, vals) => needsField(vals.tipo, 'combustible') && !v ? 'Requerido' : null,
      status:      (v, vals) => needsField(vals.tipo, 'status')      && !v ? 'Requerido' : null,
      sucursal_id: (v, vals) => needsField(vals.tipo, 'sucursal')    && !v ? 'Requerido' : null,
      ruta_id:     (v, vals) => needsField(vals.tipo, 'ruta')        && !v ? 'Requerido' : null,
      tonelaje:    (v, vals) => needsField(vals.tipo, 'tonelaje')    && (v === '' || v === null) ? 'Requerido' : null,
      pies:        (v, vals) => needsField(vals.tipo, 'pies')        && (v === '' || v === null) ? 'Requerido' : null,
      kilometraje: (v, vals) =>
        needsField(vals.tipo, 'km') && (v === '' || v === null) ? 'Requerido' :
        v !== '' && v !== null && !Number.isInteger(Number(v)) ? 'Solo números enteros' :
        validarKm(v),
    },
  })

  // El modelo puede restringir qué tipos de vehículo genera. Vacío = todos.
  const selectedModeloId = lockedModeloId != null
    ? lockedModeloId
    : (form.values.modelo_id ? parseInt(form.values.modelo_id) : null)
  const selectedModelo = modelosData?.data.find((m) => m.id === selectedModeloId)
  const tiposPermitidos = selectedModelo?.tipos_permitidos ?? []
  const tiposOptions = tiposPermitidos.length > 0
    ? TIPOS_OPTIONS.filter((o) => tiposPermitidos.includes(o.value as TipoVehiculo))
    : TIPOS_OPTIONS

  // Si al cambiar de modelo el tipo elegido deja de estar permitido, se limpia.
  useEffect(() => {
    if (isEdit) return
    if (tiposPermitidos.length > 0 && form.values.tipo && !tiposPermitidos.includes(form.values.tipo as TipoVehiculo)) {
      form.setFieldValue('tipo', '')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedModeloId, tiposPermitidos.join(',')])

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
    // El seguro y el permiso solo viajan para los tipos que los llevan: si
    // alguien eligió una póliza y luego cambió el tipo a caja de trailer, el
    // valor sigue en el formulario pero no debe mandarse — la API lo rechaza.
    const base = {
      modelo_id:    parseInt(vals.modelo_id),
      serie:        vals.serie,
      placas:       vals.placas.trim() || null,
      fecha_compra: vals.fecha_compra || null,
      ...(llevaSeguro(t)  ? { seguro_id:  vals.seguro_id  ? parseInt(vals.seguro_id)  : null } : {}),
      ...(llevaPermiso(t) ? { permiso_id: vals.permiso_id ? parseInt(vals.permiso_id) : null } : {}),
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
        tenencia:            vals.tenencia || null,
        tenencia_expiracion: vals.tenencia_expiracion || null,
      }
    } else if (t === 'tractocamion') {
      extra = {
        tonelaje:    Number(vals.tonelaje),
        combustible: vals.combustible,
        tenencia:    vals.tenencia || null,
        tenencia_expiracion: vals.tenencia_expiracion || null,
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
        tenencia:            vals.tenencia || null,
        tenencia_expiracion: vals.tenencia_expiracion || null,
      }
    }

    if (isEdit) {
      onSubmit({ ...base, ...extra } as VehiculoUpdatePayload, t)
    } else {
      onSubmit({ tipo: t, ...base, ...extra } as VehiculoCreatePayload, t)
    }
  }

  const tipoMeta = tipo ? TIPO_META[tipo] : null

  // Al crear, el formulario arranca solo con el modelo: es lo que decide qué
  // tipos de vehículo se pueden elegir después, así que pedirlo primero evita
  // presentar de golpe campos que todavía no aplican. Al editar (o si el modelo
  // viene fijado desde su ficha) ya hay modelo y se muestra todo.
  const mostrarResto = isEdit || !!form.values.modelo_id

  return (
    <form onSubmit={form.onSubmit(handleSubmit)}>
      <Stack gap="sm">
        {error && <Alert color="red" title="Error">{error}</Alert>}

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

        {!mostrarResto && (
          <Text size="sm" c="dimmed">
            Elige el modelo para capturar el resto de los datos.
          </Text>
        )}

        {mostrarResto && (
        <>
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
            data={tiposOptions}
            description={tiposPermitidos.length > 0 ? 'Limitado por los tipos permitidos del modelo.' : undefined}
            required
            {...form.getInputProps('tipo')}
          />
        )}

        {/* Campos comunes */}
        <Grid>
          <Grid.Col span={tipo === 'montacargas' ? 12 : 6}>
            <TextInput
              label="No. de serie" placeholder="Serie" required
              maxLength={20} spellCheck={false}
              styles={{ input: { textTransform: 'uppercase' } }}
              {...form.getInputProps('serie')}
              onChange={(e) => form.setFieldValue('serie', limpiarCodigo(e.currentTarget.value, 20))}
            />
          </Grid.Col>
          {tipo !== 'montacargas' && (
            <Grid.Col span={6}>
              <TextInput
                label="Placas" placeholder="Ej. ABC-123-A" required
                maxLength={10} spellCheck={false}
                styles={{ input: { textTransform: 'uppercase' } }}
                {...form.getInputProps('placas')}
                onChange={(e) => form.setFieldValue('placas', limpiarCodigo(e.currentTarget.value, 10))}
              />
            </Grid.Col>
          )}
        </Grid>

        <FechaInput
          label="Fecha de compra"
          required
          maxDate={hoyIso()}
          value={form.values.fecha_compra}
          onChange={(d) => form.setFieldValue('fecha_compra', d)}
          error={form.errors.fecha_compra}
        />

        {/* Las cajas de trailer no se aseguran, y el permiso de circulación solo
            lo llevan reparto y utilitarios: donde no aplica, el campo no existe
            (tampoco la columna en la base). */}
        {needsField(tipo, 'seguro') && (
          <Select
            label="Seguro"
            placeholder="Sin seguro asignado"
            data={segurosOpts}
            clearable
            searchable
            nothingFoundMessage="No hay seguros — regístralos en Catálogos → Seguros"
            {...form.getInputProps('seguro_id')}
          />
        )}

        {needsField(tipo, 'permiso') && (
          <Select
            label="Permiso de circulación"
            placeholder="Sin permiso asignado"
            data={permisosOpts}
            clearable
            searchable
            nothingFoundMessage="No hay permisos — regístralos en Catálogos → Permisos"
            {...form.getInputProps('permiso_id')}
          />
        )}

        {/* Campos condicionales — camion */}
        {(tipo === 'camion') && (
          <>
            <Divider label="Datos de la unidad de reparto" labelPosition="left" />
            <Grid>
              <Grid.Col span={6}>
                <Select label="Combustible" data={COMBUSTIBLES} placeholder="Tipo" required {...form.getInputProps('combustible')} />
              </Grid.Col>
              <Grid.Col span={6}>
                <Select label="Status" data={STATUSES} placeholder="Estado" required {...form.getInputProps('status')} />
              </Grid.Col>
              <Grid.Col span={6}>
                <NumberInput
                  label="Kilometraje" placeholder="0" min={0} max={KM_MAX} required
                  thousandSeparator=","
                  allowDecimal={false} allowNegative={false} clampBehavior="strict"
                  {...form.getInputProps('kilometraje')}
                />
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
                <NumberInput
                  label="Kilometraje" placeholder="0" min={0} max={KM_MAX} required
                  thousandSeparator=","
                  allowDecimal={false} allowNegative={false} clampBehavior="strict"
                  {...form.getInputProps('kilometraje')}
                />
              </Grid.Col>
              <Grid.Col span={6}>
                <Select label="Translado" data={rutasOpts} placeholder="Translado asignado" required searchable nothingFoundMessage="Sin resultados" {...form.getInputProps('ruta_id')} />
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
                <Select label="Translado" data={rutasOpts} placeholder="Translado asignado" required searchable nothingFoundMessage="Sin resultados" {...form.getInputProps('ruta_id')} />
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
                <NumberInput
                  label="Kilometraje" placeholder="0" min={0} max={KM_MAX} required
                  thousandSeparator=","
                  allowDecimal={false} allowNegative={false} clampBehavior="strict"
                  {...form.getInputProps('kilometraje')}
                />
              </Grid.Col>
              <Grid.Col span={6}>
                <TextInput label="Ubicación" placeholder="Ubicación actual (opcional)" {...form.getInputProps('ubicacion')} />
              </Grid.Col>
            </Grid>
          </>
        )}

        {/* Tenencia: un solo bloque para los tres tipos que la pagan, en vez de
            repetir los campos en cada rama. */}
        {tipo && TIPOS_CON_TENENCIA.includes(tipo) && (
          <>
            <Divider label="Tenencia" labelPosition="left" />
            <Grid>
              <Grid.Col span={6}>
                <TextInput
                  label="No. de folio"
                  placeholder="Folio de la tenencia (opcional)"
                  maxLength={50}
                  {...form.getInputProps('tenencia')}
                />
              </Grid.Col>
              <Grid.Col span={6}>
                <FechaInput
                  label="Expira"
                  clearable
                  value={form.values.tenencia_expiracion}
                  onChange={(d) => form.setFieldValue('tenencia_expiracion', d)}
                  error={form.errors.tenencia_expiracion as string}
                />
              </Grid.Col>
            </Grid>
          </>
        )}

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
