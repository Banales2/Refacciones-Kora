// La historia de desgaste de UNA pieza física: cada medición de profundímetro
// que se le ha hecho, en orden.
//
// Es lo que justifica que la lectura del chequeo guarde de qué unidad era. La
// llanta puede haber pasado por tres ejes y dos camiones, y su curva es una
// sola: si las mediciones colgaran del vehículo, rotarla borraría su historia y
// solo quedaría la del camión, que no sirve para decidir cuándo cambiarla.
//
// Lo que se enseña es lo que no se puede ver en una sola medición: cuánto
// dibujo se pierde y en cuántos kilómetros. Nada de esto se guarda —se calcula
// aquí— por lo mismo que el kilometraje de la unidad: un acumulado se
// desalinea en cuanto alguien corrige una lectura.
import { Modal, Stack, Group, Text, Table, Loader, Center, Alert, Badge } from '@mantine/core'
import { useDesgasteUnidad } from '../hooks/useUnidadesPieza'
import type { UnidadPieza } from '../hooks/useUnidadesPieza'

function fmtFecha(iso: string) {
  return new Date(`${iso.split('T')[0]}T12:00:00`).toLocaleDateString('es-MX', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

export default function DesgasteUnidadModal({
  unidad, onClose,
}: {
  unidad: UnidadPieza
  onClose: () => void
}) {
  const { data, isLoading, isError } = useDesgasteUnidad(unidad.id)
  const lecturas = data?.data ?? []

  const primera = lecturas[0]
  const ultima = lecturas[lecturas.length - 1]

  // Lo gastado entre la primera y la última medición, y en cuántos kilómetros.
  // Hacen falta dos lecturas: con una sola no hay tramo que medir, igual que el
  // rendimiento de una recarga necesita la carga anterior.
  const gastado = primera && ultima && lecturas.length > 1
    ? primera.milimetros - ultima.milimetros
    : null
  const km = primera?.lectura != null && ultima?.lectura != null
    ? ultima.lectura - primera.lectura
    : null
  // Milímetros por cada diez mil kilómetros: es la cifra con la que se compara
  // una llanta contra otra, porque no depende de cuánto lleve rodando.
  const porDiezMil = gastado != null && gastado > 0 && km != null && km > 0
    ? (gastado / km) * 10000
    : null

  return (
    <Modal
      opened
      onClose={onClose}
      size="lg"
      title={`Desgaste de ${unidad.etiqueta ? `la pieza ${unidad.etiqueta}` : unidad.numero_serie}`}
    >
      <Stack gap="sm">
        <Text size="xs" c="dimmed">
          {unidad.numero_serie} · {unidad.descripcion}
        </Text>

        {isLoading ? (
          <Center py="xl"><Loader size="sm" /></Center>
        ) : isError ? (
          <Alert color="red" title="Error">No se pudo cargar el historial.</Alert>
        ) : lecturas.length === 0 ? (
          <Text c="dimmed" size="sm" py="md">
            A esta pieza no se le ha medido el desgaste todavía. Se mide en el
            chequeo diario de la unidad donde esté montada.
          </Text>
        ) : (
          <>
            <Group gap="lg">
              <div>
                <Text size="xs" c="dimmed" tt="uppercase" fw={600}>Última</Text>
                <Text fw={700} size="lg">{ultima.milimetros} mm</Text>
              </div>
              {gastado != null && gastado > 0 && (
                <div>
                  <Text size="xs" c="dimmed" tt="uppercase" fw={600}>Gastado</Text>
                  <Text fw={700} size="lg">
                    {gastado.toFixed(1)} mm
                    {km != null && km > 0 && (
                      <Text component="span" size="xs" c="dimmed" fw={400}>
                        {' '}en {km.toLocaleString('es-MX')} km
                      </Text>
                    )}
                  </Text>
                </div>
              )}
              {porDiezMil != null && (
                <div>
                  <Text size="xs" c="dimmed" tt="uppercase" fw={600}>Ritmo</Text>
                  <Text fw={700} size="lg">
                    {porDiezMil.toFixed(1)}
                    <Text component="span" size="xs" c="dimmed" fw={400}> mm / 10,000 km</Text>
                  </Text>
                </div>
              )}
            </Group>

            <Table withTableBorder striped>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Fecha</Table.Th>
                  <Table.Th>Dónde estaba</Table.Th>
                  <Table.Th ta="right">Odómetro</Table.Th>
                  <Table.Th ta="right">Dibujo</Table.Th>
                  <Table.Th ta="right">Cambio</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {lecturas.map((l, i) => {
                  // Contra la medición anterior de esta misma pieza. La primera
                  // no tiene contra qué compararse, y eso no es un cero.
                  const previa = i > 0 ? lecturas[i - 1] : null
                  const delta = previa ? l.milimetros - previa.milimetros : null
                  return (
                    <Table.Tr key={l.chequeo_id}>
                      <Table.Td>{fmtFecha(l.fecha)}</Table.Td>
                      <Table.Td>
                        <Text size="sm">{l.vehiculo}</Text>
                        <Text size="xs" c="dimmed">{l.etiqueta || 'Sin posición'}</Text>
                      </Table.Td>
                      <Table.Td ta="right">
                        {l.lectura != null ? `${l.lectura.toLocaleString('es-MX')} km` : '—'}
                      </Table.Td>
                      <Table.Td ta="right" fw={500}>{l.milimetros} mm</Table.Td>
                      <Table.Td ta="right">
                        {delta == null ? (
                          <Text size="xs" c="dimmed">—</Text>
                        ) : (
                          // Subir de dibujo no es posible en una llanta: es que
                          // la cambiaron sin capturarlo, o que alguien midió
                          // otra rueda. Se marca en vez de esconderse.
                          <Badge size="xs" variant="light" color={delta > 0 ? 'orange' : 'gray'}>
                            {delta > 0 ? '+' : ''}{delta.toFixed(1)} mm
                          </Badge>
                        )}
                      </Table.Td>
                    </Table.Tr>
                  )
                })}
              </Table.Tbody>
            </Table>
          </>
        )}
      </Stack>
    </Modal>
  )
}
