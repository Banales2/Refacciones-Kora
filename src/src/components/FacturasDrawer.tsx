// Las facturas de compra de refacciones, agrupadas por folio y proveedor.
//
// Existe para dos cosas: rastrear qué trajo cada factura sin ir refacción por
// refacción, y meterle el IVA a las compras viejas. Esas se capturaron cuando
// la casilla no existía, así que quedaron como "el precio ya lo incluye"; aquí
// se busca la factura y se le fija la tasa a todos sus renglones de un golpe,
// que es lo correcto — el IVA es de la factura, no del renglón.
import { useState } from 'react'
import {
  Drawer, Stack, Group, Text, TextInput, Table, Loader, Center, Alert, Badge,
  Accordion, Pagination, Switch, NumberInput, Button, Tooltip,
} from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import { IconSearch, IconAlertTriangle } from '@tabler/icons-react'
import { useFacturas, useSetIvaFactura, useSetFolioFactura } from '../hooks/useFacturas'
import type { Factura } from '../hooks/useFacturas'
import { FechaInput } from './FechaInput'
import { formatMXN, formatFecha } from '../lib/formato'
import { IVA_DEFAULT, importeIva } from '../lib/iva'
import { limpiarFolio, normalizarFolio } from '../lib/validaciones'

const PAGE_SIZE = 10

/**
 * Corregir el folio mal tecleado de una factura. Se reescribe en todos sus
 * renglones a la vez: la factura ES el folio que comparten, y cambiárselo solo
 * a unos cuantos partiría la compra en dos facturas distintas.
 */
function FolioDeFactura({ factura }: { factura: Factura }) {
  const [folio, setFolio] = useState(factura.num_factura)
  const mut = useSetFolioFactura()

  const nuevo = normalizarFolio(folio)
  const cambiado = nuevo !== factura.num_factura
  const invalido = nuevo === ''

  function guardar() {
    mut.mutate({
      num_factura:       factura.num_factura,
      proveedor_id:      factura.proveedor_id,
      nuevo_num_factura: nuevo,
    })
  }

  return (
    <Stack gap="xs">
      <Group gap="sm" align="flex-end" wrap="nowrap">
        <TextInput
          label="Folio de la factura"
          description={`Se corrige en los ${factura.renglones} renglones.`}
          size="xs"
          style={{ flex: 1 }}
          value={folio}
          error={invalido ? 'Requerido' : undefined}
          onChange={(e) => setFolio(limpiarFolio(e.currentTarget.value, 30))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && cambiado && !invalido) guardar()
          }}
        />
        <Button
          size="xs"
          variant="light"
          disabled={!cambiado || invalido}
          loading={mut.isPending}
          onClick={guardar}
        >
          {cambiado ? 'Guardar folio' : 'Sin cambios'}
        </Button>
      </Group>
      {mut.error && (
        <Alert color="red" title="No se pudo cambiar el folio">
          {(mut.error as Error).message}
        </Alert>
      )}
    </Stack>
  )
}

/** El bloque de IVA de una factura. Su estado vive por factura, no en el drawer. */
function IvaDeFactura({ factura }: { factura: Factura }) {
  const [sumar, setSumar] = useState(factura.tasa_iva != null)
  const [tasa, setTasa] = useState<number | string>(factura.tasa_iva ?? IVA_DEFAULT)
  const mut = useSetIvaFactura()

  const tasaEfectiva = sumar ? Number(tasa) || 0 : null
  const iva = importeIva(factura.subtotal, tasaEfectiva)
  const guardada = factura.tasa_iva
  // Sin cambios no hay nada que mandar: el botón se apaga en vez de repetir el
  // mismo UPDATE sobre todos los renglones.
  const cambiada = (guardada ?? null) !== (sumar ? Number(tasa) : null)
  const tasaInvalida = sumar && (tasa === '' || Number(tasa) <= 0 || Number(tasa) > 100)

  function guardar() {
    mut.mutate({
      num_factura:  factura.num_factura,
      proveedor_id: factura.proveedor_id,
      tasa_iva:     sumar ? Number(tasa) : null,
    })
  }

  return (
    <Stack gap="xs">
      {factura.tasa_dispareja && (
        <Alert color="yellow" variant="light" icon={<IconAlertTriangle size={16} />}>
          <Text size="sm">
            Los renglones de esta factura no traen la misma tasa. Fíjala aquí para
            emparejarlos: se escribe en todos.
          </Text>
        </Alert>
      )}
      <Group gap="md" align="flex-start" wrap="nowrap">
        <Switch
          label="Sumar IVA al total"
          description="Actívalo si los precios capturados son el subtotal. Apagado, se toman como precio final."
          checked={sumar}
          onChange={(e) => setSumar(e.currentTarget.checked)}
        />
        {sumar && (
          <NumberInput
            label="Tasa" size="xs" w={110}
            min={0.01} max={100} clampBehavior="strict"
            decimalScale={2} suffix="%"
            value={tasa}
            onChange={setTasa}
          />
        )}
      </Group>

      <Group justify="space-between" align="flex-end">
        <Stack gap={2}>
          <Text size="xs" c="dimmed">
            Subtotal <Text component="span" fw={600}>{formatMXN(factura.subtotal)}</Text>
          </Text>
          {tasaEfectiva !== null && (
            <Text size="xs" c="dimmed">
              IVA ({tasaEfectiva}%) <Text component="span" fw={600}>{formatMXN(iva)}</Text>
            </Text>
          )}
          <Text size="sm">
            Total <Text component="span" fw={700}>{formatMXN(factura.subtotal + iva)}</Text>
          </Text>
        </Stack>
        <Button
          size="xs"
          disabled={!cambiada || tasaInvalida}
          loading={mut.isPending}
          onClick={guardar}
        >
          {cambiada ? `Aplicar a los ${factura.renglones} renglones` : 'Sin cambios'}
        </Button>
      </Group>

      {mut.error && <Alert color="red" title="Error">{(mut.error as Error).message}</Alert>}
    </Stack>
  )
}

export default function FacturasDrawer({
  opened, onClose,
}: {
  opened:  boolean
  onClose: () => void
}) {
  const [search, setSearch] = useState('')
  const [debounced] = useDebouncedValue(search, 300)
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [page, setPage] = useState(1)

  const { data, isLoading, isError } = useFacturas(
    { page, pageSize: PAGE_SIZE, search: debounced || undefined, desde: desde || undefined, hasta: hasta || undefined },
    opened,
  )

  const facturas = data?.data ?? []
  const total = data?.pagination.total ?? 0
  const paginas = Math.ceil(total / PAGE_SIZE)

  // Cualquier cambio de filtro vuelve a la primera página: quedarse en la 4 de
  // una búsqueda que ahora tiene una sola página deja la lista en blanco.
  function filtrar(fn: () => void) { fn(); setPage(1) }

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      title={<Text fw={700}>Facturas de compra</Text>}
      position="right"
      size="xl"
      overlayProps={{ backgroundOpacity: 0.3 }}
    >
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          Cada factura son los lotes que comparten folio y proveedor. Desde aquí se
          le fija el IVA a toda la compra de una vez — útil para las capturadas
          antes de que existiera la casilla.
        </Text>

        <TextInput
          placeholder="Buscar por folio o proveedor…"
          leftSection={<IconSearch size={16} />}
          value={search}
          onChange={(e) => filtrar(() => setSearch(e.currentTarget.value))}
        />
        <Group grow>
          <FechaInput
            label="Desde" clearable
            value={desde}
            onChange={(d) => filtrar(() => setDesde(d))}
          />
          <FechaInput
            label="Hasta" clearable
            value={hasta}
            onChange={(d) => filtrar(() => setHasta(d))}
          />
        </Group>

        {isError ? (
          <Alert color="red" title="Error">No se pudieron cargar las facturas.</Alert>
        ) : isLoading ? (
          <Center py="xl"><Loader /></Center>
        ) : !facturas.length ? (
          <Center py="xl">
            <Text c="dimmed">
              {debounced || desde || hasta
                ? 'Ninguna factura coincide con el filtro.'
                : 'Todavía no hay compras con folio registrado.'}
            </Text>
          </Center>
        ) : (
          <>
            <Text size="xs" c="dimmed">{total} factura{total === 1 ? '' : 's'}</Text>
            <Accordion variant="separated">
              {facturas.map((f) => {
                // La identidad del renglón no puede ser el folio: al corregirlo
                // el acordeón vería otra factura y cerraría la que se acaba de
                // editar. El primer lote sí sobrevive al cambio de nombre.
                const id = `${f.proveedor_id}:${f.detalle[0]?.lote_id ?? f.num_factura}`
                return (
                <Accordion.Item key={id} value={id}>
                  <Accordion.Control>
                    <Group justify="space-between" wrap="nowrap" pr="sm">
                      <div>
                        <Group gap={6}>
                          <Text fw={600} size="sm">{f.num_factura}</Text>
                          {f.tasa_dispareja ? (
                            <Tooltip label="Sus renglones no traen la misma tasa">
                              <Badge size="xs" variant="light" color="yellow">IVA dispar</Badge>
                            </Tooltip>
                          ) : f.tasa_iva != null ? (
                            <Badge size="xs" variant="light" color="teal">+{f.tasa_iva}% IVA</Badge>
                          ) : (
                            <Tooltip label="El precio capturado se toma como precio final">
                              <Badge size="xs" variant="light" color="gray">IVA incluido</Badge>
                            </Tooltip>
                          )}
                        </Group>
                        <Text size="xs" c="dimmed">
                          {f.proveedor} · {formatFecha(f.fecha_compra)} · {f.renglones} renglón
                          {f.renglones === 1 ? '' : 'es'}
                        </Text>
                      </div>
                      <Text size="sm" fw={600} style={{ whiteSpace: 'nowrap' }}>
                        {formatMXN(f.subtotal + importeIva(f.subtotal, f.tasa_iva))}
                      </Text>
                    </Group>
                  </Accordion.Control>
                  <Accordion.Panel>
                    <Stack gap="sm">
                      <Table.ScrollContainer minWidth={480}>
                        <Table withTableBorder striped>
                          <Table.Thead>
                            <Table.Tr>
                              <Table.Th>Refacción</Table.Th>
                              <Table.Th>Sucursal</Table.Th>
                              <Table.Th style={{ textAlign: 'center' }}>Cant.</Table.Th>
                              <Table.Th style={{ textAlign: 'right' }}>Costo unit.</Table.Th>
                              <Table.Th style={{ textAlign: 'right' }}>Subtotal</Table.Th>
                            </Table.Tr>
                          </Table.Thead>
                          <Table.Tbody>
                            {f.detalle.map((d) => (
                              <Table.Tr key={d.lote_id}>
                                <Table.Td>
                                  <Text size="sm" fw={500}>{d.numero_serie}</Text>
                                  <Text size="xs" c="dimmed">{d.descripcion}</Text>
                                </Table.Td>
                                <Table.Td c="dimmed">{d.sucursal ?? '—'}</Table.Td>
                                <Table.Td style={{ textAlign: 'center' }}>{d.cantidad_inicial}</Table.Td>
                                <Table.Td style={{ textAlign: 'right' }}>{formatMXN(d.costo_unitario)}</Table.Td>
                                <Table.Td style={{ textAlign: 'right' }}>
                                  {formatMXN(d.costo_unitario * d.cantidad_inicial)}
                                </Table.Td>
                              </Table.Tr>
                            ))}
                          </Table.Tbody>
                        </Table>
                      </Table.ScrollContainer>

                      {/* Ambos bloques se remontan por factura (`key`): lo
                          tecleado en una no debe arrastrarse a la siguiente. */}
                      <FolioDeFactura
                        key={`${f.proveedor_id}:${f.num_factura}:folio`}
                        factura={f}
                      />
                      <IvaDeFactura key={`${f.proveedor_id}:${f.num_factura}:${f.tasa_iva}`} factura={f} />
                    </Stack>
                  </Accordion.Panel>
                </Accordion.Item>
                )
              })}
            </Accordion>
            {paginas > 1 && (
              <Group justify="center">
                <Pagination value={page} onChange={setPage} total={paginas} />
              </Group>
            )}
          </>
        )}
      </Stack>
    </Drawer>
  )
}
