import { useState, useEffect } from 'react'
import {
  Stack, Group, Text, TextInput, Table, Badge,
  Pagination, Drawer, Loader, Center, Alert,
} from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import { useRefacciones } from '../hooks/useRefacciones'
import { useLotes } from '../hooks/useLotes'

function stockColor(qty: number) {
  if (qty === 0) return 'red'
  if (qty < 10) return 'orange'
  return 'green'
}

function formatMXN(n: number) {
  return n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-MX', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

export default function Piezas() {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [debouncedSearch] = useDebouncedValue(search, 400)
  const [selectedId, setSelectedId] = useState<number | null>(null)

  useEffect(() => { setPage(1) }, [debouncedSearch])

  const { data, isLoading, isError } = useRefacciones(page, debouncedSearch)
  const { data: lotesData, isLoading: lotesLoading } = useLotes(selectedId)

  const totalPages = Math.ceil((data?.pagination?.total ?? 0) / (data?.pagination?.pageSize ?? 20))

  return (
    <>
      <Stack gap="md">
        {/* Encabezado */}
        <Group justify="space-between" align="flex-end">
          <div>
            <Text size="xl" fw={600}>Piezas</Text>
            <Text size="sm" c="dimmed">Catálogo e inventario de refacciones</Text>
          </div>
          {data?.pagination && (
            <Text size="sm" c="dimmed">{data.pagination.total} piezas</Text>
          )}
        </Group>

        {/* Búsqueda */}
        <TextInput
          placeholder="Buscar por número de serie o descripción…"
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          leftSection={<span style={{ fontSize: 14 }}>🔍</span>}
          rightSection={
            search ? (
              <Text
                component="button"
                size="xs"
                c="dimmed"
                style={{ cursor: 'pointer', background: 'none', border: 'none', padding: 0 }}
                onClick={() => setSearch('')}
              >
                ✕
              </Text>
            ) : null
          }
        />

        {/* Estado de carga / error / vacío */}
        {isLoading ? (
          <Center py="xl"><Loader /></Center>
        ) : isError ? (
          <Alert color="red" title="Error al cargar">
            No se pudieron obtener las piezas. Verifica la conexión.
          </Alert>
        ) : data?.data?.length === 0 ? (
          <Center py="xl">
            <Text c="dimmed">No se encontraron piezas{search ? ` para "${search}"` : ''}.</Text>
          </Center>
        ) : (
          <Table.ScrollContainer minWidth={480}>
            <Table striped highlightOnHover withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Número de serie</Table.Th>
                  <Table.Th>Descripción</Table.Th>
                  <Table.Th style={{ textAlign: 'center' }}>En stock</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data?.data?.map((pieza) => (
                  <Table.Tr
                    key={pieza.id}
                    onClick={() => setSelectedId(pieza.id)}
                    style={{ cursor: 'pointer' }}
                  >
                    <Table.Td fw={500}>{pieza.numero_serie}</Table.Td>
                    <Table.Td c="dimmed">{pieza.descripcion}</Table.Td>
                    <Table.Td style={{ textAlign: 'center' }}>
                      <Badge
                        color={stockColor(pieza.cantidad_total)}
                        variant="light"
                        size="sm"
                      >
                        {pieza.cantidad_total}
                      </Badge>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}

        {/* Paginación */}
        {totalPages > 1 && (
          <Group justify="center">
            <Pagination total={totalPages} value={page} onChange={setPage} size="sm" />
          </Group>
        )}
      </Stack>

      {/* Drawer: historial de lotes */}
      <Drawer
        opened={selectedId !== null}
        onClose={() => setSelectedId(null)}
        title={
          lotesData ? (
            <Stack gap={2}>
              <Text fw={700} size="md">{lotesData.pieza.numero_serie}</Text>
              <Text size="xs" c="dimmed">{lotesData.pieza.descripcion}</Text>
            </Stack>
          ) : (
            <Text fw={700}>Historial de lotes</Text>
          )
        }
        position="right"
        size="xl"
        overlayProps={{ backgroundOpacity: 0.3 }}
      >
        {lotesLoading ? (
          <Center py="xl"><Loader /></Center>
        ) : !lotesData?.lotes.length ? (
          <Center py="xl">
            <Text c="dimmed">Esta pieza no tiene lotes registrados.</Text>
          </Center>
        ) : (
          <Stack gap="md">
            {/* Resumen */}
            <Group gap="xl">
              <div>
                <Text size="xs" c="dimmed" tt="uppercase" fw={600}>Lotes</Text>
                <Text fw={700} size="lg">{lotesData.lotes.length}</Text>
              </div>
              <div>
                <Text size="xs" c="dimmed" tt="uppercase" fw={600}>Stock total</Text>
                <Text fw={700} size="lg">
                  <Badge
                    color={stockColor(
                      lotesData.lotes.reduce((s, l) => s + l.cantidad_disponible, 0)
                    )}
                    variant="light"
                    size="lg"
                  >
                    {lotesData.lotes.reduce((s, l) => s + l.cantidad_disponible, 0)}
                  </Badge>
                </Text>
              </div>
            </Group>

            <Table.ScrollContainer minWidth={560}>
              <Table withTableBorder withColumnBorders striped>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Fecha compra</Table.Th>
                    <Table.Th>Proveedor</Table.Th>
                    <Table.Th>Factura</Table.Th>
                    <Table.Th style={{ textAlign: 'right' }}>Costo unit.</Table.Th>
                    <Table.Th style={{ textAlign: 'center' }}>Inicial</Table.Th>
                    <Table.Th style={{ textAlign: 'center' }}>Disponible</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {lotesData.lotes.map((lote) => (
                    <Table.Tr key={lote.id}>
                      <Table.Td>{formatDate(lote.fecha_compra)}</Table.Td>
                      <Table.Td>{lote.proveedor}</Table.Td>
                      <Table.Td c="dimmed">{lote.num_factura ?? '—'}</Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>
                        {formatMXN(lote.costo_unitario)}
                      </Table.Td>
                      <Table.Td style={{ textAlign: 'center' }}>{lote.cantidad_inicial}</Table.Td>
                      <Table.Td style={{ textAlign: 'center' }}>
                        <Badge
                          color={stockColor(lote.cantidad_disponible)}
                          variant="light"
                          size="sm"
                        >
                          {lote.cantidad_disponible}
                        </Badge>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Stack>
        )}
      </Drawer>
    </>
  )
}
