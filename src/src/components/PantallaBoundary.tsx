// Red para la pantalla que no se pudo cargar.
//
// Las pantallas se cargan al abrirlas (React.lazy en Layout). Si el pedazo no
// llega —sin conexión y fuera de la caché, o una versión vieja después de un
// despliegue que ni la recarga automática de main.tsx arregló—, sin esto React
// desmonta la app entera y queda en blanco. Aquí se queda el menú, se dice qué
// pasó y se ofrece recargar.
//
// Layout le pone `key` con la sección: cambiar de pantalla limpia el error.
import { Component, type ReactNode } from 'react'
import { Alert, Button, Stack, Text } from '@mantine/core'
import { IconAlertTriangle, IconRefresh } from '@tabler/icons-react'

export default class PantallaBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error('[pantalla] no se pudo mostrar:', error)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <Alert color="red" variant="light" icon={<IconAlertTriangle size={18} />} title="No se pudo abrir esta pantalla">
        <Stack gap="sm" align="flex-start">
          <Text size="sm">
            Puede ser la conexión, o que se publicó una versión nueva de la app mientras la
            tenías abierta. Recargar casi siempre lo arregla.
          </Text>
          <Button size="xs" leftSection={<IconRefresh size={14} />} onClick={() => window.location.reload()}>
            Recargar
          </Button>
        </Stack>
      </Alert>
    )
  }
}
