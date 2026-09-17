// Detección de fugas de dinero.
//
// Siete cruces sobre datos que ya se capturan. Cada uno contesta "¿por dónde se
// está yendo el dinero sin que aparezca como gasto?", que es una pregunta
// distinta de la que contesta el análisis de costos —ese mide lo que sí se
// gastó y lo compara contra el mejor precio conocido—.
//
// El servicio se queda con dos responsabilidades que no caben en SQL: elegir la
// ventana de tiempo de cada cruce y armar el único que necesita dos fuentes (el
// costo del preventivo diferido, que cruza el gasto correctivo con la
// clasificación del programa de mantenimiento).
import * as repo from '../repositories/fugasRepo'
import * as programaVehiculoService from './programaVehiculoService'
import { fechaMexico } from '../shared/fechaMexico'

function addDias(fechaYMD: string, dias: number): string {
  const d = new Date(`${fechaYMD}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

// Cada fuga tiene su propio horizonte porque miden cosas de ritmos distintos.
// Usar una sola ventana para todas dejaría fuera la mitad de cada una.
const DIAS = {
  /** Merca y compras: un año da estacionalidad sin diluir la tendencia. */
  merma:   365,
  compras: 365,
  /** Capital parado: seis meses sin moverse ya es inmovilizado. */
  inmovil: 180,
  /** Vales y correctivos: el trimestre es el horizonte operativo. */
  vales:      90,
  correctivo: 90,
  /** Garantías: se revisan hacia atrás lo más posible; el año es prudente. */
  garantia: 365,
}

export interface PreventivoDiferido {
  /** Unidades con al menos un servicio del programa preventivo vencido hoy. */
  con_atraso:    ComparativoGrupo
  /** Las que están al corriente. */
  al_corriente:  ComparativoGrupo
  /**
   * Cuánto más caro sale el correctivo por cada 1 000 km en las unidades
   * atrasadas. Null si algún grupo se quedó sin kilómetros medidos.
   */
  sobrecosto_por_mil: number | null
}

export interface ComparativoGrupo {
  vehiculos:    number
  correctivos:  number
  costo:        number
  km:           number
  /** Costo correctivo por cada 1 000 km recorridos del grupo. */
  costo_por_mil: number | null
}

export interface Fugas {
  /** Qué ventana usó cada bloque, para poder decirlo en pantalla. */
  ventanas: typeof DIAS
  vida_por_marca:        repo.VidaPorMarca[]
  merma:                 repo.MermaMes[]
  lotes_inmoviles:       repo.LoteInmovil[]
  vales_sin_recarga:     repo.ValeSinRecarga[]
  deriva_precios:        repo.DerivaPrecio[]
  correctivos_garantia:  repo.CorrectivoEnGarantia[]
  preventivo_diferido:   PreventivoDiferido
  /** Lo que se puede sumar honestamente. Ver `totales` abajo. */
  totales: {
    merma:                number
    capital_parado:       number
    capital_obsoleto:     number
    correctivos_garantia: number
    vales_sin_recarga:    number
  }
}

/**
 * El costo de diferir el preventivo, como contraste entre dos grupos.
 *
 * NO ES UNA RELACIÓN CAUSAL Y NO SE PRESENTA COMO TAL. Lo que se compara es el
 * gasto correctivo por kilómetro de las unidades que hoy traen requerimientos
 * vencidos contra las que están al corriente. Que el primer grupo gaste más es
 * consistente con "posponer el preventivo sale caro", pero también con "las
 * unidades que más fallan son las que menos alcanzan a entrar al taller". La
 * flecha puede ir en cualquier dirección y el dato no la distingue.
 *
 * Se normaliza por kilómetro justamente para quitar la explicación más
 * aburrida: que un grupo simplemente trabaje más.
 */
async function calcularPreventivoDiferido(desde: string): Promise<PreventivoDiferido> {
  const [porVehiculo, clasificacion] = await Promise.all([
    repo.findCorrectivosPorVehiculo(desde),
    programaVehiculoService.clasificarFleet(),
  ])

  const atrasados = new Set(clasificacion.vencidos.map((v) => v.vehiculo_id))

  const acumular = (filas: repo.CorrectivoPorVehiculo[]): ComparativoGrupo => {
    const costo = filas.reduce((s, f) => s + Number(f.costo ?? 0), 0)
    const km    = filas.reduce((s, f) => s + Number(f.km ?? 0), 0)
    return {
      vehiculos:   filas.length,
      correctivos: filas.reduce((s, f) => s + f.correctivos, 0),
      costo,
      km,
      costo_por_mil: km > 0 ? (costo * 1000) / km : null,
    }
  }

  const conAtraso   = acumular(porVehiculo.filter((f) => atrasados.has(f.vehiculo_id)))
  const alCorriente = acumular(porVehiculo.filter((f) => !atrasados.has(f.vehiculo_id)))

  return {
    con_atraso:   conAtraso,
    al_corriente: alCorriente,
    sobrecosto_por_mil:
      conAtraso.costo_por_mil != null && alCorriente.costo_por_mil != null
        ? conAtraso.costo_por_mil - alCorriente.costo_por_mil
        : null,
  }
}

export async function getFugas(): Promise<Fugas> {
  const hoy = fechaMexico()

  const [
    vidaPorMarca, merma, inmoviles, vales, deriva, garantia, diferido,
  ] = await Promise.all([
    repo.findVidaPorMarca(),
    repo.findMermaValorizada(addDias(hoy, -DIAS.merma)),
    repo.findLotesInmoviles(addDias(hoy, -DIAS.inmovil)),
    repo.findValesSinRecarga(addDias(hoy, -DIAS.vales)),
    repo.findDerivaPrecios(addDias(hoy, -DIAS.compras)),
    repo.findCorrectivosEnGarantia(addDias(hoy, -DIAS.garantia)),
    calcularPreventivoDiferido(addDias(hoy, -DIAS.correctivo)),
  ])

  // Los totales suman solo lo que es un monto real y comparable. Quedan fuera a
  // propósito:
  //
  //   - el costo por km de vida, que es una tasa y no un monto;
  //   - la deriva de precios, cuyo "sobrecosto" depende de cuánto se vaya a
  //     comprar a futuro y sería inventado;
  //   - el preventivo diferido, que es una correlación (ver arriba).
  //
  // Sumar esas tres daría una cifra más grande y más falsa.
  const capital = inmoviles.reduce(
    (acc, l) => {
      const monto = Number(l.monto ?? 0)
      if (l.descontinuada) acc.obsoleto += monto
      else acc.parado += monto
      return acc
    },
    { parado: 0, obsoleto: 0 },
  )

  return {
    ventanas: DIAS,
    vida_por_marca:       vidaPorMarca,
    merma,
    lotes_inmoviles:      inmoviles,
    vales_sin_recarga:    vales,
    deriva_precios:       deriva,
    correctivos_garantia: garantia,
    preventivo_diferido:  diferido,
    totales: {
      // Solo los faltantes. El signo lo fija la migración 022: +1 = el sistema
      // cuenta de más, o sea que en el estante hay menos. Los sobrantes no son
      // dinero recuperable, y restarlos haría ver la merma más chica de lo que es.
      merma: merma.reduce((s, m) => s + Math.max(0, Number(m.monto ?? 0)), 0),
      capital_parado:   capital.parado,
      capital_obsoleto: capital.obsoleto,
      // Por mantenimiento y no por renglón: un vehículo con dos garantías
      // vigentes produce dos renglones del mismo correctivo —cada uno es una
      // cobertura distinta que hay que revisar— y sumarlos contaría el gasto dos
      // veces.
      correctivos_garantia: [
        ...new Map(garantia.map((g) => [g.mantenimiento_id, Number(g.costo ?? 0)])).values(),
      ].reduce((s, costo) => s + costo, 0),
      // Sin monto: un vale no dice cuántos litros se surtieron. Se cuenta.
      vales_sin_recarga: vales.length,
    },
  }
}
