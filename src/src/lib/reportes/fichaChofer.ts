// La ficha que se le entrega al chofer: lo superficial que su unidad tiene
// abierto, para que lo revise y lo resuelva él mismo —el extintor, los
// papeles, la basura de la cabina—.
//
// Una hoja por unidad, porque cada chofer se lleva solo la suya, y las hojas
// agrupadas por sucursal, porque es en el patio de cada sucursal donde se
// reparten. Lo moderado y lo grave no entra: eso va al taller, no a la cabina.
//
// La hoja no cierra nada sola. Lo que el chofer arregle lo confirma el chequeo
// diario, que es quien cierra la incidencia (ver `docs/chequeo-diario.md`).
import type { IncidenciaConVehiculo } from '../../hooks/useIncidencias'
import { crearReportePdf, hoyISO } from './pdfDoc'
import { formatFecha } from '../formato'

export const SIN_SUCURSAL = 'Sin sucursal fija'

/** Lo que entra en la ficha: superficial y todavía abierto. */
export function incidenciasParaFicha(incidencias: IncidenciaConVehiculo[]): IncidenciaConVehiculo[] {
  return incidencias.filter((i) => i.severidad === 'superficial' && i.status === 'activo')
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
    pdf.vacio('No hay incidencias superficiales abiertas.')
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
        'cuando quede listo y entrega la hoja. Lo confirma el siguiente chequeo diario.',
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
