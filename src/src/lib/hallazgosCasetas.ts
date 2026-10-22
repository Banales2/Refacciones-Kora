// Cómo se nombra y se pinta cada hallazgo de una factura de casetas. Vive aparte
// porque lo usan la pantalla de la factura y el tablero, y un mismo hallazgo
// no puede llamarse de dos maneras según dónde se mire.
import type { TipoHallazgo } from '../hooks/useFacturasCasetas'

export const TITULO_HALLAZGO: Record<TipoHallazgo, string> = {
  cobrado_antes: 'Ya cobrado en otra factura',
  fuera_de_tarifa: 'Fuera de tarifa',
  doble_cobro: 'Posible doble cobro',
  clase_en_recorrido: 'Clase distinta en el recorrido',
  clase_mayor: 'Clase arriba de la habitual',
  clase_atipica: 'Clase distinta a la de siempre',
  ajuste: 'Ajuste de PASE',
  corregido: 'Corregido después',
  fuera_de_periodo: 'Fuera del periodo',
  tag_sin_unidad: 'Tag sin unidad',
  caseta_inusual: 'Caseta que el tag no cruzaba',
}

export const COLOR_HALLAZGO: Record<TipoHallazgo, string> = {
  cobrado_antes: 'red',
  fuera_de_tarifa: 'red',
  doble_cobro: 'red',
  clase_en_recorrido: 'orange',
  clase_mayor: 'orange',
  clase_atipica: 'orange',
  ajuste: 'yellow',
  corregido: 'gray',
  fuera_de_periodo: 'yellow',
  tag_sin_unidad: 'grape',
  caseta_inusual: 'blue',
}
