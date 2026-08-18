// Formulario de alta/edición de un conductor del catálogo. Vive aparte del
// panel de Catálogos porque también se abre desde el alta de un vale de
// gasolina, para no obligar a salir del formulario a darlo de alta.
import { Stack, Group, Alert, Button, TextInput, Divider } from '@mantine/core'
import { useForm } from '@mantine/form'
import { FechaInput } from './FechaInput'
import type { ConductorPayload } from '../hooks/useConductores'
import { TEXTO_SIMPLE, CODIGO, limpiarTextoSimple, limpiarCodigo } from '../lib/validaciones'
import { parseVigencia } from '../lib/vigenciaLicencia'

// El conductor tiene nombre y licencia, así que no puede reusar SitioForm (que
// exige una ubicación).
export function ConductorForm({
  initial, isPending, error, onSubmit, onCancel,
}: {
  initial?: ConductorPayload
  isPending: boolean
  error: string | null
  onSubmit: (payload: ConductorPayload) => void
  onCancel: () => void
}) {
  // Las vigencias se eligen del calendario y se guardan como texto "YYYY-MM-DD"
  // (la columna sigue siendo varchar). Lo capturado antes en texto libre
  // ("3 AÑOS") no cabe en el calendario: se deja el campo vacío y se avisa
  // debajo para que se vuelva a elegir en vez de perderlo sin decir nada.
  const estatalPrevia = initial?.licencia_estatal_vigencia ?? null
  const federalPrevia = initial?.licencia_federal_vigencia ?? null
  const expedientePrevia = initial?.licencia_federal_expediente_vigencia ?? null
  const estatalNoFecha = !!estatalPrevia && !parseVigencia(estatalPrevia)
  const federalNoFecha = !!federalPrevia && !parseVigencia(federalPrevia)
  const expedienteNoFecha = !!expedientePrevia && !parseVigencia(expedientePrevia)

  const form = useForm({
    initialValues: {
      nombre:                    initial?.nombre    ?? '',
      ubicacion:                 initial?.ubicacion ?? '',
      licencia_estatal_numero:   initial?.licencia_estatal_numero   ?? '',
      licencia_estatal_vigencia: parseVigencia(estatalPrevia) ?? '',
      licencia_federal_numero:     initial?.licencia_federal_numero     ?? '',
      licencia_federal_expediente: initial?.licencia_federal_expediente ?? '',
      licencia_federal_vigencia:   parseVigencia(federalPrevia) ?? '',
      licencia_federal_expediente_vigencia: parseVigencia(expedientePrevia) ?? '',
    },
    validate: {
      nombre: (v) =>
        !v.trim() ? 'Nombre requerido' :
        v.length > 100 ? 'Máximo 100 caracteres' : null,
      ubicacion: (v) =>
        v && !TEXTO_SIMPLE.test(v.trim()) ? 'Solo letras, números, espacios y guiones' : null,
      licencia_estatal_numero: (v) =>
        v && !CODIGO.test(v.trim()) ? 'Solo mayúsculas, números y guiones' : null,
      licencia_estatal_vigencia: (v) =>
        v && !parseVigencia(v) ? 'Fecha inválida' : null,
      licencia_federal_numero: (v) =>
        v && !CODIGO.test(v.trim()) ? 'Solo mayúsculas, números y guiones' : null,
      licencia_federal_expediente: (v) =>
        v && !CODIGO.test(v.trim()) ? 'Solo mayúsculas, números y guiones' : null,
      licencia_federal_vigencia: (v) =>
        v && !parseVigencia(v) ? 'Fecha inválida' : null,
      licencia_federal_expediente_vigencia: (v) =>
        v && !parseVigencia(v) ? 'Fecha inválida' : null,
    },
  })

  return (
    <form onSubmit={form.onSubmit((v) => onSubmit({
      nombre:                    v.nombre.trim(),
      // Vacío se manda como null: en la BD lo no capturado es null.
      ubicacion:                 v.ubicacion.trim()                 || null,
      licencia_estatal_numero:   v.licencia_estatal_numero.trim()   || null,
      licencia_estatal_vigencia: v.licencia_estatal_vigencia.trim() || null,
      licencia_federal_numero:     v.licencia_federal_numero.trim()     || null,
      licencia_federal_expediente: v.licencia_federal_expediente.trim() || null,
      licencia_federal_vigencia:   v.licencia_federal_vigencia.trim()   || null,
      licencia_federal_expediente_vigencia: v.licencia_federal_expediente_vigencia.trim() || null,
    }))}>
      <Stack gap="sm">
        <TextInput
          label="Nombre del conductor"
          placeholder="Nombre y apellido"
          required
          maxLength={100}
          {...form.getInputProps('nombre')}
        />
        <TextInput
          label="Ubicación"
          placeholder="Ej. Monterrey"
          maxLength={20}
          {...form.getInputProps('ubicacion')}
          onChange={(e) => form.setFieldValue('ubicacion', limpiarTextoSimple(e.currentTarget.value, 20))}
        />
        <Divider label="Licencia estatal" labelPosition="left" mt={4} />
        <Group grow align="flex-start">
          <TextInput
            label="No. licencia"
            placeholder="Ej. ABC1234567"
            maxLength={30}
            spellCheck={false}
            {...form.getInputProps('licencia_estatal_numero')}
            onChange={(e) => form.setFieldValue('licencia_estatal_numero', limpiarCodigo(e.currentTarget.value, 30))}
          />
          <FechaInput
            label="Vigencia de la licencia"
            clearable
            value={form.values.licencia_estatal_vigencia}
            onChange={(d) => form.setFieldValue('licencia_estatal_vigencia', d)}
            error={form.errors.licencia_estatal_vigencia as string}
            description={estatalNoFecha ? `Antes decía "${estatalPrevia}"; elige la fecha` : undefined}
          />
        </Group>
        <Divider label="Licencia federal" labelPosition="left" mt={4} />
        {/* Un renglón por documento: la licencia federal y su expediente vencen
            en fechas distintas, y con los tres números seguidos y una sola
            vigencia al final no se sabía a cuál pertenecía. */}
        <Group grow align="flex-start">
          <TextInput
            label="No. licencia"
            placeholder="Ej. ABC1234567"
            maxLength={30}
            spellCheck={false}
            {...form.getInputProps('licencia_federal_numero')}
            onChange={(e) => form.setFieldValue('licencia_federal_numero', limpiarCodigo(e.currentTarget.value, 30))}
          />
          <FechaInput
            label="Vigencia de la licencia"
            clearable
            value={form.values.licencia_federal_vigencia}
            onChange={(d) => form.setFieldValue('licencia_federal_vigencia', d)}
            error={form.errors.licencia_federal_vigencia as string}
            description={federalNoFecha ? `Antes decía "${federalPrevia}"; elige la fecha` : undefined}
          />
        </Group>
        <Group grow align="flex-start">
          <TextInput
            label="No. expediente"
            placeholder="Ej. EXP-12345"
            maxLength={30}
            spellCheck={false}
            {...form.getInputProps('licencia_federal_expediente')}
            onChange={(e) => form.setFieldValue('licencia_federal_expediente', limpiarCodigo(e.currentTarget.value, 30))}
          />
          <FechaInput
            label="Vigencia del expediente"
            clearable
            value={form.values.licencia_federal_expediente_vigencia}
            onChange={(d) => form.setFieldValue('licencia_federal_expediente_vigencia', d)}
            error={form.errors.licencia_federal_expediente_vigencia as string}
            description={expedienteNoFecha ? `Antes decía "${expedientePrevia}"; elige la fecha` : undefined}
          />
        </Group>
        {error && <Alert color="red" title="Error">{error}</Alert>}
        <Group justify="flex-end" mt="xs">
          <Button variant="default" onClick={onCancel} disabled={isPending}>Cancelar</Button>
          <Button type="submit" loading={isPending}>Guardar</Button>
        </Group>
      </Stack>
    </form>
  )
}

export default ConductorForm
