// Alta y edición de una garantía, tanto la del catálogo de un modelo como la de
// una unidad concreta.
//
// Es el mismo formulario porque es el mismo dato: lo que cambia es que la del
// vehículo además sabe cuándo arranca (fecha y odómetro), trae folio y se puede
// cancelar. El catálogo no puede saber nada de eso — cada unidad se compró un
// día distinto.
import {
  Stack, Group, Button, TextInput, Textarea, Select, NumberInput, Switch,
  Alert, Divider, Text,
} from '@mantine/core'
import { useForm } from '@mantine/form'
import {
  TEXTO_SIMPLE, TEXTO_LIBRE, CODIGO, KM_MAX,
  limpiarTextoSimple, limpiarTextoLibre, limpiarCodigo, validarKm,
} from '../lib/validaciones'
import { FechaInput } from './FechaInput'
import type {
  TriggerMode, GarantiaModelo, GarantiaVehiculo,
  GarantiaModeloPayload, GarantiaVehiculoPayload,
} from '../hooks/useGarantias'

// Con 'ambos' la garantía se pierde con lo que ocurra primero, que es como la
// redactan los fabricantes. Se dice completo en el selector porque leído al
// revés ("hay que cumplir las dos") la decisión sale al contrario.
const DISPARADORES = [
  { value: 'meses', label: 'Por tiempo (meses)' },
  { value: 'km',    label: 'Por kilometraje' },
  { value: 'ambos', label: 'Tiempo o kilometraje, lo que pase primero' },
]

export type GarantiaFormValues = {
  nombre:             string
  descripcion:        string
  trigger_mode:       TriggerMode
  duracion_meses:     number | null
  limite_km:          number | null
  activo:             boolean
  fecha_inicio:       string
  km_inicio:          number | null
  folio:              string
  observaciones:      string
  cancelada_en:       string
  motivo_cancelacion: string
}

export default function GarantiaForm({
  modo, initial, fechaCompra, soportaKm = true, isPending, error, onSubmit, onCancel,
}: {
  /** 'modelo' = catálogo del modelo; 'vehiculo' = la garantía de una unidad. */
  modo:      'modelo' | 'vehiculo'
  initial?:  GarantiaModelo | GarantiaVehiculo
  /**
   * Fecha de compra de la unidad: es el arranque por omisión de una garantía
   * nueva. Sin ella la garantía por tiempo no se puede calcular, y el formulario
   * lo dice en vez de guardar algo que no vence nunca.
   */
  fechaCompra?: string | null
  /** Un montacargas o una caja de trailer no llevan odómetro: no hay garantía por km. */
  soportaKm?: boolean
  isPending: boolean
  error:     string | null
  onSubmit:  (payload: GarantiaModeloPayload & GarantiaVehiculoPayload) => void
  onCancel:  () => void
}) {
  const esVehiculo = modo === 'vehiculo'
  const inicial = initial as Partial<GarantiaVehiculo> | undefined

  const form = useForm<GarantiaFormValues>({
    initialValues: {
      nombre:         initial?.nombre ?? '',
      descripcion:    initial?.descripcion ?? '',
      trigger_mode:   initial?.trigger_mode ?? (soportaKm ? 'ambos' : 'meses'),
      duracion_meses: initial?.duracion_meses ?? null,
      limite_km:      initial?.limite_km ?? null,
      activo:         (initial as GarantiaModelo | undefined)?.activo ?? true,
      // Una garantía nueva arranca cuando se compró la unidad; es lo correcto
      // casi siempre y se corrige cuando la entrega fue otro día.
      fecha_inicio:       inicial?.fecha_inicio ?? (initial ? '' : fechaCompra ?? ''),
      km_inicio:          inicial?.km_inicio ?? null,
      folio:              inicial?.folio ?? '',
      observaciones:      inicial?.observaciones ?? '',
      cancelada_en:       inicial?.cancelada_en ?? '',
      motivo_cancelacion: inicial?.motivo_cancelacion ?? '',
    },
    validate: {
      nombre: (v) =>
        !v.trim() ? 'Requerido' :
        v.length > 120 ? 'Máximo 120 caracteres' :
        !TEXTO_SIMPLE.test(v.trim()) ? 'Solo letras, números, espacios y guiones' : null,
      descripcion: (v) =>
        !v.trim() ? null :
        v.length > 500 ? 'Máximo 500 caracteres' :
        !TEXTO_LIBRE.test(v.trim()) ? 'Contiene caracteres no permitidos' : null,
      duracion_meses: (v, vals) =>
        (vals.trigger_mode === 'meses' || vals.trigger_mode === 'ambos')
          ? (!v ? 'Requerido' : v > 600 ? 'No puede ser mayor a 600 meses' : null)
          : null,
      limite_km: (v, vals) =>
        (vals.trigger_mode === 'km' || vals.trigger_mode === 'ambos')
          ? (!v ? 'Requerido' : validarKm(v))
          : null,
      km_inicio: (v) => validarKm(v),
      folio: (v) =>
        !v.trim() ? null :
        v.length > 60 ? 'Máximo 60 caracteres' :
        !CODIGO.test(v.trim()) ? 'Solo mayúsculas, números y guiones' : null,
      observaciones: (v) =>
        !v.trim() ? null :
        v.length > 255 ? 'Máximo 255 caracteres' :
        !TEXTO_LIBRE.test(v.trim()) ? 'Contiene caracteres no permitidos' : null,
      motivo_cancelacion: (v, vals) =>
        vals.cancelada_en && !v.trim() ? 'Di por qué se perdió la garantía' :
        v.length > 255 ? 'Máximo 255 caracteres' :
        v.trim() && !TEXTO_LIBRE.test(v.trim()) ? 'Contiene caracteres no permitidos' : null,
    },
  })

  const mode = form.values.trigger_mode
  const porTiempo = mode === 'meses' || mode === 'ambos'
  const porKm     = mode === 'km'    || mode === 'ambos'

  function handleSubmit(v: GarantiaFormValues) {
    onSubmit({
      nombre:         v.nombre.trim(),
      descripcion:    v.descripcion.trim() || null,
      trigger_mode:   v.trigger_mode,
      // El campo que no aplica al disparador se manda en null: dejarlo con el
      // valor viejo haría que la garantía venciera por algo que ya no se mide.
      duracion_meses: porTiempo ? v.duracion_meses : null,
      limite_km:      porKm     ? v.limite_km      : null,
      activo:         v.activo,
      ...(esVehiculo ? {
        fecha_inicio:       v.fecha_inicio || null,
        km_inicio:          v.km_inicio,
        folio:              v.folio.trim() || null,
        observaciones:      v.observaciones.trim() || null,
        cancelada_en:       v.cancelada_en || null,
        motivo_cancelacion: v.cancelada_en ? v.motivo_cancelacion.trim() : null,
      } : {}),
    })
  }

  return (
    <form onSubmit={form.onSubmit(handleSubmit)}>
      <Stack gap="sm">
        <TextInput
          label="Nombre" placeholder="Ej. Tren motriz" required maxLength={120}
          {...form.getInputProps('nombre')}
          onChange={(e) => form.setFieldValue('nombre', limpiarTextoSimple(e.currentTarget.value, 120))}
        />
        <Textarea
          label="Qué cubre" placeholder="Motor, transmisión y diferencial (opcional)"
          autosize minRows={2} maxLength={500}
          {...form.getInputProps('descripcion')}
          onChange={(e) => form.setFieldValue('descripcion', limpiarTextoLibre(e.currentTarget.value, 500))}
        />
        <Select
          label="Se pierde" required
          description={soportaKm
            ? undefined
            : 'Este tipo de unidad no lleva odómetro: solo puede vencer por tiempo.'}
          data={soportaKm ? DISPARADORES : DISPARADORES.filter((d) => d.value === 'meses')}
          {...form.getInputProps('trigger_mode')}
        />
        {porTiempo && (
          <NumberInput
            label="Duración" required min={1} max={600} suffix=" meses"
            description="36 meses = 3 años"
            allowDecimal={false} allowNegative={false} clampBehavior="strict"
            {...form.getInputProps('duracion_meses')}
          />
        )}
        {porKm && (
          <NumberInput
            label="Cobertura por kilometraje" required min={1} max={KM_MAX}
            suffix=" km" thousandSeparator=","
            allowDecimal={false} allowNegative={false} clampBehavior="strict"
            {...form.getInputProps('limite_km')}
          />
        )}

        {!esVehiculo && (
          <Switch
            label="Activa"
            description="Al desactivarla deja de copiarse a las unidades nuevas; las que ya la tienen no se tocan"
            {...form.getInputProps('activo', { type: 'checkbox' })}
          />
        )}

        {esVehiculo && (
          <>
            <Divider label="Desde cuándo corre" labelPosition="left" />
            <Group grow align="flex-start">
              <FechaInput
                label="Inicio de la garantía"
                clearable
                description="Normalmente la fecha de compra o la de entrega"
                value={form.values.fecha_inicio}
                onChange={(d) => form.setFieldValue('fecha_inicio', d)}
                error={form.errors.fecha_inicio as string}
              />
              <NumberInput
                label="Kilometraje de arranque" min={0} max={KM_MAX}
                placeholder="0"
                suffix=" km" thousandSeparator=","
                description="Vacío = desde cero. Solo cámbialo si la unidad se compró usada"
                allowDecimal={false} allowNegative={false} clampBehavior="strict"
                {...form.getInputProps('km_inicio')}
              />
            </Group>
            {porTiempo && !form.values.fecha_inicio && (
              <Alert color="yellow" title="Sin fecha de inicio">
                Sin la fecha de arranque no se puede saber cuándo se acaba, así que la
                garantía se tratará como vigente y sus requerimientos se seguirán pidiendo.
              </Alert>
            )}

            <TextInput
              label="Folio o póliza" placeholder="Opcional" maxLength={60}
              description="El que hay que dar para reclamarla"
              {...form.getInputProps('folio')}
              onChange={(e) => form.setFieldValue('folio', limpiarCodigo(e.currentTarget.value, 60))}
            />
            <Textarea
              label="Observaciones" placeholder="Opcional"
              autosize minRows={2} maxLength={255}
              {...form.getInputProps('observaciones')}
              onChange={(e) => form.setFieldValue('observaciones', limpiarTextoLibre(e.currentTarget.value, 255))}
            />

            <Divider label="¿Se perdió antes de tiempo?" labelPosition="left" />
            <Text size="xs" c="dimmed">
              Solo si esta unidad ya no la tiene (no se llevó a servicio, se modificó, un
              choque). Cancelarla apaga los requerimientos que existían por ella.
            </Text>
            <Group grow align="flex-start">
              <FechaInput
                label="Cancelada desde"
                clearable
                value={form.values.cancelada_en}
                onChange={(d) => form.setFieldValue('cancelada_en', d)}
                error={form.errors.cancelada_en as string}
              />
              <TextInput
                label="Motivo" placeholder="Por qué se perdió" maxLength={255}
                disabled={!form.values.cancelada_en}
                {...form.getInputProps('motivo_cancelacion')}
                onChange={(e) =>
                  form.setFieldValue('motivo_cancelacion', limpiarTextoLibre(e.currentTarget.value, 255))}
              />
            </Group>
          </>
        )}

        {error && <Alert color="red" title="Error">{error}</Alert>}
        <Group justify="flex-end" mt="xs">
          <Button variant="default" onClick={onCancel} disabled={isPending}>Cancelar</Button>
          <Button type="submit" loading={isPending}>
            {initial ? 'Guardar cambios' : 'Agregar garantía'}
          </Button>
        </Group>
      </Stack>
    </form>
  )
}
