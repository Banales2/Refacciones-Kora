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
/** Qué tan abajo del promedio de su modelo tiene que estar para marcarse. */
const RENDIMIENTO_BAJO_PCT = -15
/** Sobreprecio por litro contra el promedio del periodo que amerita revisión. */
const PRECIO_LITRO_ALTO_PCT = 15
/** Ventana en la que repetir el mismo servicio es retrabajo, no mantenimiento. */
const DIAS_RETRABAJO = 30
/** Tope de renglones de anomalías que se devuelven (van ordenadas por impacto). */
const MAX_ANOMALIAS = 100
/** Meses de historia en la gráfica de gasto mensual. */
const MESES_GASTO = 12

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
  /** Recorrido del periodo según los odómetros capturados. null si no alcanzan. */
  km_recorridos:  number | null
  combustible:    number
  mano_obra:      number
  /** Refacciones consumidas por sus mantenimientos (no las compradas al almacén). */
  refacciones:    number
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

export interface GasolineraCosto {
  gasolinera_id: number
  gasolinera:    string
  recargas:      number
  litros:        number
  costo:         number
  precio_litro:  number | null
  /** Cuánto se pagó de más aquí contra la gasolinera más barata del periodo. */
  sobreprecio:   number
}

export type TipoAnomalia =
  | 'rendimiento_bajo'
  | 'odometro_retrocede'
  | 'precio_alto'
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
    precio_litro:           number | null
    ahorro_refacciones:     number
    ahorro_combustible:     number
    /** La suma de los dos anteriores: el titular de la pestaña. */
    ahorro_total:           number
    vehiculos_analizados:   number
  }
  vehiculos:          VehiculoCosto[]
  gasolineras:        GasolineraCosto[]
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
  /** Lecturas de odómetro del periodo, vengan de una carga o de un servicio. */
  lecturas:    number[]
  /** Tramos completos entre dos cargas, que es lo único con lo que se mide km/l. */
  tramoKm:     number
  tramoLitros: number
  tramos:      number
}

export async function getAnalisisCostos(dias: number): Promise<AnalisisCostos> {
  const hoy   = fechaMexico()
  const start = addDias(hoy, -(dias - 1))
  const end   = addDias(hoy, 1)
  // La gráfica de tendencia siempre trae 12 meses, sin importar la ventana de
  // análisis: es el contexto contra el que se lee todo lo demás.
  const desdeGasto = addDias(hoy, -30 * MESES_GASTO)

  const [recargas, mantenimientos, compras, gastoMensual, flota] = await Promise.all([
    repo.findRecargasEnRango(start, end),
    repo.findMantenimientosEnRango(start, end),
    repo.findComprasComparadas(start, end),
    repo.findGastoMensual(desdeGasto),
    repo.findFlotaEnOperacion(),
  ])

  const acum = new Map<number, Acumulado>()
  for (const v of flota) {
    acum.set(v.vehiculo_id, {
      v, combustible: 0, litros: 0, mano_obra: 0, refacciones: 0,
      mantenimientos: 0, recargas: 0, lecturas: [], tramoKm: 0, tramoLitros: 0, tramos: 0,
    })
  }

  const anomalias: Anomalia[] = []

  // ── Combustible: recorrido de cargas, unidad por unidad ──
  // Vienen ordenadas por (vehículo, fecha, id) desde el repo, así que basta
  // comparar cada carga con la inmediata anterior del mismo vehículo.
  const litrosTotales = recargas.reduce((s, r) => s + r.litros, 0)
  const costoCombustible = recargas.reduce((s, r) => s + r.costo, 0)
  const precioLitroFlota = ratio(costoCombustible, litrosTotales)

  let previa: repo.RecargaCosto | null = null
  for (const r of recargas) {
    const a = acum.get(r.vehiculo_id)
    if (a) {
      a.combustible += r.costo
      a.litros      += r.litros
      a.recargas    += 1
      if (r.kilometraje != null) a.lecturas.push(r.kilometraje)
    }

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
        a.tramoLitros += r.litros
        a.tramos      += 1
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

    // Sobreprecio por litro contra el promedio del periodo.
    const precio = ratio(r.costo, r.litros)
    if (precio != null && precioLitroFlota != null) {
      const desviacion = ((precio - precioLitroFlota) / precioLitroFlota) * 100
      if (desviacion >= PRECIO_LITRO_ALTO_PCT) {
        anomalias.push({
          key: `precio-${r.id}`, tipo: 'precio_alto', severidad: 'media',
          vehiculo_id: r.vehiculo_id, vehiculo: r.vehiculo_nombre, fecha: r.fecha,
          detalle: `$${precio.toFixed(2)}/L en ${r.gasolinera}, ${desviacion.toFixed(0)}% arriba del promedio de la flota`,
          monto: (precio - precioLitroFlota) * r.litros,
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

  const vehiculos: VehiculoCosto[] = []
  for (const a of acum.values()) {
    const total = a.combustible + a.mano_obra + a.refacciones
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
      if (desviacion < 0 && precioLitroFlota != null && a.tramoKm > 0) {
        // Litros que habría gastado al rendimiento del modelo, contra los que
        // gastó de verdad, extrapolados al año con el ritmo del periodo.
        const litrosIdeales = a.tramoKm / rendModelo
        const extraPeriodo  = (a.tramoLitros - litrosIdeales) * precioLitroFlota
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

    vehiculos.push({
      vehiculo_id: a.v.vehiculo_id,
      vehiculo:    a.v.vehiculo,
      tipo:        a.v.tipo,
      modelo_id:   a.v.modelo_id,
      modelo:      a.v.modelo,
      km_recorridos: kmRecorridos,
      combustible: redondear(a.combustible, 2)!,
      mano_obra:   redondear(a.mano_obra, 2)!,
      refacciones: redondear(a.refacciones, 2)!,
      total:       redondear(total, 2)!,
      costo_por_km: redondear(kmRecorridos ? ratio(total, kmRecorridos) : null),
      litros:       redondear(a.litros, 2)!,
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
  const porGasolinera = new Map<number, GasolineraCosto>()
  for (const r of recargas) {
    const g = porGasolinera.get(r.gasolinera_id) ?? {
      gasolinera_id: r.gasolinera_id, gasolinera: r.gasolinera,
      recargas: 0, litros: 0, costo: 0, precio_litro: null, sobreprecio: 0,
    }
    g.recargas += 1
    g.litros   += r.litros
    g.costo    += r.costo
    porGasolinera.set(r.gasolinera_id, g)
  }
  const gasolineras = [...porGasolinera.values()]
  for (const g of gasolineras) g.precio_litro = redondear(ratio(g.costo, g.litros))

  // El sobreprecio se mide contra la gasolinera más barata a la que ya se va:
  // es un ahorro alcanzable —basta mandar ahí las cargas—, no un precio ideal
  // de mercado que nadie ofrece. Solo cuentan las que tienen volumen suficiente
  // para no premiar a una gasolinera con una sola carga barata de casualidad.
  const conVolumen = gasolineras.filter((g) => g.recargas >= 3 && g.precio_litro != null)
  const precioMinimo = conVolumen.length > 0
    ? Math.min(...conVolumen.map((g) => g.precio_litro!))
    : null
  let ahorroCombustible = 0
  if (precioMinimo != null) {
    for (const g of gasolineras) {
      if (g.precio_litro == null) continue
      g.sobreprecio = redondear(Math.max(0, (g.precio_litro - precioMinimo) * g.litros), 2)!
      ahorroCombustible += g.sobreprecio
    }
  }
  gasolineras.sort((a, b) => (b.precio_litro ?? 0) - (a.precio_litro ?? 0))
  for (const g of gasolineras) {
    g.litros = redondear(g.litros, 2)!
    g.costo  = redondear(g.costo, 2)!
  }

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
  const anomaliasResumen = [...resumenMap.values()]
    .map((e) => ({ ...e, monto: redondear(e.monto, 2)! }))
    .sort((a, b) => b.monto - a.monto)

  // ── Totales de flota ──
  const kmFlota = vehiculos.reduce((s, v) => s + (v.km_recorridos ?? 0), 0)
  const refaccionesCompradas = compras.reduce((s, c) => s + c.cantidad * c.costo_unitario, 0)
  const totalOperacion = costoCombustible + manoObra + piezasUsadas
  const rendimientoFlota = ratio(
    [...acum.values()].reduce((s, a) => s + (a.tramos >= TRAMOS_MIN_RENDIMIENTO ? a.tramoKm : 0), 0),
    [...acum.values()].reduce((s, a) => s + (a.tramos >= TRAMOS_MIN_RENDIMIENTO ? a.tramoLitros : 0), 0),
  )

  retrabajos.sort((a, b) => b.costo - a.costo || b.fecha.localeCompare(a.fecha))

  return {
    rango: { start, end, dias },
    totales: {
      combustible:           redondear(costoCombustible, 2)!,
      mano_obra:             redondear(manoObra, 2)!,
      refacciones_compradas: redondear(refaccionesCompradas, 2)!,
      refacciones_usadas:    redondear(piezasUsadas, 2)!,
      total_caja:            redondear(costoCombustible + manoObra + refaccionesCompradas, 2)!,
      total_operacion:       redondear(totalOperacion, 2)!,
      km_recorridos:         kmFlota,
      costo_por_km:          redondear(ratio(totalOperacion, kmFlota)),
      litros:                redondear(litrosTotales, 2)!,
      rendimiento:           redondear(rendimientoFlota),
      precio_litro:          redondear(precioLitroFlota),
      ahorro_refacciones:    redondear(totalAhorroRefacciones, 2)!,
      ahorro_combustible:    redondear(ahorroCombustible, 2)!,
      ahorro_total:          redondear(totalAhorroRefacciones + ahorroCombustible, 2)!,
      vehiculos_analizados:  vehiculos.length,
    },
    vehiculos,
    gasolineras,
    gasto_mensual: gastoMensual,
    ahorro_refacciones: ahorroRefacciones,
    anomalias: anomalias.slice(0, MAX_ANOMALIAS),
    anomalias_resumen: anomaliasResumen,
    retrabajos,
  }
}
