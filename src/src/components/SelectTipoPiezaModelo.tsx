// Selector de los tipos de pieza que declara un modelo, con alta desde el propio
// buscador: escribir un nombre que el modelo no tiene ofrece declararlo —y, si
// tampoco existe en el catálogo general, crearlo—.
//
// Vive aparte porque lo usan dos pantallas que tienen que portarse igual: el
// formulario de un renglón del programa y la importación del programa desde
// CSV, donde cada renglón que manda reemplazar pide su tipo.
import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useTiposPiezaModelo, useAddTiposPiezaModelo } from '../hooks/useTiposPiezaModelo'
import { useTiposPieza, useCreateTipoPieza } from '../hooks/useTiposPieza'
import { usePermisos } from '../hooks/usePermisos'
import { limpiarTextoSimple } from '../lib/validaciones'
import SelectCatalogo from './SelectCatalogo'

// Valores centinela: nunca se guardan, se reemplazan por el id real en cuanto
// termina el alta.
const CREAR   = '__crear__'
const AGREGAR = '__agregar__:'

export default function SelectTipoPiezaModelo({
  modeloId, value, onChange, sugerencia, label, description, placeholder,
  required, clearable, disabled, error, size,
}: {
  modeloId:     number
  /** Id del tipo como texto; '' = ninguno. */
  value:        string
  onChange:     (tipoPiezaId: string) => void
  /**
   * Un nombre que ofrecer para registrar sin tener que escribirlo, mientras el
   * buscador esté vacío. La importación lo saca del nombre del renglón.
   */
  sugerencia?:  string
  label?:       string
  description?: ReactNode
  placeholder?: string
  required?:    boolean
  clearable?:   boolean
  disabled?:    boolean
  error?:       ReactNode
  size?:        string
}) {
  const tiposQuery = useTiposPiezaModelo(modeloId)

  // Admin, editor y practicante: los que la API deja registrar tipos.
  const { puedeRegistrarTipoPieza: puedeRegistrar } = usePermisos()
  const catalogoQuery = useTiposPieza()
  const crearTipoMut  = useCreateTipoPieza()
  const agregarMut    = useAddTiposPiezaModelo()
  const [busqueda, setBusqueda] = useState('')
  const [errorAlta, setErrorAlta] = useState<string | null>(null)
  const registrando = crearTipoMut.isPending || agregarMut.isPending

  const nuevo = busqueda.trim() || (sugerencia ?? '').trim()

  const opts = useMemo(() => {
    const delModelo = tiposQuery.data?.data ?? []
    const lista = delModelo.map((t) => ({
      value: String(t.id),
      label: t.etiqueta ? `${t.nombre} — ${t.etiqueta}` : t.nombre,
    }))
    if (!puedeRegistrar || !nuevo) return lista
    const igual = (n: string) => n.toLowerCase() === nuevo.toLowerCase()
    if (delModelo.some((t) => igual(t.nombre))) return lista
    const enCatalogo = (catalogoQuery.data?.data ?? []).find((t) => igual(t.nombre))
    lista.unshift(enCatalogo
      ? { value: `${AGREGAR}${enCatalogo.id}`, label: `+ Agregar "${enCatalogo.nombre}" a este modelo` }
      : { value: CREAR, label: `+ Registrar tipo "${nuevo}" y agregarlo a este modelo` })
    return lista
  }, [tiposQuery.data, catalogoQuery.data, nuevo, puedeRegistrar])

  async function elegir(v: string | null) {
    setErrorAlta(null)
    if (v !== CREAR && !v?.startsWith(AGREGAR)) {
      onChange(v ?? '')
      return
    }
    try {
      const tipoId = v === CREAR
        ? (await crearTipoMut.mutateAsync(nuevo)).data.id
        : Number(v.slice(AGREGAR.length))
      await agregarMut.mutateAsync({ modeloId, tipoIds: [tipoId] })
      // Se espera a la lista nueva antes de elegirlo: con la vieja, el
      // selector no encuentra la etiqueta del valor y se queda en blanco.
      await tiposQuery.refetch()
      onChange(String(tipoId))
      setBusqueda('')
    } catch (e) {
      setErrorAlta((e as Error).message)
    }
  }

  return (
    <SelectCatalogo
      estado={tiposQuery}
      nombre="tipos de pieza"
      label={label}
      description={description}
      size={size}
      required={required}
      clearable={clearable}
      placeholder={registrando ? 'Registrando tipo…' : placeholder}
      searchValue={busqueda}
      onSearchChange={(v) => setBusqueda(limpiarTextoSimple(v, 40))}
      nothingFoundMessage={puedeRegistrar ? 'Escribe el nombre para registrarlo' : 'Sin coincidencias'}
      data={opts}
      // Vacío por lento o por caído no es lo mismo que vacío de verdad:
      // deshabilitarlo mientras carga esconde el aviso y el reintento.
      disabled={registrando || disabled}
      value={value || null}
      onChange={elegir}
      error={errorAlta ?? error}
    />
  )
}
