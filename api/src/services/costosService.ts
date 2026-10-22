// Análisis de costos de la flota: qué se está gastando, en qué unidad, y dónde
// hay dinero sobre la mesa.
//
// La idea de fondo: el tablero ya decía *cuánto* se gastó, pero no *si estuvo
// bien gastado*. Un gasto solo se juzga contra algo — los kilómetros que rindió,
// lo que rinde el mismo modelo, lo que cobra el otro proveedor, lo que cuesta el
// litro en la otra gasolinera. Todo lo de aquí es alguna forma de esa
// comparación, y cada número que sale lleva su equivalente en pesos: un
// rendimiento 20 % abajo del modelo no dice nada hasta que se traduce a lo que
// esa unidad quema de más al mes.
import * as repo from '../repositories/costosRepo'
import { fechaMexico } from '../shared/fechaMexico'

// ─── Umbrales ────────────────────────────────────────────────────────────────
// Están juntos y con nombre a propósito: son los que se van a querer mover
// cuando alguien diga "esto marca de más" o "esto no lo está viendo".

/** Salto de odómetro entre dos cargas que ya no es creíble: es captura errónea. */
const KM_ENTRE_CARGAS_MAX = 5_000
/** Tramos mínimos para que el rendimiento de una unidad sea comparable. */
const TRAMOS_MIN_RENDIMIENTO = 3
/**
 * Tramos mínimos para juzgar lo que rinde una gasolinera. Más que por unidad:
 * aquí se juntan unidades distintas y un tanque mal llenado pesa mucho en pocos.
 */
const TRAMOS_MIN_GASOLINERA = 5
/** Qué tan abajo del promedio de su modelo tiene que estar para marcarse. */
const RENDIMIENTO_BAJO_PCT = -15
/**
 * Qué tan lejos de la mediana de su combustible tiene que estar el litro de
 * una carga para marcarse, hacia arriba o hacia abajo. Hacia abajo casi siempre
 * es un dígito mal capturado en el costo o en los litros, y esa carga ya no
 * entra al precio de su gasolinera: una sola la volvía "la más barata".
 */
const PRECIO_LITRO_ATIPICO_PCT = 15
/** Cargas mínimas de un combustible en un mes para que su mediana sirva de vara. */
const CARGAS_MIN_MEDIANA = 3
/** Ventana en la que repetir el mismo servicio es retrabajo, no mantenimiento. */
const DIAS_RETRABAJO = 30
/** Tope de renglones de anomalías que se devuelven (van ordenadas por impacto). */
const MAX_ANOMALIAS = 100
/** Meses de historia en la gráfica de gasto mensual. */
const MESES_GASTO = 12

/**
 * El producto de las recargas que no lo traen: las de gasolina anteriores a la
 * migración 063 y las de gas. Juntas no son un combustible —puede haber Magna y
 * Premium revueltos—, así que no se les juzga el precio: solo se reportan.
 */
const SIN_PRODUCTO = 'Sin especificar'

/** Cómo se llama el grupo de las unidades sin sucursal. Ver `SucursalCosto`. */
const SIN_BASE = 'Sin base fija'

/** Diesel, Magna, Premium y al final lo que no se sabe. */
function ordenProducto(p: string): string {
  return p === SIN_PRODUCTO ? '~' : p
}

function addDias(fechaYMD: string, dias: number): string {
  const d = new Date(`${fechaYMD}T12:00:00`)
  d.setDate(d.getDate() + dias)
  return fechaMexico(d)
}

function diasEntre(a: string, b: string): number {
  return Math.round(
    (new Date(`${b}T12:00:00`).getTime() - new Date(`${a}T12:00:00`).getTime()) / 86_400_000
  )
}

// Divide cuidando el caso que arruina todos estos tableros: denominador cero o
// ausente. Devuelve null en vez de Infinity o NaN para que el front pinte un
// guion, no un número inventado.
function ratio(numerador: number, denominador: number): number | null {
  if (!denominador || denominador <= 0) return null
  return numerador / denominador
}

function mediana(valores: number[]): number | null {
  if (valores.length === 0) return null
  const o = [...valores].sort((a, b) => a - b)
  const m = Math.floor(o.length / 2)
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2
}

/**
 * El precio contra el que se juzga cada carga: la mediana de su combustible en
 * su mes. Mediana y no promedio porque el promedio lo arrastra justo la carga
 * mal capturada que se quiere detectar. Por mes porque el precio se mueve a lo
 * largo de un año; si ese mes hubo muy pocas cargas, la del combustible en
 * todo el conjunto. Sin producto no hay vara: Magna y Premium revueltas.
 */
function referenciasDePrecio(recargas: repo.RecargaCosto[]): (r: repo.RecargaCosto) => number | null {
  const porMes = new Map<string, number[]>()
  const porProducto = new Map<string, number[]>()
  for (const r of recargas) {
    if (r.producto == null || !(r.litros > 0)) continue
    const precio = r.costo / r.litros
    const kMes = `${r.fecha.slice(0, 7)}|${r.producto}`
    porMes.set(kMes, [...(porMes.get(kMes) ?? []), precio])
    porProducto.set(r.producto, [...(porProducto.get(r.producto) ?? []), precio])
  }
  const cache = new Map<string, number | null>()
  return (r) => {
    if (r.producto == null) return null
    const kMes = `${r.fecha.slice(0, 7)}|${r.producto}`
    if (!cache.has(kMes)) {
      const delMes = porMes.get(kMes) ?? []
      const delProducto = porProducto.get(r.producto) ?? []
      cache.set(kMes,
        delMes.length >= CARGAS_MIN_MEDIANA ? mediana(delMes)
        : delProducto.length >= CARGAS_MIN_MEDIANA ? mediana(delProducto)
        : null)
    }
    return cache.get(kMes)!
  }
}

/** Qué tanto se aleja el litro de la carga de su referencia, en %. null si no se puede juzgar. */
function desviacionPrecio(r: repo.RecargaCosto, referencia: number | null): number | null {
  const precio = ratio(r.costo, r.litros)
  if (precio == null || referencia == null || referencia <= 0) return null
  return ((precio - referencia) / referencia) * 100
}

function esAtipica(desviacion: number | null): boolean {
  return desviacion != null && Math.abs(desviacion) >= PRECIO_LITRO_ATIPICO_PCT
}

function redondear(n: number | null, decimales = 2): number | null {
  if (n == null || !Number.isFinite(n)) return null
  const f = 10 ** decimales
  return Math.round(n * f) / f
}

// ─── Tipos de salida ────────────────────────────────────────────────────────

export interface VehiculoCosto {
  vehiculo_id:    number
  vehiculo:       string
  tipo:           string
  modelo_id:      number
  modelo:         string
  /** Null: sin base fija. Ver `SucursalCosto`. */
  sucursal_id:    number | null
  sucursal:       string | null
  /** Recorrido del periodo según los odómetros capturados. null si no alcanzan. */
  km_recorridos:  number | null
  combustible:    number
  mano_obra:      number
  /** Refacciones consumidas por sus mantenimientos (no las compradas al almacén). */
  refacciones:    number
  /** Lo que PASE cobró por sus cruces. Llega con la factura, cada diez días. */
  casetas:        number
  total:          number
  costo_por_km:   number | null
  litros:         number
  rendimiento:    number | null
  /** Promedio km/l de las demás unidades del mismo modelo, para comparar contra algo justo. */
  rendimiento_modelo:  number | null
  /** Qué tanto se aleja del modelo, en porcentaje. Negativo = gasta de más. */
  desviacion_pct:      number | null
  /** Pesos al año que explica esa desviación. Solo si se puede estimar. */
  sobrecosto_anual:    number | null
  mantenimientos: number
  recargas:       number
}

/**
 * Una gasolinera y un combustible. El litro de Premium no se compara contra el
 * de Diesel: cada combustible tiene su propio renglón y su propia "más barata".
 */
export interface GasolineraCosto {
  gasolinera_id: number
  gasolinera:    string
  /** Diesel, Magna, Premium o SIN_PRODUCTO. */
  producto:      string
  recargas:      number
  litros:        number
  costo:         number
  /** Sin las cargas atípicas: con ellas, un dígito mal capturado decidía el renglón. */
  precio_litro:  number | null
  /** Cuánto se pagó de más aquí contra la más barata del periodo, en el mismo combustible. */
  sobreprecio:   number
  /** Cargas con el litro muy lejos de la mediana: cuentan en litros y gasto, no en el precio. */
  atipicas:      number
  /**
   * Tramos con los que se midió cuánto rinde: los que cerró una carga de aquí.
   * El tramo se le cobra a la carga que lo cierra porque esos litros son los
   * que la bomba dice que cupieron: si despacha menos de lo que marca, aquí es
   * donde sale. (La calidad del combustible saldría en el tramo siguiente,
   * que ya cierra otra carga.)
   */
  tramos:        number
  /** km/L de esos tramos. Mezcla los modelos que cargan aquí: ver `eficiencia_pct`. */
  rendimiento:   number | null
  /**
   * Qué tanto rinden aquí las unidades contra el promedio de su propio modelo,
   * en %. Es lo comparable entre gasolineras: a una le cargan los camiones y a
   * otra las camionetas. Negativo = cada litro de aquí recorre menos.
   * Null con menos de TRAMOS_MIN_GASOLINERA tramos.
   */
  eficiencia_pct:  number | null
  /**
   * El litro corregido por lo que rinde: `precio_litro / (1 + eficiencia)`.
   * Un litro más barato que recorre 10 % menos sale más caro. Es el número con
   * el que se decide a dónde mandar a cargar.
   */
  precio_efectivo: number | null
}

/** El litro de una gasolinera y un combustible en un mes, para ver cómo se mueve. */
export interface PrecioMensual {
  mes:           string   // 'YYYY-MM'
  gasolinera_id: number
  gasolinera:    string
  producto:      string
  recargas:      number
  precio_litro:  number | null
}

export interface PrecioProducto {
  producto:     string
  litros:       number
  costo:        number
  precio_litro: number | null
  /** El litro de la gasolinera más barata del periodo: contra él se mide el sobreprecio. */
  precio_minimo: number | null
}

/**
 * Una sucursal y lo que gastaron y recorrieron sus unidades. La unidad cuenta
 * en la sucursal donde tiene BASE, no en la que entregó el vale: los km, el
 * rendimiento y el taller son de la unidad, y repartirla entre patios por cada
 * vale partiría su recorrido en pedazos que no miden nada.
 *
 * `sucursal_id` null es "Sin base fija": tractocamiones, unidades de sucursal
 * múltiple y utilitarios sin sucursal asignada. Va aparte y al final; no es una
 * sucursal más contra la que comparar.
 */
export interface SucursalCosto {
  sucursal_id:     number | null
  sucursal:        string
  /** Unidades en seguimiento con base aquí, se hayan movido o no. */
  unidades_flota:  number
  /** Las que tuvieron gasto o cargas en el periodo. */
  unidades:        number
  km_recorridos:   number
  /** Cuántas de `unidades` tienen lecturas para medir su recorrido. */
  unidades_con_km: number
  combustible:     number
  litros:          number
  recargas:        number
  mano_obra:       number
  refacciones:     number
  casetas:         number
  total:           number
  /**
   * Solo con las unidades que tienen kilometraje: sumar el gasto de una que no
   * lo tiene sobre los km de las demás inflaría el costo de la sucursal.
   */
  costo_por_km:       number | null
  combustible_por_km: number | null
  precio_litro:       number | null
  gasto_por_unidad:   number | null
  /** km/L de sus unidades medibles. Mezcla modelos: ver `eficiencia_pct`. */
  rendimiento:        number | null
  /**
   * Qué tanto rinden sus unidades contra el promedio de su propio modelo, en %.
   * Es la comparación justa entre sucursales: una con camionetas siempre tiene
   * mejor km/L que una con camiones, y eso no dice nada de cómo se manejan.
   * Negativo = gastan de más.
   */
  eficiencia_pct:     number | null
  /** La suma del sobrecosto anual por rendimiento de sus unidades. */
  sobrecosto_anual:   number
  anomalias:          number
  sin_vale:           number
  sin_odometro:       number
}

export type TipoAnomalia =
  | 'rendimiento_bajo'
  | 'odometro_retrocede'
  | 'precio_alto'
  | 'precio_bajo'
  | 'carga_duplicada'
  | 'sin_vale'
  | 'sin_odometro'

export interface Anomalia {
  key:         string
  tipo:        TipoAnomalia
  severidad:   'alta' | 'media'
  vehiculo_id: number
  vehiculo:    string
  fecha:       string
  detalle:     string
  /** Pesos que cuesta —o que no se pueden auditar por— esta anomalía. */
  monto:       number | null
}

export interface Retrabajo {
  vehiculo_id:  number
  vehiculo:     string
  tipo:         string
  fecha_previa: string
  fecha:        string
  dias:         number
  /** Lo que costó la segunda intervención: es la que se pagó dos veces. */
  costo:        number
}

export interface OportunidadAhorro {
  pieza_id:        number
  numero_serie:    string
  descripcion:     string
  proveedor:       string
  mejor_proveedor: string
  /** Lo que se pagó (promedio ponderado si hubo varias compras). */
  pagado:          number
  mejor_precio:    number
  cantidad:        number
  ahorro:          number
}

export interface AnalisisCostos {
  rango: { start: string; end: string; dias: number }
  totales: {
    combustible:            number
    mano_obra:              number
    /** Todos los cruces que PASE cobró, también los de tags sin unidad. */
    casetas:                number
    /**
     * El último día con cruces facturados. PASE factura cada diez días, así que
     * lo que va después de esta fecha todavía no tiene casetas. Null sin facturas.
     */
    casetas_hasta:          string | null
    /** Salió de caja: lo que se compró al almacén en el periodo. */
    refacciones_compradas:  number
    /** Se le puede achacar a una unidad: lo que consumieron los mantenimientos. */
    refacciones_usadas:     number
    /** Lo que realmente salió de caja. */
    total_caja:             number
    /** Lo atribuible a la operación de la flota, comparable con la suma por unidad. */
    total_operacion:        number
    km_recorridos:          number
    costo_por_km:           number | null
    litros:                 number
    rendimiento:            number | null
    /** Todos los combustibles revueltos: sirve de total, no para comparar. */
    precio_litro:           number | null
    ahorro_refacciones:     number
    ahorro_combustible:     number
    /** La suma de los dos anteriores: el titular de la pestaña. */
    ahorro_total:           number
    vehiculos_analizados:   number
  }
  /** El precio por litro de cada combustible, que es el que sí se compara. */
  precios_litro:      PrecioProducto[]
  vehiculos:          VehiculoCosto[]
  /** De la que más gasta a la que menos; "Sin base fija" al final. */
  sucursales:         SucursalCosto[]
  gasolineras:        GasolineraCosto[]
  /** Últimos 12 meses sin importar el periodo elegido, igual que el gasto mensual. */
  precios_mensuales:  PrecioMensual[]
  gasto_mensual:      repo.GastoMes[]
  ahorro_refacciones: OportunidadAhorro[]
  anomalias:          Anomalia[]
  anomalias_resumen:  { tipo: TipoAnomalia; cantidad: number; monto: number }[]
  retrabajos:         Retrabajo[]
}

// ─── Cálculo ────────────────────────────────────────────────────────────────

interface Acumulado {
  v: repo.VehiculoFlota
  combustible: number
  litros:      number
  mano_obra:   number
  refacciones: number
  mantenimientos: number
  recargas:    number
  casetas:     number
  /** Lecturas de odómetro del periodo, vengan de una carga o de un servicio. */
  lecturas:    number[]
  /** Tramos completos entre dos cargas, que es lo único con lo que se mide km/l. */
  tramoKm:     number
  tramoLitros: number
  tramos:      number
}

/**
 * `rango` es semiabierto [start, end). Puede ser la ventana móvil que arma el
 * endpoint a partir de `?dias=`, o el año / las fechas que alguien eligió para
 * un reporte. Todo lo de adentro se calcula sobre él —incluido el sobrecosto
 * anualizado, que se extrapola con los días que realmente abarca— salvo la
 * gráfica de tendencia, que siempre cierra en el día de hoy porque es el
 * contexto contra el que se leen los números, no parte del corte.
 */
export async function getAnalisisCostos(rango: { start: string; end: string }): Promise<AnalisisCostos> {
  const hoy   = fechaMexico()
  const start = rango.start
  const end   = rango.end
  const dias  = Math.max(1, diasEntre(start, end))
  const desdeGasto = addDias(hoy, -30 * MESES_GASTO)

  // Desde el día 1 para que el primer mes de la tendencia no salga a medias.
  const desdePrecios = `${desdeGasto.slice(0, 7)}-01`

  const [
    recargas, mantenimientos, compras, gastoMensual, flota, recargasAnio, casetas, casetasHasta,
  ] = await Promise.all([
    repo.findRecargasEnRango(start, end),
    repo.findMantenimientosEnRango(start, end),
    repo.findComprasComparadas(start, end),
    repo.findGastoMensual(desdeGasto),
    repo.findFlotaEnOperacion(),
    repo.findRecargasEnRango(desdePrecios, addDias(hoy, 1)),
    repo.findCasetasEnRango(start, end),
    repo.findUltimoCruceFacturado(),
  ])

  const acum = new Map<number, Acumulado>()
  for (const v of flota) {
    acum.set(v.vehiculo_id, {
      v, combustible: 0, litros: 0, mano_obra: 0, refacciones: 0,
      mantenimientos: 0, recargas: 0, casetas: 0, lecturas: [], tramoKm: 0, tramoLitros: 0, tramos: 0,
    })
  }

  // ── Casetas ──
  // Las de un tag sin unidad entran a la caja pero no a ninguna unidad, y por
  // eso tampoco a `total_operacion`, que tiene que cuadrar con la suma por unidad.
  let casetasCaja = 0
  let casetasAsignadas = 0
  for (const c of casetas) {
    casetasCaja += c.total
    const a = c.vehiculo_id != null ? acum.get(c.vehiculo_id) : undefined
    if (a) {
      a.casetas += c.total
      casetasAsignadas += c.total
    }
  }

  const anomalias: Anomalia[] = []

  // ── Combustible: recorrido de cargas, unidad por unidad ──
  // Vienen ordenadas por (vehículo, fecha, id) desde el repo, así que basta
  // comparar cada carga con la inmediata anterior del mismo vehículo.
  const litrosTotales = recargas.reduce((s, r) => s + r.litros, 0)
  const costoCombustible = recargas.reduce((s, r) => s + r.costo, 0)
  const precioLitroFlota = ratio(costoCombustible, litrosTotales)

  // El litro de cada combustible por separado: con todos revueltos, la Premium
  // salía "cara" solo por ser Premium.
  const porProducto = new Map<string, { litros: number; costo: number }>()
  for (const r of recargas) {
    const p = r.producto ?? SIN_PRODUCTO
    const e = porProducto.get(p) ?? { litros: 0, costo: 0 }
    e.litros += r.litros
    e.costo  += r.costo
    porProducto.set(p, e)
  }
  const referenciaDe = referenciasDePrecio(recargas)

  // Los tramos que cerró cada gasolinera, para medir cuánto rinde. Ver
  // `GasolineraCosto.eficiencia_pct`.
  const tramosGasolinera: { modelo_id: number; clave: string; km: number; litros: number }[] = []

  let previa: repo.RecargaCosto | null = null
  // Litros de emergencia cargados desde la última carga normal de la unidad.
  let emergencia = { vehiculo_id: 0, litros: 0 }
  for (const r of recargas) {
    const a = acum.get(r.vehiculo_id)
    if (a) {
      a.combustible += r.costo
      a.litros      += r.litros
      a.recargas    += 1
      if (r.kilometraje != null) a.lecturas.push(r.kilometraje)
    }

    // La de emergencia va sin odómetro ni vale a propósito (migración 056), así
    // que no es anomalía. Esos litros se quemaron en el tramo que cierra la
    // siguiente carga con kilometraje: se le suman a ese tramo, o su
    // rendimiento saldría inflado porque el tanque llegó con esos litros de más.
    // Tampoco pasa a ser la `previa`: el tramo se mide desde la última lectura.
    if (r.emergencia) {
      if (emergencia.vehiculo_id !== r.vehiculo_id) emergencia = { vehiculo_id: r.vehiculo_id, litros: 0 }
      emergencia.litros += r.litros
      continue
    }
    const litrosEmergencia = emergencia.vehiculo_id === r.vehiculo_id ? emergencia.litros : 0
    emergencia = { vehiculo_id: 0, litros: 0 }

    const mismaUnidad = previa != null && previa.vehiculo_id === r.vehiculo_id

    // Sin odómetro no hay forma de saber qué rindió esa carga: ni entra al
    // rendimiento ni se puede auditar. Se marca para que se capture.
    if (r.kilometraje == null) {
      anomalias.push({
        key: `sin_odometro-${r.id}`, tipo: 'sin_odometro', severidad: 'media',
        vehiculo_id: r.vehiculo_id, vehiculo: r.vehiculo_nombre, fecha: r.fecha,
        detalle: `Carga de ${r.litros.toFixed(1)} L sin kilometraje capturado — no se puede medir qué rindió`,
        monto: r.costo,
      })
    } else if (mismaUnidad && previa!.kilometraje != null) {
      const deltaKm = r.kilometraje - previa!.kilometraje
      if (deltaKm < 0) {
        anomalias.push({
          key: `odometro-${r.id}`, tipo: 'odometro_retrocede', severidad: 'alta',
          vehiculo_id: r.vehiculo_id, vehiculo: r.vehiculo_nombre, fecha: r.fecha,
          detalle: `El odómetro bajó de ${previa!.kilometraje!.toLocaleString('es-MX')} a ${r.kilometraje.toLocaleString('es-MX')} km`,
          monto: r.costo,
        })
      } else if (deltaKm > 0 && deltaKm <= KM_ENTRE_CARGAS_MAX && r.litros > 0 && a) {
        // Tramo válido: los kilómetros desde la carga anterior los pagó esta.
        a.tramoKm     += deltaKm
        a.tramoLitros += r.litros + litrosEmergencia
        a.tramos      += 1
        // Para la gasolinera, solo los tramos que cerró una carga suya completa:
        // con litros de emergencia de por medio, parte del tramo se cargó en
        // otro lado. La atípica tampoco: sus litros casi seguro están mal.
        if (litrosEmergencia === 0 && r.gasolinera_id != null
          && !esAtipica(desviacionPrecio(r, referenciaDe(r)))) {
          tramosGasolinera.push({
            modelo_id: a.v.modelo_id, clave: `${r.gasolinera_id}|${r.producto ?? SIN_PRODUCTO}`,
            km: deltaKm, litros: r.litros,
          })
        }
      }
    }

    // Dos cargas el mismo día a la misma unidad. Puede ser legítimo (un viaje
    // largo), pero es el patrón clásico de la carga que se fue a otro tanque.
    if (mismaUnidad && previa!.fecha === r.fecha) {
      anomalias.push({
        key: `duplicada-${r.id}`, tipo: 'carga_duplicada', severidad: 'media',
        vehiculo_id: r.vehiculo_id, vehiculo: r.vehiculo_nombre, fecha: r.fecha,
        detalle: `Dos cargas el mismo día (${previa!.litros.toFixed(1)} L y ${r.litros.toFixed(1)} L)`,
        monto: r.costo,
      })
    }

    // Sin vale, la carga no tiene respaldo documental contra quién la autorizó.
    if (r.vale_id == null) {
      anomalias.push({
        key: `sin_vale-${r.id}`, tipo: 'sin_vale', severidad: 'media',
        vehiculo_id: r.vehiculo_id, vehiculo: r.vehiculo_nombre, fecha: r.fecha,
        detalle: `Carga de ${r.litros.toFixed(1)} L en ${r.gasolinera} sin vale (${r.conductor})`,
        monto: r.costo,
      })
    }

    // El litro contra la mediana de su combustible en su mes. Sin producto no
    // se sabe contra qué compararla y no se juzga.
    const precio = ratio(r.costo, r.litros)
    const referencia = referenciaDe(r)
    const desviacion = desviacionPrecio(r, referencia)
    if (precio != null && referencia != null && desviacion != null) {
      if (desviacion >= PRECIO_LITRO_ATIPICO_PCT) {
        anomalias.push({
          key: `precio-${r.id}`, tipo: 'precio_alto', severidad: 'media',
          vehiculo_id: r.vehiculo_id, vehiculo: r.vehiculo_nombre, fecha: r.fecha,
          detalle: `${r.producto} a $${precio.toFixed(2)}/L en ${r.gasolinera}, ${desviacion.toFixed(0)}% arriba de lo que costó el ${r.producto} ese mes`,
          monto: (precio - referencia) * r.litros,
        })
      } else if (desviacion <= -PRECIO_LITRO_ATIPICO_PCT) {
        // Nadie vende el litro un 15 % abajo: es el costo o los litros mal
        // capturados. El monto es lo que faltaría si los litros están bien.
        anomalias.push({
          key: `precio_bajo-${r.id}`, tipo: 'precio_bajo', severidad: 'media',
          vehiculo_id: r.vehiculo_id, vehiculo: r.vehiculo_nombre, fecha: r.fecha,
          detalle: `${r.producto} a $${precio.toFixed(2)}/L en ${r.gasolinera} (${r.litros.toFixed(2)} L por $${r.costo.toFixed(2)}), ${Math.abs(desviacion).toFixed(0)}% abajo de lo que costó el ${r.producto} ese mes. Revisa el costo y los litros contra el ticket`,
          monto: (referencia - precio) * r.litros,
        })
      }
    }

    previa = r
  }

  // ── Mantenimientos ──
  let manoObra = 0
  let piezasUsadas = 0
  const retrabajos: Retrabajo[] = []
  // Último servicio del mismo tipo por unidad, para detectar la repetición.
  const ultimoServicio = new Map<string, repo.MantenimientoCosto>()

  for (const m of mantenimientos) {
    manoObra     += m.costo
    piezasUsadas += m.piezas_total
    const a = acum.get(m.vehiculo_id)
    if (a) {
      a.mano_obra      += m.costo
      a.refacciones    += m.piezas_total
      a.mantenimientos += 1
      if (m.km_actual != null && m.km_actual > 0) a.lecturas.push(m.km_actual)
    }

    // Volver a hacer el mismo servicio a la misma unidad en menos de un mes
    // casi siempre significa que la primera vez no quedó: se pagó dos veces.
    if (m.tipo) {
      const clave = `${m.vehiculo_id}|${m.tipo.trim().toLowerCase()}`
      const prev = ultimoServicio.get(clave)
      if (prev) {
        const d = diasEntre(prev.fecha, m.fecha)
        if (d >= 0 && d <= DIAS_RETRABAJO) {
          retrabajos.push({
            vehiculo_id: m.vehiculo_id, vehiculo: m.vehiculo_nombre, tipo: m.tipo,
            fecha_previa: prev.fecha, fecha: m.fecha, dias: d,
            costo: m.costo + m.piezas_total,
          })
        }
      }
      ultimoServicio.set(clave, m)
    }
  }

  // ── Rendimiento por modelo ──
  // El promedio del modelo es la vara de medir: comparar un tractocamión contra
  // una camioneta no dice nada, contra otro tractocamión igual sí.
  const porModelo = new Map<number, { km: number; litros: number }>()
  for (const a of acum.values()) {
    if (a.tramos < TRAMOS_MIN_RENDIMIENTO) continue
    const e = porModelo.get(a.v.modelo_id) ?? { km: 0, litros: 0 }
    e.km     += a.tramoKm
    e.litros += a.tramoLitros
    porModelo.set(a.v.modelo_id, e)
  }

  // Por sucursal: se llena en el mismo recorrido que las unidades. Los campos
  // con guion bajo son de las unidades medibles; `_ideales`, los litros que
  // habrían gastado al rendimiento de su modelo.
  type SucursalAcum = SucursalCosto & {
    _totalConKm: number; _combConKm: number
    _tramoKm: number; _tramoLitros: number
    _efLitros: number; _ideales: number
  }
  const porSucursal = new Map<string, SucursalAcum>()
  const claveSucursal = (v: repo.VehiculoFlota) => String(v.sucursal_id ?? 'sin')
  for (const a of acum.values()) {
    const k = claveSucursal(a.v)
    const s = porSucursal.get(k) ?? {
      sucursal_id: a.v.sucursal_id, sucursal: a.v.sucursal ?? SIN_BASE,
      unidades_flota: 0, unidades: 0, km_recorridos: 0, unidades_con_km: 0,
      combustible: 0, litros: 0, recargas: 0, mano_obra: 0, refacciones: 0, casetas: 0, total: 0,
      costo_por_km: null, combustible_por_km: null, precio_litro: null, gasto_por_unidad: null,
      rendimiento: null, eficiencia_pct: null, sobrecosto_anual: 0,
      anomalias: 0, sin_vale: 0, sin_odometro: 0,
      _totalConKm: 0, _combConKm: 0, _tramoKm: 0, _tramoLitros: 0, _efLitros: 0, _ideales: 0,
    }
    s.unidades_flota += 1
    porSucursal.set(k, s)
  }

  const vehiculos: VehiculoCosto[] = []
  for (const a of acum.values()) {
    const total = a.combustible + a.mano_obra + a.refacciones + a.casetas
    // Sin gasto y sin cargas la unidad no aporta nada al análisis; sacarla evita
    // una tabla llena de ceros donde no se ve lo que importa.
    if (total === 0 && a.recargas === 0) continue

    const kmRecorridos = a.lecturas.length >= 2
      ? Math.max(...a.lecturas) - Math.min(...a.lecturas)
      : null

    const rendimiento = a.tramos >= TRAMOS_MIN_RENDIMIENTO
      ? ratio(a.tramoKm, a.tramoLitros)
      : null

    const mod = porModelo.get(a.v.modelo_id)
    const rendModelo = mod ? ratio(mod.km, mod.litros) : null

    let desviacion: number | null = null
    let sobrecostoAnual: number | null = null
    if (rendimiento != null && rendModelo != null && rendModelo > 0) {
      desviacion = ((rendimiento - rendModelo) / rendModelo) * 100
      // Los litros de más se pagan a lo que esa unidad paga el litro, no al
      // promedio de la flota: un Diesel no cuesta lo que una Magna.
      const precioUnidad = ratio(a.combustible, a.litros)
      if (desviacion < 0 && precioUnidad != null && a.tramoKm > 0) {
        // Litros que habría gastado al rendimiento del modelo, contra los que
        // gastó de verdad, extrapolados al año con el ritmo del periodo.
        const litrosIdeales = a.tramoKm / rendModelo
        const extraPeriodo  = (a.tramoLitros - litrosIdeales) * precioUnidad
        sobrecostoAnual = extraPeriodo * (365 / dias)
      }
    }

    // Una unidad que gasta bastante menos que sus gemelas casi siempre trae algo
    // mecánico —o una fuga—, y son pesos que se van sin factura de por medio.
    if (desviacion != null && desviacion <= RENDIMIENTO_BAJO_PCT && rendimiento != null) {
      anomalias.push({
        key: `rendimiento-${a.v.vehiculo_id}`, tipo: 'rendimiento_bajo', severidad: 'alta',
        vehiculo_id: a.v.vehiculo_id, vehiculo: a.v.vehiculo, fecha: hoy,
        detalle: `${rendimiento.toFixed(2)} km/L contra ${rendModelo!.toFixed(2)} del ${a.v.modelo} (${desviacion.toFixed(0)}%)`,
        monto: redondear(sobrecostoAnual),
      })
    }

    const s = porSucursal.get(claveSucursal(a.v))!
    s.unidades    += 1
    s.combustible += a.combustible
    s.litros      += a.litros
    s.recargas    += a.recargas
    s.mano_obra   += a.mano_obra
    s.refacciones += a.refacciones
    s.casetas     += a.casetas
    s.total       += total
    if (kmRecorridos != null && kmRecorridos > 0) {
      s.km_recorridos   += kmRecorridos
      s.unidades_con_km += 1
      s._totalConKm     += total
      s._combConKm      += a.combustible
    }
    if (rendimiento != null) {
      s._tramoKm     += a.tramoKm
      s._tramoLitros += a.tramoLitros
      if (rendModelo != null && rendModelo > 0) {
        s._efLitros += a.tramoLitros
        s._ideales  += a.tramoKm / rendModelo
      }
    }
    if (sobrecostoAnual != null) s.sobrecosto_anual += sobrecostoAnual

    vehiculos.push({
      vehiculo_id: a.v.vehiculo_id,
      vehiculo:    a.v.vehiculo,
      tipo:        a.v.tipo,
      modelo_id:   a.v.modelo_id,
      modelo:      a.v.modelo,
      sucursal_id: a.v.sucursal_id,
      sucursal:    a.v.sucursal,
      km_recorridos: kmRecorridos,
      combustible: redondear(a.combustible, 2)!,
      mano_obra:   redondear(a.mano_obra, 2)!,
      refacciones: redondear(a.refacciones, 2)!,
      casetas:     redondear(a.casetas, 2)!,
      total:       redondear(total, 2)!,
      costo_por_km: redondear(kmRecorridos ? ratio(total, kmRecorridos) : null),
      litros:       redondear(a.litros, 3)!,
      rendimiento:  redondear(rendimiento),
      rendimiento_modelo: redondear(rendModelo),
      desviacion_pct:     redondear(desviacion, 1),
      sobrecosto_anual:   redondear(sobrecostoAnual, 0),
      mantenimientos: a.mantenimientos,
      recargas:       a.recargas,
    })
  }
  vehiculos.sort((x, y) => y.total - x.total)

  // ── Gasolineras ──
  // Un renglón por gasolinera y combustible: la que despacha Diesel y Premium
  // no es "cara" ni "barata" en general, lo es en cada uno.
  // El litro de cada renglón sale solo de las cargas que no son atípicas;
  // litros y gasto sí las cuentan todas, porque se pagaron igual.
  // `_tramoKm` y `_tramoLitros` son los de sus tramos; `_efLitros` e `_ideales`,
  // los de los tramos de unidades cuyo modelo tiene rendimiento de referencia.
  type GasolineraAcum = GasolineraCosto & {
    _litros: number; _costo: number
    _tramoKm: number; _tramoLitros: number; _efLitros: number; _ideales: number
  }
  const porGasolinera = new Map<string, GasolineraAcum>()
  for (const r of recargas) {
    // La de emergencia se cargó donde se pudo: no dice nada de a qué
    // gasolinera conviene mandar a la flota.
    if (r.gasolinera_id == null) continue
    const producto = r.producto ?? SIN_PRODUCTO
    const clave = `${r.gasolinera_id}|${producto}`
    const g = porGasolinera.get(clave) ?? {
      gasolinera_id: r.gasolinera_id, gasolinera: r.gasolinera ?? '', producto,
      recargas: 0, litros: 0, costo: 0, precio_litro: null, sobreprecio: 0, atipicas: 0,
      tramos: 0, rendimiento: null, eficiencia_pct: null, precio_efectivo: null,
      _litros: 0, _costo: 0, _tramoKm: 0, _tramoLitros: 0, _efLitros: 0, _ideales: 0,
    }
    g.recargas += 1
    g.litros   += r.litros
    g.costo    += r.costo
    if (esAtipica(desviacionPrecio(r, referenciaDe(r)))) {
      g.atipicas += 1
    } else {
      g._litros += r.litros
      g._costo  += r.costo
    }
    porGasolinera.set(clave, g)
  }
  // Lo que rinde: cada tramo contra el rendimiento del modelo de su unidad. El
  // km/L a secas revuelve modelos y premiaría a la gasolinera de las camionetas.
  for (const t of tramosGasolinera) {
    const g = porGasolinera.get(t.clave)
    if (!g) continue
    g.tramos       += 1
    g._tramoKm     += t.km
    g._tramoLitros += t.litros
    const mod = porModelo.get(t.modelo_id)
    const rendModelo = mod ? ratio(mod.km, mod.litros) : null
    if (rendModelo != null && rendModelo > 0) {
      g._efLitros += t.litros
      g._ideales  += t.km / rendModelo
    }
  }

  const gasolineras = [...porGasolinera.values()]
  for (const g of gasolineras) {
    g.precio_litro = redondear(ratio(g._costo, g._litros))
    if (g.tramos < TRAMOS_MIN_GASOLINERA) continue
    g.rendimiento = redondear(ratio(g._tramoKm, g._tramoLitros))
    if (g._efLitros > 0) {
      const eficiencia = g._ideales / g._efLitros - 1
      g.eficiencia_pct = redondear(eficiencia * 100, 1)
      if (g.precio_litro != null && 1 + eficiencia > 0) {
        g.precio_efectivo = redondear(g.precio_litro / (1 + eficiencia))
      }
    }
  }

  // El sobreprecio se mide contra la gasolinera más barata a la que ya se va,
  // en el mismo combustible: es un ahorro alcanzable —basta mandar ahí las
  // cargas—, no un precio ideal de mercado que nadie ofrece. Solo cuentan las
  // que tienen volumen suficiente para no premiar a una gasolinera con una sola
  // carga barata de casualidad. Lo que no tiene producto no se compara.
  const precioMinimo = new Map<string, number>()
  for (const g of gasolineras) {
    if (g.producto === SIN_PRODUCTO || g.recargas - g.atipicas < 3 || g.precio_litro == null) continue
    const min = precioMinimo.get(g.producto)
    if (min == null || g.precio_litro < min) precioMinimo.set(g.producto, g.precio_litro)
  }
  let ahorroCombustible = 0
  for (const g of gasolineras) {
    const min = precioMinimo.get(g.producto)
    if (min == null || g.precio_litro == null) continue
    g.sobreprecio = redondear(Math.max(0, (g.precio_litro - min) * g._litros), 2)!
    ahorroCombustible += g.sobreprecio
  }
  // Agrupadas por combustible y, dentro de cada uno, la más cara arriba.
  gasolineras.sort((a, b) =>
    ordenProducto(a.producto).localeCompare(ordenProducto(b.producto)) ||
    (b.precio_litro ?? 0) - (a.precio_litro ?? 0))
  const gasolinerasSalida: GasolineraCosto[] = gasolineras.map((
    { _litros, _costo, _tramoKm, _tramoLitros, _efLitros, _ideales, ...g },
  ) => ({
    ...g,
    litros: redondear(g.litros, 3)!,
    costo:  redondear(g.costo, 2)!,
  }))

  // ── El litro mes por mes ──
  // Con su propia vara: la mediana de cada mes sale de las cargas del año, no
  // solo de las del periodo elegido. Sin producto no entra: revuelve Magna y
  // Premium y su línea subiría y bajaría por la mezcla, no por el precio.
  const referenciaAnio = referenciasDePrecio(recargasAnio)
  const porMes = new Map<string, PrecioMensual & { _litros: number; _costo: number }>()
  for (const r of recargasAnio) {
    if (r.gasolinera_id == null || r.producto == null) continue
    if (esAtipica(desviacionPrecio(r, referenciaAnio(r)))) continue
    const mes = r.fecha.slice(0, 7)
    const clave = `${mes}|${r.gasolinera_id}|${r.producto}`
    const e = porMes.get(clave) ?? {
      mes, gasolinera_id: r.gasolinera_id, gasolinera: r.gasolinera ?? '', producto: r.producto,
      recargas: 0, precio_litro: null, _litros: 0, _costo: 0,
    }
    e.recargas += 1
    e._litros  += r.litros
    e._costo   += r.costo
    porMes.set(clave, e)
  }
  const preciosMensuales: PrecioMensual[] = [...porMes.values()]
    .map(({ _litros, _costo, ...e }) => ({ ...e, precio_litro: redondear(ratio(_costo, _litros)) }))
    .sort((a, b) => a.mes.localeCompare(b.mes) || a.gasolinera.localeCompare(b.gasolinera))

  // ── Refacciones: lo pagado contra el mejor precio cotizado ──
  // Se agrupa por refacción, no por compra: lo accionable es "esta pieza
  // cómprala allá", y ver el mismo renglón cinco veces solo estorba.
  const porPieza = new Map<number, OportunidadAhorro & { _costo: number }>()
  for (const c of compras) {
    if (c.mejor_precio == null || c.mejor_proveedor == null) continue
    if (c.costo_unitario <= c.mejor_precio) continue
    if (c.mejor_proveedor_id === c.proveedor_id) continue

    const e = porPieza.get(c.pieza_id) ?? {
      pieza_id: c.pieza_id, numero_serie: c.numero_serie, descripcion: c.descripcion,
      proveedor: c.proveedor, mejor_proveedor: c.mejor_proveedor,
      pagado: 0, mejor_precio: c.mejor_precio, cantidad: 0, ahorro: 0, _costo: 0,
    }
    e.cantidad += c.cantidad
    e._costo   += c.cantidad * c.costo_unitario
    e.ahorro   += (c.costo_unitario - c.mejor_precio) * c.cantidad
    porPieza.set(c.pieza_id, e)
  }
  const ahorroRefacciones: OportunidadAhorro[] = [...porPieza.values()]
    .map(({ _costo, ...e }) => ({
      ...e,
      pagado: redondear(ratio(_costo, e.cantidad) ?? 0, 2)!,
      ahorro: redondear(e.ahorro, 2)!,
    }))
    .sort((a, b) => b.ahorro - a.ahorro)
  const totalAhorroRefacciones = ahorroRefacciones.reduce((s, e) => s + e.ahorro, 0)

  // ── Anomalías: primero lo grave, y dentro de eso lo caro ──
  anomalias.sort((a, b) =>
    (a.severidad === b.severidad ? 0 : a.severidad === 'alta' ? -1 : 1) ||
    (b.monto ?? 0) - (a.monto ?? 0) ||
    b.fecha.localeCompare(a.fecha)
  )
  const resumenMap = new Map<TipoAnomalia, { tipo: TipoAnomalia; cantidad: number; monto: number }>()
  for (const an of anomalias) {
    const e = resumenMap.get(an.tipo) ?? { tipo: an.tipo, cantidad: 0, monto: 0 }
    e.cantidad += 1
    e.monto    += an.monto ?? 0
    resumenMap.set(an.tipo, e)
  }
  // Las anomalías de cada sucursal, por la base de la unidad. Antes de recortar
  // a MAX_ANOMALIAS: el conteo es de todas, no de las que caben en la tabla.
  for (const an of anomalias) {
    const a = acum.get(an.vehiculo_id)
    if (!a) continue
    const s = porSucursal.get(claveSucursal(a.v))!
    s.anomalias += 1
    if (an.tipo === 'sin_vale')     s.sin_vale += 1
    if (an.tipo === 'sin_odometro') s.sin_odometro += 1
  }
  const sucursales: SucursalCosto[] = [...porSucursal.values()]
    // Una sucursal sin unidades con movimiento solo pinta un renglón de ceros.
    .filter((s) => s.unidades > 0)
    .map(({ _totalConKm, _combConKm, _tramoKm, _tramoLitros, _efLitros, _ideales, ...s }) => ({
      ...s,
      combustible:        redondear(s.combustible, 2)!,
      litros:             redondear(s.litros, 3)!,
      mano_obra:          redondear(s.mano_obra, 2)!,
      refacciones:        redondear(s.refacciones, 2)!,
      casetas:            redondear(s.casetas, 2)!,
      total:              redondear(s.total, 2)!,
      costo_por_km:       redondear(ratio(_totalConKm, s.km_recorridos)),
      combustible_por_km: redondear(ratio(_combConKm, s.km_recorridos)),
      precio_litro:       redondear(ratio(s.combustible, s.litros)),
      gasto_por_unidad:   redondear(ratio(s.total, s.unidades), 2),
      rendimiento:        redondear(ratio(_tramoKm, _tramoLitros)),
      // Litros que habrían gastado al rendimiento de su modelo entre los que
      // gastaron: arriba de 1, rinden más que sus gemelas.
      eficiencia_pct:     _efLitros > 0 ? redondear((_ideales / _efLitros - 1) * 100, 1) : null,
      sobrecosto_anual:   redondear(s.sobrecosto_anual, 0)!,
    }))
    .sort((a, b) =>
      (a.sucursal_id == null ? 1 : 0) - (b.sucursal_id == null ? 1 : 0) || b.total - a.total)

  const anomaliasResumen = [...resumenMap.values()]
    .map((e) => ({ ...e, monto: redondear(e.monto, 2)! }))
    .sort((a, b) => b.monto - a.monto)

  // ── Totales de flota ──
  const kmFlota = vehiculos.reduce((s, v) => s + (v.km_recorridos ?? 0), 0)
  const refaccionesCompradas = compras.reduce((s, c) => s + c.cantidad * c.costo_unitario, 0)
  const totalOperacion = costoCombustible + manoObra + piezasUsadas + casetasAsignadas
  const rendimientoFlota = ratio(
    [...acum.values()].reduce((s, a) => s + (a.tramos >= TRAMOS_MIN_RENDIMIENTO ? a.tramoKm : 0), 0),
    [...acum.values()].reduce((s, a) => s + (a.tramos >= TRAMOS_MIN_RENDIMIENTO ? a.tramoLitros : 0), 0),
  )

  retrabajos.sort((a, b) => b.costo - a.costo || b.fecha.localeCompare(a.fecha))

  const preciosLitro: PrecioProducto[] = [...porProducto.entries()]
    .map(([producto, e]) => ({
      producto,
      litros:       redondear(e.litros, 3)!,
      costo:        redondear(e.costo, 2)!,
      precio_litro: redondear(ratio(e.costo, e.litros)),
      precio_minimo: precioMinimo.get(producto) ?? null,
    }))
    .sort((a, b) => ordenProducto(a.producto).localeCompare(ordenProducto(b.producto)))

  return {
    rango: { start, end, dias },
    totales: {
      combustible:           redondear(costoCombustible, 2)!,
      mano_obra:             redondear(manoObra, 2)!,
      casetas:               redondear(casetasCaja, 2)!,
      casetas_hasta:         casetasHasta,
      refacciones_compradas: redondear(refaccionesCompradas, 2)!,
      refacciones_usadas:    redondear(piezasUsadas, 2)!,
      total_caja:            redondear(costoCombustible + manoObra + refaccionesCompradas + casetasCaja, 2)!,
      total_operacion:       redondear(totalOperacion, 2)!,
      km_recorridos:         kmFlota,
      costo_por_km:          redondear(ratio(totalOperacion, kmFlota)),
      litros:                redondear(litrosTotales, 3)!,
      rendimiento:           redondear(rendimientoFlota),
      precio_litro:          redondear(precioLitroFlota),
      ahorro_refacciones:    redondear(totalAhorroRefacciones, 2)!,
      ahorro_combustible:    redondear(ahorroCombustible, 2)!,
      ahorro_total:          redondear(totalAhorroRefacciones + ahorroCombustible, 2)!,
      vehiculos_analizados:  vehiculos.length,
    },
    precios_litro: preciosLitro,
    vehiculos,
    sucursales,
    gasolineras: gasolinerasSalida,
    precios_mensuales: preciosMensuales,
    gasto_mensual: gastoMensual,
    ahorro_refacciones: ahorroRefacciones,
    anomalias: anomalias.slice(0, MAX_ANOMALIAS),
    anomalias_resumen: anomaliasResumen,
    retrabajos,
  }
}
