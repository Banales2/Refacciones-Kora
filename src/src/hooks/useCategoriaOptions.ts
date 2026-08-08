// Opciones del selector de categoría, compartidas por los formularios de
// requerimientos preventivos, plantillas de modelo e incidencias: las categorías
// ya usadas en la flota más la que el usuario esté escribiendo, ofrecida para
// crearla al vuelo.
import { useMemo, useState } from 'react'
import { useRequerimientoCategorias } from './useRequerimientos'

export function useCategoriaOptions(valorActual: string, categoriaInicial?: string | null) {
  const { data } = useRequerimientoCategorias()
  const [search, setSearch] = useState('')

  const options = useMemo(() => {
    const existentes = new Set(data?.data ?? [])
    // La del registro que se edita, por si se dejó de usar en el resto.
    if (categoriaInicial) existentes.add(categoriaInicial)
    // Y la ya elegida. Esto no es un detalle: el Select busca la etiqueta del
    // valor seleccionado entre las opciones, y si la única que coincide es la de
    // "+ Crear categoría …", pinta ese texto completo como si fuera el valor.
    if (valorActual) existentes.add(valorActual)

    const opts = [...existentes]
      .sort((a, b) => a.localeCompare(b, 'es-MX'))
      .map((c) => ({ value: c, label: c }))

    const nueva = search.trim()
    const yaExiste = [...existentes].some((c) => c.toLowerCase() === nueva.toLowerCase())
    if (nueva && !yaExiste) {
      opts.unshift({ value: nueva, label: `+ Crear categoría "${nueva}"` })
    }
    return opts
  }, [data, categoriaInicial, valorActual, search])

  return { options, setSearch }
}
