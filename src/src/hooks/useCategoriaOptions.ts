// Opciones del selector de categoría, compartidas por los formularios de
// incidencia y de operación del programa: las categorías ya usadas en la flota
// más la que el usuario esté escribiendo, ofrecida para crearla al vuelo.
import { usePendienteCategorias } from './usePendientes'
import { useOpcionesTexto } from './useOpcionesTexto'

const etiquetaNueva = (v: string) => `+ Crear categoría "${v}"`

export function useCategoriaOptions(valorActual: string, categoriaInicial?: string | null) {
  const { data } = usePendienteCategorias()
  return useOpcionesTexto(data?.data, valorActual, categoriaInicial, etiquetaNueva)
}
