// Opciones del selector "autorizó" de un traspaso: quienes ya han autorizado
// alguno más el que se esté escribiendo. No hay catálogo de jefes de almacén,
// así que la lista se construye con lo capturado; sirve para que la misma
// persona no termine escrita de cinco formas distintas.
import { useTraspasoAutorizadores } from './useInventario'
import { useOpcionesTexto } from './useOpcionesTexto'

const etiquetaNueva = (v: string) => `+ Usar "${v}"`

// `estado` va junto a las opciones para que `SelectCatalogo` pueda decir si la
// lista viene en camino o si se cayó: escribir un nombre nuevo funciona igual,
// pero sin los ya usados es fácil duplicar uno que ya existía.
export function useAutorizadorOptions(valorActual: string) {
  const query = useTraspasoAutorizadores()
  return {
    ...useOpcionesTexto(query.data?.data, valorActual, null, etiquetaNueva),
    estado: query,
  }
}
