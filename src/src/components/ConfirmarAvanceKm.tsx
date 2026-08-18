// Aviso de que el odómetro del vehículo va a avanzar.
//
// Al registrar un mantenimiento o una recarga se captura la lectura del
// odómetro, y si es mayor a la que tiene la unidad el sistema la adopta como su
// kilometraje (si es menor no cambia nada: el odómetro no retrocede). Eso toca
// un dato que se ve en toda la aplicación —los requerimientos por kilometraje
// se calculan contra él—, así que no debe pasar de callado: se avisa y se pide
// aceptar antes de guardar.
import { Modal, Stack, Text, Group, Button, Alert } from '@mantine/core'
import { IconAlertTriangle } from '@tabler/icons-react'

function formatKm(n: number) {
  return `${n.toLocaleString('es-MX')} km`
}

export default function ConfirmarAvanceKm({
  opened, kmVehiculo, kmNuevo, isPending, onConfirm, onCancel,
}: {
  opened:     boolean
  kmVehiculo: number | null
  kmNuevo:    number
  isPending:  boolean
  onConfirm:  () => void
  onCancel:   () => void
}) {
  return (
    <Modal
      opened={opened}
      onClose={onCancel}
      title="Se actualizará el kilometraje"
      centered
      size="sm"
    >
      <Stack gap="md">
        <Alert color="yellow" icon={<IconAlertTriangle size={16} />}>
          {kmVehiculo == null ? (
            <Text size="sm">
              El vehículo no tiene kilometraje registrado y quedará en{' '}
              <strong>{formatKm(kmNuevo)}</strong>.
            </Text>
          ) : (
            <Text size="sm">
              El kilometraje del vehículo pasará de <strong>{formatKm(kmVehiculo)}</strong> a{' '}
              <strong>{formatKm(kmNuevo)}</strong>.
            </Text>
          )}
        </Alert>
        <Text size="xs" c="dimmed">
          Si la lectura no es correcta, cancela y corrige el kilometraje.
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={onCancel} disabled={isPending}>
            Cancelar
          </Button>
          <Button onClick={onConfirm} loading={isPending}>
            Aceptar
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
