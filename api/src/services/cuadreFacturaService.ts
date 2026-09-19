import * as repo from '../repositories/cuadreFacturaRepo'
import type { LoteDeFactura, RenglonPapel } from '../repositories/cuadreFacturaRepo'
import * as revisionRepo from '../repositories/revisionRepo'
import * as lotesService from '../services/lotesService'
import * as refaccionesRepo from '../repositories/refaccionesRepo'
import type { RenglonesPapel } from '../schemas/cuadreSchema'
import { AppError, NotFoundError } from '../shared/errors'
import { aCentavos, contribucionRenglon } from '../shared/totales'

// Cuadrar una factura de refacciones: lo que dice el papel contra lo capturado.
//
// Ver `db/migrations/044_renglones_de_la_factura.sql`.

/** Quedan desajustes sin resolver y no se confirmó cerrar así. */
export const CUADRE_INCOMPLETO = 'CUADRE_INCOMPLETO'

export type TipoDiferencia = 'falta_capturar' | 'sobra_capturado' | 'valores'

export interface Diferencia {
  tipo: TipoDiferencia
  renglon_id: number | null
  lote_id: number | null
  pieza_id: number
  numero_serie: string
  descripcion: string
  /** Lo que dice el papel. `null` cuando el papel no lo trae. */
  papel: { cantidad: number; costo_unitario: number; importe: number } | null
  /** Lo que está capturado. `null` cuando nadie lo capturó. */
  sistema: { cantidad: number; costo_unitario: number; importe: number } | null
  /**
   * Lo que el desajuste vale en el TOTAL de la factura, ya con descuento e IVA.
   * Positivo = el papel cobra más de lo capturado.
   */
  delta_dinero: number
  capturado_por: string | null
}

/**
 * Empareja los renglones del papel con los lotes capturados.
 *
 * DOS PASADAS. Primero los que coinciden en pieza, cantidad y costo — esos no
 * son una inferencia, son el mismo renglón. Después, por pieza a secas: ahí
 * está el error de captura que se busca, y dejarlo sin emparejar lo convertiría
 * en un "falta" y un "sobra" en vez de en "este costo está mal".
 *
 * Una misma factura puede traer la misma refacción dos veces con costos
 * distintos, y por eso la primera pasada existe: sin ella, el emparejado por
 * pieza podría cruzar los dos renglones y reportar dos errores donde no hay
 * ninguno.
 */
function emparejar(renglones: RenglonPapel[], lotes: LoteDeFactura[]): Map<number, number> {
  const casados = new Map<number, number>() // renglón → lote
  const lotesLibres = new Set(lotes.map((l) => l.lote_id))

  // Respeta lo que ya se decidió a mano o en un guardado anterior.
  for (const r of renglones) {
    if (r.lote_id !== null && lotesLibres.has(r.lote_id)) {
      casados.set(r.id, r.lote_id)
      lotesLibres.delete(r.lote_id)
    }
  }

  const iguales = (r: RenglonPapel, l: LoteDeFactura) =>
    l.pieza_id === r.pieza_id
    && l.cantidad_inicial === r.cantidad
    && aCentavos(l.costo_unitario) === aCentavos(r.costo_unitario)

  for (const r of renglones) {
    if (casados.has(r.id)) continue
    const exacto = lotes.find((l) => lotesLibres.has(l.lote_id) && iguales(r, l))
    if (exacto) {
      casados.set(r.id, exacto.lote_id)
      lotesLibres.delete(exacto.lote_id)
    }
  }

  for (const r of renglones) {
    if (casados.has(r.id)) continue
    const porPieza = lotes.find((l) => lotesLibres.has(l.lote_id) && l.pieza_id === r.pieza_id)
    if (porPieza) {
      casados.set(r.id, porPieza.lote_id)
      lotesLibres.delete(porPieza.lote_id)
    }
  }

  return casados
}

export interface Cuadre {
  factura: revisionRepo.CabeceraParaRevision
  renglones: RenglonPapel[]
  lotes: LoteDeFactura[]
  diferencias: Diferencia[]
  /** Suma de los renglones del papel, a precio de lista. */
  subtotal_papel: number
  /** Suma de los lotes capturados. Es `factura.subtotal`. */
  subtotal_sistema: number
  /** Total del papel menos total capturado, ya con descuento e IVA. */
  delta_total: number
  /** Todavía no se ha capturado ningún renglón del papel. */
  sin_capturar_papel: boolean
}

export async function getCuadre(facturaId: number): Promise<Cuadre> {
  const factura = await revisionRepo.leerCabecera(facturaId)
  if (!factura) throw new NotFoundError('Factura')

  const renglones = await repo.renglonesDelPapel(facturaId)
  const lotes = await repo.lotesDeFactura(facturaId)
  const casados = emparejar(renglones, lotes)
  const porLote = new Map(lotes.map((l) => [l.lote_id, l]))
  const { descuento_pct: desc, tasa_iva: iva } = factura

  const importePapel = (r: RenglonPapel) => aCentavos(r.cantidad * r.costo_unitario)
  const importeLote = (l: LoteDeFactura) => aCentavos(l.cantidad_inicial * l.costo_unitario)

  const diferencias: Diferencia[] = []

  for (const r of renglones) {
    const loteId = casados.get(r.id)
    const l = loteId !== undefined ? porLote.get(loteId) : undefined

    if (!l) {
      // El papel lo cobra y nadie lo capturó. El gasto entero es el desajuste.
      diferencias.push({
        tipo: 'falta_capturar',
        renglon_id: r.id, lote_id: null,
        pieza_id: r.pieza_id, numero_serie: r.numero_serie, descripcion: r.descripcion,
        papel: { cantidad: r.cantidad, costo_unitario: r.costo_unitario, importe: importePapel(r) },
        sistema: null,
        delta_dinero: aCentavos(contribucionRenglon(r.costo_unitario, r.cantidad, desc, iva)),
        capturado_por: null,
      })
      continue
    }

    const mismaCantidad = l.cantidad_inicial === r.cantidad
    const mismoCosto = aCentavos(l.costo_unitario) === aCentavos(r.costo_unitario)
    if (mismaCantidad && mismoCosto) continue

    diferencias.push({
      tipo: 'valores',
      renglon_id: r.id, lote_id: l.lote_id,
      pieza_id: r.pieza_id, numero_serie: r.numero_serie, descripcion: r.descripcion,
      papel: { cantidad: r.cantidad, costo_unitario: r.costo_unitario, importe: importePapel(r) },
      sistema: {
        cantidad: l.cantidad_inicial, costo_unitario: l.costo_unitario, importe: importeLote(l),
      },
      delta_dinero: aCentavos(
        contribucionRenglon(r.costo_unitario, r.cantidad, desc, iva)
        - contribucionRenglon(l.costo_unitario, l.cantidad_inicial, desc, iva),
      ),
      capturado_por: l.capturado_por,
    })
  }

  const reclamados = new Set(casados.values())
  for (const l of lotes) {
    if (reclamados.has(l.lote_id)) continue
    // Está capturado y el papel no lo trae. Es dinero que el sistema registró de
    // más: o se capturó una pieza que no se compró, o pertenece a otra factura.
    diferencias.push({
      tipo: 'sobra_capturado',
      renglon_id: null, lote_id: l.lote_id,
      pieza_id: l.pieza_id, numero_serie: l.numero_serie, descripcion: l.descripcion,
      papel: null,
      sistema: {
        cantidad: l.cantidad_inicial, costo_unitario: l.costo_unitario, importe: importeLote(l),
      },
      delta_dinero: aCentavos(
        -contribucionRenglon(l.costo_unitario, l.cantidad_inicial, desc, iva),
      ),
      capturado_por: l.capturado_por,
    })
  }

  const subtotalPapel = aCentavos(renglones.reduce((s, r) => s + importePapel(r), 0))

  return {
    factura,
    renglones,
    lotes,
    diferencias,
    subtotal_papel: subtotalPapel,
    subtotal_sistema: aCentavos(factura.subtotal),
    delta_total: aCentavos(diferencias.reduce((s, d) => s + d.delta_dinero, 0)),
    sin_capturar_papel: renglones.length === 0,
  }
}

/**
 * Guarda lo que dice el papel y devuelve el cuadre ya recalculado.
 *
 * Los renglones que traen `pieza_nueva` dan de alta la refacción antes de
 * guardarse: el papel puede cobrar una pieza que nadie ha comprado nunca, y
 * obligar a salir a otra pantalla para registrarla rompería la revisión a la
 * mitad. Es el mismo trato que en el alta de compra.
 */
export async function guardarRenglones(
  facturaId: number, datos: RenglonesPapel,
): Promise<Cuadre> {
  const factura = await revisionRepo.leerCabecera(facturaId)
  if (!factura) throw new NotFoundError('Factura')
  if (factura.cabecera_revisada_en !== null) {
    throw new AppError(
      'Esta factura ya fue cuadrada. Reábrela para volver a capturar el papel.',
      409, 'CABECERA_REVISADA',
    )
  }

  // Las refacciones nuevas primero, fuera del reemplazo: si el alta falla, es
  // mejor no haber tocado todavía lo que ya estaba capturado del papel.
  const renglones: repo.RenglonAGuardar[] = []
  for (const [i, r] of datos.renglones.entries()) {
    let piezaId = r.pieza_id
    if (piezaId === undefined) {
      const serie = r.pieza_nueva!.numero_serie
      const existente = await refaccionesRepo.findByNumeroSerie(serie)
      if (existente) {
        throw new AppError(
          `Renglón ${i + 1}: ya existe una refacción con número de serie ${serie}. ` +
          'Elígela del catálogo en vez de darla de alta.',
          409, 'CONFLICT',
        )
      }
      piezaId = (await refaccionesRepo.create(r.pieza_nueva!)).id
    }
    renglones.push({
      pieza_id: piezaId,
      cantidad: r.cantidad,
      costo_unitario: r.costo_unitario,
      lote_id: r.lote_id ?? null,
    })
  }

  // El emparejado que proponga el servidor se guarda: así lo que la pantalla
  // enseña y lo que la base tiene no pueden discrepar entre una carga y otra.
  await repo.reemplazarRenglones(facturaId, renglones)
  const cuadre = await getCuadre(facturaId)

  const conLote = cuadre.renglones.map((r) => {
    const d = cuadre.diferencias.find((x) => x.renglon_id === r.id)
    return {
      pieza_id: r.pieza_id,
      cantidad: r.cantidad,
      costo_unitario: r.costo_unitario,
      lote_id: d?.tipo === 'falta_capturar' ? null : (d?.lote_id ?? r.lote_id),
    }
  })
  await repo.reemplazarRenglones(facturaId, conLote)

  return getCuadre(facturaId)
}

/**
 * Registra la compra que el papel cobra y nadie había capturado.
 *
 * Es el otro lado de `POST /lotes/{id}/quitar`: aquel borra lo que sobra, este
 * da de alta lo que falta. El renglón ya sabe qué refacción, cuántas y a qué
 * costo; lo único que el papel no dice es dónde entró la mercancía, y por eso lo
 * único que se pide es la sucursal.
 *
 * El lote entra por `lotesService.createLote`, que es quien crea la existencia y
 * las unidades de los tipos rastreados. Su `findOrCreate` reconoce la factura
 * por (proveedor, folio), así que el lote cae en esta misma y no en una nueva.
 */
export async function registrarRenglon(
  renglonId: number, sucursalId: number, quien: string,
): Promise<{ lote_id: number; factura_id: number }> {
  const r = await repo.leerRenglon(renglonId)
  if (!r) throw new NotFoundError('Renglón')

  if (r.lote_id !== null) {
    throw new AppError('Este renglón ya tiene su compra registrada', 409, 'CONFLICT')
  }
  if (r.cabecera_revisada_en !== null) {
    throw new AppError(
      'Esta factura ya fue cuadrada. Reábrela para registrar lo que falta.',
      409, 'CABECERA_REVISADA',
    )
  }

  const lote = await lotesService.createLote(r.pieza_id, {
    proveedor_id: r.proveedor_id,
    sucursal_id: sucursalId,
    fecha_compra: r.fecha_compra,
    costo_unitario: r.costo_unitario,
    cantidad_inicial: r.cantidad,
    num_factura: r.folio,
    tasa_iva: null,
    comprado_por: r.comprado_por,
  }, quien)

  await repo.ligarLote(renglonId, lote.id)
  return { lote_id: lote.id, factura_id: r.factura_id }
}

export interface ResultadoCuadre {
  factura_id: number
  correcciones: number
  /** Lo que las correcciones movieron del total, en pesos. */
  delta_total: number
  /** Desajustes que se cerraron sin resolver. */
  sin_resolver: number
}

/**
 * Aplica lo que dice el papel y sella todos los renglones de la factura.
 *
 * Lo que se corrige son los VALORES: cantidad y costo de los lotes que no
 * coinciden con el papel. Lo que NO se toca solo es:
 *
 *   `falta_capturar`  -> hay que registrar la compra, y eso pide sucursal.
 *                        Tiene su propio endpoint.
 *   `sobra_capturado` -> quitar un lote exige comprobar que nunca se movió.
 *                        Tiene el suyo (`POST /lotes/{id}/quitar`).
 *
 * Esos dos se pueden dejar pendientes y sellar igual —el papel puede tardar en
 * aclararse— pero exige confirmarlo, así que no pasa por descuido.
 */
export async function cuadrar(
  facturaId: number, nota: string | null, confirmar: boolean, quien: string,
): Promise<ResultadoCuadre> {
  const cuadre = await getCuadre(facturaId)

  if (cuadre.sin_capturar_papel) {
    throw new AppError(
      'Todavía no se ha capturado lo que dice el papel de esta factura.',
      409, CUADRE_INCOMPLETO,
    )
  }

  const pendientes = cuadre.diferencias.filter((d) => d.tipo !== 'valores')
  if (pendientes.length > 0 && !confirmar) {
    const faltan = pendientes.filter((d) => d.tipo === 'falta_capturar').length
    const sobran = pendientes.length - faltan
    const partes = [
      faltan > 0 ? `${faltan} refacción(es) del papel que nadie capturó` : null,
      sobran > 0 ? `${sobran} capturada(s) que el papel no trae` : null,
    ].filter(Boolean)
    throw new AppError(
      `Quedan ${partes.join(' y ')}. Resuélvelas o confirma para cerrar así.`,
      409, CUADRE_INCOMPLETO,
    )
  }

  const correcciones: revisionRepo.Correccion[] = []

  for (const d of cuadre.diferencias) {
    if (d.tipo !== 'valores' || d.lote_id === null || !d.papel || !d.sistema) continue

    // En cadena, igual que en la revisión por renglón: primero la cantidad sobre
    // el costo viejo, después el costo sobre la cantidad ya corregida. Así cada
    // corrección se queda con lo que ella sola movió y las dos suman el cambio
    // total; medidas por separado se solapan.
    const { descuento_pct: desc, tasa_iva: iva } = cuadre.factura
    let corriente = contribucionRenglon(d.sistema.costo_unitario, d.sistema.cantidad, desc, iva)

    if (d.papel.cantidad !== d.sistema.cantidad) {
      const tras = contribucionRenglon(d.sistema.costo_unitario, d.papel.cantidad, desc, iva)
      correcciones.push({
        lote_id: d.lote_id,
        campo: 'cantidad_inicial',
        valor_antes: String(d.sistema.cantidad),
        valor_despues: String(d.papel.cantidad),
        capturado_por: d.capturado_por,
        delta_dinero: aCentavos(tras - corriente),
      })
      corriente = tras
    }

    if (aCentavos(d.papel.costo_unitario) !== aCentavos(d.sistema.costo_unitario)) {
      const tras = contribucionRenglon(d.papel.costo_unitario, d.papel.cantidad, desc, iva)
      correcciones.push({
        lote_id: d.lote_id,
        campo: 'costo_unitario',
        valor_antes: String(aCentavos(d.sistema.costo_unitario)),
        valor_despues: String(aCentavos(d.papel.costo_unitario)),
        capturado_por: d.capturado_por,
        delta_dinero: aCentavos(tras - corriente),
      })
      corriente = tras
    }

    // Pasa por el service del lote, que sabe ajustar la existencia al cambiar la
    // cantidad e impide bajarla por debajo de lo ya consumido. Ese error sale
    // tal cual: que el papel diga menos piezas de las que ya se usaron no es un
    // error de captura, es un descuadre de almacén.
    await lotesService.updateLote(d.lote_id, {
      cantidad_inicial: d.papel.cantidad,
      costo_unitario: d.papel.costo_unitario,
    })
  }

  // Los que quedaron sin resolver también se registran: son el hallazgo, y
  // perderlos porque alguien cerró la factura sería quedarse sin la respuesta.
  for (const d of pendientes) {
    correcciones.push({
      lote_id: d.lote_id,
      campo: d.tipo === 'falta_capturar' ? 'renglon_faltante' : 'renglon_sobrante',
      valor_antes: d.sistema ? `${d.sistema.cantidad} × ${d.sistema.costo_unitario}` : null,
      valor_despues: d.papel ? `${d.papel.cantidad} × ${d.papel.costo_unitario}` : null,
      capturado_por: d.capturado_por,
      delta_dinero: d.delta_dinero,
    })
  }

  const sellado = await revisionRepo.sellarCuadre(
    facturaId, correcciones, quien, nota?.trim() || null,
  )
  if (!sellado) {
    throw new AppError('Alguien más acaba de cuadrar esta factura', 409, 'CABECERA_REVISADA')
  }

  return {
    factura_id: facturaId,
    correcciones: correcciones.length,
    delta_total: aCentavos(correcciones.reduce((s, c) => s + c.delta_dinero, 0)),
    sin_resolver: pendientes.length,
  }
}
