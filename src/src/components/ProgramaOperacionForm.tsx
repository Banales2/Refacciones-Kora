// Un renglón del programa: la operación que el manual pide sobre una pieza.
//
// El nombre es un campo largo y de texto libre a propósito: los renglones del
// manual son frases enteras ("Soltura o daños en el tapón del tanque de
// combustible y tubería de combustible"), no etiquetas de catálogo.
import { Stack, Group, Text, Textarea, Button, NumberInput, Alert, Autocomplete } from '@mantine/core'
import { useForm } from '@mantine/form'
import { TEXTO_LIBRE, TEXTO_SIMPLE, limpiarTextoLibre, limpiarTextoSimple } from '../lib/validaciones'
import { useTiposPiezaModelo } from '../hooks/useTiposPiezaModelo'
import SelectCatalogo from './SelectCatalogo'
import type { OperacionPrograma, OperacionPayload } from '../hooks/usePrograma'

export default function ProgramaOperacionForm({
  modeloId, initial, categorias, tipoPiezaObligatorio, isPending, error, onSubmit, onCancel,
}: {
  modeloId:   number
  initial?:   OperacionPrograma
  /** Las categorías que ya usa este programa, para no reescribirlas a mano. */
  categorias: string[]
  /**
   * El renglón ya manda reemplazar en alguna columna. Entonces el tipo de pieza
   * no es opcional: es lo que el acta de la visita va a exigir cargado —"el
   * cambio de aceite exige un aceite"— y sin él el reemplazo se colaría como
   * una inspección más.
   */
  tipoPiezaObligatorio?: boolean
  isPending:  boolean
  error:      string | null
  onSubmit:   (payload: OperacionPayload) => void
  onCancel:   () => void
}) {
  const tiposQuery = useTiposPiezaModelo(modeloId)
  const tiposOpts = (tiposQuery.data?.data ?? []).map((t) => ({
    value: String(t.id),
    label: t.etiqueta ? `${t.nombre} — ${t.etiqueta}` : t.nombre,
  }))

  const form = useForm({
    initialValues: {
      nombre:        initial?.nombre ?? '',
      descripcion:   initial?.descripcion ?? '',
      categoria:     initial?.categoria ?? '',
      tipo_pieza_id: initial?.tipo_pieza_id != null ? String(initial.tipo_pieza_id) : '',
      limite_meses:  initial?.limite_meses ?? (null as number | null),
    },
    validate: {
      tipo_pieza_id: (v) =>
        tipoPiezaObligatorio && !v
          ? 'Requerido: este renglón manda reemplazar y hay que decir qué se cambia'
          : null,
      nombre: (v) =>
        !v.trim() ? 'Requerido' :
        v.length > 200 ? 'Máximo 200 caracteres' :
        !TEXTO_LIBRE.test(v.trim()) ? 'Contiene caracteres no permitidos' : null,
      descripcion: (v) =>
        v && v.trim() && !TEXTO_LIBRE.test(v.trim()) ? 'Contiene caracteres no permitidos' : null,
      categoria: (v) =>
        !v || !v.trim() ? null :
        v.length > 30 ? 'Máximo 30 caracteres' :
        !TEXTO_SIMPLE.test(v.trim()) ? 'Solo letras, números, espacios y guiones' : null,
      limite_meses: (v) =>
        v != null && (v < 1 || v > 600) ? 'Entre 1 y 600 meses' : null,
    },
  })

  return (
    <form onSubmit={form.onSubmit((v) => onSubmit({
      nombre:        v.nombre.trim(),
      descripcion:   v.descripcion.trim() || null,
      categoria:     v.categoria.trim()   || null,
      tipo_pieza_id: v.tipo_pieza_id ? Number(v.tipo_pieza_id) : null,
      limite_meses:  v.limite_meses ?? null,
    }))}>
      <Stack gap="sm">
        <Textarea
          label="Operación" required autosize minRows={1} maxLength={200}
          placeholder="Ej. Filtro de aceite de motor"
          description="Como viene en el manual, tal cual."
          {...form.getInputProps('nombre')}
          onChange={(e) => form.setFieldValue('nombre', limpiarTextoLibre(e.currentTarget.value, 200))}
        />
        <Textarea
          label="Notas" autosize minRows={2} maxLength={2000}
          placeholder="Condiciones, excepciones, lo que el manual aclara en la nota al pie"
          {...form.getInputProps('descripcion')}
          onChange={(e) => form.setFieldValue('descripcion', limpiarTextoLibre(e.currentTarget.value, 2000))}
        />
        <Group grow align="flex-start">
          <Autocomplete
            label="Categoría" maxLength={30}
            placeholder="Ej. Motor, Frenos, Dirección"
            data={categorias}
            {...form.getInputProps('categoria')}
            onChange={(v) => form.setFieldValue('categoria', limpiarTextoSimple(v, 30))}
          />
          <NumberInput
            label="Límite de tiempo" min={1} max={600}
            suffix=" meses"
            placeholder="Sin límite"
            description="El «o cada N meses» del renglón."
            allowDecimal={false} allowNegative={false}
            {...form.getInputProps('limite_meses')}
          />
        </Group>
        <SelectCatalogo
          estado={tiposQuery}
          nombre="tipos de pieza"
          label="Tipo de pieza" clearable required={tipoPiezaObligatorio}
          placeholder={tiposOpts.length
            ? (tipoPiezaObligatorio ? 'Qué pieza se cambia' : 'Ninguna en particular')
            : 'Primero declara los tipos de pieza del modelo'}
          // El selector solo ofrece los tipos que el modelo declara, no el
          // catálogo entero. Cuando la lista está vacía el campo queda sin
          // salida, así que hay que decir dónde se arregla.
          description={!tiposQuery.isLoading && !tiposQuery.isError && !tiposOpts.length
            ? 'Este modelo no tiene tipos de pieza declarados. Se agregan en «Tipos de pieza del modelo», arriba en esta misma ficha.'
            : tipoPiezaObligatorio
              ? 'Este renglón manda reemplazar: al cerrar la visita se va a exigir una refacción de este tipo.'
              : 'Opcional: muchos renglones son revisiones que no tocan una pieza del inventario. Si después lo marcas como reemplazo, va a hacer falta.'}
          data={tiposOpts}
          // Vacío por lento o por caído no es lo mismo que vacío de verdad:
          // deshabilitarlo mientras carga esconde el aviso y el reintento.
          disabled={!tiposQuery.isLoading && !tiposQuery.isError && !tiposOpts.length}
          {...form.getInputProps('tipo_pieza_id')}
          onChange={(v) => form.setFieldValue('tipo_pieza_id', v ?? '')}
        />

        <Text size="xs" c="dimmed">
          En qué servicios entra esta operación se marca después, sobre la cuadrícula. Una
          operación sin ninguna casilla marcada y con límite de tiempo va solo por meses.
        </Text>

        {error && <Alert color="red" title="Error">{error}</Alert>}

        <Group justify="flex-end">
          <Button variant="default" onClick={onCancel} disabled={isPending}>Cancelar</Button>
          <Button type="submit" loading={isPending}>
            {initial ? 'Guardar cambios' : 'Agregar operación'}
          </Button>
        </Group>
      </Stack>
    </form>
  )
}
