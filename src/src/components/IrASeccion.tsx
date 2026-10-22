import { Button } from '@mantine/core'
import { IconArrowRight } from '@tabler/icons-react'
import { usePermisos, type Seccion } from '../hooks/usePermisos'

/**
 * Un botón para ir a la pantalla donde se resuelve lo que se está viendo. Solo
 * sale si quien mira puede abrirla: un enlace que lleva a un 403 enseña a no
 * confiar en los enlaces.
 */
export function IrASeccion({ seccion, children, onNavigate }: {
  seccion: Seccion
  children: React.ReactNode
  onNavigate?: (s: Seccion) => void
}) {
  const { puedeVerSeccion } = usePermisos()
  if (!onNavigate || !puedeVerSeccion(seccion)) return null
  return (
    <Button
      size="compact-xs" variant="subtle"
      rightSection={<IconArrowRight size={12} />}
      onClick={() => onNavigate(seccion)}
    >
      {children}
    </Button>
  )
}
