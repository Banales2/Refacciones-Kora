// Formulario de alta/edición de un proveedor. Vive aparte de la página
// Proveedores porque también se abre encadenado desde el alta de un lote,
// que a su vez se abre desde el alta de una refacción.
import { Stack, Group, Alert, Button, TextInput } from '@mantine/core'
import { useForm } from '@mantine/form'
import type { Proveedor, ProveedorPayload } from '../hooks/useProveedores'
import { TELEFONO, limpiarTelefono } from '../lib/validaciones'

export function ProveedorForm({
  initial,
  isPending,
  error,
  onSubmit,
  onCancel,
}: {
  initial?: Proveedor
  isPending: boolean
  error: string | null
  onSubmit: (payload: ProveedorPayload) => void
  onCancel: () => void
}) {
  const form = useForm({
    initialValues: {
      nombre:   initial?.nombre   ?? '',
      contacto: initial?.contacto ?? '',
      telefono: initial?.telefono ?? '',
    },
    validate: {
      nombre: (v) =>
        v.trim().length < 2 ? 'Mínimo 2 caracteres' :
        v.length > 100      ? 'Máximo 100 caracteres' : null,
      telefono: (v) =>
        v && !TELEFONO.test(v.trim()) ? 'Solo números, espacios, paréntesis, + y guiones' : null,
    },
  })

  return (
    <form onSubmit={form.onSubmit((v) => onSubmit({
      nombre: v.nombre, contacto: v.contacto || null, telefono: v.telefono.trim() || null,
    }))}>
      <Stack gap="sm">
        <TextInput
          label="Nombre del proveedor"
          placeholder="Ej. Distribuidora Norte"
          required
          {...form.getInputProps('nombre')}
        />
        <TextInput
          label="Contacto"
          placeholder="Nombre de la persona de contacto"
          {...form.getInputProps('contacto')}
        />
        <TextInput
          label="No. Teléfono"
          placeholder="Ej. 81 1234 5678"
          maxLength={12}
          inputMode="tel"
          {...form.getInputProps('telefono')}
          onChange={(e) => form.setFieldValue('telefono', limpiarTelefono(e.currentTarget.value, 12))}
        />
        {error && <Alert color="red" title="Error">{error}</Alert>}
        <Group justify="flex-end" mt="xs">
          <Button variant="default" onClick={onCancel} disabled={isPending}>
            Cancelar
          </Button>
          <Button type="submit" loading={isPending}>
            Guardar
          </Button>
        </Group>
      </Stack>
    </form>
  )
}

export default ProveedorForm
