// Opciones del selector de categoría, compartidas por los formularios de
// requerimientos preventivos, plantillas de modelo e incidencias: las categorías
// ya usadas en la flota más la que el usuario esté escribiendo, ofrecida para
// crearla al vuelo.
import { useRequerimientoCategorias } from './useRequerimientos'
import { useOpcionesTexto } from './useOpcionesTexto'

const etiquetaNueva = (v: string) => `+ Crear categoría "${v}"`

export function useCategoriaOptions(valorActual: string, categoriaInicial?: string | null) {
  const { data } = useRequerimientoCategorias()
  return useOpcionesTexto(data?.data, valorActual, categoriaInicial, etiquetaNueva)
}
