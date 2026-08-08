// Opciones de un Select sobre un campo de texto libre sin catálogo detrás: lo
// ya capturado en la flota más lo que el usuario esté escribiendo, ofrecido para
// crearlo al vuelo. Lo usan categoría y "reportado por".
import { useMemo, useState } from 'react'

export function useOpcionesTexto(
  existentesRemotas: string[] | undefined,
  valorActual: string,
  valorInicial: string | null | undefined,
  etiquetaNueva: (valor: string) => string,
) {
  const [search, setSearch] = useState('')

  const options = useMemo(() => {
    const existentes = new Set(existentesRemotas ?? [])
    // La del registro que se edita, por si se dejó de usar en el resto.
    if (valorInicial) existentes.add(valorInicial)
    // Y el ya elegido. Esto no es un detalle: el Select busca la etiqueta del
    // valor seleccionado entre las opciones, y si la única que coincide es la de
    // "+ Crear …", pinta ese texto completo como si fuera el valor.
    if (valorActual) existentes.add(valorActual)

    const opts = [...existentes]
      .sort((a, b) => a.localeCompare(b, 'es-MX'))
      .map((c) => ({ value: c, label: c }))

    const nuevo = search.trim()
    const yaExiste = [...existentes].some((c) => c.toLowerCase() === nuevo.toLowerCase())
    if (nuevo && !yaExiste) {
      opts.unshift({ value: nuevo, label: etiquetaNueva(nuevo) })
    }
    return opts
  }, [existentesRemotas, valorInicial, valorActual, search, etiquetaNueva])

  return { options, setSearch }
}
