// Opciones de vale para el Select de la recarga. Igual que las de vehículo (ver
// OpcionVehiculo): en una sola línea —folio, fecha, chofer y unidad— el renglón
// quedaba demasiado largo y se cortaba, así que la lista lo reparte en dos y el
// campo ya elegido muestra la forma corta.
import { Badge, Group, Text } from '@mantine/core'
import type { ComboboxParsedItem, SelectProps } from '@mantine/core'
import type { ValeGasolina } from '../hooks/useValesGasolina'
import { vehiculoLabelCorto } from './OpcionVehiculo'
import { formatFecha } from '../lib/formato'

export type OpcionVale = {
  value:    string
  label:    string
  folio:    string
  fecha:    string
  chofer:   string
  unidad:   string
  placas:   string | null
  perdido:  boolean
  /** Todo lo que se puede teclear para encontrarlo, ya en minúsculas y sin acentos. */
  busqueda: string
}

function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

// Lo que queda escrito en el campo al elegir: el folio, que es lo que trae el
// papel, y el chofer para confirmar que es el que se tiene en la mano.
export function valeLabelCorto(v: Pick<ValeGasolina, 'folio' | 'conductor'>): string {
  return `Vale ${v.folio} · ${v.conductor}`
}

export function opcionVale(v: ValeGasolina): OpcionVale {
  const unidad = `${v.marca} ${v.modelo}`
  return {
    value:   String(v.id),
    label:   valeLabelCorto(v),
    folio:   v.folio,
    fecha:   formatFecha(v.fecha),
    chofer:  v.conductor,
    unidad,
    placas:  v.placas,
    perdido: v.estado === 'perdido',
    busqueda: normalizar([v.folio, v.conductor, unidad, v.placas ?? '', v.serie, vehiculoLabelCorto(v)].join(' ')),
  }
}

// El "perdido" se dice aquí: si el papel aparece y se gasta, quien lo captura
// merece ver que el sistema lo daba por extraviado —puede que esté agarrando el
// folio equivocado—.
export const renderOpcionVale: SelectProps['renderOption'] = ({ option }) => {
  const o = option as unknown as OpcionVale
  if (!o.chofer) return <Text size="sm">{o.label}</Text>
  return (
    <Group justify="space-between" wrap="nowrap" gap="sm" w="100%">
      <div style={{ minWidth: 0, flex: 1 }}>
        <Group gap={6} wrap="nowrap">
          <Text size="sm" fw={500} truncate>Vale {o.folio}</Text>
          <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>{o.fecha}</Text>
        </Group>
        <Text size="xs" c="dimmed" truncate>{o.chofer} · {o.unidad}</Text>
      </div>
      {o.perdido ? (
        <Badge variant="light" color="red" radius="sm" style={{ flexShrink: 0 }}>Perdido</Badge>
      ) : o.placas ? (
        <Badge variant="light" color="gray" radius="sm" style={{ flexShrink: 0 }}>{o.placas}</Badge>
      ) : (
        <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>Sin placas</Text>
      )}
    </Group>
  )
}

// Mantine filtra por la etiqueta, que solo trae folio y chofer: sin esto,
// buscar por placas o por la unidad no encontraba nada. Se busca por palabras,
// en el orden que sea, como en el buscador de vehículos.
export const filtrarVales = ({ options, search }: { options: ComboboxParsedItem[]; search: string }) => {
  const palabras = normalizar(search).split(/\s+/).filter(Boolean)
  if (palabras.length === 0) return options
  return options.filter((o) => {
    const texto = (o as unknown as OpcionVale).busqueda ?? normalizar((o as { label?: string }).label ?? '')
    return palabras.every((p) => texto.includes(p))
  })
}
