// Qué días de una gasolinera están facturados.
//
// La factura de gasolinera solo trae su fecha de emisión: no dice qué días
// cobra. Lo que cubre se sabe por las recargas que casaron con ella, así que
// aquí se ponen las facturas en orden con su rango y, entre ellas, los tramos
// de cargas que ninguna cobra. Si se perdió una factura entera, sale como un
// hueco de varios días entre dos que sí.
//
// Ver `docs/facturas-de-gasolina.md`, "La cobertura".
import { useState } from 'react'
import {
  Alert, Anchor, Badge, Button, Card, Center, Group, Loader, Stack, Table, Text,
} from '@mantine/core'
import { IconAlertTriangle, IconClockHour4 } from '@tabler/icons-react'
import { useCoberturaGasolina } from '../hooks/useFacturasGasolina'
import type {
  FacturaEnCobertura, FacturaRef, HuecoDeCobertura,
} from '../hooks/useFacturasGasolina'
import { useGasolineras } from '../hooks/useGasolineras'
import { SelectCatalogo } from './SelectCatalogo'
import { FechaInput } from './FechaInput'
import { formatFecha, formatFechaCorta, formatMXN } from '../lib/formato'
import { hoyIso } from '../lib/fechas'

/** Cuántos días hacia atrás se ve al abrir la pestaña. */
const DIAS_POR_DEFECTO = 180

function haceDias(dias: number): string {
  const d = new Date()
  d.setDate(d.getDate() - dias)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function rango(desde: string, hasta: string): string {
  return desde === hasta ? `el ${formatFecha(desde)}` : `del ${formatFechaCorta(desde)} al ${formatFecha(hasta)}`
}

function cargas(n: number): string {
  return `${n} carga${n === 1 ? '' : 's'}`
}

function Folios({ fs, onAbrir }: { fs: FacturaRef[]; onAbrir: (id: number) => void }) {
  return (
    <>
      {fs.map((f, i) => (
        <span key={f.id}>
          {i > 0 && ', '}
          <Anchor component="button" size="sm" onClick={() => onAbrir(f.id)}>{f.folio}</Anchor>
        </span>
      ))}
    </>
  )
}

function FilaFactura({
  f, n, onAbrir,
}: { f: FacturaEnCobertura; n: number; onAbrir: (id: number) => void }) {
  return (
    <Card withBorder padding="sm">
      <Group justify="space-between" wrap="wrap" gap="xs">
        <div>
          <Group gap="xs">
            <Anchor component="button" fw={600} onClick={() => onAbrir(f.id)}>{f.folio}</Anchor>
            <Text size="xs" c="dimmed">emitida {formatFecha(f.fecha)}</Text>
          </Group>
          {f.cubre_desde && f.cubre_hasta ? (
            <Text size="sm">Cobra cargas {rango(f.cubre_desde, f.cubre_hasta)}</Text>
          ) : (
            <Text size="sm" c="orange.7">
              Sin renglones casados: no se sabe qué días cobra hasta conciliarla.
            </Text>
          )}
        </div>
        <Group gap="md" wrap="nowrap">
          <Text size="sm" c="dimmed">{cargas(n)}</Text>
          <Text size="sm" fw={600}>{formatMXN(f.total)}</Text>
          {f.conciliada
            ? <Badge color="green" variant="light">Conciliada</Badge>
            : <Badge color="gray" variant="light">Por conciliar {f.casados}/{f.renglones}</Badge>}
        </Group>
      </Group>
    </Card>
  )
}

function FilaHueco({ h, onAbrir }: { h: HuecoDeCobertura; onAbrir: (id: number) => void }) {
  const [abierto, setAbierto] = useState(false)
  const color = h.al_final ? 'blue' : 'red'
  return (
    <Card
      withBorder padding="sm"
      style={{ borderLeft: `4px solid var(--mantine-color-${color}-6)` }}
    >
      <Group justify="space-between" wrap="wrap" gap="xs" align="flex-start">
        <Stack gap={2}>
          <Group gap="xs">
            {h.al_final
              ? <IconClockHour4 size={16} color={`var(--mantine-color-${color}-6)`} />
              : <IconAlertTriangle size={16} color={`var(--mantine-color-${color}-6)`} />}
            <Text fw={600} size="sm">
              {h.al_final && h.antes
                ? `Por cobrar: ${cargas(h.tickets.length)} ${rango(h.desde, h.hasta)}`
                : h.al_final
                  ? `Ninguna factura cobra estas ${cargas(h.tickets.length)}, ${rango(h.desde, h.hasta)}`
                  : `Hueco ${rango(h.desde, h.hasta)}: ${cargas(h.tickets.length)} sin factura`}
            </Text>
          </Group>
          {h.al_final && h.antes ? (
            <Text size="sm" c="dimmed">
              Después de la última carga facturada ({h.antes.folio}). Lo normal es que
              la factura todavía no llegue.
            </Text>
          ) : h.antes && h.despues ? (
            <Text size="sm" c="dimmed">
              Entre <Folios fs={[h.antes]} onAbrir={onAbrir} /> y{' '}
              <Folios fs={[h.despues]} onAbrir={onAbrir} />.
            </Text>
          ) : h.despues ? (
            <Text size="sm" c="dimmed">
              Antes de <Folios fs={[h.despues]} onAbrir={onAbrir} />.
            </Text>
          ) : null}
          {h.abiertas.length > 0 && (
            <Text size="sm">
              Puede cobrarlas <Folios fs={h.abiertas} onAbrir={onAbrir} />, que falta conciliar:
              concíliala antes de dar el hueco por bueno.
            </Text>
          )}
        </Stack>
        <Group gap="md" wrap="nowrap">
          <Text size="sm" fw={600}>{formatMXN(h.costo)}</Text>
          <Button size="compact-xs" variant="subtle" onClick={() => setAbierto((a) => !a)}>
            {abierto ? 'Ocultar' : 'Ver cargas'}
          </Button>
        </Group>
      </Group>
      {abierto && (
        <Table mt="sm" striped withTableBorder fz="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Fecha</Table.Th>
              <Table.Th>Unidad</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Litros</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Costo</Table.Th>
              <Table.Th>Vale</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {h.tickets.map((t) => (
              <Table.Tr key={t.id}>
                <Table.Td>{formatFecha(t.fecha)}</Table.Td>
                <Table.Td>
                  <Text size="sm">{t.vehiculo}</Text>
                  <Text size="xs" c="dimmed">{t.conductor}</Text>
                </Table.Td>
                <Table.Td style={{ textAlign: 'right' }}>{t.litros}</Table.Td>
                <Table.Td style={{ textAlign: 'right' }}>{formatMXN(t.costo)}</Table.Td>
                <Table.Td>
                  <Text size="xs" c={t.vale_folio ? undefined : 'dimmed'}>{t.vale_folio ?? 'Sin vale'}</Text>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Card>
  )
}

export default function CoberturaGasolinaPanel({ onAbrir }: { onAbrir: (id: number) => void }) {
  const gasolineras = useGasolineras()
  const [gasolineraId, setGasolineraId] = useState<string | null>(null)
  const [desde, setDesde] = useState(() => haceDias(DIAS_POR_DEFECTO))
  const [hasta, setHasta] = useState(hoyIso)
  const gid = gasolineraId ? Number(gasolineraId) : null
  const { data, isLoading, isError } = useCoberturaGasolina(gid, desde, hasta)
  const c = data?.data

  return (
    <Stack gap="md">
      <Text size="sm" c="dimmed">
        La factura solo trae su fecha de emisión. Aquí se ve qué días cobra cada una,
        por las recargas que casaron con ella, y los tramos de cargas que ninguna
        cobra: si se perdió una factura, sale como hueco entre dos.
      </Text>

      <Group gap="sm" align="flex-end" wrap="wrap">
        <SelectCatalogo
          label="Gasolinera" nombre="gasolineras" estado={gasolineras}
          placeholder="Elige una" searchable size="xs" w={220}
          data={(gasolineras.data?.data ?? []).map((g) => ({ value: String(g.id), label: g.nombre }))}
          value={gasolineraId} onChange={setGasolineraId}
        />
        <FechaInput label="Desde" size="xs" w={140} value={desde} onChange={(v) => setDesde(v ?? '')} />
        <FechaInput label="Hasta" size="xs" w={140} value={hasta} onChange={(v) => setHasta(v ?? '')} />
      </Group>

      {gid === null ? (
        <Center py="xl"><Text c="dimmed">Elige una gasolinera para ver su cobertura.</Text></Center>
      ) : desde > hasta ? (
        <Alert color="orange">La fecha inicial va antes que la final.</Alert>
      ) : isError ? (
        <Alert color="red" title="Error">No se pudo cargar la cobertura.</Alert>
      ) : isLoading || !c ? (
        <Center py="xl"><Loader /></Center>
      ) : c.items.length === 0 ? (
        <Center py="xl"><Text c="dimmed">Ni cargas ni facturas de esta gasolinera en esas fechas.</Text></Center>
      ) : (
        <>
          <Group gap="sm">
            <Card withBorder padding="xs" style={{ flex: 1, minWidth: 140 }}>
              <Text size="xs" c="dimmed">Facturas</Text>
              <Text size="lg" fw={700}>{c.resumen.facturas}</Text>
              {c.resumen.facturas_sin_casar > 0 && (
                <Text size="xs" c="orange.7">{c.resumen.facturas_sin_casar} sin casar</Text>
              )}
            </Card>
            <Card withBorder padding="xs" style={{ flex: 1, minWidth: 140 }}>
              <Text size="xs" c="dimmed">Cargas facturadas</Text>
              <Text size="lg" fw={700}>{c.resumen.cargas_facturadas} de {c.resumen.cargas}</Text>
            </Card>
            <Card withBorder padding="xs" style={{ flex: 1, minWidth: 140 }}>
              <Text size="xs" c="dimmed">En huecos</Text>
              <Text size="lg" fw={700} c={c.resumen.huecos > 0 ? 'red.7' : undefined}>
                {formatMXN(c.resumen.costo_en_huecos)}
              </Text>
              <Text size="xs" c="dimmed">
                {c.resumen.huecos} hueco{c.resumen.huecos === 1 ? '' : 's'} · {cargas(c.resumen.cargas_en_huecos)}
              </Text>
            </Card>
            <Card withBorder padding="xs" style={{ flex: 1, minWidth: 140 }}>
              <Text size="xs" c="dimmed">Por cobrar al final</Text>
              <Text size="lg" fw={700}>{formatMXN(c.resumen.costo_por_cobrar)}</Text>
              <Text size="xs" c="dimmed">{cargas(c.resumen.cargas_por_cobrar)}</Text>
            </Card>
          </Group>

          <Stack gap="xs">
            {c.items.map((i) => i.tipo === 'factura'
              ? <FilaFactura key={`f${i.factura.id}`} f={i.factura} n={i.cargas} onAbrir={onAbrir} />
              : <FilaHueco key={`h${i.hueco.desde}-${i.hueco.tickets[0].id}`} h={i.hueco} onAbrir={onAbrir} />)}
          </Stack>
        </>
      )}
    </Stack>
  )
}
