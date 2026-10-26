// Aviso en rojo cuando el kilometraje de una recarga no cabe entre las de otras
// fechas: menor que el de una recarga anterior, o mayor que el de una
// posterior. Pasa al capturar una carga atrasada con la fecha de hoy, o con un
// dígito de más o de menos. La API la rechaza igual (`validarKmPorFecha`); esto
// solo lo dice antes, mientras se captura, para que se revisen la fecha y el
// kilometraje sin esperar al error.
import { Alert, Text } from '@mantine/core'
import { IconAlertTriangle } from '@tabler/icons-react'
import { useKmVecinos, type KmVecinos } from '../hooks/useRecargas'
import { formatFecha } from '../lib/formato'

export interface KmFueraDeOrden {
  lado:  'anterior' | 'siguiente'
  fecha: string
  km:    number
}

function fueraDeOrden(km: number, v: KmVecinos | undefined): KmFueraDeOrden | null {
  if (!v || !(km > 0)) return null
  if (v.anterior && km < v.anterior.kilometraje) {
    return { lado: 'anterior', fecha: v.anterior.fecha, km: v.anterior.kilometraje }
  }
  if (v.siguiente && km > v.siguiente.kilometraje) {
    return { lado: 'siguiente', fecha: v.siguiente.fecha, km: v.siguiente.kilometraje }
  }
  return null
}

/**
 * `fecha` y `km` como están en el formulario; `excluir` es la recarga que se
 * corrige, que no se compara consigo misma. Null: no hay nada que objetar
 * (o todavía no se sabe).
 */
export function useKmFueraDeOrden(
  vehiculoId: number | undefined, fecha: string, km: number | string | null, excluir?: number,
): KmFueraDeOrden | null {
  const valida = /^\d{4}-\d{2}-\d{2}$/.test(fecha)
  const { data } = useKmVecinos(valida ? vehiculoId : undefined, fecha, excluir)
  const n = km === '' || km == null ? 0 : Number(km)
  return fueraDeOrden(n, data?.data)
}

export function AlertaKmRecarga({ problema, km }: { problema: KmFueraDeOrden; km: number | string }) {
  const fmt = (n: number) => n.toLocaleString('es-MX')
  return (
    <Alert color="red" variant="filled" icon={<IconAlertTriangle size={16} />} title="El kilometraje no cuadra con la fecha">
      <Text size="sm">
        {problema.lado === 'anterior'
          ? <>Capturaste <strong>{fmt(Number(km))} km</strong>, pero la recarga del{' '}
              <strong>{formatFecha(problema.fecha)}</strong> ya marcaba{' '}
              <strong>{fmt(problema.km)} km</strong>. El odómetro no puede bajar.</>
          : <>Capturaste <strong>{fmt(Number(km))} km</strong>, pero la recarga del{' '}
              <strong>{formatFecha(problema.fecha)}</strong>, que es posterior, marca{' '}
              <strong>{fmt(problema.km)} km</strong>.</>}
      </Text>
      <Text size="sm" mt={6}>
        Verifica el kilometraje y la fecha contra el ticket. No se puede registrar así.
      </Text>
    </Alert>
  )
}
