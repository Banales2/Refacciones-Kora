// Aviso de que la lectura del chequeo va a HACER BAJAR el odómetro.
//
// En el chequeo de flotilla la lectura manda aunque sea menor que la registrada
// —la toma alguien parado frente al tablero, así que es la buena—, y a
// diferencia de un mantenimiento o una recarga, aquí el odómetro sí retrocede.
// Eso toca un dato del que cuelga toda la proyección de preventivos por
// kilómetro, y la causa más común de una lectura menor no es un odómetro
// reemplazado: es un dígito mal tecleado con el teléfono en la mano. Por eso se
// pregunta antes de guardar, y no después con un aviso que ya no deshace nada.
//
// Hermano de `ConfirmarAvanceKm`, pero no el mismo: ahí el odómetro sube y lo
// peor que pasa es adelantarlo; aquí baja, y el hueco se lleva los kilómetros
// recorridos de por medio. De ahí el color rojo y que el botón diga qué hace.
import { Modal, Stack, Text, Group, Button, Alert } from '@mantine/core'
import { IconAlertTriangle } from '@tabler/icons-react'

export default function ConfirmarLecturaMenor({
  opened, etiqueta, kmVehiculo, kmNuevo, isPending, onConfirm, onCancel,
}: {
  opened:     boolean
  /** Cómo se llama la lectura en esta unidad: "Odómetro", "Horómetro"… */
  etiqueta:   string
  kmVehiculo: number
  kmNuevo:    number
  isPending:  boolean
  onConfirm:  () => void
  onCancel:   () => void
}) {
  const fmt = (n: number) => n.toLocaleString('es-MX')

  return (
    <Modal
      opened={opened}
      onClose={onCancel}
      title="La lectura es menor que la registrada"
      centered
      size="sm"
    >
      <Stack gap="md">
        <Alert color="red" icon={<IconAlertTriangle size={16} />}>
          <Text size="sm">
            {etiqueta} capturado: <strong>{fmt(kmNuevo)}</strong>. La unidad tiene{' '}
            <strong>{fmt(kmVehiculo)}</strong>.
          </Text>
          <Text size="sm" mt={6}>
            Si guardas, la unidad baja a <strong>{fmt(kmNuevo)}</strong> y se pierden{' '}
            <strong>{fmt(kmVehiculo - kmNuevo)}</strong> de diferencia.
          </Text>
        </Alert>
        <Text size="xs" c="dimmed">
          Confírmalo solo si eso es lo que marca el tablero. Si te faltó o te
          sobró un dígito, cancela y corrige la lectura.
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={onCancel} disabled={isPending}>
            Corregir
          </Button>
          <Button color="red" onClick={onConfirm} loading={isPending}>
            Sí, bajar la lectura
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
