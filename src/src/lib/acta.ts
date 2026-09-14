// El acta de una visita del programa: cómo terminó cada renglón de la columna
// que se está cerrando, y qué le falta para poder guardarse.
//
// La revisión vive aquí y no en el componente porque es la misma que hace la
// API al recibir la visita. Adelantarla sirve para que el problema se vea antes
// de guardar: llegar al servidor con un acta incompleta dejaría el
// mantenimiento ya registrado y la columna sin cerrar.
//
// Ver la migración 031 para por qué la columna dejó de cerrarse en silencio y
// por qué los desenlaces son tres y no dos.

/**
 * Cómo terminó un renglón. El corte que importa no es "se hizo o no", es
 * ATENDIDO contra SALTADO: revisar y no encontrar nada es cumplir el
 * mantenimiento igual que cambiar la pieza.
 */
export type ResultadoRenglon = 'atendida' | 'revisada' | 'omitida'

export const RESULTADO_LABEL: Record<ResultadoRenglon, string> = {
  atendida: 'Se atendió',
  revisada: 'No se ocupó',
  omitida:  'Quedó pendiente',
}

/** Un renglón de la columna que se está cerrando, listo para preguntarse. */
export interface RenglonColumna {
  operacion_id:      number
  nombre:            string
  categoria:         string | null
  /** El código de la celda (I, A, R, T, L). */
  accion:            string
  accion_nombre:     string
  /** Sobre qué tipo de pieza trabaja el renglón. Null = no toca el inventario. */
  tipo_pieza_id:     number | null
  tipo_pieza_nombre: string | null
  /** Su acción consume refacción: atenderlo exige tener la pieza cargada. */
  requiere_pieza:    boolean
}

export interface RespuestaRenglon {
  resultado: ResultadoRenglon
  nota:      string
}

/** Lo que se ha tocado a mano, por renglón. Lo demás corre con su arranque. */
export type ActaValor = Record<number, RespuestaRenglon>

/**
 * El renglón exige que se elija a mano, sin arranque posible.
 *
 * Reemplazar no tiene desenlace por omisión: o se cambió la pieza o no se
 * cambió, y arrancarlo en "no se ocupó" sería el sistema contestando por el
 * taller justo en lo único que cuesta dinero —que es la mentira que todo esto
 * vino a quitar—. Son pocos por columna, así que no estorba la captura rápida.
 */
export function exigeRespuesta(r: RenglonColumna): boolean {
  return r.requiere_pieza && r.tipo_pieza_id != null
}

/**
 * Lo contestado de un renglón, con el arranque ya aplicado.
 *
 * Un chequeo general es una lista larga donde casi todo sale bien, así que
 * arranca en "revisada, no se ocupó" y el capturista solo toca las excepciones:
 * lo que sí se cambió y lo que no se alcanzó a ver. Marcar treinta renglones a
 * mano no lo haría nadie dos veces.
 *
 * Devuelve `undefined` solo en los renglones que exigen elegir: ahí no hay
 * arranque que valga.
 */
export function respuestaDe(
  r: RenglonColumna, valor: ActaValor,
): RespuestaRenglon | undefined {
  const propia = valor[r.operacion_id]
  if (propia) return propia
  return exigeRespuesta(r) ? undefined : { resultado: 'revisada', nota: '' }
}

/**
 * El renglón se dio por atendido pero la refacción que consume no está
 * capturada. Es "el cambio de aceite exige un aceite": la pieza tiene que salir
 * del inventario en este mismo mantenimiento.
 */
export function exigePiezaFaltante(
  r: RenglonColumna, resp: RespuestaRenglon | undefined, tiposCargados: Set<number>,
): boolean {
  return resp?.resultado === 'atendida' && r.requiere_pieza &&
    r.tipo_pieza_id != null && !tiposCargados.has(r.tipo_pieza_id)
}

/** Lo que le falta a cada renglón para poder cerrar la columna. */
export function revisarActa(
  renglones: RenglonColumna[], valor: ActaValor, tiposCargados: Set<number>,
): Record<number, string> {
  const errores: Record<number, string> = {}
  for (const r of renglones) {
    const resp = respuestaDe(r, valor)
    if (!resp) {
      errores[r.operacion_id] = 'Falta decir si se cambió'
    } else if (resp.resultado === 'omitida' && !resp.nota.trim()) {
      errores[r.operacion_id] = 'Di por qué quedó pendiente'
    } else if (exigePiezaFaltante(r, resp, tiposCargados)) {
      errores[r.operacion_id] =
        `Agrega la refacción (${r.tipo_pieza_nombre ?? 'del tipo que corresponde'}) ` +
        'abajo, o márcalo como que no se ocupó'
    }
  }
  return errores
}

/** El acta completa tal como viaja a la API, con el arranque ya resuelto. */
export function actaParaEnviar(renglones: RenglonColumna[], valor: ActaValor) {
  return renglones.map((r) => {
    const resp = respuestaDe(r, valor)
    return {
      operacion_id: r.operacion_id,
      // Sin respuesta no debería llegar aquí —`revisarActa` lo ataja antes—,
      // pero si llegara, omitida es lo honesto: no se dijo que se hiciera.
      resultado:    resp?.resultado ?? 'omitida' as ResultadoRenglon,
      nota:         resp?.nota.trim() || null,
    }
  })
}
