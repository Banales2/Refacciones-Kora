// La ficha de un taller, desde el catálogo de técnicos.
//
// DOS PESTAÑAS PORQUE SON DOS PREGUNTAS, y la interesante está en el cruce:
//
//   Facturas        lo que el taller ha COBRADO
//   Mantenimientos  lo que el taller ha HECHO
//
// Un trabajo sin folio que lo reclame es mano de obra sin facturar; una factura
// sin cuadrar es un cobro que nadie ha comprobado. Las dos se contestaban
// saliendo a otra pantalla y buscando por nombre.
//
// SALEN TODAS SUS FACTURAS, no solo las de mano de obra. Si a ese mismo taller
// se le compraron refacciones, esas facturas son suyas igual; separarlas aquí
// escondería justo el papel mixto, que es el que cobra las dos cosas y el que
// más fácil se descuadra.
//
// LA PALABRA "PROVEEDOR" NO APARECE. Que un taller facture como proveedor es una
// consecuencia del modelo —la llave de la factura es (proveedor, folio)— y el
// endpoint la resuelve por dentro. Ver `docs/facturas-de-mantenimiento.md`.
import { useState } from 'react'
import {
  Alert, Badge, Card, Center, Drawer, Group, Loader, Pagination, Stack, Table,
  Tabs, Text, Tooltip,
} from '@mantine/core'
import { IconAlertTriangle, IconCheck } from '@tabler/icons-react'
import { useFacturasDeTaller, useMantenimientosDeTaller } from '../hooks/useTecnicos'
import type { Tecnico } from '../hooks/useTecnicos'
import { EstadoRevision } from './RevisionFactura'
import { formatMXN, formatFecha } from '../lib/formato'
import { totalesFactura } from '../lib/totales'

const PAGE_SIZE = 10

// ── Lo que ha cobrado ────────────────────────────────────────────────────────

function FacturasPanel({ tallerId }: { tallerId: number }) {
  const [page, setPage] = useState(1)
  const { data, isLoading, isError } = useFacturasDeTaller(tallerId, page, PAGE_SIZE)

  const facturas = data?.data ?? []
  const total = data?.pagination.total ?? 0
  const paginas = Math.ceil(total / PAGE_SIZE)

  // Los totales son de la página, no de todo el histórico, y el pie lo dice:
  // sumar solo lo que se está viendo y presentarlo como el total del taller
  // sería un número falso en cuanto haya más de una página.
  const facturado = facturas.reduce(
    (s, f) => s + totalesFactura(f.subtotal, f.descuento_pct, f.tasa_iva).total, 0,
  )
  const manoObra = facturas.reduce((s, f) => s + f.subtotal_mano_obra, 0)
  const porCuadrar = facturas.filter((f) => !f.cerrada).length

  if (isError) return <Alert color="red" title="Error">No se pudieron cargar las facturas.</Alert>
  if (isLoading) return <Center py="xl"><Loader /></Center>

  if (!facturas.length) {
    return (
      <Center py="xl">
        <Stack gap={4} align="center" maw={380}>
          <Text c="dimmed">Este taller no tiene facturas registradas.</Text>
          <Text size="xs" c="dimmed" ta="center">
            Aparecen en cuanto se le da de alta una desde Facturas → Mantenimientos,
            o en cuanto se le captura una compra de refacciones.
          </Text>
        </Stack>
      </Center>
    )
  }

  return (
    <Stack gap="md">
      <Group gap="sm">
        <Card withBorder padding="xs" style={{ flex: 1, minWidth: 110 }}>
          <Text size="xs" c="dimmed">Facturas</Text>
          <Text size="lg" fw={700}>{total}</Text>
        </Card>
        <Card withBorder padding="xs" style={{ flex: 1, minWidth: 140 }}>
          <Text size="xs" c="dimmed">Total en esta página</Text>
          <Text size="lg" fw={700}>{formatMXN(facturado)}</Text>
          {manoObra > 0 && (
            <Text size="xs" c="dimmed">{formatMXN(manoObra)} de mano de obra</Text>
          )}
        </Card>
        {porCuadrar > 0 && (
          <Card
            withBorder padding="xs" style={{ flex: 1, minWidth: 120 }}
            bg="var(--mantine-color-yellow-light)"
          >
            <Text size="xs" c="dimmed">Sin cuadrar</Text>
            <Text size="lg" fw={700}>{porCuadrar}</Text>
            <Text size="xs" c="dimmed">en esta página</Text>
          </Card>
        )}
      </Group>

      <Table.ScrollContainer minWidth={560}>
        <Table withTableBorder striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Folio</Table.Th>
              <Table.Th>Fecha</Table.Th>
              <Table.Th>Qué cobra</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Mano de obra</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Total</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {facturas.map((f) => (
              <Table.Tr key={f.id}>
                <Table.Td>
                  <Group gap={6} wrap="nowrap">
                    <Text size="sm" fw={600}>{f.num_factura}</Text>
                    <EstadoRevision factura={f} />
                  </Group>
                </Table.Td>
                <Table.Td c="dimmed">{formatFecha(f.fecha_compra)}</Table.Td>
                <Table.Td>
                  {/* Las dos mitades del papel, dichas por separado: un papel
                      mixto es el caso normal del taller y leerlo como si fuera
                      solo trabajo es el error que se quiere evitar. */}
                  <Group gap={4}>
                    {f.mano_obra > 0 && (
                      <Tooltip label={`${f.mano_obra} servicio${f.mano_obra === 1 ? '' : 's'}`}>
                        <Badge size="xs" variant="light" color="blue">Trabajo</Badge>
                      </Tooltip>
                    )}
                    {f.renglones > 0 && (
                      <Tooltip label={`${f.renglones} renglón${f.renglones === 1 ? '' : 'es'}`}>
                        <Badge size="xs" variant="light" color="grape">Refacciones</Badge>
                      </Tooltip>
                    )}
                    {f.mano_obra === 0 && f.renglones === 0 && (
                      <Text size="xs" c="dimmed">nada capturado</Text>
                    )}
                  </Group>
                </Table.Td>
                <Table.Td style={{ textAlign: 'right' }}>
                  {f.subtotal_mano_obra > 0
                    ? formatMXN(f.subtotal_mano_obra)
                    : <Text size="xs" c="dimmed">—</Text>}
                </Table.Td>
                <Table.Td style={{ textAlign: 'right' }}>
                  <Text size="sm" fw={600}>
                    {formatMXN(totalesFactura(f.subtotal, f.descuento_pct, f.tasa_iva).total)}
                  </Text>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>

      {paginas > 1 && (
        <Group justify="center">
          <Pagination value={page} onChange={setPage} total={paginas} />
        </Group>
      )}

      <Text size="xs" c="dimmed">
        Para cuadrar una contra el papel, ábrela en Facturas → Mantenimientos.
      </Text>
    </Stack>
  )
}

// ── Lo que ha hecho ──────────────────────────────────────────────────────────

/**
 * El trabajo del taller, con su estado frente al papel.
 *
 * La columna que justifica la pestaña es **Factura**: un servicio sin folio que
 * lo reclame es mano de obra que el taller no ha cobrado todavía, y verlo aquí
 * —junto al resto de su trabajo— es distinto de verlo en la bandeja general de
 * servicios sin factura, que es de toda la flota.
 */
function MantenimientosPanel({ tallerId }: { tallerId: number }) {
  const [page, setPage] = useState(1)
  const { data, isLoading, isError } = useMantenimientosDeTaller(tallerId, page, PAGE_SIZE)

  const filas = data?.data ?? []
  const total = data?.pagination.total ?? 0
  const paginas = Math.ceil(total / PAGE_SIZE)
  const sinFacturar = filas.filter((m) => m.factura_folio === null && m.costo > 0)

  if (isError) return <Alert color="red" title="Error">No se pudieron cargar los mantenimientos.</Alert>
  if (isLoading) return <Center py="xl"><Loader /></Center>

  if (!filas.length) {
    return (
      <Center py="xl">
        <Text c="dimmed">Este taller no tiene mantenimientos registrados.</Text>
      </Center>
    )
  }

  return (
    <Stack gap="md">
      <Group gap="sm">
        <Card withBorder padding="xs" style={{ flex: 1, minWidth: 120 }}>
          <Text size="xs" c="dimmed">Servicios</Text>
          <Text size="lg" fw={700}>{total}</Text>
        </Card>
        <Card withBorder padding="xs" style={{ flex: 1, minWidth: 150 }}>
          <Text size="xs" c="dimmed">Mano de obra, histórico</Text>
          <Text size="lg" fw={700}>{formatMXN(data?.costo_total ?? 0)}</Text>
          <Text size="xs" c="dimmed">todos sus servicios</Text>
        </Card>
        {sinFacturar.length > 0 && (
          <Card
            withBorder padding="xs" style={{ flex: 1, minWidth: 140 }}
            bg="var(--mantine-color-orange-light)"
          >
            <Text size="xs" c="dimmed">Sin facturar</Text>
            <Text size="lg" fw={700}>{sinFacturar.length}</Text>
            <Text size="xs" c="dimmed">
              {formatMXN(sinFacturar.reduce((s, m) => s + m.costo, 0))} en esta página
            </Text>
          </Card>
        )}
      </Group>

      <Table.ScrollContainer minWidth={620}>
        <Table withTableBorder striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Unidad</Table.Th>
              <Table.Th>Fecha</Table.Th>
              <Table.Th>Tipo</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Mano de obra</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Refacciones</Table.Th>
              <Table.Th>Factura</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {filas.map((m) => (
              <Table.Tr key={m.id}>
                <Table.Td>
                  <Text size="sm">{m.vehiculo}</Text>
                  {m.km_actual != null && m.km_actual > 0 && (
                    <Text size="xs" c="dimmed">{m.km_actual.toLocaleString('es-MX')} km</Text>
                  )}
                </Table.Td>
                <Table.Td c="dimmed">{m.fecha ? formatFecha(m.fecha) : '—'}</Table.Td>
                <Table.Td c="dimmed">{m.tipo ?? '—'}</Table.Td>
                <Table.Td style={{ textAlign: 'right' }}>{formatMXN(m.costo)}</Table.Td>
                <Table.Td style={{ textAlign: 'right' }}>
                  {/* Las refacciones que consumió salen del almacén y ya se
                      pagaron al comprarlas: no las cobra este taller. Se enseñan
                      porque dicen lo que costó el servicio completo. */}
                  {m.piezas_total > 0
                    ? <Text size="sm" c="dimmed">{formatMXN(m.piezas_total)}</Text>
                    : <Text size="xs" c="dimmed">—</Text>}
                </Table.Td>
                <Table.Td>
                  {m.factura_folio ? (
                    <Group gap={4} wrap="nowrap">
                      <Text size="sm">{m.factura_folio}</Text>
                      {m.revisado_en && (
                        <Tooltip label={`Cuadrada por ${m.revisado_por ?? '—'}`}>
                          <Badge
                            size="xs" variant="light" color="green"
                            leftSection={<IconCheck size={10} />}
                          >
                            cuadrada
                          </Badge>
                        </Tooltip>
                      )}
                    </Group>
                  ) : m.costo > 0 ? (
                    <Tooltip label="Ninguna factura cobra este trabajo todavía">
                      <Badge
                        size="xs" variant="light" color="orange"
                        leftSection={<IconAlertTriangle size={10} />}
                      >
                        sin facturar
                      </Badge>
                    </Tooltip>
                  ) : (
                    <Text size="xs" c="dimmed">sin cobro</Text>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>

      {paginas > 1 && (
        <Group justify="center">
          <Pagination value={page} onChange={setPage} total={paginas} />
        </Group>
      )}
    </Stack>
  )
}

// ── El cajón ─────────────────────────────────────────────────────────────────

export default function TallerDrawer({
  taller, onClose,
}: {
  taller:  Tecnico | null
  onClose: () => void
}) {
  return (
    <Drawer
      opened={taller !== null}
      onClose={onClose}
      position="right"
      size="xl"
      title={
        <div>
          <Text fw={700}>{taller?.nombre}</Text>
          <Text size="xs" c="dimmed">{taller?.ubicacion}</Text>
        </div>
      }
      overlayProps={{ backgroundOpacity: 0.3 }}
    >
      {/* Los paneles se remontan por taller: la paginación de uno no puede
          arrastrarse al siguiente, que casi nunca tiene tantas páginas. */}
      {taller && (
        <Tabs defaultValue="facturas" key={taller.id}>
          <Tabs.List>
            <Tabs.Tab value="facturas">Facturas</Tabs.Tab>
            <Tabs.Tab value="mantenimientos">Mantenimientos</Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="facturas" pt="md">
            <FacturasPanel tallerId={taller.id} />
          </Tabs.Panel>

          <Tabs.Panel value="mantenimientos" pt="md">
            <MantenimientosPanel tallerId={taller.id} />
          </Tabs.Panel>
        </Tabs>
      )}
    </Drawer>
  )
}
