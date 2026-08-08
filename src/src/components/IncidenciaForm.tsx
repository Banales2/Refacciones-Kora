// Formulario de incidencia, compartido por la página de Incidencias y por la
// sección de incidencias del detalle de un vehículo.
import { Stack, Group, TextInput, Textarea, Select, Button, Alert } from '@mantine/core'
import { DateInput, TimeInput } from '@mantine/dates'
import { useForm } from '@mantine/form'
import type { Incidencia, IncidenciaPayload, Severidad, StatusIncidencia } from '../hooks/useIncidencias'
import { useCategoriaOptions } from '../hooks/useCategoriaOptions'
import { TEXTO_SIMPLE, TEXTO_LIBRE, limpiarTextoSimple, limpiarTextoLibre } from '../lib/validaciones'

function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function IncidenciaForm({
  initial, isPending, error, onSubmit, onCancel,
}: {
  initial?:  Incidencia
  isPending: boolean
  error:     string | null
  onSubmit:  (p: IncidenciaPayload) => void
  onCancel:  () => void
}) {
  const form = useForm({
    initialValues: {
      nombre:        initial?.nombre ?? '',
      descripcion:   initial?.descripcion ?? '',
      categoria:     initial?.categoria ?? '',
      severidad:     (initial?.severidad ?? 'moderada') as Severidad,
      fecha:         initial?.fecha?.split('T')[0] ?? todayIso(),
      // La API devuelve "HH:MM:SS"; el input trabaja con "HH:MM".
      hora:          initial?.hora?.slice(0, 5) ?? '',
      ubicacion:     initial?.ubicacion ?? '',
      reportado_por: initial?.reportado_por ?? '',
      status:        (initial?.status ?? 'activo') as StatusIncidencia,
    },
    validate: {
      nombre: (v) =>
        !v.trim() ? 'Requerido' :
        v.length > 40 ? 'Máximo 40 caracteres' :
        !TEXTO_SIMPLE.test(v.trim()) ? 'Solo letras, números, espacios y guiones' : null,
      descripcion: (v) =>
        !v.trim() ? 'Requerido' :
        v.length > 255 ? 'Máximo 255 caracteres' :
        !TEXTO_LIBRE.test(v.trim()) ? 'Contiene caracteres no permitidos' : null,
      categoria: (v) =>
        !v.trim() ? 'Requerido' :
        v.length > 30 ? 'Máximo 30 caracteres' :
        !TEXTO_SIMPLE.test(v.trim()) ? 'Solo letras, números, espacios y guiones' : null,
      fecha: (v) => !v ? 'Requerido' : null,
    },
  })

  const { options: categoriaOptions, setSearch: setCategoriaSearch } =
    useCategoriaOptions(form.values.categoria, initial?.categoria)

  function handleSubmit(vals: typeof form.values) {
    onSubmit({
      nombre:        vals.nombre.trim(),
      descripcion:   vals.descripcion.trim(),
      categoria:     vals.categoria.trim()     || null,
      severidad:     vals.severidad,
      fecha:         vals.fecha,
      hora:          vals.hora                 || null,
      ubicacion:     vals.ubicacion.trim()     || null,
      reportado_por: vals.reportado_por.trim() || null,
      status:        vals.status,
    })
  }

  return (
    <form onSubmit={form.onSubmit(handleSubmit)}>
      <Stack gap="sm">
        <TextInput
          label="Nombre" placeholder="Ej. Cambiar pintura" required maxLength={40}
          description="Un resumen corto de la incidencia"
          {...form.getInputProps('nombre')}
          onChange={(e) => form.setFieldValue('nombre', limpiarTextoSimple(e.currentTarget.value, 40))}
        />
        <Textarea
          label="Descripción" required autosize minRows={2} maxLength={255}
          placeholder="Qué se encontró y en qué condiciones"
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
          {...form.getInputProps('categoria')}
          onChange={(v) => { form.setFieldValue('categoria', v ?? ''); setCategoriaSearch('') }}
        />
        <Select
          label="Severidad" required
          data={[
            { value: 'superficial', label: 'Superficial — no impide operar' },
            { value: 'moderada',    label: 'Moderada — conviene atenderla pronto' },
            { value: 'grave',       label: 'Grave — la unidad no debería salir así' },
          ]}
          allowDeselect={false}
          {...form.getInputProps('severidad')}
        />
        <Group grow align="flex-start">
          <DateInput
            label="Fecha" required
            placeholder="dd/mm/aaaa" valueFormat="DD/MM/YYYY"
            maxDate={todayIso()}
            value={form.values.fecha || null}
            onChange={(d) => form.setFieldValue('fecha', d ?? '')}
            error={form.errors.fecha as string}
          />
          <TimeInput
            label="Hora"
            description="Opcional"
            {...form.getInputProps('hora')}
          />
        </Group>
        <TextInput
          label="Ubicación" maxLength={160}
          placeholder="Dónde ocurrió o dónde se detectó"
          {...form.getInputProps('ubicacion')}
          onChange={(e) => form.setFieldValue('ubicacion', limpiarTextoLibre(e.currentTarget.value, 160))}
        />
        <TextInput
          label="Reportado por" maxLength={120}
          placeholder="Quién la reportó"
          {...form.getInputProps('reportado_por')}
          onChange={(e) => form.setFieldValue('reportado_por', limpiarTextoSimple(e.currentTarget.value, 120))}
        />
        <Select
          label="Status" required
          description="Cancelada conserva el registro pero deja de alertar"
          data={[
            { value: 'activo',     label: 'Sin atender' },
            { value: 'completado', label: 'Atendida' },
            { value: 'pausado',    label: 'Pausada' },
            { value: 'cancelado',  label: 'Cancelada' },
          ]}
          allowDeselect={false}
          {...form.getInputProps('status')}
        />

        {error && <Alert color="red" title="Error">{error}</Alert>}
        <Group justify="flex-end" mt="xs">
          <Button variant="default" onClick={onCancel} disabled={isPending}>Cancelar</Button>
          <Button type="submit" loading={isPending}>
            {initial ? 'Guardar cambios' : 'Crear incidencia'}
          </Button>
        </Group>
      </Stack>
    </form>
  )
}
