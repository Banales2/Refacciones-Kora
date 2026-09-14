// Confirmación para los borrados que SÍ siguen existiendo: los vínculos de
// configuración —qué tipo de pieza pide un modelo, qué renglón propio lleva una
// unidad, qué mínimo se vigila de una refacción—.
//
// Esos no son entidades sino decisiones de armado, y por eso se siguen pudiendo
// quitar desde la aplicación mientras todo lo demás solo se archiva. Lo que no
// pueden seguir haciendo es irse de un clic: varios arrastran cosas que no se
// ven desde el botón —quitar un tipo de pieza de un modelo borra la refacción
// que CADA unidad de ese modelo tenía elegida para ese renglón— y un clic de
// más no se deshace.
import type { ReactNode } from 'react'
import { Modal, Stack, Text, Alert, Group, Button } from '@mantine/core'

export default function ConfirmarQuitar({
  abierto, titulo, mensaje, advertencia, error, cargando,
  textoConfirmar = 'Quitar', onCancelar, onConfirmar, zIndex,
}: {
  abierto:      boolean
  titulo:       string
  mensaje:      ReactNode
  /** Lo que se lleva por delante, si se lleva algo que no se ve desde el botón. */
  advertencia?: ReactNode
  error?:       unknown
  cargando?:    boolean
  textoConfirmar?: string
  onCancelar:   () => void
  onConfirmar:  () => void
  /** Para los que se abren encima de un cajón, que si no los tapa. */
  zIndex?:      number
}) {
  return (
    <Modal
      opened={abierto} onClose={onCancelar} title={titulo}
      centered size="sm" zIndex={zIndex}
    >
      <Stack gap="md">
        <Text>{mensaje}</Text>
        {advertencia && <Text size="sm" c="dimmed">{advertencia}</Text>}
        {error != null && (
          <Alert color="red" title="No se pudo">{(error as Error).message}</Alert>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onCancelar} disabled={cargando}>Cancelar</Button>
          <Button color="red" loading={cargando} onClick={onConfirmar}>{textoConfirmar}</Button>
        </Group>
      </Stack>
    </Modal>
  )
}
