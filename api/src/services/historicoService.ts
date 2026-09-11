import * as repo from '../repositories/historicoRepo'
import * as proveedoresRepo from '../repositories/proveedoresRepo'
import * as sucursalesRepo from '../repositories/sucursalesRepo'
import * as tiposPiezaRepo from '../repositories/tiposPiezaRepo'
import { ImportacionHistorica } from '../schemas/historicoSchema'
import { ConflictError, NotFoundError, ValidationError } from '../shared/errors'

/**
 * Importa facturas anteriores al sistema. Ver `historicoRepo` para qué escribe
 * y `docs/importacion-historica.md` para por qué.
 *
 * Todo lo que se puede rechazar se rechaza ANTES de abrir la transacción, por
 * lo mismo que en `comprasService`: un rollback deshace también las refacciones
 * que se dieron de alta en las facturas anteriores, y con 200 renglones el
 * usuario no tiene forma de saber cuál fue el del problema. Aquí pesa todavía
 * más — lo que se importa no se capturó a mano, así que un error de referencia
 * es del archivo entero y no de un renglón suelto.
 */
export async function importar(
  data: ImportacionHistorica, autorizadoPor: string,
): Promise<repo.ImportacionResultado> {
  if (!(await proveedoresRepo.findById(data.proveedor_id))) {
    throw new NotFoundError('El proveedor')
  }
  if (!(await sucursalesRepo.findById(data.sucursal_id))) {
    throw new NotFoundError('La sucursal')
  }

  // Dos facturas con el mismo folio dentro del archivo. El UNIQUE de
  // (proveedor, folio) las rechazaría de todos modos, pero a media importación
  // y sin decir cuál es el folio que choca.
  const folios = new Set<string>()
  for (const factura of data.facturas) {
    if (folios.has(factura.num_factura)) {
      throw new ConflictError(
        `El folio ${factura.num_factura} viene dos veces en el archivo. ` +
        'Junta sus renglones en una sola factura.',
      )
    }
    folios.add(factura.num_factura)
  }

  // Los tipos de pieza, de una vez y no uno por renglón: el archivo repite el
  // mismo puñado de tipos en cientos de renglones.
  const tiposValidos = new Set((await tiposPiezaRepo.findAll()).map((t) => t.id))
  for (const tipo of new Set(
    data.facturas.flatMap((f) => f.renglones.map((r) => r.tipo_pieza_id)),
  )) {
    if (tipo !== undefined && !tiposValidos.has(tipo)) {
      throw new ValidationError(`El tipo de pieza ${tipo} no existe`)
    }
  }

  // El tipo solo hace falta donde va a nacer una refacción. Comprobarlo aquí
  // —y no al llegar a ese renglón— es lo que permite decir CUÁLES faltan en vez
  // de morir en el primero: con doscientos renglones, corregir de uno en uno
  // significa doscientos intentos.
  const series = [...new Set(
    data.facturas.flatMap((f) => f.renglones.map((r) => r.numero_serie)),
  )]
  const enCatalogo = await repo.seriesEnCatalogo(series)
  const sinTipo = [...new Set(
    data.facturas
      .flatMap((f) => f.renglones)
      .filter((r) => r.tipo_pieza_id === undefined && !enCatalogo.has(r.numero_serie))
      .map((r) => r.numero_serie),
  )]
  if (sinTipo.length) {
    throw new ValidationError(
      `Falta el tipo de pieza de ${sinTipo.length} refacción(es) que no están en ` +
      `el catálogo: ${sinTipo.slice(0, 10).join(', ')}` +
      (sinTipo.length > 10 ? ` y ${sinTipo.length - 10} más` : ''),
    )
  }

  return repo.importar(data, autorizadoPor)
}
