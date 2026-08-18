// Alta y edición de un precio cotizado con un proveedor.
//
// La refacción se elige del catálogo (solo se cotiza lo que ya existe) y solo
// al registrar: cambiarla al editar convertiría el registro en otro, así que en
// edición se muestra fija.
import { useMemo, useState } from 'react'
import {
  Stack, Group, Button, Select, NumberInput, Textarea, Alert, Loader, TextInput,
} from '@mantine/core'
import { useForm } from '@mantine/form'
import { useDebouncedValue } from '@mantine/hooks'
import { useRefacciones } from '../hooks/useRefacciones'
import { TEXTO_LIBRE, limpiarTextoLibre } from '../lib/validaciones'
import { FechaInput } from './FechaInput'
import type { PrecioProveedorPayload } from '../hooks/usePreciosProveedor'

function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export type PrecioFormValues = {
  pieza_id:      string
  precio:        number | string
  fecha:         string
  observaciones: string
}

export default function PrecioProveedorForm({
  initial, piezaFija, isPending, error, onSubmit, onCancel,
}: {
  initial?: PrecioFormValues
  /**
   * Refacción ya decidida: al editar (no se puede cambiar) o al registrar otro
   * precio desde el grupo de una refacción que ya se cotiza. En los dos casos
   * el selector se sustituye por su nombre.
   */
  piezaFija?: { id: number; label: string }
  isPending: boolean
  error: string | null
  onSubmit: (payload: PrecioProveedorPayload) => void
  onCancel: () => void
}) {
  const hoy = todayIso()

  // El catálogo de refacciones puede pasar de las 100 que devuelve una página,
  // así que el Select busca contra la API en vez de filtrar una lista completa.
  const [search, setSearch] = useState('')
  const [debouncedSearch] = useDebouncedValue(search, 300)
  const { data: piezasData, isLoading: cargandoPiezas } =
    useRefacciones(1, debouncedSearch, 'all', 20, piezaFija === undefined)

  const form = useForm<PrecioFormValues>({
    initialValues: initial ?? {
      pieza_id: piezaFija ? String(piezaFija.id) : '',
      precio: '',
      fecha: hoy,
      observaciones: '',
    },
    validate: {
      pieza_id: (v) => (!v ? 'Refacción requerida' : null),
      precio:   (v) => (v === '' || Number(v) <= 0 ? 'Debe ser mayor a 0' : null),
      fecha: (v) => {
        if (!v) return 'Fecha requerida'
        if (v > hoy) return 'No puede ser una fecha futura'
        return null
      },
      observaciones: (v) =>
        v.length > 255 ? 'Máximo 255 caracteres' :
        v.trim() && !TEXTO_LIBRE.test(v.trim()) ? 'Contiene caracteres no permitidos' : null,
    },
  })

  const piezas = useMemo(
    () => (piezasData?.data ?? []).map((p) => ({
      value: String(p.id),
      label: `${p.numero_serie} — ${p.descripcion}`,
    })),
    [piezasData]
  )

  return (
    <form
      onSubmit={form.onSubmit((v) => onSubmit({
        pieza_id: parseInt(v.pieza_id, 10),
        precio:   Number(v.precio),
        fecha:    v.fecha,
        observaciones: v.observaciones.trim() || null,
      }))}
    >
      <Stack gap="sm">
        {piezaFija ? (
          <TextInput label="Refacción" value={piezaFija.label} disabled />
        ) : (
          <Select
            label="Refacción"
            placeholder="Busca por número de serie o descripción"
            data={piezas}
            searchable
            required
            searchValue={search}
            onSearchChange={setSearch}
            rightSection={cargandoPiezas ? <Loader size="xs" /> : undefined}
            nothingFoundMessage={cargandoPiezas ? 'Buscando…' : 'Sin resultados'}
            {...form.getInputProps('pieza_id')}
          />
        )}
        <NumberInput
          label="Precio unitario" placeholder="0.00" required
          min={0} max={200000} decimalScale={2} step={0.01}
          prefix="$" thousandSeparator=","
          description="Lo que pide el proveedor por una pieza"
          {...form.getInputProps('precio')}
        />
        <FechaInput
          label="Fecha de la cotización"
          required
          maxDate={hoy}
          value={form.values.fecha}
          onChange={(d) => form.setFieldValue('fecha', d)}
          error={form.errors.fecha as string}
        />
        <Textarea
          label="Observaciones"
          placeholder="De dónde salió el precio, si incluye IVA, vigencia…"
          autosize minRows={2} maxLength={255}
          {...form.getInputProps('observaciones')}
          onChange={(e) =>
            form.setFieldValue('observaciones', limpiarTextoLibre(e.currentTarget.value, 255))
          }
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
