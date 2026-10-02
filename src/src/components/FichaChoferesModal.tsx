// Elegir de qué sucursal se imprime la ficha de los choferes: una hoja por
// unidad con lo que le toca resolver al chofer y lo que solo se le avisa. Ver
// `lib/reportes/fichaChofer.ts` para qué entra y por qué.
import { useMemo, useState } from 'react'
import { Modal, Stack, Select, Text, Alert, Group, Button } from '@mantine/core'
import { IconPrinter } from '@tabler/icons-react'
import type { IncidenciaConVehiculo } from '../hooks/useIncidencias'
import { useChequeosRango } from '../hooks/useChequeos'
import {
  DIAS_COMBUSTIBLE, SIN_SUCURSAL, combustibleBajo, exportFichaChoferPdf,
  incidenciasParaFicha, ordenarSucursales, unidadesPorSucursal,
} from '../lib/reportes/fichaChofer'
import { hoyISO } from '../lib/reportes/pdfDoc'

const TODAS = '__todas__'

// Hace `dias` días, en la fecha local (no UTC: recorrería el día en la tarde).
function haceDias(dias: number): string {
  const d = new Date()
  d.setDate(d.getDate() - dias)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function FichaChoferesModal({ incidencias, onClose }: {
  incidencias: IncidenciaConVehiculo[]
  onClose:     () => void
}) {
  const [sucursal, setSucursal] = useState(TODAS)
  const [generando, setGenerando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // De aquí sale cómo venía el tanque: el combustible no abre incidencia.
  const [desde] = useState(() => haceDias(DIAS_COMBUSTIBLE))
  const chequeosQuery = useChequeosRango({ desde, hasta: hoyISO() })
  const combustibles = useMemo(
    () => combustibleBajo(chequeosQuery.data?.data ?? []),
    [chequeosQuery.data],
  )

  const abiertas = incidenciasParaFicha(incidencias)
  const nombreSuc = (i: IncidenciaConVehiculo) => i.vehiculo_sucursal ?? SIN_SUCURSAL

  // Cuántas unidades entran por sucursal, para que la lista diga qué hay antes
  // de generar nada.
  const porSuc = unidadesPorSucursal(incidencias, combustibles)
  const total = new Set([...porSuc.values()].flatMap((s) => [...s])).size
  const opciones = [
    { value: TODAS, label: `Todas las sucursales (${total} unidades)` },
    ...[...porSuc.entries()]
      .sort(([a], [b]) => ordenarSucursales(a, b))
      .map(([s, set]) => ({ value: s, label: `${s} (${set.size} unidad${set.size !== 1 ? 'es' : ''})` })),
  ]

  async function generar() {
    setGenerando(true)
    setError(null)
    try {
      const todas = sucursal === TODAS
      await exportFichaChoferPdf(
        todas ? abiertas : abiertas.filter((i) => nombreSuc(i) === sucursal),
        todas ? combustibles : combustibles.filter((c) => c.sucursal === sucursal),
        todas ? 'Todas las sucursales' : sucursal,
      )
      onClose()
    } catch (e) {
      setError((e as Error).message || 'No se pudo generar el PDF.')
    } finally {
      setGenerando(false)
    }
  }

  return (
    <Modal opened onClose={onClose} title="Ficha para choferes" centered size="md">
      <Stack gap="sm">
        <Text size="sm" c="dimmed">
          Una hoja por unidad, agrupadas por sucursal. Arriba, con casilla, lo que el chofer
          resuelve sin taller: niveles de aceite, frenos, anticongelante, dirección y
          limpiaparabrisas, cargar combustible si trae un cuarto o menos, papeles, extintor,
          herramienta y basura. Abajo, para que esté enterado, todo lo demás que la unidad
          tiene abierto —llantas, luces, golpes— aunque lo atienda el taller.
        </Text>

        {/* Sin los chequeos la ficha sale igual, solo que sin el aviso de
            combustible: no tiene caso detener lo demás por eso. */}
        {chequeosQuery.isError && (
          <Alert color="yellow" variant="light">
            No se pudieron consultar los chequeos recientes: la ficha saldrá sin el aviso de
            combustible bajo.
          </Alert>
        )}

        {total === 0 && !chequeosQuery.isLoading ? (
          <Alert color="green" variant="light">
            Ninguna unidad trae incidencias abiertas ni el tanque bajo.
          </Alert>
        ) : (
          <Select
            label="Sucursal"
            data={opciones}
            value={sucursal}
            onChange={(v) => setSucursal(v ?? TODAS)}
            allowDeselect={false}
          />
        )}

        {error && <Alert color="red" title="Error">{error}</Alert>}

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} disabled={generando}>Cancelar</Button>
          <Button
            leftSection={<IconPrinter size={16} />}
            // Mientras llegan los chequeos se espera: generar antes dejaría
            // fuera el combustible sin avisar.
            loading={generando || chequeosQuery.isLoading}
            disabled={total === 0}
            onClick={generar}
          >
            Generar PDF
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
