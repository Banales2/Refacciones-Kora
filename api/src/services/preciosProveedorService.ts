import * as repo from '../repositories/preciosProveedorRepo'
import * as refaccionesRepo from '../repositories/refaccionesRepo'
import type { PrecioProveedor } from '../repositories/preciosProveedorRepo'
import type { PrecioProveedorCreate, PrecioProveedorUpdate } from '../schemas/precioProveedorSchema'
import { DESCUENTO_REFERENCIA } from '../repositories/preciosSql'
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

/**
 * Lo que hoy costaría una refacción con un proveedor, ya comparable.
 *
 * Un proveedor puede tener cotización y compras de la misma refacción. Aquí
 * queda UNA entrada por proveedor —la comparativa se lee como una columna por
 * proveedor y dos filas suyas la romperían— y manda la más reciente de las dos:
 * una cotización de esta semana dice más que una compra de hace ocho meses, y
 * al revés. La que pierde no se tira: va en `otro`, que es justo el contraste
 * que sirve para negociar ("te pago 92 y me cotizas 105").
 */
export interface PrecioDeProveedor {
  proveedor_id: number
  proveedor:    string
  /** Ya con descuento. Es el que ordena y con el que se calcula todo. */
  precio:       number
  /** De dónde salió: lo que ofrece o lo que ya se le pagó. */
  origen:       'cotizado' | 'pagado'
  /** Lo que dice el papel, antes del descuento. */
  precio_lista: number
  /** El descuento aplicado. Ver `estimado`. */
  descuento_pct: number | null
  /**
   * El descuento no salió de ninguna factura: es el de referencia. Pasa en toda
   * cotización, porque el proveedor cotiza lista y el descuento se pacta luego.
   */
  estimado:     boolean
  fecha:        string
  /** Cuánto más caro es que el mejor precio de esa refacción, en porcentaje. */
  sobre_mejor:  number
  /**
   * Cómo llegó este proveedor a este precio. Con un solo proveedor en el
   * catálogo no hay columnas que comparar, y lo único que queda por mirar
   * —lo que de verdad se pregunta— es si el precio se movió y cuándo.
   *
   * `registros` cuenta facturas, no renglones: la misma refacción viene
   * repetida en varias partidas del mismo papel.
   */
  registros:        number
  precio_anterior:  number | null
  fecha_anterior:   string | null
  /** Contra el registro anterior. Positivo = subió. Null si no hay con qué. */
  cambio_pct:       number | null
  /** El registro más viejo de esta fuente, para leer el recorrido entero. */
  precio_primero:   number
  fecha_primera:    string
  /** Del primero al vigente. Null cuando solo hay un registro. */
  cambio_total_pct: number | null
  /** La otra fuente del mismo proveedor, si la tiene. */
  otro:         { origen: 'cotizado' | 'pagado'; precio: number; fecha: string } | null
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
  /** Última compra real, para contrastar contra lo mejor que se consigue. */
  ultimo_pagado:    number | null
  ultimo_proveedor: string | null
  ultima_compra:    string | null
  /** Lo que se paga de más hoy contra el mejor precio disponible, por unidad. */
  ahorro_unitario:  number | null
  /**
   * La mayor subida entre los precios vigentes de esta refacción, contra el
   * registro anterior de cada proveedor. Es lo que ordena la tabla cuando no
   * hay nada que comparar entre proveedores —el caso de un catálogo con un
   * solo proveedor—, y lo que responde "¿a cuáles me subieron el precio?".
   * Null si ninguno tiene un registro previo.
   */
  alza_pct:               number | null
}

export interface ComparativaPrecios {
  /** Proveedores que aparecen en al menos una refacción, para armar las columnas. */
  proveedores: { id: number; nombre: string }[]
  piezas:      FilaComparativa[]
  /** El supuesto con el que se estimó el neto de las cotizaciones. */
  descuento_referencia: number
  totales: {
    refacciones:          number
    /** Cuántas tienen precio de dos o más proveedores: las únicas comparables. */
    comparables:          number
    /** Cuántas subieron de precio contra el registro anterior de su proveedor. */
    con_alza:             number
    /** Suma del ahorro por unidad de las que hoy se compran más caro de lo necesario. */
    ahorro_unitario_total: number
  }
}

const redondear = (n: number) => Math.round(n * 100) / 100
const pct = (de: number, a: number) => Math.round(((a - de) / de) * 1000) / 10

/** Variación porcentual contra un precio previo. Null si no hay con qué medir. */
function cambio(previo: number | null | undefined, actual: number): number | null {
  return previo == null || previo <= 0 ? null : pct(previo, actual)
}

/**
 * Pivotea los precios comparables: de una fila por (refacción, proveedor,
 * origen) a una fila por refacción con todos sus precios ordenados. Se hace
 * aquí y no en SQL porque el número de proveedores es variable y un PIVOT
 * tendría que armarse con SQL dinámico.
 *
 * `descuentoRef` es el descuento que se supone sobre una cotización para saber
 * lo que costaría de verdad. Ver `repositories/preciosSql.ts`: sin él, una
 * cotización a precio de lista se compara contra compras ya descontadas, y el
 * proveedor que cotiza sale perdiendo siempre.
 */
export async function getComparativa(
  piezaId?: number, descuentoRef = DESCUENTO_REFERENCIA,
): Promise<ComparativaPrecios> {
  const comparables = await repo.findComparables(piezaId, descuentoRef)

  const porPieza = new Map<number, FilaComparativa>()
  const proveedores = new Map<number, string>()
  // Una entrada por (pieza, proveedor); la segunda fuente que llegue del mismo
  // proveedor se resuelve contra la que ya estaba.
  const porProveedor = new Map<string, PrecioDeProveedor>()

  for (const c of comparables) {
    proveedores.set(c.proveedor_id, c.proveedor)
    const fila = porPieza.get(c.pieza_id) ?? {
      pieza_id: c.pieza_id, numero_serie: c.numero_serie, descripcion: c.descripcion,
      tipo_pieza: c.tipo_pieza, precios: [],
      mejor_precio: 0, mejor_proveedor: '', peor_precio: 0, peor_proveedor: '',
      diferencia: 0, diferencia_pct: 0,
      ultimo_pagado: null, ultimo_proveedor: null, ultima_compra: null,
      ahorro_unitario: null, alza_pct: null,
    }
    porPieza.set(c.pieza_id, fila)

    // La compra más reciente de la refacción, venga del proveedor que venga: es
    // contra lo que se mide si hoy se está pagando de más.
    if (c.origen === 'pagado' && (fila.ultima_compra == null || c.fecha > fila.ultima_compra)) {
      fila.ultimo_pagado    = c.precio
      fila.ultimo_proveedor = c.proveedor
      fila.ultima_compra    = c.fecha
    }

    const entrada: PrecioDeProveedor = {
      proveedor_id: c.proveedor_id, proveedor: c.proveedor,
      precio: c.precio, origen: c.origen,
      precio_lista: c.precio_lista, descuento_pct: c.descuento_pct,
      estimado: c.origen === 'cotizado',
      fecha: c.fecha,
      sobre_mejor: 0,
      registros:        c.registros,
      precio_anterior:  c.precio_anterior,
      fecha_anterior:   c.fecha_anterior,
      cambio_pct:       cambio(c.precio_anterior, c.precio),
      precio_primero:   c.precio_primero,
      fecha_primera:    c.fecha_primera,
      // Con un solo registro el primero ES el vigente: decir "+0%" sonaría a
      // que se midió un recorrido que no existe.
      cambio_total_pct: c.registros > 1 ? cambio(c.precio_primero, c.precio) : null,
      otro: null,
    }

    const clave = `${c.pieza_id}:${c.proveedor_id}`
    const previa = porProveedor.get(clave)
    if (!previa) {
      porProveedor.set(clave, entrada)
      fila.precios.push(entrada)
      continue
    }
    // Gana la más reciente. A igual fecha gana la compra: es un hecho, no una
    // oferta, y es lo que de verdad va a costar reponerla.
    const ganaNueva = entrada.fecha > previa.fecha ||
      (entrada.fecha === previa.fecha && entrada.origen === 'pagado')
    const [queda, desplazada] = ganaNueva ? [entrada, previa] : [previa, entrada]
    queda.otro = { origen: desplazada.origen, precio: desplazada.precio, fecha: desplazada.fecha }
    if (ganaNueva) {
      fila.precios[fila.precios.indexOf(previa)] = entrada
      porProveedor.set(clave, entrada)
    }
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
    fila.diferencia      = redondear(peor.precio - mejor.precio)
    fila.diferencia_pct  = mejor.precio > 0
      ? Math.round(((peor.precio - mejor.precio) / mejor.precio) * 1000) / 10
      : 0
    for (const p of fila.precios) {
      p.sobre_mejor = mejor.precio > 0
        ? Math.round(((p.precio - mejor.precio) / mejor.precio) * 1000) / 10
        : 0
    }
    // Solo cuenta como ahorro si lo último que se pagó fue de verdad más caro
    // que lo mejor que hoy se consigue. Si el mejor precio ES esa última compra,
    // la resta da cero y no hay nada que perseguir.
    fila.ahorro_unitario = fila.ultimo_pagado != null && fila.ultimo_pagado > mejor.precio
      ? redondear(fila.ultimo_pagado - mejor.precio)
      : null

    // La subida más fuerte entre los proveedores de esta refacción. Se queda en
    // la fila porque es lo que la ordena y lo que se cuenta en el resumen.
    const alzas = fila.precios
      .map((p) => p.cambio_pct)
      .filter((x): x is number => x != null && x > 0)
    fila.alza_pct = alzas.length ? Math.max(...alzas) : null
  }

  // Primero lo que más margen tiene: es donde una llamada al proveedor rinde
  // más. El alza entra como tercer criterio y no como primero porque un
  // sobreprecio contra otro proveedor es dinero que se está perdiendo hoy,
  // mientras que una subida puede ser el mercado entero. Pero manda sobre el
  // orden alfabético: con un solo proveedor los dos primeros criterios empatan
  // en cero para todo el catálogo, y sin esto lo que más subió quedaba enterrado.
  piezas.sort((a, b) =>
    (b.ahorro_unitario ?? 0) - (a.ahorro_unitario ?? 0) ||
    b.diferencia - a.diferencia ||
    (b.alza_pct ?? -Infinity) - (a.alza_pct ?? -Infinity) ||
    a.descripcion.localeCompare(b.descripcion, 'es-MX'))

  return {
    proveedores: [...proveedores.entries()]
      .map(([id, nombre]) => ({ id, nombre }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es-MX')),
    piezas,
    descuento_referencia: descuentoRef,
    totales: {
      refacciones: piezas.length,
      comparables: piezas.filter((p) => p.precios.length > 1).length,
      con_alza:    piezas.filter((p) => p.alza_pct != null).length,
      ahorro_unitario_total: redondear(
        piezas.reduce((s, p) => s + (p.ahorro_unitario ?? 0), 0)),
    },
  }
}

// ─── Comparativa de una sola refacción ──────────────────────────────────────
// Es la que se abre desde la pieza para decidir a quién comprarle *ésta*: los
// mismos números de la comparativa global, pero de una fila. Devuelve también
// la pieza porque la refacción puede no tener ni un precio, y el documento
// igual tiene que decir de cuál se está hablando.

export interface ComparativaPieza {
  pieza: {
    id:           number
    numero_serie: string
    descripcion:  string
    tipo_pieza:   string | null
  }
  /** Null cuando nadie la cotiza y nunca se ha comprado. */
  fila: FilaComparativa | null
  /** El supuesto con el que se estimó el neto de las cotizaciones. */
  descuento_referencia: number
}

export async function getComparativaPieza(
  piezaId: number, descuentoRef = DESCUENTO_REFERENCIA,
): Promise<ComparativaPieza> {
  const pieza = await refaccionesRepo.findById(piezaId)
  if (!pieza) throw new NotFoundError('Refacción')
  const comparativa = await getComparativa(piezaId, descuentoRef)
  return {
    pieza: {
      id:           pieza.id,
      numero_serie: pieza.numero_serie,
      descripcion:  pieza.descripcion,
      tipo_pieza:   pieza.tipo_pieza ?? null,
    },
    fila: comparativa.piezas[0] ?? null,
    descuento_referencia: comparativa.descuento_referencia,
  }
}
