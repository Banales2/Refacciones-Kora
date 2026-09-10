// Dónde las piezas identificadas no cuadran con lo que dice la existencia.
//
// Mientras las dos capas convivan —`existencias_lote` cuenta, `unidades_pieza`
// identifica— pueden separarse si algún movimiento toca una y no la otra. Esto
// lo hace visible en vez de dejarlo silencioso.
//
// No es una tabla: se calcula al preguntarlo. Por eso no se "resuelve" como un
// descuadre de inventario — se arregla capturando lo que falte, y desaparece
// solo en cuanto las dos cifras vuelven a coincidir.
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

export interface CuadreUnidades {
  pieza_id:     number
  numero_serie: string
  descripcion:  string
  sucursal_id:  number | null
  sucursal:     string | null
  /** Unidades libres —sin instalación abierta— en ese estante. */
  unidades:     number
  /** Lo que dice la existencia para esa refacción en ese estante. */
  existencia:   number
}

export function useCuadreUnidades() {
  return useQuery({
    queryKey: ['unidades-cuadre'],
    queryFn: () => api.get<{ data: CuadreUnidades[] }>('/unidades/cuadre'),
  })
}
