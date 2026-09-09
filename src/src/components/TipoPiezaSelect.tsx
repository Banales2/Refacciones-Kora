// Selector del tipo de una refacción, con alta del tipo desde el propio
// buscador: si lo que se escribe no existe, la primera opción lo crea.
//
// Vive aparte de PiezaForm porque el alta de una refacción ocurre en dos
// lugares —el formulario completo y el renglón de una compra de varias
// refacciones—, y el "escribe para crear el tipo" tiene que portarse igual en
// los dos. Duplicarlo era la vía segura a que uno de los dos se quedara atrás.
import { useState, useMemo } from 'react'
import { Select } from '@mantine/core'
import { useTiposPieza, useCreateTipoPieza } from '../hooks/useTiposPieza'
import { limpiarTextoSimple } from '../lib/validaciones'

// Valor centinela del selector: al elegirlo se crea el tipo escrito. Nunca se
// guarda — se reemplaza por el id real que devuelve el backend.
const CREAR_TIPO = '__crear__'

export default function TipoPiezaSelect({
  value, onChange, error, label = 'Tipo de pieza', description, size,
}: {
  value:        string
  onChange:     (tipoPiezaId: string) => void
  error?:       string | null
  label?:       string | null
  description?: string
  size?:        string
}) {
  const [search, setSearch] = useState('')

  const { data: tiposData } = useTiposPieza()
  const crearTipoMut = useCreateTipoPieza()

  const options = useMemo(() => {
    const tipos = tiposData?.data ?? []
    const opts = tipos.map((t) => ({ value: String(t.id), label: t.nombre }))
    const nuevo = search.trim()
    const yaExiste = tipos.some((t) => t.nombre.toLowerCase() === nuevo.toLowerCase())
    if (nuevo && !yaExiste) {
      opts.unshift({ value: CREAR_TIPO, label: `+ Crear tipo "${nuevo}"` })
    }
    return opts
  }, [tiposData, search])

  function handleChange(v: string | null) {
    if (v !== CREAR_TIPO) { onChange(v ?? ''); return }
    const nombre = search.trim()
    if (!nombre) return
    crearTipoMut.mutate(nombre, {
      onSuccess: ({ data: tipo }) => {
        onChange(String(tipo.id))
        setSearch('')
      },
    })
  }

  return (
    <Select
      label={label ?? undefined}
      description={description}
      size={size}
      placeholder="Selecciona o escribe para crear un tipo"
      data={options}
      searchable
      required
      searchValue={search}
      // Allowlist: solo letras, números, espacios y guiones (máx. 40)
      onSearchChange={(v) => setSearch(limpiarTextoSimple(v, 40))}
      nothingFoundMessage="Escribe para crear un tipo nuevo"
      value={value || null}
      onChange={handleChange}
      error={crearTipoMut.error ? (crearTipoMut.error as Error).message : error}
    />
  )
}
