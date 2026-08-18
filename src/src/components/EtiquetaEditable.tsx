// Celda de la etiqueta de un renglón de piezas: la muestra y deja renombrarla
// sin salir de la tabla. Renombrar no es quitar y volver a agregar —eso borraría
// la refacción montada y cortaría el historial—, así que se edita en su lugar.
//
// La misma celda se usa en la plantilla del modelo y en las piezas del vehículo;
// lo único que cambia entre las dos es qué mutación recibe.
import { useState } from 'react'
import { ActionIcon, Badge, Group, Text, TextInput, Tooltip } from '@mantine/core'
import { IconCheck, IconPencil, IconX } from '@tabler/icons-react'
import { limpiarTextoSimple } from '../lib/validaciones'

export default function EtiquetaEditable({
  etiqueta, onGuardar, isPending = false, motivoBloqueo,
}: {
  etiqueta: string
  onGuardar: (nueva: string) => void
  isPending?: boolean
  /** Cuando viene, la celda es de solo lectura y lo explica en un tooltip. */
  motivoBloqueo?: string
}) {
  const [editando, setEditando] = useState(false)
  const [valor, setValor] = useState(etiqueta)

  function abrir() {
    setValor(etiqueta)
    setEditando(true)
  }

  function guardar() {
    const nueva = valor.trim()
    setEditando(false)
    // Sin cambio no se llama a la API: un PUT que no mueve nada solo ensucia la
    // bitácora de auditoría.
    if (nueva !== etiqueta) onGuardar(nueva)
  }

  if (editando) {
    return (
      <Group gap={4} wrap="nowrap">
        <TextInput
          size="xs"
          autoFocus
          placeholder="Sin etiqueta"
          value={valor}
          onChange={(e) => setValor(limpiarTextoSimple(e.currentTarget.value, 40))}
          onKeyDown={(e) => {
            if (e.key === 'Enter')  { e.preventDefault(); guardar() }
            if (e.key === 'Escape') { e.preventDefault(); setEditando(false) }
          }}
        />
        <ActionIcon size="sm" variant="subtle" color="green" aria-label="Guardar etiqueta" onClick={guardar}>
          <IconCheck size={14} />
        </ActionIcon>
        <ActionIcon size="sm" variant="subtle" color="gray" aria-label="Cancelar" onClick={() => setEditando(false)}>
          <IconX size={14} />
        </ActionIcon>
      </Group>
    )
  }

  const texto = etiqueta
    ? <Badge size="sm" variant="light">{etiqueta}</Badge>
    : <Text size="xs" c="dimmed">—</Text>

  if (motivoBloqueo) {
    return <Tooltip label={motivoBloqueo}>{<span>{texto}</span>}</Tooltip>
  }

  return (
    <Group gap={4} wrap="nowrap">
      {texto}
      <Tooltip label={etiqueta ? 'Renombrar la etiqueta' : 'Ponerle una etiqueta'}>
        <ActionIcon
          size="sm" variant="subtle" color="gray"
          aria-label="Renombrar etiqueta"
          loading={isPending}
          onClick={abrir}
        >
          <IconPencil size={14} />
        </ActionIcon>
      </Tooltip>
    </Group>
  )
}
