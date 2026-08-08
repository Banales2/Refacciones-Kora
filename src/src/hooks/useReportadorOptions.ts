// Opciones del selector "reportado por": los empleados que ya han reportado algo
// más el que se esté escribiendo. No hay catálogo de empleados, así que la lista
// se construye con lo capturado; sirve para que la misma persona no termine
// escrita de cinco formas distintas.
import { useIncidenciaReportadores } from './useIncidencias'
import { useOpcionesTexto } from './useOpcionesTexto'

const etiquetaNueva = (v: string) => `+ Usar "${v}"`

export function useReportadorOptions(valorActual: string, reportadorInicial?: string | null) {
  const { data } = useIncidenciaReportadores()
  return useOpcionesTexto(data?.data, valorActual, reportadorInicial, etiquetaNueva)
}
