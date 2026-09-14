// El acta de una visita del programa: qué se contestó de cada renglón de la
// columna que se está cerrando, y qué le falta para poder guardarse.
//
// La revisión vive aquí y no en el componente porque es la misma que hace la
// API al recibir la visita. Adelantarla sirve para que el problema se vea antes
// de guardar: llegar al servidor con un acta incompleta dejaría el
// mantenimiento ya registrado y la columna sin cerrar.
//
// Ver la migración 031 para por qué la columna dejó de cerrarse en silencio.

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
  /** Su acción consume refacción: darlo por hecho exige tener la pieza cargada. */
  requiere_pieza:    boolean
}

export interface RespuestaRenglon {
  hecha: boolean
  nota:  string
}

/** Lo contestado hasta ahora, por renglón. Lo que no está, está sin responder. */
export type ActaValor = Record<number, RespuestaRenglon>

/**
 * El renglón se dio por hecho pero la refacción que consume no está capturada.
 * Es "el cambio de aceite exige un aceite": la pieza tiene que salir del
 * inventario en este mismo mantenimiento.
 */
export function exigePiezaFaltante(
  r: RenglonColumna, resp: RespuestaRenglon | undefined, tiposCargados: Set<number>,
): boolean {
  return resp?.hecha === true && r.requiere_pieza && r.tipo_pieza_id != null &&
    !tiposCargados.has(r.tipo_pieza_id)
}

/** Lo que le falta a cada renglón para poder cerrar la columna. */
export function revisarActa(
  renglones: RenglonColumna[], valor: ActaValor, tiposCargados: Set<number>,
): Record<number, string> {
  const errores: Record<number, string> = {}
  for (const r of renglones) {
    const resp = valor[r.operacion_id]
    if (!resp) {
      errores[r.operacion_id] = 'Falta decir si se hizo'
    } else if (!resp.hecha && !resp.nota.trim()) {
      errores[r.operacion_id] = 'Di por qué no se hizo'
    } else if (exigePiezaFaltante(r, resp, tiposCargados)) {
      errores[r.operacion_id] =
        `Agrega la refacción (${r.tipo_pieza_nombre ?? 'del tipo que corresponde'}) ` +
        'abajo, o marca que no se hizo'
    }
  }
  return errores
}
