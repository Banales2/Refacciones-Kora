// Mini reporte de la pestaña Vales: los vales que nadie ha gastado, por
// sucursal. Se elige una sucursal o todas, se ve el conteo y se descarga en PDF
// o Excel. Ver lib/reportes/valesSinUsar.
//
// Lee la misma consulta que la pestaña (sin archivados), así que al responsable
// solo le salen los vales que la API ya le deja ver.
import { useMemo, useState } from 'react'
import { Modal, Stack, Select, Table, Text, Group, Button, Alert, Loader, Center } from '@mantine/core'
import { IconFileTypePdf, IconFileSpreadsheet } from '@tabler/icons-react'
import { useValesGasolina } from '../hooks/useValesGasolina'
import {
  agruparPorSucursal, esSinUsar, sucursalDelVale,
  exportValesSinUsarPdf, exportValesSinUsarExcel,
} from '../lib/reportes/valesSinUsar'

const TODAS = '__todas__'

export default function ReporteValesSinUsarModal({
  opened, onClose,
}: {
  opened:  boolean
  onClose: () => void
}) {
  const { data, isLoading, isError } = useValesGasolina()
  const [sucursal, setSucursal] = useState<string>(TODAS)
  const [generando, setGenerando] = useState<'pdf' | 'excel' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const sinUsar = useMemo(() => (data?.data ?? []).filter(esSinUsar), [data])
  const todos = useMemo(() => agruparPorSucursal(sinUsar), [sinUsar])
  // Solo las sucursales que tienen algo pendiente: elegir una vacía daría un
  // reporte en blanco.
  const opciones = [
    { value: TODAS, label: 'Todas las sucursales' },
    ...todos.map((g) => ({ value: g.sucursal, label: `${g.sucursal} (${g.vales.length})` })),
  ]
  const elegida = sucursal === TODAS ? null : sucursal
  const vales = elegida ? sinUsar.filter((v) => sucursalDelVale(v) === elegida) : sinUsar
  const grupos = elegida ? todos.filter((g) => g.sucursal === elegida) : todos

  async function generar(formato: 'pdf' | 'excel') {
    setError(null)
    setGenerando(formato)
    try {
      await (formato === 'pdf' ? exportValesSinUsarPdf : exportValesSinUsarExcel)(vales, elegida)
    } catch (e) {
      setError((e as Error).message || 'No se pudo generar el reporte')
    } finally {
      setGenerando(null)
    }
  }

  return (
    <Modal opened={opened} onClose={onClose} title="Vales sin usar por sucursal" centered size="md">
      {isLoading ? (
        <Center py="xl"><Loader /></Center>
      ) : isError ? (
        <Alert color="red" title="Error al cargar">No se pudieron obtener los vales.</Alert>
      ) : (
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            Los vales entregados que todavía no se cargan: sin usar y perdidos. Los archivados no
            entran.
          </Text>
          <Select
            label="Sucursal"
            data={opciones}
            value={sucursal}
            onChange={(v) => setSucursal(v ?? TODAS)}
            allowDeselect={false}
          />

          {grupos.length === 0 ? (
            <Text size="sm" c="dimmed" ta="center" py="sm">
              No hay vales sin usar.
            </Text>
          ) : (
            <Table withTableBorder striped>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Sucursal</Table.Th>
                  <Table.Th ta="center">Sin usar</Table.Th>
                  <Table.Th ta="center">Perdidos</Table.Th>
                  <Table.Th ta="center">Total</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {grupos.map((g) => (
                  <Table.Tr key={g.sucursal}>
                    <Table.Td>{g.sucursal}</Table.Td>
                    <Table.Td ta="center">{g.sinUsar}</Table.Td>
                    <Table.Td ta="center" c={g.perdidos > 0 ? 'red' : undefined} fw={g.perdidos > 0 ? 600 : undefined}>
                      {g.perdidos}
                    </Table.Td>
                    <Table.Td ta="center" fw={500}>{g.vales.length}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}

          {error && <Alert color="red" title="Error">{error}</Alert>}
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>Cerrar</Button>
            <Button
              variant="light" leftSection={<IconFileSpreadsheet size={16} />}
              loading={generando === 'excel'} disabled={generando !== null || vales.length === 0}
              onClick={() => generar('excel')}
            >
              Excel
            </Button>
            <Button
              leftSection={<IconFileTypePdf size={16} />}
              loading={generando === 'pdf'} disabled={generando !== null || vales.length === 0}
              onClick={() => generar('pdf')}
            >
              PDF
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  )
}
