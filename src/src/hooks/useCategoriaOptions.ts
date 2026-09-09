// Opciones del selector de categoría, compartidas por los formularios de
// incidencia y de operación del programa: las categorías ya usadas en la flota
// más la que el usuario esté escribiendo, ofrecida para crearla al vuelo.
import { usePendienteCategorias } from './usePendientes'
import { useOpcionesTexto } from './useOpcionesTexto'

const etiquetaNueva = (v: string) => `+ Crear categoría "${v}"`

// `estado` viaja junto a las opciones para que el selector pueda decir si la
// lista viene en camino o si se cayó: escribir una categoría nueva funciona
// igual, pero sin las ya usadas es fácil duplicar una que ya existía con otra
// mayúscula. Lo consume `SelectCatalogo`.
export function useCategoriaOptions(valorActual: string, categoriaInicial?: string | null) {
  const query = usePendienteCategorias()
  return {
    ...useOpcionesTexto(query.data?.data, valorActual, categoriaInicial, etiquetaNueva),
    estado: query,
  }
}
