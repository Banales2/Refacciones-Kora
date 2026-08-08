// Opciones del selector de compañía aseguradora en el catálogo de seguros: las
// compañías que ya aparecen en alguna póliza más la que el usuario esté
// escribiendo, ofrecida para crearla al vuelo. No hay catálogo de compañías
// detrás, así que las existentes salen de las pólizas ya capturadas.
import { useMemo } from 'react'
import { useSeguros } from './useSeguros'
import { useOpcionesTexto } from './useOpcionesTexto'

const etiquetaNueva = (v: string) => `+ Crear compañía "${v}"`

export function useCompaniaOptions(valorActual: string, companiaInicial?: string | null) {
  const { data } = useSeguros()
  // Memoizado: `useOpcionesTexto` lo trae como dependencia y un arreglo nuevo en
  // cada render recalcularía las opciones de balde.
  const companias = useMemo(
    () => data?.data.map((s) => s.compania).filter(Boolean),
    [data],
  )
  return useOpcionesTexto(companias, valorActual, companiaInicial, etiquetaNueva)
}
