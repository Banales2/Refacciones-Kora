// Formulario de alta/edición de un técnico del catálogo. Vive aparte del panel
// de Catálogos porque también se abre desde el registro de un mantenimiento y
// desde el agendado, para no obligar a salir del formulario a darlo de alta.
import { Stack, Group, Alert, Button, TextInput } from '@mantine/core'
import { useForm } from '@mantine/form'
import type { TecnicoPayload } from '../hooks/useTecnicos'
import {
  TEXTO_SIMPLE, TEXTO_LIBRE, CONTACTO,
  limpiarTextoSimple, limpiarTextoLibre, limpiarContacto,
} from '../lib/validaciones'

// El técnico lleva nombre, ubicación y contacto, así que no puede reusar
// SitioForm (que solo maneja nombre + ubicación).
export function TecnicoForm({
  initial, isPending, error, onSubmit, onCancel,
}: {
  initial?:  TecnicoPayload
  isPending: boolean
  error:     string | null
  onSubmit:  (payload: TecnicoPayload) => void
  onCancel:  () => void
}) {
  const form = useForm({
    initialValues: {
      nombre:    initial?.nombre    ?? '',
      ubicacion: initial?.ubicacion ?? '',
      contacto:  initial?.contacto  ?? '',
    },
    validate: {
      nombre: (v) =>
        v.trim().length < 2 ? 'Mínimo 2 caracteres' :
        v.length > 40 ? 'Máximo 40 caracteres' :
        !TEXTO_SIMPLE.test(v.trim()) ? 'Solo letras, números, espacios y guiones' : null,
      ubicacion: (v) =>
        !v.trim() ? 'Requerido' :
        v.length > 100 ? 'Máximo 100 caracteres' :
        !TEXTO_LIBRE.test(v.trim()) ? 'Contiene caracteres no permitidos' : null,
      contacto: (v) =>
        !v.trim() ? null :
        v.length > 40 ? 'Máximo 40 caracteres' :
        !CONTACTO.test(v.trim()) ? 'Contiene caracteres no permitidos' : null,
    },
  })

  return (
    <form onSubmit={form.onSubmit((v) => onSubmit({
      nombre:    v.nombre.trim(),
      ubicacion: v.ubicacion.trim(),
      contacto:  v.contacto.trim() || null,
    }))}>
      <Stack gap="sm">
        <TextInput
          label="Nombre del técnico" placeholder="Nombre y apellido" required
          maxLength={40}
          {...form.getInputProps('nombre')}
          onChange={(e) => form.setFieldValue('nombre', limpiarTextoSimple(e.currentTarget.value, 40))}
        />
        <TextInput
          label="Ubicación" placeholder="Taller o zona donde atiende" required
          maxLength={100}
          {...form.getInputProps('ubicacion')}
          onChange={(e) => form.setFieldValue('ubicacion', limpiarTextoLibre(e.currentTarget.value, 100))}
        />
        <TextInput
          label="Contacto" placeholder="Teléfono o correo"
          maxLength={40}
          {...form.getInputProps('contacto')}
          onChange={(e) => form.setFieldValue('contacto', limpiarContacto(e.currentTarget.value, 40))}
        />
        {error && <Alert color="red" title="Error">{error}</Alert>}
        <Group justify="flex-end" mt="xs">
          <Button variant="default" onClick={onCancel} disabled={isPending}>Cancelar</Button>
          <Button type="submit" loading={isPending}>Guardar</Button>
        </Group>
      </Stack>
    </form>
  )
}

export default TecnicoForm
