// Chequeo diario: la declaración del chofer más el checklist de lo que se ve.
// Uno por unidad por día; el de hoy se corrige, no se captura otro.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { ItemChequeo, Resultado, Severidad } from '../lib/chequeoItems'

export interface ChequeoItem {
  clave:        string
  resultado:    Resultado
  /** Solo las preguntas que no son de sí o no. Hoy: "3/4" de tanque. */
  valor:        string | null
  nota:         string | null
  /** La incidencia que abrió esta falla, si abrió alguna. */
  pendiente_id: number | null
  /**
   * La fecha de esa incidencia. Anterior a la del chequeo = la falla no abrió
   * nada: se enganchó a la que ya venía abierta. Es lo que hace visible que el
   * problema lleva días sin atenderse (ver `arrastra` en `chequeoItems`).
   */
  incidencia_desde: string | null
}

export interface Chequeo {
  id:            number
  vehiculo_id:   number
  fecha:         string
  hora:          string | null
  ubicacion:     string
  conductor_id:  number | null
  conductor:     string | null
  /** El chofer de la unidad. `null` cuando no había ninguno (ver `sin_chofer`). */
  declarado_por: string | null
  /** Quien recorrió el patio y capturó; la pone la API. */
  revisado_por:  string
  hay_novedad:   boolean
  /**
   * No había chofer a quien preguntarle. Distinto de `hay_novedad: false`, que
   * es "se le preguntó y no reportó nada".
   */
  sin_chofer:    boolean
  declaracion:   string | null
  lectura:          number | null
  /** El odómetro que traía la unidad al momento del chequeo. */
  lectura_anterior: number | null
  nota:          string | null
  revisada_en:   string | null
  revisada_por:  string | null
  revision_nota: string | null
  declaracion_pendiente_id: number | null
  created_at:    string
  updated_at:    string
  items:         ChequeoItem[]
}

export interface ChequeoConVehiculo extends Chequeo {
  vehiculo_nombre: string
  vehiculo_tipo:   string
}

export interface ItemPayload {
  clave:     string
  resultado: Resultado
  valor?:    string | null
  nota?:     string | null
  /** Solo la pregunta que el catálogo deja graduar (hoy los golpes). */
  severidad?: Severidad
}

export interface ChequeoPayload {
  ubicacion:     string
  declarado_por?: string | null
  conductor_id?: number | null
  hay_novedad:   boolean
  sin_chofer:    boolean
  declaracion?:  string | null
  lectura?:      number | null
  /**
   * Acuse de que la lectura baja el odómetro de la unidad y aun así se sostiene.
   * Sin él la API rechaza la lectura menor; lo manda el formulario después de
   * que quien captura lo confirma (`ConfirmarLecturaMenor`).
   */
  confirmar_baja?: boolean
  fecha?:        string
  hora?:         string | null
  nota?:         string | null
  items:         ItemPayload[]
}

/** Lo que el formulario necesita para armarse, servido por la API. */
export interface FormularioChequeo {
  vehiculo_id: number
  tipo:        string
  kilometraje: number | null
  /** Odómetro u horómetro, o null si esta unidad no lleva ninguno. */
  lectura:     ItemChequeo | null
  items:       ItemChequeo[]
  /** El chequeo de hoy, si ya lo hicieron. */
  hoy:         Chequeo | null
}

export interface UnidadSinChequeo {
  vehiculo_id: number
  nombre:      string
  tipo:        string
  placas:      string | null
}

export interface ResumenChequeos {
  fecha:       string
  total:       number
  revisadas:   number
  faltan:      UnidadSinChequeo[]
  /** Reportes del chofer que nadie ha leído. */
  por_revisar: ChequeoConVehiculo[]
}

/** Lo que la API responde al guardar: el chequeo y lo que hay que avisar. */
interface RespuestaChequeo {
  data:   Chequeo
  avisos: string[]
}

export function useChequeosVehiculo(vehiculoId: number) {
  return useQuery({
    queryKey: ['chequeos', vehiculoId],
    queryFn: () => api.get<{ data: Chequeo[] }>(`/vehiculos/${vehiculoId}/chequeos`),
  })
}

// `enabled` porque el formulario solo se arma cuando se abre: pedirlo con la
// ficha cargaría una consulta por unidad listada.
export function useFormularioChequeo(vehiculoId: number, activo: boolean) {
  return useQuery({
    queryKey: ['chequeo-formulario', vehiculoId],
    queryFn: () => api.get<{ data: FormularioChequeo }>(`/vehiculos/${vehiculoId}/chequeos/formulario`),
    enabled: activo,
  })
}

export function useResumenChequeos() {
  return useQuery({
    queryKey: ['chequeos-hoy'],
    queryFn: () => api.get<{ data: ResumenChequeos }>('/dashboard/chequeos-hoy'),
  })
}

export function useChequeosRango(params: { desde?: string; hasta?: string; filtro?: 'por_revisar' } = {}) {
  const query = new URLSearchParams()
  if (params.desde)  query.set('desde', params.desde)
  if (params.hasta)  query.set('hasta', params.hasta)
  if (params.filtro) query.set('filtro', params.filtro)
  const qs = query.toString()
  return useQuery({
    queryKey: ['chequeos', 'rango', params],
    queryFn: () => api.get<{ data: ChequeoConVehiculo[] }>(`/chequeos${qs ? `?${qs}` : ''}`),
  })
}

export interface UnidadPatio extends UnidadSinChequeo {
  /** El chequeo de hoy de esta unidad, si ya se hizo. */
  chequeo_id:  number | null
  fallas:      number
  hay_novedad: boolean
}

export interface Patio {
  fecha:      string
  sucursal:   { id: number; nombre: string }
  /** Lo que hay que escribir en `ubicacion` de cada chequeo del recorrido. */
  ubicacion:  string
  /** Las unidades con base en esta sucursal. */
  base:       UnidadPatio[]
  /** Lo revisado aquí hoy sin tener base aquí: tráilers de paso. */
  visitantes: UnidadPatio[]
  pendientes: number
}

// El recorrido del patio. `refetchOnWindowFocus` porque son dos personas
// caminando la misma flota: si una revisó la unidad que la otra tiene enfrente,
// conviene que se entere al volver a la pantalla y no al final del recorrido.
export function usePatio(sucursalId: number | null) {
  return useQuery({
    queryKey: ['chequeos-patio', sucursalId],
    queryFn: () => api.get<{ data: Patio }>(`/chequeos/patio?sucursal_id=${sucursalId}`),
    enabled: sucursalId != null,
    refetchOnWindowFocus: true,
  })
}

export function useDeclarantes() {
  return useQuery({
    queryKey: ['chequeos-declarantes'],
    queryFn: () => api.get<{ data: string[] }>('/chequeos/declarantes'),
  })
}

// Guardar un chequeo mueve más cosas que su propia lista: puede haber abierto
// incidencias, y casi siempre movió el odómetro de la unidad.
function invalidar(qc: ReturnType<typeof useQueryClient>, vehiculoId: number) {
  qc.invalidateQueries({ queryKey: ['chequeos'] })
  qc.invalidateQueries({ queryKey: ['chequeo-formulario', vehiculoId] })
  qc.invalidateQueries({ queryKey: ['chequeos-hoy'] })
  qc.invalidateQueries({ queryKey: ['chequeos-patio'] })
  qc.invalidateQueries({ queryKey: ['chequeos-declarantes'] })
  qc.invalidateQueries({ queryKey: ['incidencias'] })
  qc.invalidateQueries({ queryKey: ['pendientes', vehiculoId] })
  // El odómetro de la unidad cambió, y con él lo que el programa de
  // mantenimiento proyecta.
  qc.invalidateQueries({ queryKey: ['vehiculos'] })
  qc.invalidateQueries({ queryKey: ['programa-vehiculo', vehiculoId] })
}

export function useCreateChequeo(vehiculoId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: ChequeoPayload) =>
      api.post<RespuestaChequeo>(`/vehiculos/${vehiculoId}/chequeos`, payload),
    onSuccess: () => invalidar(qc, vehiculoId),
  })
}

export function useUpdateChequeo(vehiculoId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<ChequeoPayload> }) =>
      api.put<RespuestaChequeo>(`/chequeos/${id}`, payload),
    onSuccess: () => invalidar(qc, vehiculoId),
  })
}

export interface RevisionPayload {
  nota?:            string | null
  abrir_incidencia: boolean
  severidad?:       Severidad
  categoria?:       string | null
}

export function useRevisarChequeo(vehiculoId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: RevisionPayload }) =>
      api.post<{ data: Chequeo }>(`/chequeos/${id}/revisar`, payload),
    onSuccess: () => invalidar(qc, vehiculoId),
  })
}
