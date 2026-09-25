// El odómetro de una unidad se puso en cero: tablero reemplazado, o el contador
// que dio la vuelta al llegar a su tope.
//
// No es corregir una lectura mal capturada —eso se hace en el chequeo diario,
// que sí deja fijar lo que marque el tablero— sino registrar un hecho que parte
// la historia de la unidad en dos: los kilómetros que traía dejan de contarse
// en el tablero y pasan a acumularse aparte. De ahí en adelante, la vida de la
// unidad es esa suma más lo que marque el velocímetro.
//
// Lo acumulado no se guarda en ninguna columna: se suma de los reinicios
// registrados. Por eso aquí solo se captura el hecho. Ver la migración 053.
import { useState } from 'react'
import {
  Modal, Stack, Group, Text, Alert, Button, NumberInput, Textarea, Table, Divider,
} from '@mantine/core'
import { IconRotateClockwise } from '@tabler/icons-react'
import { useReiniciosOdometro, useReiniciarOdometro } from '../hooks/useVehiculos'
import { FechaInput } from './FechaInput'
import { KM_MAX } from '../lib/validaciones'

function hoyIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function fmtFecha(iso: string) {
  return new Date(`${iso.split('T')[0]}T12:00:00`).toLocaleDateString('es-MX', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

export default function ReiniciarOdometroModal({
  vehiculoId, kilometraje, onClose,
}: {
  vehiculoId: number
  /** Lo que el sistema tiene hoy en el tablero. Es el valor por omisión. */
  kilometraje: number | null
  onClose: () => void
}) {
  const hoy = hoyIso()
  const { data: previos } = useReiniciosOdometro(vehiculoId)
  const mut = useReiniciarOdometro(vehiculoId)

  const [fecha, setFecha] = useState(hoy)
  const [kmAlReiniciar, setKmAlReiniciar] = useState<number | ''>(kilometraje ?? '')
  const [kmNuevo, setKmNuevo] = useState<number | ''>(0)
  const [motivo, setMotivo] = useState('')

  const reinicios = previos?.data ?? []
  const yaAcumulado = reinicios.reduce((s, r) => s + r.km_al_reiniciar, 0)

  // Lo que quedará como vida de la unidad si esto se guarda. Se enseña antes
  // de guardar porque es el número que la operación va a creerse de aquí en
  // adelante, y es más fácil de revisar ahora que de corregir después.
  const totalDespues = kmAlReiniciar === ''
    ? null
    : yaAcumulado + Number(kmAlReiniciar) + Number(kmNuevo || 0)

  const menor = kilometraje != null && kmAlReiniciar !== '' && Number(kmAlReiniciar) < kilometraje

  function guardar() {
    if (kmAlReiniciar === '' || menor) return
    mut.mutate(
      {
        fecha,
        km_al_reiniciar: Number(kmAlReiniciar),
        km_nuevo:        Number(kmNuevo || 0),
        motivo:          motivo.trim() || null,
      },
      { onSuccess: onClose },
    )
  }

  return (
    <Modal opened onClose={onClose} title="Reiniciar el odómetro" centered size="md">
      <Stack gap="sm">
        <Alert color="blue" variant="light" icon={<IconRotateClockwise size={16} />}>
          <Text size="xs">
            Esto no corrige una lectura: registra que el tablero se puso en cero. Los
            kilómetros que la unidad ya traía se siguen contando aparte, así que sus
            servicios, sus garantías y la vida de sus llantas no se reinician con él.
            Para corregir una lectura mal capturada, usa el chequeo diario.
          </Text>
        </Alert>

        <NumberInput
          label="Último kilometraje antes de reiniciar"
          description="Lo que marcaba el tablero justo antes. Es lo que se va a acumular."
          required
          min={1}
          max={KM_MAX}
          suffix=" km"
          thousandSeparator=","
          clampBehavior="strict"
          value={kmAlReiniciar}
          onChange={(v) => setKmAlReiniciar(v as number | '')}
          error={menor
            ? `El sistema tiene ${kilometraje!.toLocaleString('es-MX')} km: no puede ser menor`
            : undefined}
        />

        <NumberInput
          label="Lectura actual del tablero"
          description="Casi siempre 0. Distinto si la unidad ya rodó desde que se reinició."
          min={0}
          max={KM_MAX}
          suffix=" km"
          thousandSeparator=","
          clampBehavior="strict"
          value={kmNuevo}
          onChange={(v) => setKmNuevo(v as number | '')}
        />

        <FechaInput
          label="Fecha del reinicio"
          required
          maxDate={hoy}
          value={fecha}
          onChange={setFecha}
        />

        <Textarea
          label="Motivo"
          placeholder="Tablero reemplazado, odómetro al tope, reparación eléctrica…"
          description="Opcional, pero es lo que explica el salto cuando alguien lo revise dentro de un año."
          rows={2}
          maxLength={200}
          value={motivo}
          onChange={(e) => setMotivo(e.currentTarget.value)}
        />

        {totalDespues != null && (
          <Alert color="gray" variant="light" py={8}>
            <Text size="xs">
              La unidad quedará con{' '}
              <Text component="span" fw={700}>{totalDespues.toLocaleString('es-MX')} km</Text>{' '}
              de vida, y el tablero en {Number(kmNuevo || 0).toLocaleString('es-MX')} km.
            </Text>
          </Alert>
        )}

        {/* Ya hubo otros: se enseñan porque un segundo reinicio suma sobre lo
            que ya estaba, y conviene ver contra qué se está sumando. */}
        {reinicios.length > 0 && (
          <>
            <Divider label="Reinicios anteriores" labelPosition="left" />
            <Table withTableBorder>
              <Table.Tbody>
                {reinicios.map((r) => (
                  <Table.Tr key={r.id}>
                    <Table.Td><Text size="xs">{fmtFecha(r.fecha)}</Text></Table.Td>
                    <Table.Td>
                      <Text size="xs" fw={500}>{r.km_al_reiniciar.toLocaleString('es-MX')} km</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" c="dimmed">{r.motivo ?? 'Sin motivo'}</Text>
                      <Text size="xs" c="dimmed">{r.registrado_por}</Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </>
        )}

        {mut.error && <Alert color="red" title="Error">{(mut.error as Error).message}</Alert>}

        <Group justify="flex-end" mt="xs">
          <Button variant="default" onClick={onClose} disabled={mut.isPending}>Cancelar</Button>
          <Button
            color="orange"
            loading={mut.isPending}
            disabled={kmAlReiniciar === '' || menor}
            onClick={guardar}
          >
            Registrar el reinicio
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
