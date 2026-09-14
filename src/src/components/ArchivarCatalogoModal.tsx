// Confirmar el archivado (o la restauración) de un renglón de catálogo.
//
// Uno solo para los ocho catálogos: el texto cambia por la etiqueta que le pasa
// cada pantalla y nada más. Antes cada catálogo traía su propio modal de
// borrado copiado del anterior, y entre copia y copia se perdían frases —el
// aviso de qué se lleva por delante, el mensaje de error del servidor—.
import { useState } from 'react'
import { Modal, Stack, Text, TextInput, Alert, Group, Button } from '@mantine/core'
import {
  useArchivarCatalogo, useRestaurarCatalogo,
  type CatalogoArchivable, type CamposArchivado,
} from '../hooks/useArchivado'

export interface ItemArchivable extends CamposArchivado {
  id:     number
  nombre: string
}

export default function ArchivarCatalogoModal({
  recurso, item, etiqueta, onClose, onArchivado,
}: {
  recurso:  CatalogoArchivable
  /** null = cerrado. */
  item:     ItemArchivable | null
  /** Cómo se le nombra en el texto, con artículo: "la sucursal", "el proveedor". */
  etiqueta: string
  onClose:  () => void
  /** Para cerrar una ficha de detalle que ya no tiene sentido dejar abierta. */
  onArchivado?: () => void
}) {
  const [motivo, setMotivo] = useState('')
  const archivarMut  = useArchivarCatalogo(recurso)
  const restaurarMut = useRestaurarCatalogo(recurso)

  const restaurando = item?.archivado_en != null
  const mut = restaurando ? restaurarMut : archivarMut

  function cerrar() {
    archivarMut.reset()
    restaurarMut.reset()
    setMotivo('')
    onClose()
  }

  function listo() {
    cerrar()
    if (!restaurando) onArchivado?.()
  }

  return (
    <Modal
      opened={item !== null} onClose={cerrar}
      title={restaurando ? `Restaurar ${etiqueta}` : `Archivar ${etiqueta}`}
      centered size="sm"
    >
      <Stack gap="md">
        {restaurando ? (
          <>
            <Text>
              ¿Volver a usar <strong>{item?.nombre}</strong>?
            </Text>
            {item?.archivado_motivo && (
              <Text size="sm" c="dimmed">Se archivó por: {item.archivado_motivo}</Text>
            )}
          </>
        ) : (
          <>
            <Text>
              ¿Archivar <strong>{item?.nombre}</strong>?
            </Text>
            <Text size="sm" c="dimmed">
              Deja de aparecer en este catálogo y en los selectores, pero no se borra: todo
              lo que ya lo menciona lo sigue mostrando, y puedes restaurarlo cuando quieras.
            </Text>
            <TextInput
              label="Motivo" placeholder="Ya no se usa"
              description="Opcional, pero evita que alguien lo vuelva a capturar duplicado."
              maxLength={200}
              value={motivo} onChange={(e) => setMotivo(e.currentTarget.value)}
            />
          </>
        )}
        {mut.error && <Alert color="red" title="No se pudo">{(mut.error as Error).message}</Alert>}
        <Group justify="flex-end">
          <Button variant="default" onClick={cerrar} disabled={mut.isPending}>Cancelar</Button>
          <Button
            color={restaurando ? 'teal' : 'orange'} loading={mut.isPending}
            onClick={() => {
              if (restaurando) restaurarMut.mutate(item!.id, { onSuccess: listo })
              else archivarMut.mutate(
                { id: item!.id, motivo: motivo.trim() || undefined },
                { onSuccess: listo },
              )
            }}
          >
            {restaurando ? 'Restaurar' : 'Archivar'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
