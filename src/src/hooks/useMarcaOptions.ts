// Opciones del selector de marca de una refacción: las marcas ya capturadas en
// el catálogo más la que se esté escribiendo. No hay catálogo de marcas —salen
// más rápido de lo que nadie lo mantendría—, así que la lista se construye con
// lo capturado; sirve para que la misma marca no termine escrita de cinco
// formas distintas.
import { useMarcasRefaccion } from './useRefacciones'
import { useOpcionesTexto } from './useOpcionesTexto'

const etiquetaNueva = (v: string) => `+ Usar "${v}"`

// `estado` va junto a las opciones para que `SelectCatalogo` pueda decir si la
// lista viene en camino o si se cayó: escribir una marca nueva funciona igual,
// pero sin las ya usadas es fácil duplicar una que ya existía.
export function useMarcaOptions(valorActual: string, marcaInicial?: string | null) {
  const query = useMarcasRefaccion()
  return {
    ...useOpcionesTexto(query.data?.data, valorActual, marcaInicial, etiquetaNueva),
    estado: query,
  }
}
