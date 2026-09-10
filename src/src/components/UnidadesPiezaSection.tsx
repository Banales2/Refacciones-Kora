// Las piezas físicas de una refacción, una por una: dónde está cada una, si es
// nueva o usada, y cuánto lleva recorrido.
//
// Aparece dentro del drawer de lotes, debajo del historial de compras, y solo
// cuando la refacción es de un tipo con rastreo individual. Para lo que se
// cuenta a granel no hay nada que mostrar y la sección no se pinta.
//
// Casi todo lo de aquí es derivado de la bitácora de instalaciones, así que no
// se edita: para que una unidad cambie de estado hay que montarla o quitarla del
// vehículo, que es donde ese cambio de verdad ocurre. Lo único que se captura a
// mano es la etiqueta —el folio pegado a la pieza—, porque es lo que permite
// casar el número del estante con el del sistema.
import { useState } from 'react'
import {
  Stack, Group, Text, Table, Badge, Loader, Center, Alert, ActionIcon,
  TextInput, Tooltip, Divider,
} from '@mantine/core'
import { IconPencil, IconCheck, IconX } from '@tabler/icons-react'
import {
  useUnidadesPieza, useSetEtiquetaUnidad, ESTADO_UNIDAD,
} from '../hooks/useUnidadesPieza'
import type { UnidadPieza } from '../hooks/useUnidadesPieza'

function fmtKm(km: number | null) {
  if (km == null) return '—'
  return `${km.toLocaleString('es-MX')} km`
}

/** La etiqueta física, editable en sitio. Lo único que se captura de una unidad. */
function Etiqueta({ unidad, piezaId }: { unidad: UnidadPieza; piezaId: number }) {
  const [editando, setEditando] = useState(false)
  const [valor, setValor] = useState(unidad.etiqueta ?? '')
  const mut = useSetEtiquetaUnidad(piezaId)

  function guardar() {
    mut.mutate(
      { id: unidad.id, etiqueta: valor.trim() || null },
      { onSuccess: () => setEditando(false) },
    )
  }

  if (!editando) {
    return (
      <Group gap={4} wrap="nowrap">
        {unidad.etiqueta
          ? <Text size="sm">{unidad.etiqueta}</Text>
          : <Text size="sm" c="dimmed">Sin etiqueta</Text>}
        <ActionIcon
          variant="subtle" color="gray" size="xs"
          aria-label={`Etiquetar unidad ${unidad.id}`}
          onClick={() => { setValor(unidad.etiqueta ?? ''); mut.reset(); setEditando(true) }}
        >
          <IconPencil size={12} />
        </ActionIcon>
      </Group>
    )
  }

  return (
    <Group gap={4} wrap="nowrap">
      <TextInput
        size="xs" w={110} data-autofocus
        maxLength={40}
        value={valor}
        onChange={(e) => setValor(e.currentTarget.value.slice(0, 40))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') guardar()
          if (e.key === 'Escape') setEditando(false)
        }}
      />
      <ActionIcon
        variant="subtle" color="green" size="xs" aria-label="Guardar etiqueta"
        loading={mut.isPending} onClick={guardar}
      >
        <IconCheck size={13} />
      </ActionIcon>
      <ActionIcon
        variant="subtle" color="gray" size="xs" aria-label="Cancelar"
        onClick={() => setEditando(false)}
      >
        <IconX size={13} />
      </ActionIcon>
    </Group>
  )
}

export default function UnidadesPiezaSection({ piezaId }: { piezaId: number }) {
  const { data, isLoading, isError } = useUnidadesPieza(piezaId)
  const unidades = data?.data ?? []

  // Sin unidades no es un error: es una refacción que se cuenta a granel. No se
  // pinta nada para no sugerir que falta capturar algo.
  if (isLoading) return <Center py="md"><Loader size="sm" /></Center>
  if (isError) {
    return <Alert color="red" title="Error">No se pudieron cargar las piezas identificadas.</Alert>
  }
  if (!unidades.length) return null

  const enAlmacen = unidades.filter((u) => u.estado === 'almacen').length
  const montadas  = unidades.filter((u) => u.estado === 'montada').length

  return (
    <Stack gap="xs">
      <Divider
        label={
          <Group gap={8}>
            <Text size="sm" fw={500}>Piezas identificadas ({unidades.length})</Text>
            <Badge size="xs" variant="light" color="green">{enAlmacen} en almacén</Badge>
            <Badge size="xs" variant="light" color="blue">{montadas} montadas</Badge>
          </Group>
        }
        labelPosition="left"
      />
      <Text size="xs" c="dimmed">
        Esta refacción se rastrea pieza por pieza. El estado y el kilometraje salen de
        su historial de montajes, así que no se editan aquí: cambian al montarla o
        quitarla de una unidad.
      </Text>

      <Table.ScrollContainer minWidth={720}>
        <Table withTableBorder striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Etiqueta</Table.Th>
              <Table.Th>Estado</Table.Th>
              <Table.Th>Dónde</Table.Th>
              <Table.Th>Compra</Table.Th>
              <Table.Th style={{ textAlign: 'center' }}>Montajes</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Recorrido</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {unidades.map((u) => {
              const est = ESTADO_UNIDAD[u.estado]
              return (
                <Table.Tr key={u.id}>
                  <Table.Td><Etiqueta unidad={u} piezaId={piezaId} /></Table.Td>
                  <Table.Td>
                    <Group gap={4}>
                      <Badge size="xs" variant="light" color={est.color}>{est.label}</Badge>
                      {u.condicion === 'usada' && (
                        <Tooltip label="Ya estuvo montada al menos una vez">
                          <Badge size="xs" variant="outline" color="gray">Usada</Badge>
                        </Tooltip>
                      )}
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    {u.estado === 'montada' ? (
                      <>
                        <Text size="sm">{u.vehiculo ?? `Unidad ${u.vehiculo_id}`}</Text>
                        {u.desde && <Text size="xs" c="dimmed">desde {u.desde}</Text>}
                      </>
                    ) : (
                      <Text size="sm" c="dimmed">{u.sucursal ?? '—'}</Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs">{u.num_factura ?? 'Sin factura'}</Text>
                    <Text size="xs" c="dimmed">{u.proveedor ?? 'Recuperada de unidad'}</Text>
                  </Table.Td>
                  <Table.Td style={{ textAlign: 'center' }}>{u.montajes}</Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>
                    <Text size="sm">{fmtKm(u.km_recorridos)}</Text>
                  </Table.Td>
                </Table.Tr>
              )
            })}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Stack>
  )
}
