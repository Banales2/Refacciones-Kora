import * as repo from '../repositories/preciosProveedorRepo'
import * as refaccionesRepo from '../repositories/refaccionesRepo'
import type { PrecioProveedor } from '../repositories/preciosProveedorRepo'
import type { PrecioProveedorCreate, PrecioProveedorUpdate } from '../schemas/precioProveedorSchema'
import { NotFoundError, ConflictError } from '../shared/errors'

export async function getByProveedor(proveedorId: number): Promise<PrecioProveedor[]> {
  if (!(await repo.proveedorExists(proveedorId))) throw new NotFoundError('Proveedor')
  return repo.findByProveedor(proveedorId)
}

export async function create(
  proveedorId: number, data: PrecioProveedorCreate, registradoPor: string
): Promise<PrecioProveedor> {
  if (!(await repo.proveedorExists(proveedorId))) throw new NotFoundError('Proveedor')
  // Se cotizan refacciones del catálogo: si la pieza no existe, el 404 dice qué
  // pasó mejor que el error de llave foránea.
  if (!(await repo.piezaExists(data.pieza_id))) throw new NotFoundError('Refacción')
  if (await repo.existsMismoDia(proveedorId, data.pieza_id, data.fecha)) {
    throw new ConflictError(
      'Ya hay un precio de esa refacción con este proveedor en esa fecha. Edítalo en vez de capturarlo otra vez.'
    )
  }
  return repo.create(proveedorId, data, registradoPor)
}

export async function update(id: number, data: PrecioProveedorUpdate): Promise<PrecioProveedor> {
  const actual = await repo.findById(id)
  if (!actual) throw new NotFoundError('Precio')
  // Mover la fecha puede chocar con otro precio de la misma refacción.
  if (data.fecha !== undefined &&
      await repo.existsMismoDia(actual.proveedor_id, actual.pieza_id, data.fecha, id)) {
    throw new ConflictError(
      'Ya hay un precio de esa refacción con este proveedor en esa fecha.'
    )
  }
  const result = await repo.update(id, data)
  if (!result) throw new NotFoundError('Precio')
  return result
}

export async function remove(id: number): Promise<void> {
  const deleted = await repo.remove(id)
  if (!deleted) throw new NotFoundError('Precio')
}

// ─── Comparativa global de precios ──────────────────────────────────────────

export interface PrecioDeProveedor {
  proveedor_id: number
  proveedor:    string
  precio:       number
  fecha:        string
  /** Días naturales en que surte ese proveedor. Null si no se capturó. */
  tiempo_entrega_dias: number | null
  /** Cuánto más caro es que el mejor precio de esa refacción, en porcentaje. */
  sobre_mejor:  number
}

export interface FilaComparativa {
  pieza_id:        number
  numero_serie:    string
  descripcion:     string
  tipo_pieza:      string | null
  /** Ordenados del más barato al más caro. */
  precios:         PrecioDeProveedor[]
  mejor_precio:    number
  mejor_proveedor: string
  peor_precio:     number
  peor_proveedor:  string
  /** Diferencia entre el más caro y el más barato: el margen que hay para negociar. */
  diferencia:      number
  diferencia_pct:  number
  /** Última compra real, para contrastar la cotización contra lo que se pagó. */
  ultimo_pagado:    number | null
  ultimo_proveedor: string | null
  ultima_compra:    string | null
  /** Lo que se paga de más hoy contra el mejor precio cotizado, por unidad. */
  ahorro_unitario:  number | null
  /** El plazo más corto entre los proveedores que lo capturaron. */
  mejor_entrega:          number | null
  mejor_entrega_proveedor: string | null
}

export interface ComparativaPrecios {
  /** Proveedores que aparecen en al menos una refacción, para armar las columnas. */
  proveedores: { id: number; nombre: string }[]
  piezas:      FilaComparativa[]
  totales: {
    refacciones:          number
    /** Cuántas tienen precio de dos o más proveedores: las únicas comparables. */
    comparables:          number
    /** Suma del ahorro por unidad de las que hoy se compran más caro de lo necesario. */
    ahorro_unitario_total: number
  }
}

// Pivotea los precios vigentes: de una fila por (refacción, proveedor) a una
// fila por refacción con todos sus precios ordenados. Se hace aquí y no en SQL
// porque el número de proveedores es variable y un PIVOT tendría que armarse
// con SQL dinámico.
export async function getComparativa(piezaId?: number): Promise<ComparativaPrecios> {
  const vigentes = await repo.findVigentesGlobal(piezaId)

  const porPieza = new Map<number, FilaComparativa>()
  const proveedores = new Map<number, string>()

  for (const v of vigentes) {
    proveedores.set(v.proveedor_id, v.proveedor)
    const fila = porPieza.get(v.pieza_id) ?? {
      pieza_id: v.pieza_id, numero_serie: v.numero_serie, descripcion: v.descripcion,
      tipo_pieza: v.tipo_pieza, precios: [],
      mejor_precio: 0, mejor_proveedor: '', peor_precio: 0, peor_proveedor: '',
      diferencia: 0, diferencia_pct: 0,
      ultimo_pagado: v.ultimo_pagado, ultimo_proveedor: v.ultimo_proveedor,
      ultima_compra: v.ultima_compra, ahorro_unitario: null,
      mejor_entrega: null, mejor_entrega_proveedor: null,
    }
    fila.precios.push({
      proveedor_id: v.proveedor_id, proveedor: v.proveedor,
      precio: v.precio, fecha: v.fecha,
      tiempo_entrega_dias: v.tiempo_entrega_dias, sobre_mejor: 0,
    })
    porPieza.set(v.pieza_id, fila)
  }

  const piezas = [...porPieza.values()]
  for (const fila of piezas) {
    fila.precios.sort((a, b) => a.precio - b.precio || a.proveedor.localeCompare(b.proveedor, 'es-MX'))
    const mejor = fila.precios[0]
    const peor  = fila.precios[fila.precios.length - 1]
    fila.mejor_precio    = mejor.precio
    fila.mejor_proveedor = mejor.proveedor
    fila.peor_precio     = peor.precio
    fila.peor_proveedor  = peor.proveedor
    fila.diferencia      = Math.round((peor.precio - mejor.precio) * 100) / 100
    fila.diferencia_pct  = mejor.precio > 0
      ? Math.round(((peor.precio - mejor.precio) / mejor.precio) * 1000) / 10
      : 0
    for (const p of fila.precios) {
      p.sobre_mejor = mejor.precio > 0
        ? Math.round(((p.precio - mejor.precio) / mejor.precio) * 1000) / 10
        : 0
    }
    // Solo cuenta como ahorro si lo último que se pagó fue de verdad más caro
    // que la mejor cotización vigente.
    fila.ahorro_unitario = fila.ultimo_pagado != null && fila.ultimo_pagado > mejor.precio
      ? Math.round((fila.ultimo_pagado - mejor.precio) * 100) / 100
      : null

    // El más barato no siempre es el que entrega antes: con la unidad parada,
    // el plazo pesa tanto como el precio, así que la fila lleva los dos.
    const conEntrega = fila.precios.filter((p) => p.tiempo_entrega_dias != null)
    if (conEntrega.length) {
      const rapido = conEntrega.reduce((a, b) =>
        b.tiempo_entrega_dias! < a.tiempo_entrega_dias! ? b : a)
      fila.mejor_entrega           = rapido.tiempo_entrega_dias
      fila.mejor_entrega_proveedor = rapido.proveedor
    }
  }

  // Primero lo que más margen tiene: es donde una llamada al proveedor rinde más.
  piezas.sort((a, b) =>
    (b.ahorro_unitario ?? 0) - (a.ahorro_unitario ?? 0) ||
    b.diferencia - a.diferencia ||
    a.descripcion.localeCompare(b.descripcion, 'es-MX'))

  return {
    proveedores: [...proveedores.entries()]
      .map(([id, nombre]) => ({ id, nombre }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es-MX')),
    piezas,
    totales: {
      refacciones: piezas.length,
      comparables: piezas.filter((p) => p.precios.length > 1).length,
      ahorro_unitario_total: Math.round(
        piezas.reduce((s, p) => s + (p.ahorro_unitario ?? 0), 0) * 100) / 100,
    },
  }
}

// ─── Comparativa de una sola refacción ──────────────────────────────────────
// Es la que se abre desde la pieza para decidir a quién comprarle *ésta*: los
// mismos números de la comparativa global, pero de una fila. Devuelve también
// la pieza porque la refacción puede no tener ni un precio capturado, y el
// documento igual tiene que decir de cuál se está hablando.

export interface ComparativaPieza {
  pieza: {
    id:           number
    numero_serie: string
    descripcion:  string
    tipo_pieza:   string | null
  }
  /** Null cuando ningún proveedor la cotiza todavía. */
  fila: FilaComparativa | null
}

export async function getComparativaPieza(piezaId: number): Promise<ComparativaPieza> {
  const pieza = await refaccionesRepo.findById(piezaId)
  if (!pieza) throw new NotFoundError('Refacción')
  const comparativa = await getComparativa(piezaId)
  return {
    pieza: {
      id:           pieza.id,
      numero_serie: pieza.numero_serie,
      descripcion:  pieza.descripcion,
      tipo_pieza:   pieza.tipo_pieza ?? null,
    },
    fila: comparativa.piezas[0] ?? null,
  }
}
