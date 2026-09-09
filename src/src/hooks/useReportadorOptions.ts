// Opciones del selector "reportado por": los empleados que ya han reportado algo
// más el que se esté escribiendo. No hay catálogo de empleados, así que la lista
// se construye con lo capturado; sirve para que la misma persona no termine
// escrita de cinco formas distintas.
import { useIncidenciaReportadores } from './useIncidencias'
import { useOpcionesTexto } from './useOpcionesTexto'

const etiquetaNueva = (v: string) => `+ Usar "${v}"`

// `estado` va junto a las opciones: sin la lista de quienes ya han reportado,
// la misma persona acaba escrita de cinco formas, que es justo lo que este
// selector existe para evitar. Lo consume `SelectCatalogo`.
export function useReportadorOptions(valorActual: string, reportadorInicial?: string | null) {
  const query = useIncidenciaReportadores()
  return {
    ...useOpcionesTexto(query.data?.data, valorActual, reportadorInicial, etiquetaNueva),
    estado: query,
  }
}
