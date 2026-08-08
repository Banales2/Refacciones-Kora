// Página Incidencias: por ahora solo la pestaña y su encabezado. El contenido
// (registro y seguimiento de incidencias de la flota) queda pendiente.
import { Stack, Group, Text, Center, Alert } from '@mantine/core'

export default function Incidencias() {
  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end">
        <div>
          <Text size="xl" fw={600}>Incidencias</Text>
          <Text size="sm" c="dimmed">Incidencias reportadas de la flota</Text>
        </div>
      </Group>

      <Center py="xl">
        <Alert color="gray" title="En construcción" maw={480}>
          Todavía no hay nada que mostrar aquí: esta sección está pendiente de definir.
        </Alert>
      </Center>
    </Stack>
  )
}
