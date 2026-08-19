// Modal de reportes del tablero.
//
// Antes había dos botones sueltos en la cabecera —Excel y PDF— que siempre
// sacaban lo mismo, sin importar qué se estuviera viendo. Con cuatro pestañas y
// un reporte de flota que ahora se puede acotar, eso ya no cabía en la barra
// superior sin volverla ilegible.
//
// Aquí se decide una sola cosa: **qué** se reporta y **de qué parte de la
// flota**. El formato es lo último que se elige, porque es lo que menos se
// piensa: PDF para imprimir y firmar, Excel para seguirle sacando cuentas.
import { useState } from 'react'
import {
  Alert, Button, Divider, Group, Modal, Select, Stack, Text,
} from '@mantine/core'
import {
  IconAlertTriangle, IconFileSpreadsheet, IconFileTypePdf, IconTruck,
} from '@tabler/icons-react'
import type {
  ResumenMes, DocumentosPorVencer, AnalisisCostos, PeriodoComparacion,
} from '../hooks/useDashboard'
import {
  fetchReporteFlota, fetchResumen, fetchAnalisisCostos, fetchDocumentosPorVencer,
} from '../hooks/useDashboard'
import type { Sucursal } from '../hooks/useSucursales'
import { exportResumenPdf, exportResumenExcel } from '../lib/reportes/resumen'
import { exportCostosPdf, exportCostosExcel } from '../lib/reportes/costos'
import { exportVencimientosPdf, exportVencimientosExcel } from '../lib/reportes/vencimientos'
import { exportPendientesPdf, exportPendientesExcel, type DatosPendientes } from '../lib/reportes/pendientes'
import {
  exportReporteFlotaPdf, exportReporteFlotaExcel, etiquetaFiltro, type FiltroFlota,
} from '../lib/reportes/flota'
import { TIPO_LABELS } from '../lib/tipoVehiculo'
import SelectorPeriodoReporte from './SelectorPeriodoReporte'
import { type Periodo, periodoValido, PERIODO_DEFAULT } from '../lib/reportes/periodo'

type Formato = 'pdf' | 'excel'

// Etiquetas de cada pestaña dentro del modal. Se nombra lo que contiene el
// reporte, no la pestaña: quien lo abre desde "Pendientes" ya sabe dónde está,
// lo que necesita saber es qué se va a llevar.
// `default` nombra la ventana de siempre de cada reporte —la que se ve en el
// tablero— para que la opción por omisión del selector diga qué trae, en vez de
// un "Predeterminado" que no explica nada. `fechable` marca los reportes que
// admiten periodo: los pendientes no, porque son el estado de hoy y no algo que
// ocurrió entre dos fechas.
const PESTANA: Record<string, {
  titulo: string; descripcion: string; default: string; fechable: boolean
}> = {
  resumen: {
    titulo: 'Resumen de costos',
    descripcion: 'Costos del periodo, mantenimientos por vehículo y refacciones compradas.',
    default: 'Últimos 30 días (lo que ves en el tablero)',
    fechable: true,
  },
  costos: {
    titulo: 'Costos y ahorro',
    descripcion: 'Ahorro identificado, costo por kilómetro, rendimiento por unidad, retrabajos y cargas a revisar.',
    default: 'Ventana del tablero',
    fechable: true,
  },
  vencimientos: {
    titulo: 'Vencimientos',
    descripcion: 'Seguros, permisos, licencias y tenencias por vencer, y unidades sin documentos.',
    default: 'Lo que urge (30 días; licencias, 2 meses)',
    fechable: true,
  },
  pendientes: {
    titulo: 'Pendientes de mantenimiento',
    descripcion: 'Requerimientos vencidos y por vencer agrupados por unidad, e incidencias sin atender.',
    default: 'Estado de hoy',
    fechable: false,
  },
}

const VALOR_TODA = 'toda'

// El alcance se codifica en el value del Select ("suc-3", "tipo-utilitario")
// porque Mantine maneja strings; se decodifica aquí de vuelta al filtro.
function decodificarAlcance(valor: string | null): FiltroFlota {
  if (!valor || valor === VALOR_TODA) return { modo: 'toda' }
  if (valor.startsWith('suc-'))  return { modo: 'sucursal', sucursalId: Number(valor.slice(4)) }
  if (valor.startsWith('tipo-')) return { modo: 'tipo', tipo: valor.slice(5) }
  return { modo: 'toda' }
}

export default function ReportesDashboardModal({
  opened, onClose, tab, resumen, documentos, pendientes, analisis, sucursales,
}: {
  opened:      boolean
  onClose:     () => void
  tab:         string
  resumen?:    ResumenMes
  documentos?: DocumentosPorVencer
  pendientes:  DatosPendientes
  analisis?:   AnalisisCostos
  sucursales:  Sucursal[]
}) {
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [error, setError]     = useState<string | null>(null)
  const [alcance, setAlcance] = useState<string>(VALOR_TODA)
  const [periodo, setPeriodo] = useState<PeriodoComparacion>('mes')
  // Cada bloque lleva su propio periodo: el de la pestaña y el de la flota son
  // reportes distintos y casi nunca se piden por el mismo corte.
  const [rangoTab, setRangoTab]     = useState<Periodo>(PERIODO_DEFAULT)
  const [rangoFlota, setRangoFlota] = useState<Periodo>(PERIODO_DEFAULT)

  const meta = PESTANA[tab] ?? PESTANA.resumen

  // Un reporte de una pestaña cuyos datos no han llegado saldría en blanco: se
  // deshabilita hasta que hay algo que imprimir.
  // Con un periodo elegido los datos se vuelven a pedir a la API, así que no
  // depende de lo que ya cargó el tablero; sin él, un reporte de una pestaña
  // que aún no llega saldría en blanco.
  const rangoPropio = rangoTab.modo !== 'default'
  const datosListos = rangoPropio || (
    tab === 'resumen'      ? !!resumen
    : tab === 'costos'     ? !!analisis
    : tab === 'vencimientos' ? !!documentos
    : true)

  async function correr(clave: string, fn: () => Promise<void>) {
    setOcupado(clave)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError((e as Error).message || 'No se pudo generar el reporte.')
    } finally {
      setOcupado(null)
    }
  }

  function reportePestana(formato: Formato) {
    return correr(`tab-${formato}`, async () => {
      const pdf = formato === 'pdf'
      switch (tab) {
        case 'costos': {
          // Con periodo propio se vuelve a consultar; sin él se usa lo que el
          // tablero ya tiene y no se gasta otra petición.
          const datos = rangoPropio ? (await fetchAnalisisCostos(rangoTab)).data : analisis
          if (datos) await (pdf ? exportCostosPdf : exportCostosExcel)(datos)
          break
        }
        case 'vencimientos': {
          const datos = rangoPropio ? (await fetchDocumentosPorVencer(rangoTab)).data : documentos
          await (pdf ? exportVencimientosPdf : exportVencimientosExcel)(datos, rangoTab)
          break
        }
        case 'pendientes':
          await (pdf ? exportPendientesPdf : exportPendientesExcel)(pendientes)
          break
        default: {
          const datos = rangoPropio ? (await fetchResumen(rangoTab)).data : resumen
          if (datos) await (pdf ? exportResumenPdf : exportResumenExcel)(datos)
        }
      }
    })
  }

  function reporteFlota(formato: Formato) {
    return correr(`flota-${formato}`, async () => {
      // Se pide al momento: agrega la flota completa y solo hace falta aquí.
      const reporte = await fetchReporteFlota(periodo, rangoFlota)
      const filtro = decodificarAlcance(alcance)
      const fn = formato === 'pdf' ? exportReporteFlotaPdf : exportReporteFlotaExcel
      await fn(reporte.data, sucursales, filtro)
    })
  }

  const opcionesAlcance = [
    { value: VALOR_TODA, label: 'Flota completa' },
    ...sucursales.map((s) => ({ value: `suc-${s.id}`, label: `Sucursal: ${s.nombre}` })),
    ...Object.entries(TIPO_LABELS).map(([tipo, label]) => ({ value: `tipo-${tipo}`, label: `Solo ${label.toLowerCase()}` })),
  ]

  const filtroActual = decodificarAlcance(alcance)

  // Un rango a medio escribir no se puede pedir: el botón espera a que estén
  // las dos fechas en vez de mandar una petición que la API va a rechazar.
  const tabListo    = datosListos && periodoValido(rangoTab)
  const flotaLista  = periodoValido(rangoFlota)

  return (
    <Modal opened={opened} onClose={onClose} title="Generar reporte" size="lg" centered>
      <Stack gap="lg">
        {error && (
          <Alert color="red" icon={<IconAlertTriangle size={16} />} title="No se pudo generar">
            {error}
          </Alert>
        )}

        {/* ── Reporte de la pestaña que se está viendo ── */}
        <Stack gap="xs">
          <div>
            <Text fw={600}>{meta.titulo}</Text>
            <Text size="xs" c="dimmed">{meta.descripcion}</Text>
          </div>
          {!datosListos && (
            <Text size="xs" c="dimmed">Todavía se están cargando los datos de esta pestaña…</Text>
          )}

          {meta.fechable ? (
            <SelectorPeriodoReporte
              value={rangoTab}
              onChange={setRangoTab}
              etiquetaDefault={meta.default}
              disabled={ocupado !== null}
            />
          ) : (
            <Text size="xs" c="dimmed">
              Este reporte no lleva periodo: es el estado de la flota hoy —lo que está vencido y lo
              que sigue abierto—, no lo que pasó entre dos fechas.
            </Text>
          )}

          <Group gap="xs">
            <Button
              variant="light" leftSection={<IconFileTypePdf size={16} />}
              loading={ocupado === 'tab-pdf'} disabled={!tabListo || ocupado !== null}
              onClick={() => reportePestana('pdf')}
            >
              PDF
            </Button>
            <Button
              variant="light" color="green" leftSection={<IconFileSpreadsheet size={16} />}
              loading={ocupado === 'tab-excel'} disabled={!tabListo || ocupado !== null}
              onClick={() => reportePestana('excel')}
            >
              Excel
            </Button>
          </Group>
        </Stack>

        <Divider />

        {/* ── Reporte de flota, acotable ── */}
        <Stack gap="xs">
          <div>
            <Group gap={6}>
              <IconTruck size={16} />
              <Text fw={600}>Reporte de flota</Text>
            </Group>
            <Text size="xs" c="dimmed">
              Inventario con costos, kilometraje y pendientes de cada unidad, agrupado por ubicación.
              Puede acotarse a una sucursal o a un solo tipo de vehículo.
            </Text>
          </div>

          <Group grow align="flex-end">
            <Select
              label="Alcance"
              data={opcionesAlcance}
              value={alcance}
              onChange={(v) => setAlcance(v ?? VALOR_TODA)}
              disabled={ocupado !== null}
              searchable
              comboboxProps={{ withinPortal: true }}
            />
            <Select
              label="Comparar contra"
              data={[
                { value: 'mes',    label: 'Mes pasado' },
                { value: 'semana', label: 'Semana pasada' },
              ]}
              value={periodo}
              onChange={(v) => setPeriodo((v as PeriodoComparacion) ?? 'mes')}
              // Con un periodo elegido la comparación sale de él —2025 contra
              // 2024, una quincena contra la anterior—, así que este control
              // dejaría de significar nada: es el atajo del caso por omisión.
              disabled={ocupado !== null || filtroActual.modo !== 'toda' || rangoFlota.modo !== 'default'}
              description={rangoFlota.modo !== 'default' ? 'Lo define el periodo' : undefined}
              comboboxProps={{ withinPortal: true }}
            />
          </Group>

          <SelectorPeriodoReporte
            value={rangoFlota}
            onChange={setRangoFlota}
            etiquetaDefault="Mes en curso"
            disabled={ocupado !== null}
          />

          {rangoFlota.modo !== 'default' && (
            <Alert color="gray" variant="light" p="xs">
              <Text size="xs">
                La comparación de requerimientos vencidos se mide contra el periodo inmediato
                anterior del mismo largo — un año contra el año previo, una quincena contra la
                quincena previa. Si el periodo ya cerró, el conteo es el que se registró al cierre y
                no el de hoy; el reporte lo indica.
              </Text>
            </Alert>
          )}

          {filtroActual.modo !== 'toda' && (
            <Alert color="gray" variant="light" p="xs">
              <Text size="xs">
                El reporte de <strong>{etiquetaFiltro(filtroActual, sucursales)}</strong> suma solo esas
                unidades. Las refacciones compradas no aparecen: los lotes entran al almacén general y
                no pertenecen a una sucursal ni a un tipo. La comparación contra el periodo anterior
                tampoco, porque solo se lleva para la flota completa.
              </Text>
            </Alert>
          )}

          <Group gap="xs">
            <Button
              variant="light" leftSection={<IconFileTypePdf size={16} />}
              loading={ocupado === 'flota-pdf'} disabled={!flotaLista || ocupado !== null}
              onClick={() => reporteFlota('pdf')}
            >
              PDF
            </Button>
            <Button
              variant="light" color="green" leftSection={<IconFileSpreadsheet size={16} />}
              loading={ocupado === 'flota-excel'} disabled={!flotaLista || ocupado !== null}
              onClick={() => reporteFlota('excel')}
            >
              Excel
            </Button>
          </Group>
        </Stack>
      </Stack>
    </Modal>
  )
}
