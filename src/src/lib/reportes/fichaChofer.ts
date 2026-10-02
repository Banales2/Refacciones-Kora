// La ficha que se le entrega al chofer: una hoja por unidad con todo lo que su
// unidad trae abierto, separado en dos partes.
//
//   LO QUE TE TOCA RESOLVER. Lo que se arregla sin taller ni refacción —los
//   niveles, el extintor, los papeles, la basura de la cabina— y cargar
//   combustible si el último chequeo la recibió con un cuarto o menos. Lleva
//   casilla para palomear: es trabajo que se le pide.
//
//   PARA QUE ESTÉS ENTERADO. Todo lo demás: llantas, luces, golpes, fugas. No lo
//   resuelve él, pero es su unidad y la maneja todos los días: tiene que saber
//   que las llantas están dañadas o que un stop no prende, y avisar si empeora.
//   Sin casilla, a propósito: palomear algo que no puede arreglar no significa
//   nada.
//
// Una hoja por unidad, porque cada chofer se lleva solo la suya, y las hojas
// agrupadas por sucursal, porque es en el patio de cada sucursal donde se
// reparten.
//
// QUÉ LE TOCA NO LO DECIDE LA GRAVEDAD. "Superficial" dice qué tan urgente es,
// no quién lo arregla: un espejo que falta es superficial y hay que comprarlo y
// montarlo en el taller, y el aceite bajo es grave y lo rellena el chofer. Le
// tocan las preguntas del chequeo que el catálogo marca con `cierreAutomatico`,
// que son también las que el chequeo diario cierra solo cuando las encuentra
// bien. Así la hoja y el cierre no se pueden desalinear.
//
// Una incidencia capturada a mano no dice de qué punto del chequeo es salvo que
// traiga `clave_chequeo`; sin eso no hay forma de saber si la arregla el chofer,
// y va a "enterado".
//
// EL COMBUSTIBLE NO ES INCIDENCIA. A un cuarto solo quiere decir que hay que
// cargar (ver el catálogo), así que sale del último chequeo de la unidad y no de
// las incidencias.
import type { IncidenciaConVehiculo, Severidad } from '../../hooks/useIncidencias'
import type { ChequeoConVehiculo } from '../../hooks/useChequeos'
import { ITEMS_CHEQUEO } from '../chequeoItems'
import { SEVERIDAD_META } from '../incidenciaMeta'
import { crearReportePdf, hoyISO } from './pdfDoc'
import { formatFecha } from '../formato'

export const SIN_SUCURSAL = 'Sin sucursal fija'

/** Qué tan atrás se busca el último chequeo para saber cómo traía el tanque. */
export const DIAS_COMBUSTIBLE = 7

const LAS_ARREGLA_EL_CHOFER = new Set(
  ITEMS_CHEQUEO.filter((i) => i.cierreAutomatico).map((i) => i.clave)
)

const ORDEN_SEVERIDAD: Record<Severidad, number> = { grave: 0, moderada: 1, superficial: 2 }

/** Si la resuelve el chofer o solo se le avisa. */
export function esDelChofer(i: IncidenciaConVehiculo): boolean {
  return i.clave_chequeo != null && LAS_ARREGLA_EL_CHOFER.has(i.clave_chequeo)
}

/** Lo que entra en la ficha: todo lo abierto. Qué parte de la hoja ocupa lo decide `esDelChofer`. */
export function incidenciasParaFicha(incidencias: IncidenciaConVehiculo[]): IncidenciaConVehiculo[] {
  return incidencias.filter((i) => i.status === 'activo')
}

export interface CombustibleBajo {
  vehiculo_id:     number
  vehiculo_nombre: string
  placas:          string | null
  sucursal:        string
  /** Como se capturó: "1/4", o un octavo de los chequeos viejos. */
  valor:           string
  fecha:           string
}

// "1/4" → 0.25. Lo que no tenga forma de fracción no cuenta como bajo: mejor
// callar que mandar a cargar por un dato que no se entiende.
function fraccion(valor: string): number | null {
  const m = /^(\d+)\/(\d+)$/.exec(valor.trim())
  if (!m || Number(m[2]) === 0) return null
  return Number(m[1]) / Number(m[2])
}

/**
 * Las unidades cuyo chequeo MÁS RECIENTE las recibió con un cuarto de tanque o
 * menos. Solo el más reciente: si el de ayer decía 1/4 y el de hoy 3/4, ya
 * cargaron.
 */
export function combustibleBajo(chequeos: ChequeoConVehiculo[]): CombustibleBajo[] {
  const ultimo = new Map<number, ChequeoConVehiculo>()
  for (const c of chequeos) {
    const previo = ultimo.get(c.vehiculo_id)
    if (!previo || c.fecha > previo.fecha || (c.fecha === previo.fecha && c.id > previo.id)) {
      ultimo.set(c.vehiculo_id, c)
    }
  }
  const bajos: CombustibleBajo[] = []
  for (const c of ultimo.values()) {
    const item = c.items.find((i) => i.clave === 'combustible')
    const nivel = item?.valor ? fraccion(item.valor) : null
    if (nivel === null || nivel > 0.25) continue
    bajos.push({
      vehiculo_id:     c.vehiculo_id,
      vehiculo_nombre: c.vehiculo_nombre,
      placas:          c.vehiculo_placas ?? null,
      sucursal:        c.vehiculo_sucursal ?? SIN_SUCURSAL,
      valor:           item!.valor!,
      fecha:           c.fecha.split('T')[0],
    })
  }
  return bajos
}

interface HojaVehiculo {
  vehiculo_id:     number
  vehiculo_nombre: string
  placas:          string | null
  /** Lo que le toca: con casilla. */
  tuyas:           IncidenciaConVehiculo[]
  /** Lo que solo se le avisa: sin casilla. */
  avisos:          IncidenciaConVehiculo[]
  combustible:     CombustibleBajo | null
}

interface GrupoSucursal {
  sucursal: string
  hojas:    HojaVehiculo[]
}

/** Cuántas unidades se imprimirían por sucursal, para el selector. */
export function unidadesPorSucursal(
  incidencias: IncidenciaConVehiculo[], combustibles: CombustibleBajo[],
): Map<string, Set<number>> {
  const r = new Map<string, Set<number>>()
  const sumar = (suc: string, id: number) => r.set(suc, (r.get(suc) ?? new Set()).add(id))
  for (const i of incidenciasParaFicha(incidencias)) sumar(i.vehiculo_sucursal ?? SIN_SUCURSAL, i.vehiculo_id)
  for (const c of combustibles) sumar(c.sucursal, c.vehiculo_id)
  return r
}

export function ordenarSucursales(a: string, b: string): number {
  return a === SIN_SUCURSAL ? 1 : b === SIN_SUCURSAL ? -1 : a.localeCompare(b, 'es-MX')
}

// Sucursales en orden alfabético, con las unidades sin base al final: son las
// que no se reparten en ningún patio en particular.
function agrupar(
  incidencias: IncidenciaConVehiculo[], combustibles: CombustibleBajo[],
): GrupoSucursal[] {
  const porSucursal = new Map<string, Map<number, HojaVehiculo>>()
  const hojaDe = (suc: string, id: number, nombre: string, placas: string | null) => {
    const hojas = porSucursal.get(suc) ?? new Map<number, HojaVehiculo>()
    porSucursal.set(suc, hojas)
    const hoja = hojas.get(id) ?? {
      vehiculo_id: id, vehiculo_nombre: nombre, placas, tuyas: [], avisos: [], combustible: null,
    }
    hojas.set(id, hoja)
    return hoja
  }

  for (const i of incidenciasParaFicha(incidencias)) {
    const hoja = hojaDe(i.vehiculo_sucursal ?? SIN_SUCURSAL, i.vehiculo_id, i.vehiculo_nombre, i.vehiculo_placas)
    ;(esDelChofer(i) ? hoja.tuyas : hoja.avisos).push(i)
  }
  for (const c of combustibles) {
    hojaDe(c.sucursal, c.vehiculo_id, c.vehiculo_nombre, c.placas).combustible = c
  }

  return [...porSucursal.entries()]
    .sort(([a], [b]) => ordenarSucursales(a, b))
    .map(([sucursal, hojas]) => ({
      sucursal,
      hojas: [...hojas.values()]
        .sort((a, b) => a.vehiculo_nombre.localeCompare(b.vehiculo_nombre, 'es-MX'))
        .map((h) => ({
          ...h,
          // Lo suyo, de lo más viejo a lo más nuevo: es lo que más tiempo lleva
          // esperando. Lo del taller, lo más grave primero: es lo que más le
          // importa saber antes de arrancar.
          tuyas: [...h.tuyas].sort((a, b) => a.fecha.localeCompare(b.fecha)),
          avisos: [...h.avisos].sort((a, b) =>
            ORDEN_SEVERIDAD[a.severidad] - ORDEN_SEVERIDAD[b.severidad] || a.fecha.localeCompare(b.fecha)),
        })),
    }))
}

/**
 * El título de cada parte de la hoja. `subseccion` deja solo 2 mm abajo —está
 * pensada para ir pegada a una tabla— y aquí lo que sigue es un párrafo, que
 * se encimaba con el título. Se deja el espacio de una línea.
 */
function tituloDeParte(pdf: Awaited<ReturnType<typeof crearReportePdf>>, texto: string) {
  pdf.subseccion(texto)
  pdf.espacio(5)
}

/**
 * Genera el PDF. `incidencias` y `combustibles` ya vienen filtrados a lo que se
 * quiere imprimir (una sucursal o todas).
 */
export async function exportFichaChoferPdf(
  incidencias: IncidenciaConVehiculo[], combustibles: CombustibleBajo[], etiqueta: string,
) {
  const grupos = agrupar(incidencias, combustibles)
  const unidades = grupos.reduce((s, g) => s + g.hojas.length, 0)

  const pdf = await crearReportePdf({
    titulo: 'Ficha de revisión para choferes',
    subtitulo: `${etiqueta} · ${unidades} unidad${unidades !== 1 ? 'es' : ''}`,
  })

  if (unidades === 0) {
    pdf.vacio('Ninguna unidad trae incidencias abiertas ni el tanque bajo.')
    pdf.guardar(`ficha-choferes-${hoyISO()}`)
    return
  }

  // Primera hoja: el índice de lo que se va a repartir, por sucursal.
  for (const g of grupos) {
    pdf.seccion(g.sucursal)
    pdf.tabla({
      head: ['Vehículo', 'Placas', 'Le toca', 'Para avisarle'],
      body: g.hojas.map((h) => [
        h.vehiculo_nombre, h.placas ?? '—',
        h.tuyas.length + (h.combustible ? 1 : 0), h.avisos.length,
      ]),
      columnStyles: {
        2: { halign: 'center', cellWidth: 22 },
        3: { halign: 'center', cellWidth: 28 },
      },
      fontSize: 9,
    })
  }

  for (const g of grupos) {
    for (const h of g.hojas) {
      pdf.nuevaPagina()
      pdf.seccion(
        h.vehiculo_nombre,
        `${g.sucursal}${h.placas ? ` · Placas ${h.placas}` : ''}`,
      )

      // ── Lo que le toca ──
      const tareas: (string | number)[][] = h.tuyas.map((i) =>
        ['', i.nombre, i.descripcion ?? '', formatFecha(i.fecha)])
      if (h.combustible) {
        tareas.unshift([
          '', 'Cargar combustible',
          `El chequeo la recibió con ${h.combustible.valor} de tanque. Carga antes de salir a ruta.`,
          formatFecha(h.combustible.fecha),
        ])
      }

      tituloDeParte(pdf, 'Lo que te toca resolver')
      if (tareas.length) {
        pdf.parrafo(
          'Estos puntos los puedes resolver tú, sin taller: rellenar niveles, cargar combustible, ' +
          'traer lo que falta a bordo. Marca cada uno cuando quede listo y entrega la hoja. El ' +
          'siguiente chequeo diario lo confirma y lo cierra.',
        )
        pdf.tabla({
          head: ['Listo', 'Punto a revisar', 'Detalle', 'Desde'],
          body: tareas,
          columnStyles: {
            0: { cellWidth: 14, minCellHeight: 10 },
            1: { cellWidth: 55, fontStyle: 'bold' },
            3: { cellWidth: 26 },
          },
          // La casilla se dibuja como un cuadro vacío para palomearlo a mano.
          didParseCell: (c) => {
            if (c.section === 'body' && c.column.index === 0) c.cell.text = ['[   ]']
          },
          fontSize: 10,
        })
      } else {
        pdf.nota('Por ahora no hay nada que te toque resolver en esta unidad.')
      }

      // ── Lo que solo se le avisa ──
      if (h.avisos.length) {
        pdf.espacio(4)
        tituloDeParte(pdf, 'Para que estés enterado')
        pdf.parrafo(
          'Esto lo atiende el taller y no tienes que resolverlo, pero es tu unidad: tenlo en ' +
          'cuenta al manejarla. Si empeora o notas algo nuevo, avísale a tu supervisor.',
        )
        if (h.avisos.some((i) => i.severidad === 'grave')) {
          pdf.nota(
            'Hay puntos GRAVES. Si te parece que la unidad no está para salir, avísale a tu ' +
            'supervisor antes de salir a ruta.',
          )
        }
        pdf.tabla({
          head: ['Gravedad', 'Punto', 'Detalle', 'Desde'],
          body: h.avisos.map((i) => [
            SEVERIDAD_META[i.severidad].label, i.nombre, i.descripcion ?? '', formatFecha(i.fecha),
          ]),
          columnStyles: {
            0: { cellWidth: 24 },
            1: { cellWidth: 50, fontStyle: 'bold' },
            3: { cellWidth: 26 },
          },
          // Lo grave se tiene que ver de lejos, aunque la hoja salga en blanco y negro.
          didParseCell: (c) => {
            if (c.section === 'body' && c.column.index === 0 && c.cell.raw === SEVERIDAD_META.grave.label) {
              c.cell.styles.fontStyle = 'bold'
              c.cell.styles.textColor = [200, 30, 30]
            }
          },
          fontSize: 9,
        })
      }

      pdf.espacio(6)
      pdf.parrafo('Chofer: ________________________________     Fecha: ______________')
      pdf.espacio(2)
      pdf.parrafo('Firma: ________________________________')
    }
  }

  pdf.guardar(`ficha-choferes-${hoyISO()}`)
}
