// Cálculos de las recargas de combustible que comparten la ficha del vehículo
// (components/RecargasSection) y el listado de toda la flota
// (components/RecargasFlota).
import type { Recarga } from '../hooks/useRecargas'

// Rendimiento por recarga: los km recorridos son el kilometraje de esta recarga
// menos el de la recarga anterior (en orden cronológico). km/L = km recorridos
// / litros.
//
// La primera carga capturada no tiene rendimiento, y no es lo mismo que tenerlo
// en cero: los kilómetros que traía la unidad antes de esa carga los pagó
// combustible que nadie registró aquí. Tomar el anterior como 0 le atribuía el
// odómetro completo —30 000 km con un tanque en una unidad que se dio de alta
// usada—. Es el mismo criterio de lib/reportes/vehiculo y del análisis de
// costos de la flota: solo se mide de tanque a tanque.
//
// Devuelve un mapa id → km por litro (null si no se puede calcular: la primera
// carga, una sin kilometraje, sin litros, o si el kilometraje bajó respecto al
// anterior).
export function calcularRendimientos(items: Recarga[]): Map<number, number | null> {
  const asc = [...items].sort((a, b) => {
    const fa = a.fecha.split('T')[0]
    const fb = b.fecha.split('T')[0]
    return fa === fb ? a.id - b.id : fa.localeCompare(fb)
  })

  const rend = new Map<number, number | null>()
  let kmAnterior: number | null = null
  for (const r of asc) {
    if (r.kilometraje == null) {
      rend.set(r.id, null)
      continue
    }
    if (kmAnterior == null) {
      // La que abre el historial: deja la referencia para la siguiente, que sí
      // cierra un tramo completo.
      rend.set(r.id, null)
      kmAnterior = r.kilometraje
      continue
    }
    const kmRecorridos = r.kilometraje - kmAnterior
    const litros = Number(r.litros)
    rend.set(r.id, litros > 0 && kmRecorridos >= 0 ? kmRecorridos / litros : null)
    kmAnterior = r.kilometraje
  }
  return rend
}

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

// ── Agrupado año → mes ────────────────────────────────────────────────────────

type Grupo = {
  key:    string
  label:  string
  litros: number
  costo:  number
}

type GrupoMes<T extends Recarga = Recarga>  = Grupo & { items: T[] }
type GrupoAnio<T extends Recarga = Recarga> = Grupo & { meses: GrupoMes<T>[] }

// La fecha llega como "YYYY-MM-DD" (o ISO con hora). Se parte el string en vez
// de construir un Date para que el mes no se recorra por zona horaria.
export function agrupar<T extends Recarga>(items: T[]): GrupoAnio<T>[] {
  const anios = new Map<string, Map<string, T[]>>()

  for (const r of items) {
    const [anio, mes] = r.fecha.split('T')[0].split('-')
    if (!anios.has(anio)) anios.set(anio, new Map())
    const meses = anios.get(anio)!
    if (!meses.has(mes)) meses.set(mes, [])
    meses.get(mes)!.push(r)
  }

  const sumar = (rs: Recarga[]) => ({
    litros: rs.reduce((s, r) => s + Number(r.litros), 0),
    costo:  rs.reduce((s, r) => s + Number(r.costo),  0),
  })

  return [...anios.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([anio, mesesMap]) => {
      const meses: GrupoMes<T>[] = [...mesesMap.entries()]
        .sort((a, b) => b[0].localeCompare(a[0]))
        .map(([mes, rs]) => ({
          key:   `${anio}-${mes}`,
          label: MESES[parseInt(mes, 10) - 1],
          items: rs,
          ...sumar(rs),
        }))

      return {
        key:   anio,
        label: anio,
        meses,
        ...sumar(meses.flatMap((m) => m.items)),
      }
    })
}
