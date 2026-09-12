// El flujo del costo de una refacción: cada compra y cada cotización, por
// proveedor y en el tiempo.
//
// La comparativa contesta "¿a quién le compro hoy?" y para eso se queda con un
// precio por proveedor, el último. Esto contesta la otra mitad —"¿cómo llegó a
// costar esto?"— que es la única que se puede contestar cuando al catálogo le
// falta un segundo proveedor con quien comparar: ahí no hay columnas que
// contrastar, pero sí hay meses.
//
// Vive aquí y no dentro del modal porque el PDF de la refacción imprime la
// misma tabla: cuando esto estaba en el componente, la hoja y la pantalla
// acababan diciendo cosas distintas.
import type { RegistroPrecio } from '../hooks/usePreciosProveedor'
import { formatFechaCorta } from './formato'

/**
 * Los colores de las series, en orden fijo.
 *
 * Se asignan por el orden en que aparece cada proveedor y NO se reciclan: el
 * color es del proveedor, así que filtrar o quitar uno no puede repintar a los
 * demás. Con más proveedores que colores la gráfica se queda corta a propósito
 * —ver `MAX_SERIES`—: inventar un séptimo tono acaba en dos series iguales.
 *
 * La lista pasa las seis comprobaciones de color (banda de luminosidad, croma,
 * separación para daltonismo, piso de visión normal y contraste) contra la
 * superficie clara Y la oscura, así que es una sola paleta para los dos temas.
 * El par teal/naranja queda en el piso de separación para tritanopía, que es
 * legal sólo con una segunda señal: por eso la leyenda y la tabla de abajo
 * nombran siempre al proveedor, y el color nunca es lo único que lo identifica.
 */
export const COLORES_SERIE = [
  '#228be6', // blue.6
  '#e8590c', // orange.8
  '#0ca678', // teal.7
  '#be4bdb', // grape.6
  '#5c940d', // lime.8
  '#1098ad', // cyan.7
] as const

export const MAX_SERIES = COLORES_SERIE.length

export interface SerieProveedor {
  proveedor: string
  color:     string
}

/** Un punto de la gráfica: una fecha con lo que costaba ese día en cada proveedor. */
export type PuntoHistorial = Record<string, string | number | null>

/**
 * De la lista de registros a lo que dibuja la gráfica.
 *
 * Una fila por fecha y una columna por proveedor, que es la forma que pide
 * LineChart. Los huecos van en null: el proveedor que no vendió ese día no
 * tiene precio ese día, y poner un cero dibujaría una caída a suelo que nunca
 * pasó (la gráfica une los puntos por encima del hueco).
 */
export function seriesDeHistorial(historial: RegistroPrecio[]): {
  series: SerieProveedor[]
  datos:  PuntoHistorial[]
} {
  // Por orden de aparición, que ya viene ordenado por proveedor y fecha: así el
  // color de cada uno no depende de cuántos registros traiga.
  const nombres: string[] = []
  for (const r of historial) if (!nombres.includes(r.proveedor)) nombres.push(r.proveedor)

  const series = nombres.slice(0, MAX_SERIES).map((proveedor, i) => ({
    proveedor,
    color: COLORES_SERIE[i],
  }))
  const dibujados = new Set(series.map((s) => s.proveedor))

  const porFecha = new Map<string, PuntoHistorial>()
  for (const r of historial) {
    if (!dibujados.has(r.proveedor)) continue
    const punto = porFecha.get(r.fecha) ?? {
      fecha: r.fecha,
      fechaLabel: formatFechaCorta(r.fecha),
      ...Object.fromEntries(nombres.map((n) => [n, null])),
    }
    // Dos registros del mismo proveedor el mismo día: manda el último, que es
    // el mismo criterio con el que la comparativa elige el precio vigente.
    punto[r.proveedor] = r.precio
    porFecha.set(r.fecha, punto)
  }

  return {
    series,
    datos: [...porFecha.values()].sort(
      (a, b) => String(a.fecha).localeCompare(String(b.fecha))),
  }
}

export interface RegistroConVariacion extends RegistroPrecio {
  /** Contra el registro anterior del MISMO proveedor. Null en el primero. */
  cambio_pct: number | null
}

/**
 * Los registros de lo más reciente a lo más viejo, cada uno con lo que cambió
 * respecto de la vez anterior de ese proveedor.
 *
 * La comparación es dentro del proveedor y no contra el registro anterior a
 * secas: entre dos proveedores distintos la diferencia es de precio, no un
 * cambio, y mezclarlas diría que "subió" algo que sólo cambió de vendedor.
 */
export function conVariacion(historial: RegistroPrecio[]): RegistroConVariacion[] {
  const previo = new Map<string, number>()
  // El recorrido va del más viejo al más nuevo —que es como llega— para poder
  // mirar hacia atrás; el orden de salida se invierte al final.
  const anotados = historial.map((r) => {
    const antes = previo.get(r.proveedor)
    previo.set(r.proveedor, r.precio)
    return {
      ...r,
      cambio_pct: antes == null || antes <= 0
        ? null
        : Math.round(((r.precio - antes) / antes) * 1000) / 10,
    }
  })
  return anotados.sort((a, b) =>
    b.fecha.localeCompare(a.fecha) || a.proveedor.localeCompare(b.proveedor, 'es-MX'))
}
