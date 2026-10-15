// Pestaña "Sin reportar" de Facturas de gas: las recargas que aparecieron al
// cuadrar la factura porque nadie las había capturado, y los vales que el
// encargado tampoco registró. Es la lista que se le lleva a cada uno. Se llena
// con "Registrar recarga no reportada" en el cuadre. Ver la migración 069.
import { useState } from 'react'
import {
  Alert, Badge, Button, Card, Center, Group, Loader, SegmentedControl, Stack, Table, Text,
} from '@mantine/core'
import { IconFileSpreadsheet, IconFileTypePdf } from '@tabler/icons-react'
import { useSinReportar } from '../hooks/useFacturasGasolina'
import { FechaInput } from './FechaInput'
import { formatFecha, formatLitros, formatMXN } from '../lib/formato'
import {
  exportSinReportarExcel, exportSinReportarPdf, porChofer, porEncargado,
} from '../lib/reportes/sinReportar'
import type { GrupoOmision } from '../lib/reportes/sinReportar'

type Vista = 'chofer' | 'encargado'

export default function SinReportarPanel() {
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [vista, setVista] = useState<Vista>('chofer')
  const [generando, setGenerando] = useState<'pdf' | 'excel' | null>(null)
  const [errorExport, setErrorExport] = useState<string | null>(null)

  const filtros = { desde: desde || undefined, hasta: hasta || undefined }
  const { data, isLoading, isError } = useSinReportar(filtros)
  const items = data?.data ?? []
  const choferes = porChofer(items)
  const encargados = porEncargado(items)
  const vales = encargados.reduce((s, g) => s + g.items.length, 0)
  const grupos = vista === 'chofer' ? choferes : encargados

  async function generar(formato: 'pdf' | 'excel') {
    setErrorExport(null)
    setGenerando(formato)
    try {
      if (formato === 'pdf') await exportSinReportarPdf(items, filtros.desde, filtros.hasta)
      else await exportSinReportarExcel(items)
    } catch (e) {
      setErrorExport((e as Error).message || 'No se pudo generar el reporte')
    } finally {
      setGenerando(null)
    }
  }

  return (
    <Stack gap="md">
      <Text size="sm" c="dimmed">
        Recargas que el chofer no reportó y salieron al cuadrar la factura de la gasolinera, y los
        vales que el encargado tampoco registró. Se agregan desde el cuadre, con
        "Registrar recarga no reportada".
      </Text>

      <Group gap="sm" align="flex-end" wrap="wrap">
        <FechaInput label="Desde" clearable value={desde} onChange={setDesde} style={{ width: 160 }} />
        <FechaInput label="Hasta" clearable value={hasta} onChange={setHasta} style={{ width: 160 }} />
        <Group gap="xs" ml="auto">
          <Button
            variant="light" leftSection={<IconFileSpreadsheet size={16} />}
            loading={generando === 'excel'} disabled={generando !== null || items.length === 0}
            onClick={() => generar('excel')}
          >
            Excel
          </Button>
          <Button
            leftSection={<IconFileTypePdf size={16} />}
            loading={generando === 'pdf'} disabled={generando !== null || items.length === 0}
            onClick={() => generar('pdf')}
          >
            PDF
          </Button>
        </Group>
      </Group>
      {errorExport && <Alert color="red" title="Error">{errorExport}</Alert>}

      {isError ? (
        <Alert color="red" title="Error">No se pudieron cargar las recargas sin reportar.</Alert>
      ) : isLoading ? (
        <Center py="xl"><Loader /></Center>
      ) : items.length === 0 ? (
        <Center py="xl">
          <Text c="dimmed">
            {desde || hasta ? 'Nada sin reportar en esas fechas.' : 'No hay recargas sin reportar.'}
          </Text>
        </Center>
      ) : (
        <>
          <Group gap="sm">
            <Card withBorder padding="xs" style={{ flex: 1, minWidth: 130 }}>
              <Text size="xs" c="dimmed">Recargas sin reportar</Text>
              <Text size="lg" fw={700}>{items.length}</Text>
            </Card>
            <Card withBorder padding="xs" style={{ flex: 1, minWidth: 130 }}>
              <Text size="xs" c="dimmed">Vales sin registrar</Text>
              <Text size="lg" fw={700}>{vales}</Text>
            </Card>
            <Card withBorder padding="xs" style={{ flex: 1, minWidth: 130 }}>
              <Text size="xs" c="dimmed">Lo que suman</Text>
              <Text size="lg" fw={700}>{formatMXN(items.reduce((s, r) => s + r.costo, 0))}</Text>
            </Card>
          </Group>

          <SegmentedControl
            value={vista}
            onChange={(v) => setVista(v as Vista)}
            data={[
              { value: 'chofer', label: `Por chofer (${choferes.length})` },
              { value: 'encargado', label: `Por encargado (${encargados.length})` },
            ]}
          />

          {grupos.length === 0 ? (
            <Text size="sm" c="dimmed" ta="center" py="sm">
              Todos los vales de estas recargas estaban registrados.
            </Text>
          ) : grupos.map((g) => <Grupo key={g.clave} g={g} vista={vista} />)}
        </>
      )}
    </Stack>
  )
}

function Grupo({ g, vista }: { g: GrupoOmision; vista: Vista }) {
  return (
    <Stack gap={4}>
      <Group justify="space-between">
        <Text fw={600}>
          {g.nombre}
          {g.detalle && <Text span size="xs" c="dimmed" fw={400}> · {g.detalle}</Text>}
        </Text>
        <Text size="sm" c="dimmed">
          {g.items.length} {vista === 'chofer'
            ? `recarga${g.items.length !== 1 ? 's' : ''} · ${formatLitros(g.litros)} L · ${formatMXN(g.costo)}`
            : `vale${g.items.length !== 1 ? 's' : ''}`}
        </Text>
      </Group>
      <Table.ScrollContainer minWidth={700}>
        <Table withTableBorder striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th style={{ width: 110 }}>Fecha</Table.Th>
              <Table.Th>{vista === 'chofer' ? 'Unidad' : 'Chofer y unidad'}</Table.Th>
              <Table.Th>Gasolinera</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Litros</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Costo</Table.Th>
              <Table.Th>Vale</Table.Th>
              <Table.Th>Factura</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {g.items.map((r) => (
              <Table.Tr key={r.recarga_id}>
                <Table.Td><Text size="sm">{formatFecha(r.fecha)}</Text></Table.Td>
                <Table.Td>
                  {vista === 'encargado' && <Text size="sm">{r.conductor}</Text>}
                  <Text size={vista === 'encargado' ? 'xs' : 'sm'} c={vista === 'encargado' ? 'dimmed' : undefined}>
                    {r.vehiculo}{r.placas ? ` · ${r.placas}` : ''}
                  </Text>
                </Table.Td>
                <Table.Td><Text size="sm">{r.gasolinera ?? '—'}</Text></Table.Td>
                <Table.Td style={{ textAlign: 'right' }}><Text size="sm">{formatLitros(r.litros)}</Text></Table.Td>
                <Table.Td style={{ textAlign: 'right' }}><Text size="sm">{formatMXN(r.costo)}</Text></Table.Td>
                <Table.Td>
                  <Text size="sm">{r.vale_folio ?? '—'}</Text>
                  {r.vale_sin_registrar && vista === 'chofer' && (
                    <Badge size="xs" variant="light" color="grape">Vale sin registrar</Badge>
                  )}
                  {vista === 'encargado' && r.vale_fecha && (
                    <Text size="xs" c="dimmed">
                      Entregado {formatFecha(r.vale_fecha)}{r.sucursal ? ` · ${r.sucursal}` : ''}
                    </Text>
                  )}
                </Table.Td>
                <Table.Td><Text size="sm">{r.factura_folio}</Text></Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Stack>
  )
}
