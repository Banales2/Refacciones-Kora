// Qué refacción usa un vehículo para cada tipo de pieza que necesita. La lista
// trae los tipos que pide su modelo más los propios de la unidad
// (useTiposPiezaVehiculo); pieza_id viene null mientras no se haya elegido,
// para que se vea lo que falta capturar.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export interface PiezaDeVehiculo {
  tipo_pieza_id: number
  tipo_nombre:   string
  pieza_id:      number | null
  numero_serie:  string | null
  descripcion:   string | null
  // 'modelo': lo pide el modelo y se quita desde allá. 'vehiculo': es propio de
  // esta unidad y se quita aquí.
  origen:        'modelo' | 'vehiculo'
  // Desde cuándo trae puesta esta pieza. Null en las que se asignaron antes de
  // que existiera el historial, o cuando no se capturó el dato.
  fecha_instalacion: string | null
  km_instalacion:    number | null
}

export function usePiezasVehiculo(vehiculoId?: number) {
  return useQuery({
    queryKey: ['piezas-vehiculo', vehiculoId],
    queryFn: () => api.get<{ data: PiezaDeVehiculo[] }>(`/vehiculos/${vehiculoId}/piezas`),
    enabled: vehiculoId !== undefined,
  })
}

export type MotivoRetiro = 'desgaste' | 'falla' | 'robo' | 'siniestro' | 'preventivo' | 'garantia'
export type DestinoPieza = 'desecho' | 'reacondicionar' | 'devolucion_proveedor' | 'venta' | 'stock'

// Trazabilidad del montaje. Todo opcional: la API acepta la asignación sin nada
// de esto, solo que el renglón del historial queda sin rastro de compra.
export interface DatosMontaje {
  lote_id?:           number
  fecha_instalacion?: string
  km_instalacion?:    number
  // De la pieza que sale, cuando el montaje reemplaza una anterior.
  motivo_retiro?:     MotivoRetiro
  destino?:           DestinoPieza
  km_retiro?:         number
}

export interface DatosRetiro {
  fecha_retiro?:  string
  km_retiro?:     number
  motivo_retiro?: MotivoRetiro
  destino?:       DestinoPieza
}

// Invalida la lista vigente y el historial: un montaje toca las dos.
function invalidar(qc: ReturnType<typeof useQueryClient>, vehiculoId: number) {
  qc.invalidateQueries({ queryKey: ['piezas-vehiculo', vehiculoId] })
  qc.invalidateQueries({ queryKey: ['piezas-historial', vehiculoId] })
}

export function useSetPiezaVehiculo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ vehiculoId, tipoId, piezaId, datos }: {
      vehiculoId: number; tipoId: number; piezaId: number; datos?: DatosMontaje
    }) =>
      api.put<void>(`/vehiculos/${vehiculoId}/piezas/${tipoId}`, { pieza_id: piezaId, ...datos }),
    onSuccess: (_d, { vehiculoId }) => invalidar(qc, vehiculoId),
  })
}

export function useRemovePiezaVehiculo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ vehiculoId, tipoId, datos }: {
      vehiculoId: number; tipoId: number; datos?: DatosRetiro
    }) => {
      // Los datos del retiro van por query string: la API los recibe así porque
      // un DELETE con cuerpo no lo manejan igual todos los proxies.
      const qs = new URLSearchParams(
        Object.entries(datos ?? {})
          .filter(([, v]) => v !== undefined && v !== '')
          .map(([k, v]) => [k, String(v)])
      ).toString()
      return api.delete<void>(`/vehiculos/${vehiculoId}/piezas/${tipoId}${qs ? `?${qs}` : ''}`)
    },
    onSuccess: (_d, { vehiculoId }) => invalidar(qc, vehiculoId),
  })
}

// Un renglón por cada vez que se montó una pieza en este vehículo. Los vigentes
// traen fecha_retiro en null; el resto son los que ya se cambiaron.
export interface InstalacionHistorial {
  id:                number
  tipo_pieza_id:     number
  tipo_nombre:       string
  pieza_id:          number
  numero_serie:      string
  descripcion:       string
  lote_id:           number | null
  num_factura:       string | null
  proveedor:         string | null
  costo_unitario:    number | null
  fecha_compra:      string | null
  sucursal:          string | null
  mantenimiento_id:  number | null
  fecha_instalacion: string | null
  km_instalacion:    number | null
  fecha_retiro:      string | null
  km_retiro:         number | null
  motivo_retiro:     MotivoRetiro | null
  destino:           DestinoPieza | null
}

export function useHistorialPiezas(vehiculoId?: number, enabled = true) {
  return useQuery({
    queryKey: ['piezas-historial', vehiculoId],
    queryFn: () => api.get<{ data: InstalacionHistorial[] }>(`/vehiculos/${vehiculoId}/piezas/historial`),
    enabled: vehiculoId !== undefined && enabled,
  })
}
