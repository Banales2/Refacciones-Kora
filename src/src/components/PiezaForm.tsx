// Formulario de alta/edición de una refacción del catálogo. Vive aparte de la
// página Piezas porque también se abre encadenado desde el registro de un
// mantenimiento. Permite crear tipos de pieza nuevos desde el propio selector.
import { useState, useMemo } from 'react'
import { Stack, Group, Alert, Button, TextInput, Textarea, Select } from '@mantine/core'
import { useForm } from '@mantine/form'
import { useTiposPieza, useCreateTipoPieza } from '../hooks/useTiposPieza'
import { TEXTO_LIBRE, limpiarTextoSimple, limpiarTextoLibre } from '../lib/validaciones'

// El tipo indica qué necesidad de un modelo cubre la refacción ("filtro de
// aire") y es obligatorio: sin él la refacción no se puede clasificar ni
// asignar a un vehículo. Se maneja como string porque es el valor del Select;
// '' solo aparece en las piezas anteriores al catálogo de tipos, que al
// editarse quedan obligadas a elegir uno.
export type PiezaFormValues = { numero_serie: string; descripcion: string; tipo_pieza_id: string }

// Valor centinela del selector de tipo: al elegirlo se crea el tipo escrito.
const CREAR_TIPO = '__crear__'

export function PiezaForm({
  initial,
  isPending,
  error,
  onSubmit,
  onCancel,
}: {
  initial?: PiezaFormValues
  isPending: boolean
  error: string | null
  onSubmit: (v: PiezaFormValues) => void
  onCancel: () => void
}) {
  const form = useForm<PiezaFormValues>({
    initialValues: initial ?? { numero_serie: '', descripcion: '', tipo_pieza_id: '' },
    validate: {
      numero_serie: (v) =>
        !v.trim() ? 'Requerido' :
        v.length > 20 ? 'Máximo 20 caracteres' :
        !/^[A-Z0-9-]+$/.test(v) ? 'Solo mayúsculas, números y guiones' : null,
      descripcion: (v) =>
        v.trim().length < 3 ? 'Mínimo 3 caracteres' :
        v.length > 255 ? 'Máximo 255 caracteres' :
        !TEXTO_LIBRE.test(v.trim()) ? 'Contiene caracteres no permitidos' : null,
      tipo_pieza_id: (v) => !v ? 'Requerido' : null,
    },
  })

  const [tipoSearch, setTipoSearch] = useState('')

  const { data: tiposData } = useTiposPieza()
  const crearTipoMut = useCreateTipoPieza()

  const tipoOptions = useMemo(() => {
    const tipos = tiposData?.data ?? []
    const opts = tipos.map((t) => ({ value: String(t.id), label: t.nombre }))
    const nuevo = tipoSearch.trim()
    const yaExiste = tipos.some((t) => t.nombre.toLowerCase() === nuevo.toLowerCase())
    if (nuevo && !yaExiste) {
      opts.unshift({ value: CREAR_TIPO, label: `+ Crear tipo "${nuevo}"` })
    }
    return opts
  }, [tiposData, tipoSearch])

  // El centinela nunca se guarda: se crea el tipo y se deja seleccionado el id
  // real que devuelve el backend.
  function handleTipoChange(value: string | null) {
    if (value !== CREAR_TIPO) { form.setFieldValue('tipo_pieza_id', value ?? ''); return }
    const nombre = tipoSearch.trim()
    if (!nombre) return
    crearTipoMut.mutate(nombre, {
      onSuccess: ({ data: tipo }) => {
        form.setFieldValue('tipo_pieza_id', String(tipo.id))
        setTipoSearch('')
      },
    })
  }

  return (
    <form onSubmit={form.onSubmit(onSubmit)}>
      <Stack gap="sm">
        <TextInput
          label="No. serie"
          placeholder="EJ-001"
          required
          maxLength={20}
          spellCheck={false}
          {...form.getInputProps('numero_serie')}
          styles={{ input: { textTransform: 'uppercase' } }}
          onChange={(e) =>
            // Allowlist: solo mayúsculas, números y guiones
            form.setFieldValue(
              'numero_serie',
              e.currentTarget.value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 20),
            )
          }
        />
        <Textarea
          label="Descripción"
          placeholder="Descripción de la refacción"
          rows={3}
          required
          maxLength={255}
          {...form.getInputProps('descripcion')}
          onChange={(e) => form.setFieldValue('descripcion', limpiarTextoLibre(e.currentTarget.value, 255))}
        />
        <Select
          label="Tipo de pieza"
          description="Qué necesidad del modelo cubre. Determina a qué vehículos puede asignarse la refacción."
          placeholder="Selecciona o escribe para crear un tipo"
          data={tipoOptions}
          searchable
          required
          searchValue={tipoSearch}
          // Allowlist: solo letras, números, espacios y guiones (máx. 40)
          onSearchChange={(v) => setTipoSearch(limpiarTextoSimple(v, 40))}
          nothingFoundMessage="Escribe para crear un tipo nuevo"
          value={form.values.tipo_pieza_id || null}
          onChange={handleTipoChange}
          error={crearTipoMut.error ? (crearTipoMut.error as Error).message : form.errors.tipo_pieza_id}
        />
        {error && (
          <Alert color="red" title="Error">
            {error}
          </Alert>
        )}
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

export default PiezaForm
