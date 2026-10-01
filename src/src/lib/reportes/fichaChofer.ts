// La ficha que se le entrega al chofer: lo que su unidad tiene abierto y él
// mismo puede resolver —el extintor, los papeles, la basura de la cabina—.
//
// Una hoja por unidad, porque cada chofer se lleva solo la suya, y las hojas
// agrupadas por sucursal, porque es en el patio de cada sucursal donde se
// reparten.
//
// QUÉ ENTRA NO LO DECIDE LA GRAVEDAD. "Superficial" dice qué tan urgente es, no
// quién lo arregla: un espejo que falta es superficial y hay que comprarlo y
// montarlo en el taller. Entran las preguntas del chequeo que el catálogo marca
// con `cierreAutomatico` —lo que se arregla sin taller ni refacción—, que son
// también las que el chequeo diario cierra solo cuando las encuentra bien. Así
// la hoja y el cierre no se pueden desalinear: lo que se le pide al chofer es
// justo lo que el siguiente chequeo confirma y cierra.
//
// Por eso una incidencia capturada a mano entra solo si dice de qué punto del
// chequeo es (`clave_chequeo`): sin eso no hay forma de saber si la arregla el
// chofer o el taller.
import type { IncidenciaConVehiculo } from '../../hooks/useIncidencias'
import { ITEMS_CHEQUEO } from '../chequeoItems'
import { crearReportePdf, hoyISO } from './pdfDoc'
import { formatFecha } from '../formato'

export const SIN_SUCURSAL = 'Sin sucursal fija'

const LAS_ARREGLA_EL_CHOFER = new Set(
  ITEMS_CHEQUEO.filter((i) => i.cierreAutomatico).map((i) => i.clave)
)

/** Lo que entra en la ficha: abierto y de algo que el chofer puede resolver. */
export function incidenciasParaFicha(incidencias: IncidenciaConVehiculo[]): IncidenciaConVehiculo[] {
  return incidencias.filter((i) =>
    i.status === 'activo' && i.clave_chequeo != null && LAS_ARREGLA_EL_CHOFER.has(i.clave_chequeo))
}

interface HojaVehiculo {
  vehiculo_nombre: string
  placas:          string | null
  incidencias:     IncidenciaConVehiculo[]
}

interface GrupoSucursal {
  sucursal: string
  hojas:    HojaVehiculo[]
}

// Sucursales en orden alfabético, con las unidades sin base al final: son las
// que no se reparten en ningún patio en particular.
function agrupar(incidencias: IncidenciaConVehiculo[]): GrupoSucursal[] {
  const porSucursal = new Map<string, Map<number, HojaVehiculo>>()
  for (const i of incidencias) {
    const suc = i.vehiculo_sucursal ?? SIN_SUCURSAL
    const hojas = porSucursal.get(suc) ?? new Map<number, HojaVehiculo>()
    const hoja = hojas.get(i.vehiculo_id) ?? {
      vehiculo_nombre: i.vehiculo_nombre, placas: i.vehiculo_placas, incidencias: [],
    }
    hoja.incidencias.push(i)
    hojas.set(i.vehiculo_id, hoja)
    porSucursal.set(suc, hojas)
  }
  return [...porSucursal.entries()]
    .sort(([a], [b]) =>
      a === SIN_SUCURSAL ? 1 : b === SIN_SUCURSAL ? -1 : a.localeCompare(b, 'es-MX'))
    .map(([sucursal, hojas]) => ({
      sucursal,
      hojas: [...hojas.values()]
        .sort((a, b) => a.vehiculo_nombre.localeCompare(b.vehiculo_nombre, 'es-MX'))
        // Lo más viejo arriba: es lo que más tiempo lleva esperando.
        .map((h) => ({ ...h, incidencias: [...h.incidencias].sort((a, b) => a.fecha.localeCompare(b.fecha)) })),
    }))
}

/**
 * Genera el PDF. `incidencias` ya viene filtrado a lo que se quiere imprimir
 * (una sucursal o todas); aquí solo se queda lo superficial y abierto.
 */
export async function exportFichaChoferPdf(incidencias: IncidenciaConVehiculo[], etiqueta: string) {
  const grupos = agrupar(incidenciasParaFicha(incidencias))
  const unidades = grupos.reduce((s, g) => s + g.hojas.length, 0)

  const pdf = await crearReportePdf({
    titulo: 'Ficha de revisión para choferes',
    subtitulo: `${etiqueta} · ${unidades} unidad${unidades !== 1 ? 'es' : ''}`,
  })

  if (unidades === 0) {
    pdf.vacio('No hay incidencias abiertas que pueda resolver el chofer.')
    pdf.guardar(`ficha-choferes-${hoyISO()}`)
    return
  }

  // Primera hoja: el índice de lo que se va a repartir, por sucursal.
  for (const g of grupos) {
    pdf.seccion(g.sucursal)
    pdf.tabla({
      head: ['Vehículo', 'Placas', 'Puntos'],
      body: g.hojas.map((h) => [h.vehiculo_nombre, h.placas ?? '—', h.incidencias.length]),
      columnStyles: { 2: { halign: 'center', cellWidth: 20 } },
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
      pdf.parrafo(
        'Revisa estos puntos de tu unidad y resuélvelos si está en tus manos. Marca cada uno ' +
        'cuando quede listo y entrega la hoja. El siguiente chequeo diario lo confirma y cierra ' +
        'la incidencia.',
      )
      pdf.tabla({
        head: ['Listo', 'Punto a revisar', 'Detalle', 'Desde'],
        body: h.incidencias.map((i) => ['', i.nombre, i.descripcion ?? '', formatFecha(i.fecha)]),
        columnStyles: {
          0: { cellWidth: 14, minCellHeight: 10 },
          1: { cellWidth: 60, fontStyle: 'bold' },
          3: { cellWidth: 26 },
        },
        // La casilla se dibuja como un cuadro vacío para palomearlo a mano.
        didParseCell: (c) => {
          if (c.section === 'body' && c.column.index === 0) c.cell.text = ['[   ]']
        },
        fontSize: 10,
      })
      pdf.espacio(6)
      pdf.parrafo('Chofer: ________________________________     Fecha: ______________')
      pdf.espacio(2)
      pdf.parrafo('Firma: ________________________________')
    }
  }

  pdf.guardar(`ficha-choferes-${hoyISO()}`)
}
