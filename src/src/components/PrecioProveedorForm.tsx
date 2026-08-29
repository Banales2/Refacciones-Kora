// Alta y edición de un precio cotizado con un proveedor.
//
// La refacción se elige del catálogo y solo al registrar: cambiarla al editar
// convertiría el registro en otro, así que en edición se muestra fija. Si la
// refacción todavía no está en el catálogo se da de alta desde aquí, sin salir
// del formulario y sin registrar compra: cotizar no es comprar.
import { useMemo, useState } from 'react'
import {
  Stack, Group, Button, Select, NumberInput, Textarea, Alert, Loader, TextInput,
} from '@mantine/core'
import { useForm } from '@mantine/form'
import { useDebouncedValue } from '@mantine/hooks'
import { IconPlus } from '@tabler/icons-react'
import { useRefacciones } from '../hooks/useRefacciones'
import type { Pieza } from '../hooks/useRefacciones'
import { TEXTO_LIBRE, limpiarTextoLibre } from '../lib/validaciones'
import { FechaInput } from './FechaInput'
import NuevaPiezaModal from './NuevaPiezaModal'
import type { PrecioProveedorPayload } from '../hooks/usePreciosProveedor'

function piezaLabel(p: Pick<Pieza, 'numero_serie' | 'descripcion'>) {
  return `${p.numero_serie} — ${p.descripcion}`
}

function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export type PrecioFormValues = {
  pieza_id:      string
  precio:        number | string
  fecha:         string
  /** Días naturales de entrega. Cadena vacía = no se preguntó. */
  tiempo_entrega_dias: number | string
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
      tiempo_entrega_dias: '',
      observaciones: '',
    },
    validate: {
      pieza_id: (v) => (!v ? 'Refacción requerida' : null),
      precio:   (v) => (v === '' || Number(v) <= 0 ? 'Debe ser mayor a 0' : null),
      // Opcional: no todos los proveedores lo dicen al cotizar, y dejarlo en
      // blanco es más honesto que inventar un plazo.
      tiempo_entrega_dias: (v) => {
        if (v === '' || v === null) return null
        const n = Number(v)
        if (!Number.isInteger(n)) return 'Días completos, sin decimales'
        if (n < 0)   return 'No puede ser negativo'
        if (n > 365) return 'No puede ser mayor a 365 días'
        return null
      },
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

  // Refacciones dadas de alta desde este mismo formulario: se agregan a mano
  // porque la búsqueda activa ya no las devuelve (el texto buscado suele ser
  // otro) y sin esto el Select se quedaría en blanco justo después de crearlas.
  const [nuevaPiezaOpen, setNuevaPiezaOpen] = useState(false)
  const [piezasNuevas, setPiezasNuevas] = useState<Pieza[]>([])

  // Al elegir una opción, Mantine copia su etiqueta al texto de búsqueda, lo que
  // lanza otra consulta que ya no devuelve esa refacción (la etiqueta lleva
  // serie y descripción juntas, y el LIKE es contra una o la otra). Por eso se
  // guarda su etiqueta al seleccionarla: sin esto el campo acababa mostrando el
  // id en vez del nombre.
  const [etiquetaSeleccionada, setEtiquetaSeleccionada] = useState('')

  const piezas = useMemo(() => {
    const opts = (piezasData?.data ?? []).map((p) => ({
      value: String(p.id),
      label: piezaLabel(p),
    }))
    // Las creadas aquí van primero y sin duplicarse con los resultados.
    for (const p of piezasNuevas) {
      if (!opts.some((o) => o.value === String(p.id))) {
        opts.unshift({ value: String(p.id), label: piezaLabel(p) })
      }
    }
    const seleccionada = form.values.pieza_id
    if (seleccionada && !opts.some((o) => o.value === seleccionada)) {
      opts.unshift({ value: seleccionada, label: etiquetaSeleccionada })
    }
    return opts
  }, [piezasData, piezasNuevas, form.values.pieza_id, etiquetaSeleccionada])

  function seleccionarPieza(id: string | null) {
    form.setFieldValue('pieza_id', id ?? '')
    const elegida = [...(piezasData?.data ?? []), ...piezasNuevas]
      .find((p) => String(p.id) === id)
    setEtiquetaSeleccionada(elegida ? piezaLabel(elegida) : '')
  }

  // La refacción recién creada queda seleccionada, que es para lo que se abrió
  // el alta desde aquí.
  function piezaCreada(pieza: Pieza) {
    setPiezasNuevas((prev) => [...prev, pieza])
    form.setFieldValue('pieza_id', String(pieza.id))
    setEtiquetaSeleccionada(piezaLabel(pieza))
  }

  return (
    <>
    <form
      onSubmit={form.onSubmit((v) => onSubmit({
        pieza_id: parseInt(v.pieza_id, 10),
        precio:   Number(v.precio),
        fecha:    v.fecha,
        tiempo_entrega_dias:
          v.tiempo_entrega_dias === '' ? null : Number(v.tiempo_entrega_dias),
        observaciones: v.observaciones.trim() || null,
      }))}
    >
      <Stack gap="sm">
        {piezaFija ? (
          <TextInput label="Refacción" value={piezaFija.label} disabled />
        ) : (
          <div>
            <Select
              label="Refacción"
              placeholder="Busca por número de serie o descripción"
              data={piezas}
              searchable
              required
              searchValue={search}
              onSearchChange={setSearch}
              rightSection={cargandoPiezas ? <Loader size="xs" /> : undefined}
              nothingFoundMessage={
                cargandoPiezas ? 'Buscando…' : 'Sin coincidencias: usa "Nueva refacción"'
              }
              {...form.getInputProps('pieza_id')}
              onChange={seleccionarPieza}
            />
            <Button
              variant="subtle" size="compact-xs" mt={4} leftSection={<IconPlus size={12} />}
              onClick={() => setNuevaPiezaOpen(true)}
            >
              Nueva refacción
            </Button>
          </div>
        )}
        <NumberInput
          label="Precio unitario" placeholder="0.00" required
          min={0} max={200000} decimalScale={2} step={0.01}
          prefix="$" thousandSeparator=","
          description="Lo que pide el proveedor por una pieza"
          {...form.getInputProps('precio')}
        />
        <NumberInput
          label="Tiempo de entrega"
          placeholder="Ej. 3"
          min={0} max={365} allowDecimal={false} step={1}
          suffix=" días"
          description="En cuántos días surte, si lo dijo. El más barato no siempre es el que llega antes"
          {...form.getInputProps('tiempo_entrega_dias')}
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

    {/* Fuera del <form>: el alta de la refacción es otro <form>, y anidarlos no
        es HTML válido — el submit de adentro dispararía el de afuera. */}
    <NuevaPiezaModal
      opened={nuevaPiezaOpen}
      onClose={() => setNuevaPiezaOpen(false)}
      onCreated={piezaCreada}
    />
    </>
  )
}
