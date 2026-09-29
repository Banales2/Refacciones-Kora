// Opciones de vehículo para los Select que buscan contra la API. En una sola
// línea (marca, modelo, serie y placas) el renglón quedaba demasiado largo, así
// que la lista lo reparte en dos y el campo ya elegido muestra la forma corta.
import { Badge, Group, Text } from '@mantine/core'
import type { ComboboxParsedItem, SelectProps } from '@mantine/core'
import type { VehiculoRow } from '../hooks/useVehiculos'

type DatosVehiculo = Pick<VehiculoRow, 'marca' | 'modelo' | 'serie' | 'placas'>

export type OpcionVehiculo = {
  value:   string
  label:   string
  nombre?: string
  serie?:  string
  placas?: string | null
}

// Lo que queda escrito en el campo al elegir: las placas identifican la unidad
// a simple vista; la serie solo cuando no tiene placas.
export function vehiculoLabelCorto(v: DatosVehiculo): string {
  return `${v.marca} ${v.modelo} · ${v.placas || v.serie}`
}

export function opcionVehiculo(v: DatosVehiculo & { id: number }): OpcionVehiculo {
  return {
    value:  String(v.id),
    label:  vehiculoLabelCorto(v),
    nombre: `${v.marca} ${v.modelo}`,
    serie:  v.serie,
    placas: v.placas,
  }
}

// La opción de respaldo del vehículo ya elegido solo trae la etiqueta; en ese
// caso se muestra tal cual.
export const renderOpcionVehiculo: SelectProps['renderOption'] = ({ option }) => {
  const o = option as unknown as OpcionVehiculo
  if (!o.nombre) return <Text size="sm">{o.label}</Text>
  return (
    <Group justify="space-between" wrap="nowrap" gap="sm" w="100%">
      <div style={{ minWidth: 0, flex: 1 }}>
        <Text size="sm" fw={500} truncate>{o.nombre}</Text>
        <Text size="xs" c="dimmed" truncate>Serie {o.serie}</Text>
      </div>
      {o.placas
        ? <Badge variant="light" color="gray" radius="sm" style={{ flexShrink: 0 }}>{o.placas}</Badge>
        : <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>Sin placas</Text>}
    </Group>
  )
}

// La API ya filtra por marca, modelo, serie y placas; si Mantine vuelve a
// filtrar por la etiqueta, descarta lo que coincidió en un campo que no se ve.
export const sinFiltroLocal = ({ options }: { options: ComboboxParsedItem[] }) => options
