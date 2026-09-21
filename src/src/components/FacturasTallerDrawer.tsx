// Las facturas de un taller, desde el catálogo de técnicos.
//
// QUÉ CONTESTA. "Cuánto llevamos pagándole a este taller y qué está sin cuadrar",
// que es la pregunta que se hace estando en su ficha y que antes obligaba a
// salir a Facturas y buscar por nombre.
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
  Text, Tooltip,
} from '@mantine/core'
import { useFacturasDeTaller } from '../hooks/useTecnicos'
import type { Tecnico } from '../hooks/useTecnicos'
import { EstadoRevision } from './RevisionFactura'
import { formatMXN, formatFecha } from '../lib/formato'
import { totalesFactura } from '../lib/totales'

const PAGE_SIZE = 10

export default function FacturasTallerDrawer({
  taller, onClose,
}: {
  taller:  Tecnico | null
  onClose: () => void
}) {
  const [page, setPage] = useState(1)
  const { data, isLoading, isError } = useFacturasDeTaller(taller?.id ?? null, page, PAGE_SIZE)

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

  return (
    <Drawer
      opened={taller !== null}
      onClose={() => { onClose(); setPage(1) }}
      position="right"
      size="xl"
      title={
        <div>
          <Text fw={700}>{taller?.nombre}</Text>
          <Text size="xs" c="dimmed">Facturas de este taller</Text>
        </div>
      }
      overlayProps={{ backgroundOpacity: 0.3 }}
    >
      {isError ? (
        <Alert color="red" title="Error">No se pudieron cargar las facturas.</Alert>
      ) : isLoading ? (
        <Center py="xl"><Loader /></Center>
      ) : !facturas.length ? (
        <Center py="xl">
          <Stack gap={4} align="center" maw={380}>
            <Text c="dimmed">Este taller no tiene facturas registradas.</Text>
            <Text size="xs" c="dimmed" ta="center">
              Aparecen en cuanto se le da de alta una desde Facturas → Mantenimientos,
              o en cuanto se le captura una compra de refacciones.
            </Text>
          </Stack>
        </Center>
      ) : (
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
                          mixto es el caso normal del taller y leerlo como si
                          fuera solo trabajo es el error que se quiere evitar. */}
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
      )}
    </Drawer>
  )
}
