// Elegir de qué sucursal se imprime la ficha de los choferes: lo superficial
// que cada unidad trae abierto, una hoja por unidad. Ver
// `lib/reportes/fichaChofer.ts`.
import { useState } from 'react'
import { Modal, Stack, Select, Text, Alert, Group, Button } from '@mantine/core'
import { IconPrinter } from '@tabler/icons-react'
import type { IncidenciaConVehiculo } from '../hooks/useIncidencias'
import { SIN_SUCURSAL, exportFichaChoferPdf, incidenciasParaFicha } from '../lib/reportes/fichaChofer'

const TODAS = '__todas__'

export default function FichaChoferesModal({ incidencias, onClose }: {
  incidencias: IncidenciaConVehiculo[]
  onClose:     () => void
}) {
  const [sucursal, setSucursal] = useState(TODAS)
  const [generando, setGenerando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const superficiales = incidenciasParaFicha(incidencias)
  const nombreSuc = (i: IncidenciaConVehiculo) => i.vehiculo_sucursal ?? SIN_SUCURSAL

  // Cuántas unidades entran por sucursal, para que la lista diga qué hay antes
  // de generar nada.
  const unidadesPorSuc = new Map<string, Set<number>>()
  for (const i of superficiales) {
    const set = unidadesPorSuc.get(nombreSuc(i)) ?? new Set<number>()
    set.add(i.vehiculo_id)
    unidadesPorSuc.set(nombreSuc(i), set)
  }
  const total = new Set(superficiales.map((i) => i.vehiculo_id)).size
  const opciones = [
    { value: TODAS, label: `Todas las sucursales (${total} unidades)` },
    ...[...unidadesPorSuc.entries()]
      .sort(([a], [b]) =>
        a === SIN_SUCURSAL ? 1 : b === SIN_SUCURSAL ? -1 : a.localeCompare(b, 'es-MX'))
      .map(([s, set]) => ({ value: s, label: `${s} (${set.size} unidad${set.size !== 1 ? 'es' : ''})` })),
  ]

  async function generar() {
    setGenerando(true)
    setError(null)
    try {
      const elegidas = sucursal === TODAS
        ? superficiales
        : superficiales.filter((i) => nombreSuc(i) === sucursal)
      await exportFichaChoferPdf(elegidas, sucursal === TODAS ? 'Todas las sucursales' : sucursal)
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
          Las incidencias <strong>superficiales</strong> que siguen abiertas —lo que el chofer puede
          resolver sin taller—, una hoja por unidad para entregársela a su chofer. Agrupadas por
          sucursal; las unidades sin base fija van al final.
        </Text>

        {total === 0 ? (
          <Alert color="green" variant="light">No hay incidencias superficiales abiertas.</Alert>
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
            loading={generando}
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
