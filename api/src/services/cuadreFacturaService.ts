import * as repo from '../repositories/cuadreFacturaRepo'
import type { LoteDeFactura, RenglonPapel } from '../repositories/cuadreFacturaRepo'
import * as manoObraRepo from '../repositories/manoObraRepo'
import type { RenglonManoObra } from '../repositories/manoObraRepo'
import * as revisionRepo from '../repositories/revisionRepo'
import * as lotesService from '../services/lotesService'
import * as refaccionesRepo from '../repositories/refaccionesRepo'
import * as facturasRepo from '../repositories/facturasRepo'
import type { FacturaHallada, RenglonesPapel } from '../schemas/cuadreSchema'
import { AppError, NotFoundError } from '../shared/errors'
import { aCentavos, contribucionRenglon } from '../shared/totales'

// Cuadrar una factura: lo que dice el papel contra lo capturado.
//
// EL PAPEL PUEDE COBRAR DOS COSAS, y por eso este archivo tiene dos mitades. El
// taller factura las refacciones y la mano de obra en el MISMO documento, con un
// folio, un IVA y un descuento; son dos comparaciones distintas sobre una sola
// factura:
//
//   refacciones    `facturas_renglones` contra `lotes_pieza`       (044)
//   mano de obra   `facturas_mano_obra` contra `mantenimiento.costo` (046)
//
// Van en DOS LISTAS DE DIFERENCIAS y no en una sola con campos opcionales: lo
// que se compara no es lo mismo —una refacción tiene cantidad y costo unitario,
// un servicio tiene un importe y punto— y meterlas juntas obligaría a que la
// mitad de los campos fueran nulos en la mitad de las filas. El total sí es uno,
// porque el papel es uno.
//
// Ver `db/migrations/044_renglones_de_la_factura.sql` y la `046`.

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
 * Qué le pasa a un renglón de mano de obra del papel.
 *
 * NO HAY "SOBRA CAPTURADO" AQUÍ, y no es un olvido. En refacciones un lote
 * pertenece a la factura, así que uno que el papel no traiga sobra. Un
 * mantenimiento no pertenece a ninguna factura hasta que un renglón lo reclama:
 * uno que esta factura no cobre no sobra, simplemente todavía no está facturado
 * —o lo cobra otro papel—. Esa pregunta la contesta la bandeja de
 * `GET /mantenimientos/sin-facturar`, que es de la flota entera y no de una
 * factura suelta.
 */
export type TipoDiferenciaManoObra = 'sin_registrar' | 'valores'

export interface DiferenciaManoObra {
  tipo: TipoDiferenciaManoObra
  renglon_id: number
  /** `null` = el papel cobra un trabajo que ningún mantenimiento capturado explica. */
  mantenimiento_id: number | null
  vehiculo: string | null
  fecha: string | null
  tipo_servicio: string | null
  /** Lo que el papel cobra por el trabajo. */
  papel: number
  /** La mano de obra capturada (`mantenimiento.costo`). `null` si no casó. */
  sistema: number | null
  /** Lo que el desajuste vale en el TOTAL de la factura, ya con descuento e IVA. */
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
  /** La mano de obra que cobra el papel. Vacío en una factura de puras refacciones. */
  renglones_mano_obra: RenglonManoObra[]
  diferencias_mano_obra: DiferenciaManoObra[]
  /** Suma de todo lo que cobra el papel —refacciones y mano de obra—, a lista. */
  subtotal_papel: number
  /** Suma de lo capturado: los lotes más la mano de obra que la factura reclama. */
  subtotal_sistema: number
  /** Total del papel menos total capturado, ya con descuento e IVA. */
  delta_total: number
  /** Todavía no se ha transcrito nada del papel, ni refacciones ni mano de obra. */
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

  // ── La mano de obra ────────────────────────────────────────────────────────
  // El emparejado no hace falta aquí: el renglón ya dice qué mantenimiento cobra
  // porque una persona lo eligió de los candidatos. En refacciones hay que
  // inferirlo porque el papel solo trae una descripción; aquí el vínculo se
  // captura, así que lo único que queda es comparar dos importes.
  const manoObra = await manoObraRepo.renglonesDelPapel(facturaId)
  const diferenciasManoObra: DiferenciaManoObra[] = []

  for (const r of manoObra) {
    const comun = {
      renglon_id: r.id,
      mantenimiento_id: r.mantenimiento_id,
      vehiculo: r.vehiculo,
      fecha: r.mantenimiento_fecha,
      tipo_servicio: r.mantenimiento_tipo,
      papel: aCentavos(r.importe),
      capturado_por: r.capturado_por,
    }

    if (r.mantenimiento_id === null || r.mantenimiento_costo === null) {
      // El papel cobra un trabajo y no hay servicio capturado que lo explique.
      // El importe entero es el desajuste, igual que una refacción sin lote.
      diferenciasManoObra.push({
        ...comun,
        tipo: 'sin_registrar',
        sistema: null,
        delta_dinero: aCentavos(contribucionRenglon(r.importe, 1, desc, iva)),
      })
      continue
    }

    if (aCentavos(r.mantenimiento_costo) === aCentavos(r.importe)) continue

    diferenciasManoObra.push({
      ...comun,
      tipo: 'valores',
      sistema: aCentavos(r.mantenimiento_costo),
      delta_dinero: aCentavos(
        contribucionRenglon(r.importe, 1, desc, iva)
        - contribucionRenglon(r.mantenimiento_costo, 1, desc, iva),
      ),
    })
  }

  const subtotalPapel = aCentavos(
    renglones.reduce((s, r) => s + importePapel(r), 0)
    + manoObra.reduce((s, r) => s + r.importe, 0),
  )

  return {
    factura,
    renglones,
    lotes,
    diferencias,
    renglones_mano_obra: manoObra,
    diferencias_mano_obra: diferenciasManoObra,
    subtotal_papel: subtotalPapel,
    // `factura.subtotal` ya trae las dos mitades de lo capturado: los lotes y la
    // mano de obra de los mantenimientos que esta factura reclama.
    subtotal_sistema: aCentavos(factura.subtotal),
    delta_total: aCentavos(
      diferencias.reduce((s, d) => s + d.delta_dinero, 0)
      + diferenciasManoObra.reduce((s, d) => s + d.delta_dinero, 0),
    ),
    sin_capturar_papel: renglones.length === 0 && manoObra.length === 0,
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

/** El papel cobra un servicio que otra factura ya cobró. */
export const MANTENIMIENTO_YA_FACTURADO = 'MANTENIMIENTO_YA_FACTURADO'

/**
 * Guarda la mano de obra que cobra el papel y devuelve el cuadre recalculado.
 *
 * Cada renglón dice qué mantenimiento cobra —elegido de los candidatos, no
 * adivinado— y cuánto. El que no case con ninguno se guarda igual, con
 * `mantenimiento_id` en NULL: que el papel cobre un trabajo que nadie registró
 * es justo el hallazgo, y perderlo por no poder guardarlo lo volvería invisible.
 *
 * DOS FACTURAS NO PUEDEN COBRAR EL MISMO SERVICIO. Lo impone un UNIQUE, no este
 * código: comprobarlo aquí dejaría pasar dos capturas simultáneas. Lo que se
 * hace aquí es traducir ese choque a algo que se pueda leer en pantalla.
 */
export async function guardarManoObra(
  facturaId: number, renglones: { mantenimiento_id: number | null; importe: number }[],
): Promise<Cuadre> {
  const factura = await revisionRepo.leerCabecera(facturaId)
  if (!factura) throw new NotFoundError('Factura')
  if (factura.cabecera_revisada_en !== null) {
    throw new AppError(
      'Esta factura ya fue cuadrada. Reábrela para volver a capturar el papel.',
      409, 'CABECERA_REVISADA',
    )
  }

  // Dos renglones del MISMO papel apuntando al mismo servicio. El UNIQUE también
  // lo caza, pero su mensaje hablaría de otra factura y aquí no hay ninguna: lo
  // que pasó es que alguien eligió dos veces el mismo mantenimiento.
  const vistos = new Set<number>()
  for (const r of renglones) {
    if (r.mantenimiento_id === null) continue
    if (vistos.has(r.mantenimiento_id)) {
      throw new AppError(
        'Hay dos renglones de esta factura cobrando el mismo servicio. ' +
        'Si el papel lo desglosa en varias líneas, captúralo como un solo importe.',
        409, MANTENIMIENTO_YA_FACTURADO,
      )
    }
    vistos.add(r.mantenimiento_id)
  }

  try {
    await manoObraRepo.reemplazarRenglones(facturaId, renglones)
  } catch (err) {
    // 2601 y 2627 son el índice único y la restricción única de SQL Server.
    const numero = (err as { number?: number }).number
    if (numero === 2601 || numero === 2627) {
      throw new AppError(
        'Otra factura ya cobra uno de esos servicios. Quítalo de este papel, ' +
        'o revisa si las dos facturas son el mismo documento capturado dos veces.',
        409, MANTENIMIENTO_YA_FACTURADO,
      )
    }
    throw err
  }

  return getCuadre(facturaId)
}

/** Los mantenimientos que esta factura podría estar cobrando. */
export async function candidatosManoObra(facturaId: number) {
  const factura = await revisionRepo.leerCabecera(facturaId)
  if (!factura) throw new NotFoundError('Factura')
  return manoObraRepo.candidatos(facturaId)
}

/**
 * Da de alta la factura que nadie había capturado.
 *
 * No hay forma de detectarla sola: no existe ningún dato en el sistema que pueda
 * notar la ausencia de algo que nunca se capturó. El único detector es la
 * persona con el fajo de papeles; esto es donde lo registra cuando lo encuentra.
 *
 * Nace SIN RENGLONES a propósito. Al abrir su cuadre, todo lo que se transcriba
 * del papel sale como `falta_capturar` —que es la verdad— y cada renglón se
 * registra con el botón que ya existe.
 */
export async function crearHallada(
  datos: FacturaHallada, registradaPor: string,
): Promise<number> {
  const existente = await facturasRepo.findByFolio(datos.num_factura, datos.proveedor_id)
  if (existente) {
    throw new AppError(
      `Ese proveedor ya tiene la factura ${datos.num_factura} en el sistema. ` +
      'Ábrela y cuádrala contra el papel en vez de darla de alta otra vez.',
      409, 'CONFLICT',
    )
  }

  return facturasRepo.crearHallada({
    proveedor_id: datos.proveedor_id,
    folio: datos.num_factura,
    fecha_compra: datos.fecha_compra,
    tasa_iva: datos.tasa_iva ?? null,
    descuento_pct: datos.descuento_pct ?? null,
    comprado_por: datos.comprado_por,
  }, registradaPor)
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
    // `capturado_por` en NULL: esta compra no la tecleó nadie, y por eso la
    // revisión la encontró. Ponerle el nombre de quien la registra ahora
    // convertiría al verificador en el culpable de un error que arregló.
  }, quien, null)

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
  // La mano de obra sin servicio que la explique se queda pendiente por lo
  // mismo que una refacción sin capturar: resolverla es dar de alta el
  // mantenimiento, y eso pide vehículo, fecha y kilometraje — es la captura de
  // un servicio entero, no un botón dentro del cuadre.
  const pendientesManoObra = cuadre.diferencias_mano_obra.filter((d) => d.tipo !== 'valores')

  if ((pendientes.length > 0 || pendientesManoObra.length > 0) && !confirmar) {
    const faltan = pendientes.filter((d) => d.tipo === 'falta_capturar').length
    const sobran = pendientes.length - faltan
    const partes = [
      faltan > 0 ? `${faltan} refacción(es) del papel que nadie capturó` : null,
      sobran > 0 ? `${sobran} capturada(s) que el papel no trae` : null,
      pendientesManoObra.length > 0
        ? `${pendientesManoObra.length} cobro(s) de mano de obra sin mantenimiento registrado`
        : null,
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

  // ── La mano de obra ────────────────────────────────────────────────────────
  // Un solo campo, así que no hay cadena que repartir: el importe del papel pisa
  // a `mantenimiento.costo` y la corrección se queda con la diferencia entera.
  const { descuento_pct: dpct, tasa_iva: ipct } = cuadre.factura

  for (const d of cuadre.diferencias_mano_obra) {
    if (d.tipo !== 'valores' || d.mantenimiento_id === null || d.sistema === null) continue

    correcciones.push({
      lote_id: null,
      mantenimiento_id: d.mantenimiento_id,
      campo: 'costo_mano_obra',
      valor_antes: String(d.sistema),
      valor_despues: String(d.papel),
      capturado_por: d.capturado_por,
      delta_dinero: aCentavos(
        contribucionRenglon(d.papel, 1, dpct, ipct)
        - contribucionRenglon(d.sistema, 1, dpct, ipct),
      ),
    })

    // El papel gana. `mantenimiento.costo` es de donde sale el gasto en todos
    // los reportes: dejarlo como se capturó crearía dos verdades.
    await manoObraRepo.setCosto(d.mantenimiento_id, d.papel)
  }

  for (const d of pendientesManoObra) {
    correcciones.push({
      lote_id: null,
      mantenimiento_id: null,
      campo: 'mano_obra_sin_registrar',
      valor_antes: null,
      valor_despues: String(d.papel),
      capturado_por: null,
      delta_dinero: d.delta_dinero,
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
    sin_resolver: pendientes.length + pendientesManoObra.length,
  }
}
