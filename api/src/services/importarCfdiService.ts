import * as repo from '../repositories/importarCfdiRepo'
import * as facturasRepo from '../repositories/facturasRepo'
import * as proveedoresRepo from '../repositories/proveedoresRepo'
import * as refaccionesRepo from '../repositories/refaccionesRepo'
import type { FacturaCfdiImport, ConceptoCfdi } from '../schemas/importarCfdiSchema'
import { AppError, ConflictError, NotFoundError, ValidationError } from '../shared/errors'
import { aCentavos } from '../shared/totales'
import { RFC_EMPRESA } from '../shared/empresa'

// Importar una factura de refacciones de su XML. Ver la migración 070 y
// docs/importar-facturas-de-refacciones.md.
//
// Todo lo que se puede rechazar se rechaza ANTES de la transacción, con el
// concepto que lo causó: igual que el alta de compra, un rollback a medias no
// le dice a nadie cuál de los renglones era el del problema.

export const FACTURA_DUPLICADA = 'FACTURA_DUPLICADA'
export const PROVEEDOR_DESCONOCIDO = 'PROVEEDOR_DESCONOCIDO'

const TOLERANCIA = 0.01

/** Dos descuentos son el mismo si difieren en menos de una centésima de punto. */
const MISMO_PCT = 0.0001

/** Lo que deja pasar `TEXTO_LIBRE`: el XML trae de todo ("VALVE=801665"). */
function limpiarTexto(s: string): string {
  return s.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 .,;:()¿?¡!"'%#°+&/-]/g, ' ').replace(/\s+/g, ' ').trim()
}

function nombreConcepto(c: ConceptoCfdi, i: number): string {
  return `Concepto ${i + 1} ("${c.descripcion.slice(0, 60)}")`
}

/**
 * El descuento del papel, como lo guarda el sistema.
 *
 * El sistema lo guarda POR FACTURA (`descuento_pct`, 021) y el CFDI lo trae POR
 * CONCEPTO. Si todos los conceptos —refacciones, mano de obra y cargos— llevan
 * el mismo porcentaje, se guarda a precio de lista con ese descuento, que es la
 * forma completa. Si no, no hay un porcentaje que lo diga: cada concepto se
 * guarda ya descontado y la factura sin descuento, que es como se capturaron
 * siempre los precios "ya descontados".
 */
function descuentoDeLaFactura(conceptos: ConceptoCfdi[]): { lista: boolean; pct: number | null } {
  const pcts = conceptos.map((c) => (c.importe > 0 ? c.descuento / c.importe : 0))
  const parejo = pcts.every((p) => Math.abs(p - pcts[0]) < MISMO_PCT)
  if (!parejo) return { lista: false, pct: null }
  const pct = Math.round(pcts[0] * 10000) / 100
  return { lista: true, pct: pct > 0 ? pct : null }
}

export interface Importada extends repo.Importada {
  folio: string
  proveedor: string
}

export async function importar(data: FacturaCfdiImport, usuario: string): Promise<Importada> {
  if (data.receptor_rfc !== RFC_EMPRESA) {
    throw new ValidationError(
      `La factura está a nombre de ${data.receptor_rfc}, no de ${RFC_EMPRESA}. No es gasto de aquí.`,
    )
  }
  const repetida = await repo.facturaPorUuid(data.uuid)
  if (repetida) {
    throw new AppError(`Esta factura ya está importada (folio ${repetida.folio}).`, 409, FACTURA_DUPLICADA)
  }

  // Las sumas del papel, antes de creerle nada.
  const suma = (k: 'importe' | 'descuento' | 'iva') => aCentavos(data.conceptos.reduce((s, c) => s + c[k], 0))
  const comparaciones: [string, number, number][] = [
    ['subtotal', suma('importe'), data.subtotal],
    ['descuento', suma('descuento'), data.descuento],
    ['IVA', suma('iva'), data.iva],
    ['total', aCentavos(data.subtotal - data.descuento + data.iva), data.total],
  ]
  for (const [nombre, sumado, impreso] of comparaciones) {
    if (Math.abs(sumado - impreso) > TOLERANCIA) {
      throw new ValidationError(
        `Los conceptos dan ${sumado.toFixed(2)} de ${nombre} y la factura dice ` +
        `${impreso.toFixed(2)}. No se importó nada.`,
      )
    }
  }

  // ── El proveedor, por su RFC ──
  let proveedor: repo.ImportacionResuelta['proveedor']
  let proveedorId: number | null
  let nombreProveedor: string
  const dueno = await repo.proveedorPorRfc(data.emisor_rfc)
  if (dueno) {
    if (data.proveedor_id && data.proveedor_id !== dueno.id) {
      throw new ConflictError(`El RFC ${data.emisor_rfc} ya es del proveedor ${dueno.nombre}.`)
    }
    proveedor = { id: dueno.id, ligar_rfc: null }
    proveedorId = dueno.id
    nombreProveedor = dueno.nombre
  } else if (data.proveedor_id) {
    const p = await proveedoresRepo.findById(data.proveedor_id)
    if (!p) throw new NotFoundError('Proveedor')
    if (p.rfc && p.rfc !== data.emisor_rfc) {
      throw new ConflictError(
        `${p.nombre} tiene el RFC ${p.rfc} y esta factura es de ${data.emisor_rfc}: es otro proveedor.`,
      )
    }
    proveedor = { id: p.id, ligar_rfc: data.emisor_rfc }
    proveedorId = p.id
    nombreProveedor = p.nombre
  } else if (data.proveedor_nuevo) {
    const nombre = data.emisor_nombre.trim().replace(/\s+/g, ' ').slice(0, 100)
    if (nombre.length < 2) throw new ValidationError('El XML no trae el nombre del emisor: elige el proveedor.')
    if (await proveedoresRepo.existsNombre(nombre)) {
      throw new ConflictError(`Ya existe un proveedor llamado ${nombre}: elígelo en vez de darlo de alta.`)
    }
    proveedor = { nuevo: { nombre, rfc: data.emisor_rfc } }
    proveedorId = null
    nombreProveedor = nombre
  } else {
    throw new AppError(
      `Ningún proveedor tiene el RFC ${data.emisor_rfc}. Elige cuál es o dalo de alta.`,
      409, PROVEEDOR_DESCONOCIDO,
    )
  }

  // ── El folio, con su serie ──
  // Una capturada a mano pudo quedar con o sin la serie: se buscan las formas
  // para no meter dos veces el mismo papel.
  const folio = data.serie ? `${data.serie}-${data.folio}` : data.folio
  if (folio.length > 30) throw new ValidationError(`El folio ${folio} pasa de 30 caracteres.`)
  if (proveedorId !== null) {
    for (const candidato of new Set([folio, data.folio, `${data.serie ?? ''}${data.folio}`])) {
      if (await facturasRepo.findByFolio(candidato, proveedorId)) {
        throw new ConflictError(
          `${nombreProveedor} ya tiene la factura ${candidato}, capturada a mano. No hace falta importarla.`,
        )
      }
    }
  }

  // ── Los conceptos ──
  const { lista, pct } = descuentoDeLaFactura(data.conceptos)
  const neto = (c: ConceptoCfdi) => (lista ? c.importe : c.importe - c.descuento)

  const refacciones: repo.RefaccionResuelta[] = []
  const indiceRefaccion = new Map<number, number>()
  const seriesNuevas = new Set<string>()
  const cargos: repo.ImportacionResuelta['cargos'] = []
  let manoObra: number | null = null

  for (const [i, c] of data.conceptos.entries()) {
    const donde = nombreConcepto(c, i)
    const a = c.asignacion
    if (a.tipo === 'mano_obra') {
      manoObra = (manoObra ?? 0) + neto(c)
      continue
    }
    if (a.tipo === 'cargo') {
      cargos.push({ descripcion: limpiarTexto(c.descripcion).slice(0, 255) || 'Cargo', importe: aCentavos(neto(c)) })
      continue
    }

    // Lo que trae el XML entre lo que trae cada pieza: 10 L en botes de 1 L.
    const exacto = c.cantidad / a.contenido
    const piezas = Math.round(exacto)
    if (Math.abs(exacto - piezas) > 1e-6) {
      throw new ValidationError(
        `${donde}: ${c.cantidad} entre ${a.contenido} por pieza no da piezas enteras. ` +
        'Revisa cuánto trae cada pieza.',
      )
    }
    if (piezas < 1 || piezas > 999) {
      throw new ValidationError(`${donde}: salen ${piezas} piezas; un lote lleva de 1 a 999.`)
    }
    const costo = aCentavos(neto(c) / piezas)
    if (costo <= 0 || costo > 200000) {
      throw new ValidationError(`${donde}: el costo por pieza sale en ${costo.toFixed(2)}.`)
    }

    if (a.pieza_id !== undefined) {
      if (!(await refaccionesRepo.findById(a.pieza_id))) throw new NotFoundError(`${donde}: la refacción`)
    } else {
      const serie = a.pieza_nueva!.numero_serie
      if (seriesNuevas.has(serie)) {
        throw new ConflictError(`${donde}: el número de serie ${serie} se repite en esta factura.`)
      }
      seriesNuevas.add(serie)
      if (await refaccionesRepo.findByNumeroSerie(serie)) {
        throw new ConflictError(
          `${donde}: ya existe una refacción con número de serie ${serie}. Elígela del catálogo.`,
        )
      }
    }

    indiceRefaccion.set(i, refacciones.length)
    refacciones.push({
      ...(a.pieza_id !== undefined ? { pieza_id: a.pieza_id } : { pieza_nueva: a.pieza_nueva! }),
      cantidad: piezas,
      costo_unitario: costo,
    })
  }

  const aprender: repo.ImportacionResuelta['aprender'] = data.conceptos
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => !!c.no_identificacion)
    .map(({ c, i }) => ({
      no_identificacion: c.no_identificacion!,
      tipo: c.asignacion.tipo,
      refaccion: indiceRefaccion.get(i) ?? null,
      contenido: c.asignacion.tipo === 'refaccion' ? c.asignacion.contenido : 1,
    }))

  const r = await repo.importar({
    uuid: data.uuid,
    folio,
    fecha: data.fecha,
    tasa_iva: data.tasa_iva,
    descuento_pct: pct,
    comprado_por: data.comprado_por,
    autorizado_por: usuario,
    sucursal_id: data.sucursal_id,
    fecha_llegada: data.fecha_llegada ?? null,
    proveedor,
    refacciones,
    mano_obra: manoObra === null ? null : aCentavos(manoObra),
    cargos,
    aprender,
  })
  if (r.estado === 'duplicada') {
    throw new AppError('Alguien acaba de importar esta factura.', 409, FACTURA_DUPLICADA)
  }
  if (r.estado === 'folio_existente') {
    throw new ConflictError(`${nombreProveedor} ya tiene la factura ${folio}. No hace falta importarla.`)
  }
  return { ...r.datos, folio, proveedor: nombreProveedor }
}

export async function conceptosDe(proveedorId: number) {
  return repo.conceptosDe(proveedorId)
}
