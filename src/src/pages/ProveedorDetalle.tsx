// Página de un proveedor: sus datos de contacto y, sobre todo, los precios que
// da por cada refacción.
//
// Para qué sirve: los lotes solo dicen lo que costó una compra que ya se hizo,
// así que del proveedor al que no se le compra no se sabe nada. Aquí se anota
// lo que cada quien pide —se le compre o no— y la pantalla compara ese precio
// contra el mejor que haya registrado cualquier otro proveedor.
//
// Cada refacción es un grupo: arriba el precio vigente (el más reciente) con su
// comparación, y adentro el historial, que es lo que enseña si un proveedor va
// subiendo.
import { useMemo, useState } from 'react'
import {
  Stack, Group, Text, Table, Loader, Center, Alert, Button, ActionIcon,
  Modal, Badge, Accordion, Paper, Tooltip, Anchor,
} from '@mantine/core'
import {
  IconPencil, IconTrash, IconPlus, IconArrowLeft, IconPhone, IconUser,
} from '@tabler/icons-react'
import {
  usePreciosProveedor, useCreatePrecioProveedor,
  useUpdatePrecioProveedor, useDeletePrecioProveedor,
} from '../hooks/usePreciosProveedor'
import type { PrecioProveedor } from '../hooks/usePreciosProveedor'
import type { Proveedor } from '../hooks/useProveedores'
import PrecioProveedorForm from '../components/PrecioProveedorForm'

function formatMXN(n: number) {
  return Number(n).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })
}

function formatFecha(iso: string) {
  return new Date(`${iso.split('T')[0]}T12:00:00`).toLocaleDateString('es-MX', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

// ── Agrupado por refacción ────────────────────────────────────────────────────

type GrupoPieza = {
  piezaId:  number
  label:    string
  tipo:     string | null
  /** Del más reciente al más viejo; el primero es el precio vigente. */
  historial: PrecioProveedor[]
}

// La API ya devuelve los precios ordenados por refacción y, dentro de cada una,
// del más reciente al más viejo: basta con agrupar respetando ese orden.
function agrupar(items: PrecioProveedor[]): GrupoPieza[] {
  const grupos = new Map<number, GrupoPieza>()
  for (const p of items) {
    const grupo = grupos.get(p.pieza_id)
    if (grupo) grupo.historial.push(p)
    else grupos.set(p.pieza_id, {
      piezaId:   p.pieza_id,
      label:     `${p.pieza_serie} — ${p.pieza}`,
      tipo:      p.tipo_pieza,
      historial: [p],
    })
  }
  return [...grupos.values()]
}

// ── Comparación contra los demás proveedores ──────────────────────────────────

// Qué tan lejos está el precio vigente de este proveedor del mejor registrado.
// El mejor incluye el propio, así que empatar con él es ser el más barato.
function ComparativaBadge({ vigente }: { vigente: PrecioProveedor }) {
  const mejor = vigente.mejor_precio != null ? Number(vigente.mejor_precio) : null
  const precio = Number(vigente.precio)

  if (mejor == null || vigente.proveedores_con_precio <= 1) {
    return (
      <Tooltip label="Ningún otro proveedor tiene precio registrado para esta refacción">
        <Badge variant="light" color="gray">Sin comparación</Badge>
      </Tooltip>
    )
  }
  if (precio <= mejor) {
    return (
      <Tooltip label={`El más barato de ${vigente.proveedores_con_precio} proveedores con precio`}>
        <Badge variant="light" color="green">Más barato</Badge>
      </Tooltip>
    )
  }

  const diferencia = precio - mejor
  const porcentaje = (diferencia / mejor) * 100
  return (
    <Tooltip label={`${formatMXN(mejor)} con ${vigente.mejor_proveedor} · ${formatMXN(diferencia)} de diferencia`}>
      <Badge variant="light" color="orange">
        +{porcentaje.toFixed(1)}% vs {vigente.mejor_proveedor}
      </Badge>
    </Tooltip>
  )
}

// ── Historial de una refacción ────────────────────────────────────────────────

// Cuánto cambió cada precio respecto al anterior en el tiempo. El historial
// viene del más reciente al más viejo, así que el "anterior" es el siguiente
// renglón de la lista.
function VariacionCelda({ actual, anterior }: { actual: number; anterior?: number }) {
  if (anterior === undefined) return <Text size="sm" c="dimmed">—</Text>
  const delta = Number(actual) - Number(anterior)
  if (delta === 0) return <Text size="sm" c="dimmed">Sin cambio</Text>
  const pct = (delta / Number(anterior)) * 100
  return (
    <Text size="sm" c={delta > 0 ? 'red' : 'green'}>
      {delta > 0 ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}%
    </Text>
  )
}

function HistorialTabla({
  historial, onEdit, onDelete,
}: {
  historial: PrecioProveedor[]
  onEdit: (p: PrecioProveedor) => void
  onDelete: (p: PrecioProveedor) => void
}) {
  return (
    <Table highlightOnHover verticalSpacing="xs">
      <Table.Thead>
        <Table.Tr>
          <Table.Th style={{ width: 130 }}>Fecha</Table.Th>
          <Table.Th style={{ width: 120, textAlign: 'right' }}>Precio</Table.Th>
          <Table.Th style={{ width: 110 }}>Cambio</Table.Th>
          <Table.Th>Observaciones</Table.Th>
          <Table.Th style={{ width: 160 }}>Registró</Table.Th>
          <Table.Th style={{ width: 80 }} />
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {historial.map((p, i) => (
          <Table.Tr key={p.id}>
            <Table.Td>
              <Group gap={6} wrap="nowrap">
                {formatFecha(p.fecha)}
                {i === 0 && <Badge size="xs" variant="light">Vigente</Badge>}
              </Group>
            </Table.Td>
            <Table.Td style={{ textAlign: 'right' }} fw={i === 0 ? 600 : 400}>
              {formatMXN(p.precio)}
            </Table.Td>
            <Table.Td>
              <VariacionCelda actual={p.precio} anterior={historial[i + 1]?.precio} />
            </Table.Td>
            <Table.Td c={p.observaciones ? undefined : 'dimmed'}>
              <Text size="sm">{p.observaciones ?? '—'}</Text>
            </Table.Td>
            <Table.Td><Text size="xs" c="dimmed">{p.registrado_por}</Text></Table.Td>
            <Table.Td>
              <Group gap={4} justify="flex-end" wrap="nowrap">
                <ActionIcon variant="subtle" color="blue" size="sm"
                  aria-label="Editar" onClick={() => onEdit(p)}>
                  <IconPencil size={14} />
                </ActionIcon>
                <ActionIcon variant="subtle" color="red" size="sm"
                  aria-label="Eliminar" onClick={() => onDelete(p)}>
                  <IconTrash size={14} />
                </ActionIcon>
              </Group>
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  )
}

// ── Página ────────────────────────────────────────────────────────────────────

export default function ProveedorDetalle({
  proveedor, onBack,
}: {
  proveedor: Proveedor
  onBack: () => void
}) {
  const [createOpen, setCreateOpen]   = useState(false)
  // Refacción ya decidida al registrar otro precio desde su propio grupo.
  const [piezaFija, setPiezaFija]     = useState<{ id: number; label: string } | null>(null)
  const [editPrecio, setEditPrecio]   = useState<PrecioProveedor | null>(null)
  const [deletePrecio, setDeletePrecio] = useState<PrecioProveedor | null>(null)
  const [abierta, setAbierta]         = useState<string | null>(null)

  const { data, isLoading, isError } = usePreciosProveedor(proveedor.id)
  const createMut = useCreatePrecioProveedor(proveedor.id)
  const updateMut = useUpdatePrecioProveedor()
  const deleteMut = useDeletePrecioProveedor()

  const precios = useMemo(() => data?.data ?? [], [data])
  const grupos  = useMemo(() => agrupar(precios), [precios])

  // En cuántas refacciones este proveedor es el más barato de los que tienen
  // precio registrado. Es el número que dice si conviene pedirle cotización.
  const masBaratas = grupos.filter((g) => {
    const v = g.historial[0]
    return v.mejor_proveedor_id === proveedor.id && v.proveedores_con_precio > 1
  }).length

  function abrirAlta(pieza?: { id: number; label: string }) {
    setPiezaFija(pieza ?? null)
    createMut.reset()
    setCreateOpen(true)
  }

  return (
    <>
      <Stack gap="md">
        <div>
          <Anchor component="button" type="button" size="sm" onClick={onBack}>
            <Group gap={4} wrap="nowrap">
              <IconArrowLeft size={14} />
              Proveedores
            </Group>
          </Anchor>
        </div>

        <Paper withBorder p="md" radius="md">
          <Group justify="space-between" align="flex-start" wrap="wrap">
            <div>
              <Text size="xl" fw={600}>{proveedor.nombre}</Text>
              <Group gap="md" mt={4}>
                <Group gap={4}>
                  <IconUser size={14} opacity={0.6} />
                  <Text size="sm" c={proveedor.contacto ? undefined : 'dimmed'}>
                    {proveedor.contacto ?? 'Sin contacto'}
                  </Text>
                </Group>
                <Group gap={4}>
                  <IconPhone size={14} opacity={0.6} />
                  <Text size="sm" c={proveedor.telefono ? undefined : 'dimmed'}>
                    {proveedor.telefono ?? 'Sin teléfono'}
                  </Text>
                </Group>
              </Group>
            </div>
            <Group gap="sm" align="center">
              <Badge variant="light" color="gray" size="lg">
                {grupos.length} refacción{grupos.length !== 1 ? 'es' : ''} con precio
              </Badge>
              {masBaratas > 0 && (
                <Tooltip label="Refacciones en las que es el proveedor más barato de los registrados">
                  <Badge variant="light" color="green" size="lg">
                    {masBaratas} al mejor precio
                  </Badge>
                </Tooltip>
              )}
              <Button leftSection={<IconPlus size={16} />} onClick={() => abrirAlta()}>
                Registrar precio
              </Button>
            </Group>
          </Group>
        </Paper>

        {isLoading ? (
          <Center py="xl"><Loader /></Center>
        ) : isError ? (
          <Alert color="red" title="Error al cargar">
            No se pudieron obtener los precios de este proveedor. Verifica la conexión.
          </Alert>
        ) : grupos.length === 0 ? (
          <Center py="xl">
            <Stack align="center" gap="xs">
              <Text c="dimmed">Este proveedor no tiene precios registrados.</Text>
              <Text size="sm" c="dimmed">
                Registra lo que pide por una refacción para poder compararlo con los demás.
              </Text>
              <Button size="xs" variant="light" leftSection={<IconPlus size={14} />}
                onClick={() => abrirAlta()}>
                Registrar precio
              </Button>
            </Stack>
          </Center>
        ) : (
          <Accordion variant="separated" value={abierta} onChange={setAbierta}>
            {grupos.map((g) => {
              const vigente = g.historial[0]
              return (
                <Accordion.Item key={g.piezaId} value={String(g.piezaId)}>
                  <Accordion.Control>
                    <Group justify="space-between" wrap="nowrap" pr="sm">
                      <div style={{ minWidth: 0 }}>
                        <Text size="sm" fw={500} truncate>{g.label}</Text>
                        <Text size="xs" c="dimmed">
                          {g.tipo ?? 'Sin tipo'} · {g.historial.length} precio
                          {g.historial.length !== 1 ? 's' : ''} · último {formatFecha(vigente.fecha)}
                        </Text>
                      </div>
                      <Group gap="sm" wrap="nowrap">
                        <ComparativaBadge vigente={vigente} />
                        <Text size="sm" fw={600}>{formatMXN(vigente.precio)}</Text>
                      </Group>
                    </Group>
                  </Accordion.Control>
                  <Accordion.Panel>
                    <Stack gap="xs">
                      <HistorialTabla
                        historial={g.historial}
                        onEdit={(p) => { updateMut.reset(); setEditPrecio(p) }}
                        onDelete={setDeletePrecio}
                      />
                      <Group justify="flex-end">
                        <Button
                          size="xs" variant="light" leftSection={<IconPlus size={14} />}
                          onClick={() => abrirAlta({ id: g.piezaId, label: g.label })}
                        >
                          Registrar precio nuevo
                        </Button>
                      </Group>
                    </Stack>
                  </Accordion.Panel>
                </Accordion.Item>
              )
            })}
          </Accordion>
        )}
      </Stack>

      {/* Modal: nuevo precio */}
      <Modal
        opened={createOpen}
        onClose={() => setCreateOpen(false)}
        title={`Registrar precio — ${proveedor.nombre}`}
        centered
        size="md"
      >
        <PrecioProveedorForm
          piezaFija={piezaFija ?? undefined}
          isPending={createMut.isPending}
          error={createMut.error ? (createMut.error as Error).message : null}
          onSubmit={(payload) =>
            createMut.mutate(payload, { onSuccess: () => setCreateOpen(false) })
          }
          onCancel={() => setCreateOpen(false)}
        />
      </Modal>

      {/* Modal: editar precio */}
      <Modal
        opened={editPrecio !== null}
        onClose={() => setEditPrecio(null)}
        title="Editar precio"
        centered
        size="md"
      >
        {editPrecio && (
          <PrecioProveedorForm
            initial={{
              pieza_id:      String(editPrecio.pieza_id),
              precio:        Number(editPrecio.precio),
              fecha:         editPrecio.fecha.split('T')[0],
              observaciones: editPrecio.observaciones ?? '',
            }}
            piezaFija={{
              id: editPrecio.pieza_id,
              label: `${editPrecio.pieza_serie} — ${editPrecio.pieza}`,
            }}
            isPending={updateMut.isPending}
            error={updateMut.error ? (updateMut.error as Error).message : null}
            onSubmit={({ precio, fecha, observaciones }) =>
              updateMut.mutate(
                { id: editPrecio.id, payload: { precio, fecha, observaciones } },
                { onSuccess: () => setEditPrecio(null) }
              )
            }
            onCancel={() => setEditPrecio(null)}
          />
        )}
      </Modal>

      {/* Modal: confirmar eliminación */}
      <Modal
        opened={deletePrecio !== null}
        onClose={() => setDeletePrecio(null)}
        title="Eliminar precio"
        centered
        size="sm"
      >
        <Stack gap="md">
          <Text>
            ¿Eliminar el precio de{' '}
            <strong>{deletePrecio ? formatMXN(deletePrecio.precio) : ''}</strong> del{' '}
            <strong>{deletePrecio ? formatFecha(deletePrecio.fecha) : ''}</strong> para{' '}
            <strong>{deletePrecio?.pieza}</strong>? Esta acción no se puede deshacer.
          </Text>
          {deleteMut.error && (
            <Alert color="red" title="Error">{(deleteMut.error as Error).message}</Alert>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDeletePrecio(null)}
              disabled={deleteMut.isPending}>
              Cancelar
            </Button>
            <Button color="red" loading={deleteMut.isPending}
              onClick={() =>
                deleteMut.mutate(deletePrecio!.id, { onSuccess: () => setDeletePrecio(null) })
              }>
              Eliminar
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  )
}
