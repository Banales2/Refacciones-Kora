// Archivar una recarga capturada de más, y ver y restaurar las archivadas.
//
// El caso que lo pidió: el mismo papel capturado dos veces, una con el folio
// bien (6071) y otra con el folio mal tecleado (0671). No se borra —es
// historia—: se archiva. Deja de contar en costos, rendimiento, conciliación y
// vales, y su vale queda libre para cancelarlo si era el que no existía.
//
// Lo hacen admin y editor (la API lo impone): sacar una recarga de los costos
// es decisión de quien firma el gasto. El motivo es obligatorio por lo mismo.
import { useState } from 'react'
import {
  Alert, Anchor, Badge, Button, Collapse, Group, Loader, Center, Modal, Stack, Table, Text,
  Textarea, Tooltip,
} from '@mantine/core'
import { IconArchive, IconArrowBackUp, IconChevronDown, IconChevronUp } from '@tabler/icons-react'
import {
  useArchivarRecarga, useRecargasArchivadas, useRestaurarRecarga,
  type Recarga, type RecargaConVehiculo,
} from '../hooks/useRecargas'
import { formatFecha, formatLitros, formatMXN } from '../lib/formato'

function etiquetaRecarga(r: Recarga): string {
  return `${formatFecha(r.fecha)} · ${r.vale_folio ? `vale ${r.vale_folio}` : 'sin vale'} · `
    + `${formatLitros(Number(r.litros))} L · ${formatMXN(Number(r.costo))}`
}

/** Confirmación con motivo. `recarga` null: cerrado. */
export function ArchivarRecargaModal({ recarga, titulo, onClose }: {
  recarga: Recarga | null
  /** Cómo se llama la unidad, para que no se archive la de otra por error. */
  titulo?: string
  onClose: () => void
}) {
  const [motivo, setMotivo] = useState('')
  const archivar = useArchivarRecarga()

  function cerrar() {
    setMotivo('')
    archivar.reset()
    onClose()
  }

  function confirmar() {
    if (!recarga) return
    archivar.mutate({ id: recarga.id, motivo: motivo.trim() }, { onSuccess: cerrar })
  }

  return (
    <Modal opened={recarga != null} onClose={cerrar} title="Archivar recarga" centered size="md">
      {recarga && (
        <Stack gap="sm">
          <div>
            {titulo && <Text size="sm" fw={600}>{titulo}</Text>}
            <Text size="sm">{etiquetaRecarga(recarga)}</Text>
            <Text size="xs" c="dimmed">Chofer: {recarga.conductor}</Text>
          </div>
          <Text size="sm">
            Deja de contar en costos, rendimiento, conciliación de facturas y vales, pero no se
            borra: se puede restaurar desde "Ver archivadas".
            {recarga.vale_folio && <> El vale <strong>{recarga.vale_folio}</strong> queda libre; si
            era un folio mal capturado, cancélalo después en Vales de gasolina.</>}
          </Text>
          <Textarea
            label="Motivo"
            placeholder="Ej. Duplicada: es la misma carga del vale 6071, se capturó con el folio 0671"
            value={motivo}
            onChange={(e) => setMotivo(e.currentTarget.value)}
            maxLength={200}
            autosize minRows={2}
            required
            data-autofocus
          />
          {archivar.error && <Alert color="red" variant="light">{archivar.error.message}</Alert>}
          <Group justify="flex-end">
            <Button variant="default" onClick={cerrar} disabled={archivar.isPending}>Cancelar</Button>
            <Button
              color="red" leftSection={<IconArchive size={16} />}
              loading={archivar.isPending} disabled={motivo.trim().length < 3}
              onClick={confirmar}
            >
              Archivar
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  )
}

function Restaurar({ recarga }: { recarga: Recarga }) {
  const restaurar = useRestaurarRecarga()
  return (
    <Stack gap={2} align="flex-end">
      <Button
        size="compact-xs" variant="subtle" color="gray"
        leftSection={<IconArrowBackUp size={14} />}
        loading={restaurar.isPending}
        onClick={() => restaurar.mutate(recarga.id)}
      >
        Restaurar
      </Button>
      {/* Largo a propósito: dice qué hacer (archivar la otra, quitar la cancelación). */}
      {restaurar.error && <Text size="xs" c="red" maw={260} ta="right">{restaurar.error.message}</Text>}
    </Stack>
  )
}

/**
 * "Ver archivadas", al pie de un listado. Se piden a la API solo al abrirla:
 * casi siempre no hay ninguna y no vale la consulta.
 */
export function RecargasArchivadasPanel({ vehiculoId, puedeRestaurar, onNavigateVehiculo }: {
  vehiculoId: number | 'todas'
  puedeRestaurar: boolean
  onNavigateVehiculo?: (id: number) => void
}) {
  const [abierto, setAbierto] = useState(false)
  const { data, isLoading, error } = useRecargasArchivadas(vehiculoId, abierto)
  const items = data?.data ?? []
  const conVehiculo = vehiculoId === 'todas'

  return (
    <div>
      <Button
        size="xs" variant="subtle" color="gray"
        leftSection={abierto ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
        onClick={() => setAbierto((v) => !v)}
      >
        {abierto ? 'Ocultar archivadas' : 'Ver archivadas'}
      </Button>
      <Collapse expanded={abierto}>
        {isLoading ? (
          <Center py="sm"><Loader size="sm" /></Center>
        ) : error ? (
          <Alert color="red" variant="light">{(error as Error).message}</Alert>
        ) : items.length === 0 ? (
          <Text size="sm" c="dimmed" py="xs" px="sm">No hay recargas archivadas.</Text>
        ) : (
          <Table.ScrollContainer minWidth={720} mt="xs">
            <Table striped withTableBorder verticalSpacing="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Fecha</Table.Th>
                  {conVehiculo && <Table.Th>Vehículo</Table.Th>}
                  <Table.Th>Chofer</Table.Th>
                  <Table.Th>Vale</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Litros</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Costo</Table.Th>
                  <Table.Th>Por qué se archivó</Table.Th>
                  {puedeRestaurar && <Table.Th />}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {items.map((r: RecargaConVehiculo) => (
                  <Table.Tr key={r.id}>
                    <Table.Td><Text size="sm">{formatFecha(r.fecha)}</Text></Table.Td>
                    {conVehiculo && (
                      <Table.Td>
                        {onNavigateVehiculo ? (
                          <Anchor component="button" type="button" size="sm" onClick={() => onNavigateVehiculo(r.vehiculo_id)}>
                            {r.marca} {r.modelo} — {r.serie}
                          </Anchor>
                        ) : (
                          <Text size="sm">{r.marca} {r.modelo} — {r.serie}</Text>
                        )}
                      </Table.Td>
                    )}
                    <Table.Td><Text size="sm">{r.conductor}</Text></Table.Td>
                    <Table.Td>
                      {r.vale_folio ? <Text size="sm">{r.vale_folio}</Text>
                        : r.emergencia ? <Badge color="orange" variant="light" size="sm">Emergencia</Badge>
                        : <Text size="sm" c="dimmed">—</Text>}
                    </Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>{formatLitros(Number(r.litros))}</Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>{formatMXN(Number(r.costo))}</Table.Td>
                    <Table.Td>
                      <Text size="sm">{r.archivado_motivo ?? '—'}</Text>
                      {r.archivado_en && (
                        <Tooltip label="Quién la archivó queda en la bitácora" withArrow>
                          <Text size="xs" c="dimmed">Archivada el {formatFecha(r.archivado_en.slice(0, 10))}</Text>
                        </Tooltip>
                      )}
                    </Table.Td>
                    {puedeRestaurar && (
                      <Table.Td style={{ textAlign: 'right' }}><Restaurar recarga={r} /></Table.Td>
                    )}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Collapse>
    </div>
  )
}
