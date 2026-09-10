// Ponerle nombre a las piezas que ya estaban en el estante.
//
// Encender el rastreo de un tipo no hace aparecer unidades para lo que ya se
// había comprado: esas piezas están en la existencia pero no se pueden
// identificar. Este modal es el momento de arreglarlo — se abre justo al activar
// el interruptor, con el stock delante, para capturar el folio de cada una.
//
// No crea unidades en blanco de un golpe a propósito: una unidad sin nombre no
// sirve más que para volver a buscarla después. Pero los folios que se dejen
// vacíos SÍ crean su unidad, porque la pieza existe aunque no traiga número
// grabado; lo que se evita es que ese sea el camino por omisión.
import { useState } from 'react'
import {
  Modal, Stack, Group, Text, TextInput, Button, Alert, Loader, Center, Paper, Badge,
} from '@mantine/core'
import { useSinIdentificar, useIdentificarExistentes } from '../hooks/useUnidadesPieza'
import type { GrupoSinIdentificar } from '../hooks/useUnidadesPieza'

/** La clave de un grupo: mismo estante, misma compra. */
const claveGrupo = (g: GrupoSinIdentificar) => `${g.pieza_id}|${g.lote_id}|${g.sucursal_id ?? ''}`

/** La casilla i-ésima de un grupo. Un mapa disperso evita tener que inicializar
 *  arreglos —y sincronizarlos con un efecto— cada vez que la lista se refresca. */
const claveCasilla = (g: GrupoSinIdentificar, i: number) => `${claveGrupo(g)}#${i}`

export default function IdentificarExistentesModal({
  opened, onClose, tipoPiezaId, piezaId, tipoNombre,
}: {
  opened:       boolean
  onClose:      () => void
  /** Al activar el rastreo de un tipo: pregunta por todo lo que ese tipo tenía. */
  tipoPiezaId?: number
  /** Desde la ficha de una refacción: solo la suya. */
  piezaId?:     number
  tipoNombre?:  string
}) {
  const { data, isLoading } = useSinIdentificar({ tipoPiezaId, piezaId }, opened)
  const mut = useIdentificarExistentes()
  const grupos = data?.data ?? []

  // Lo tecleado, por casilla. Disperso a propósito: lo que no se ha escrito no
  // está, así que un refetch de la lista no puede pisar lo capturado ni obliga a
  // sincronizar arreglos con un efecto.
  const [folios, setFolios] = useState<Record<string, string>>({})

  const total = grupos.reduce((n, g) => n + g.faltan, 0)
  const conFolio = Object.values(folios).filter((f) => f.trim()).length

  function guardar() {
    mut.mutate(
      grupos.map((g) => ({
        pieza_id:    g.pieza_id,
        lote_id:     g.lote_id,
        sucursal_id: g.sucursal_id,
        etiquetas:   Array.from({ length: g.faltan }, (_, i) => folios[claveCasilla(g, i)] ?? ''),
      })),
      { onSuccess: () => { setFolios({}); onClose() } },
    )
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={<Text fw={700}>Identificar las piezas que ya estaban</Text>}
      centered
      size="lg"
      zIndex={400}
    >
      {isLoading ? (
        <Center py="xl"><Loader /></Center>
      ) : !grupos.length ? (
        <Stack gap="md">
          <Text size="sm">
            No hay nada pendiente{tipoNombre ? ` en ${tipoNombre}` : ''}: todas las piezas
            en existencia ya tienen su identidad.
          </Text>
          <Group justify="flex-end">
            <Button onClick={onClose}>Cerrar</Button>
          </Group>
        </Stack>
      ) : (
        <Stack gap="sm">
          <Text size="sm">
            Hay <Text component="span" fw={600}>{total}</Text> pieza{total === 1 ? '' : 's'} en
            el estante que se compraron antes de encender el rastreo
            {tipoNombre ? ` de ${tipoNombre}` : ''}. Escribe el número grabado o la etiqueta
            de cada una.
          </Text>
          <Text size="xs" c="dimmed">
            Puedes dejar en blanco las que no traigan número: la pieza se registra igual y
            se rotula después desde la ficha de la refacción.
          </Text>

          {grupos.map((g) => {
            const k = claveGrupo(g)
            return (
              <Paper key={k} withBorder p="xs" radius="sm">
                <Group gap={6} mb={6}>
                  <Text size="sm" fw={600}>{g.numero_serie}</Text>
                  <Badge size="xs" variant="light">{g.faltan} pieza{g.faltan === 1 ? '' : 's'}</Badge>
                  <Text size="xs" c="dimmed">
                    {g.sucursal ?? 'sin sucursal'}
                    {g.num_factura ? ` · Fact. ${g.num_factura}` : ' · sin factura'}
                    {g.proveedor ? ` · ${g.proveedor}` : ''}
                  </Text>
                </Group>
                <Group gap={6} wrap="wrap">
                  {Array.from({ length: g.faltan }).map((_, i) => (
                    <TextInput
                      key={i}
                      size="xs"
                      w={140}
                      placeholder={`Pieza ${i + 1}`}
                      maxLength={40}
                      value={folios[claveCasilla(g, i)] ?? ''}
                      onChange={(e) => setFolios((prev) => ({
                        ...prev,
                        [claveCasilla(g, i)]: e.currentTarget.value.slice(0, 40),
                      }))}
                    />
                  ))}
                </Group>
              </Paper>
            )
          })}

          {mut.error && <Alert color="red" title="Error">{(mut.error as Error).message}</Alert>}

          <Group justify="space-between" mt="xs">
            <Text size="xs" c="dimmed">
              {conFolio} de {total} con identificador
            </Text>
            <Group gap="xs">
              <Button variant="default" onClick={onClose} disabled={mut.isPending}>
                Ahora no
              </Button>
              <Button loading={mut.isPending} onClick={guardar}>
                Registrar {total} pieza{total === 1 ? '' : 's'}
              </Button>
            </Group>
          </Group>
        </Stack>
      )}
    </Modal>
  )
}
