// El formulario de mantenimiento, con sus piezas.
//
// Vive aquí y no en la página de vehículos porque lo usan tres pantallas: la
// ficha de la unidad, el calendario al completar una agenda, y la sección del
// programa de mantenimiento —donde el mismo formulario se presenta como
// "registrar la visita al taller", porque eso es lo que es para quien lo
// captura, aunque lo que se guarde sea un mantenimiento como cualquier otro—.
//
// Tenerlo en la página lo dejaba fuera del alcance del programa: la sección del
// programa la importa la propia página, y traerse el formulario de vuelta
// habría cerrado un ciclo entre los dos módulos.
import { useState, useMemo, useRef, useEffect } from 'react'
import {
  Stack, Group, Text, Textarea, Pill, Input,
  Alert, Button, Select, MultiSelect,
  ActionIcon, Tooltip, NumberInput, Divider, Grid,
} from '@mantine/core'
import { useForm } from '@mantine/form'
import { IconTrash, IconPlus } from '@tabler/icons-react'
import { FechaInput } from './FechaInput'
import ConfirmarAvanceKm from './ConfirmarAvanceKm'
import CompraModal from './CompraModal'
import PosicionesMontaje from './PosicionesMontaje'
import NuevoTecnicoModal from './NuevoTecnicoModal'
import { avanzaOdometro } from '../lib/odometro'
import { formatMXN } from '../lib/formato'
import { POSICIONES_VACIAS, aMontajes } from '../lib/montajes'
import type { PosicionesValue } from '../lib/montajes'
import { KM_MAX, validarKm, TEXTO_LIBRE, limpiarTextoLibre } from '../lib/validaciones'
import { useTecnicos } from '../hooks/useTecnicos'
import type { Tecnico } from '../hooks/useTecnicos'
import { useLotesDisponibles } from '../hooks/useLotesDisponibles'
import type { LoteDisponible } from '../hooks/useLotesDisponibles'
import { usePendientes, ORIGEN_LABEL } from '../hooks/usePendientes'
import type { OrigenPendiente } from '../hooks/usePendientes'
import { useIncidenciasVehiculo } from '../hooks/useIncidencias'
import type { Mantenimiento, MantenimientoPayload } from '../hooks/useMantenimientos'
import type { DetalleMttoPayload } from '../hooks/useDetalleMtto'
import { useVehiculo } from '../hooks/useVehiculos'
import type { TipoVehiculo } from '../hooks/useVehiculos'
import SelectCatalogo from './SelectCatalogo'

// Fecha local de hoy en "YYYY-MM-DD" (construirla con métodos UTC recorrería
// el día en zonas horarias detrás de UTC).
function hoyIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

type MantForm = {
  fecha:             string
  tipo:              string
  tecnico_id:        string
  costo:             number | string
  km_actual:         number | string
  observaciones:     string
  pendiente_ids:     string[]
  // Piezas usadas, capturadas al registrar. Puede quedar vacío: hay
  // mantenimientos que no consumen refacciones.
  piezas:            PiezaLinea[]
}

type PiezaLinea = {
  lote_id:        string
  // De qué sucursal sale la pieza. Desde el inventario por sucursal el lote
  // solo ya no basta: el mismo lote puede estar repartido, y la API exige saber
  // de dónde descontar.
  sucursal_id:    string
  cantidad:       number | string
  costo_unitario: number | string
  // En qué renglones de la unidad queda puesta, capturado aquí mismo para no
  // tener que ir después al vehículo a declararlo. Vacío = no se monta.
  posiciones:     PosicionesValue
}

// El selector ofrece existencias, no lotes: la opción es la pareja
// (lote, sucursal), así que su valor tiene que llevar las dos.
const claveExistencia = (loteId: number | string, sucursalId: number | string) =>
  `${loteId}:${sucursalId}`

function initMant(
  m?: Mantenimiento, prefillPendienteIds?: number[], kmVehiculo?: number | null,
  tipoInicial?: string,
): MantForm {
  return {
    fecha:             m?.fecha?.split('T')[0] ?? '',
    // Al editar manda lo guardado; al registrar, la razón por la que se abrió
    // el formulario (atender una incidencia es correctivo). Sigue siendo un
    // valor cualquiera del selector: se puede cambiar antes de guardar.
    tipo:              m?.tipo          ?? tipoInicial ?? '',
    tecnico_id:        m?.tecnico_id != null ? String(m.tecnico_id) : '',
    costo:             m?.costo         ?? '',
    // Al registrar se parte del odómetro actual del vehículo; se ajusta si la
    // lectura real del taller es otra.
    km_actual:         m?.km_actual     ?? kmVehiculo ?? '',
    observaciones:     m?.observaciones ?? '',
    pendiente_ids:     m?.pendiente_ids?.map(String) ?? prefillPendienteIds?.map(String) ?? [],
    piezas:            [],
  }
}

export default function MantenimientoForm({
  vehiculoId, tipoVehiculo, initial, prefillPendienteIds, pendienteFijo, origenFijo,
  tipoInicial, isPending, error, onSubmit, onCancel,
}: {
  vehiculoId:               number
  tipoVehiculo?:            TipoVehiculo
  initial?:                 Mantenimiento
  prefillPendienteIds?:     number[]
  /**
   * Pendiente que este mantenimiento existe para cerrar y que por eso no se
   * puede quitar: se muestra fijo y va siempre en el alta. Los demás se siguen
   * agregando y quitando con normalidad.
   */
  pendienteFijo?:           { id: number; nombre: string }
  /**
   * Un origen que no es un pendiente y que por eso no viaja en
   * `pendiente_ids`: hoy, el servicio del programa de mantenimiento. Se pinta
   * igual que `pendienteFijo` —fijo y sin poder quitarse— porque cumple el
   * mismo papel: es la razón por la que este mantenimiento existe. Lo que lo
   * amarra al programa se guarda aparte, al cerrar la columna.
   */
  origenFijo?:              { etiqueta: string; ayuda: string }
  /**
   * Con qué tipo llega el selector al abrirse (solo al registrar). Lo usa quien
   * ya sabe la razón del servicio —atender una incidencia es correctivo— para
   * no hacer elegir lo que ya se sabe. No lo fija: se puede cambiar.
   */
  tipoInicial?:             string
  isPending:                boolean
  error:                    string | null
  onSubmit:                 (p: MantenimientoPayload, piezas: DetalleMttoPayload[]) => void
  onCancel:                 () => void
}) {
  const tieneKilometraje = tipoVehiculo !== 'montacargas' && tipoVehiculo !== 'caja_trailer'

  // El selector se alimenta de la lista de pendientes y los agrupa por origen.
  // Los ya vinculados se consultan aparte: el endpoint de pendientes solo
  // devuelve los activos, y al editar hay que seguir mostrando los que este
  // mantenimiento ya cerró.
  const { data: pendientesData } = usePendientes(vehiculoId)
  const { data: incData }        = useIncidenciasVehiculo(vehiculoId)

  const linkedIds = useMemo(
    () => new Set(initial?.pendiente_ids ?? prefillPendienteIds ?? []),
    [initial, prefillPendienteIds]
  )

  // Solo el id: `pendienteFijo` llega como objeto nuevo en cada render y
  // recalcularía las opciones sin necesidad.
  const fijoId = pendienteFijo?.id ?? null

  // Los dos orígenes fijos se pintan igual; lo único que cambia es de dónde
  // salen el texto y la explicación.
  const fijo = pendienteFijo
    ? {
      etiqueta: pendienteFijo.nombre,
      ayuda: 'Esta incidencia se marcó como atendida, así que este mantenimiento es la que la cierra: no se puede quitar.',
    }
    : origenFijo ?? null

  const pendienteGroups = useMemo(() => {
    const porId = new Map<number, { id: number; nombre: string; origen: OrigenPendiente; activo: boolean }>()
    for (const p of pendientesData?.data ?? []) {
      porId.set(p.id, { id: p.id, nombre: p.nombre, origen: p.origen, activo: true })
    }
    // Los ya vinculados aunque no estén activos, para no perderlos al editar.
    for (const i of incData?.data ?? []) {
      if (linkedIds.has(i.id) && !porId.has(i.id)) {
        porId.set(i.id, { id: i.id, nombre: i.nombre, origen: 'incidencia', activo: false })
      }
    }

    // El fijo se muestra aparte, no como una opción más del selector.
    if (fijoId != null) porId.delete(fijoId)

    const items = [...porId.values()]
    return (['incidencia'] as OrigenPendiente[])
      .map(origen => ({
        group: ORIGEN_LABEL[origen],
        items: items
          .filter(p => p.origen === origen)
          .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es-MX'))
          .map(p => ({ value: String(p.id), label: p.activo ? p.nombre : `${p.nombre} (cerrado)` })),
      }))
      .filter(g => g.items.length > 0)
  }, [pendientesData, incData, linkedIds, fijoId])

  const hayPendientes = pendienteGroups.some(g => g.items.length > 0)

  // Las piezas solo se capturan al registrar. Al editar se gestionan desde el
  // detalle del mantenimiento, que ya permite agregarlas, cambiarlas y quitarlas
  // devolviendo el stock al lote.
  const isEdit = !!initial
  // Resultado completo: con la red lenta hay que poder decir si los lotes
  // vienen en camino o si la consulta se cayó. Vacío no significa lo mismo.
  const lotesQuery = useLotesDisponibles(!isEdit)
  const lotesData = lotesQuery.data

  // Refacciones compradas desde este mismo formulario: se agregan a mano porque
  // la lista de lotes disponibles todavía puede estar refrescándose.
  const [compraOpen, setCompraOpen] = useState(false)
  const [lotesNuevos, setLotesNuevos] = useState<LoteDisponible[]>([])
  const lotes = useMemo(() => {
    const base = lotesData?.data ?? []
    // La llave es la pareja (lote, sucursal): el mismo lote puede aparecer una
    // vez por sucursal, y deduplicar por el id solo lo escondería.
    const ids = new Set(base.map(l => claveExistencia(l.id, l.sucursal_id)))
    return [...base, ...lotesNuevos.filter(l => !ids.has(claveExistencia(l.id, l.sucursal_id)))]
  }, [lotesData, lotesNuevos])

  // El odómetro actual del vehículo precarga el campo de kilometraje al registrar.
  const { data: vehiculoData } = useVehiculo(isEdit ? undefined : vehiculoId)
  const kmVehiculo = vehiculoData?.data.kilometraje ?? null

  // El técnico se guarda por id contra el catálogo. Si el técnico se eliminó,
  // el mantenimiento queda sin técnico y hay que elegir otro al editarlo.
  const tecnicosQuery = useTecnicos()
  const tecnicosData = tecnicosQuery.data

  // Técnicos dados de alta desde este mismo formulario: se agregan a mano
  // porque el catálogo todavía puede estar refrescándose.
  const [nuevoTecnicoOpen, setNuevoTecnicoOpen] = useState(false)
  const [tecnicosNuevos, setTecnicosNuevos] = useState<Tecnico[]>([])
  const tecnicoOptions = useMemo(() => {
    const base = tecnicosData?.data ?? []
    const ids = new Set(base.map((t) => t.id))
    return [...base, ...tecnicosNuevos.filter((t) => !ids.has(t.id))]
      .map((t) => ({ value: String(t.id), label: t.nombre }))
  }, [tecnicosData, tecnicosNuevos])

  const form = useForm<MantForm>({
    initialValues: initMant(initial, prefillPendienteIds, kmVehiculo, tipoInicial),
    validate: {
      fecha:             (v) => !v ? 'Requerido' : null,
      tipo:              (v) => !v ? 'Requerido' : null,
      tecnico_id:        (v) => !v ? 'Requerido' : null,
      km_actual:         (v) => tieneKilometraje && (v === '' || v === null) ? 'Requerido' : validarKm(v),
      costo:             (v) => v === '' || v === null ? 'Requerido' : null,
      observaciones:     (v) =>
        !v.trim() ? 'Requerido' :
        v.length > 255 ? 'Máximo 255 caracteres' :
        !TEXTO_LIBRE.test(v.trim()) ? 'Contiene caracteres no permitidos' : null,
      // TEMPORAL — mantenimiento sin origen. Aquí se exigía al menos un
      // pendiente cuando no había uno fijo; se suspendió para poder capturar
      // mantenimientos antiguos cuya razón ya no se conserva, y volverá a ser
      // obligatorio. Para reactivarlo, buscar los puntos marcados con
      // `grep -rn "mantenimiento sin origen"`. Mientras tanto el formulario
      // avisa en pantalla en vez de bloquear.
      piezas: {
        lote_id:  (v: string) => !v ? 'Selecciona la refacción' : null,
        cantidad: (v: number | string, vals: MantForm, path: string) => {
          if (v === '' || Number(v) < 1) return 'Mínimo 1'
          const linea = vals.piezas[Number(path.split('.')[1])]
          const lote = lotes.find(l =>
            claveExistencia(l.id, l.sucursal_id) === claveExistencia(linea?.lote_id ?? '', linea?.sucursal_id ?? '')
          )
          if (lote && Number(v) > lote.cantidad_disponible) return `Máx. ${lote.cantidad_disponible}`
          return null
        },
        costo_unitario: (v: number | string) => (v === '' || Number(v) < 0 ? 'Costo inválido' : null),
      },
    },
  })

  // initialValues solo se aplica al montar, y el vehículo llega después: en
  // cuanto resuelve se precarga el km, salvo que el usuario ya haya escrito uno.
  const kmPrecargado = useRef(false)
  useEffect(() => {
    if (isEdit || kmPrecargado.current || kmVehiculo == null) return
    kmPrecargado.current = true
    if (form.values.km_actual === '') form.setFieldValue('km_actual', kmVehiculo)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kmVehiculo, isEdit])

  const piezas = form.values.piezas

  // Un lote ya elegido no se ofrece en las demás líneas: evita capturar dos
  // veces la misma pieza y que la suma de cantidades rebase el stock.
  function loteOptions(idx: number) {
    const usados = new Set(
      piezas.filter((_, i) => i !== idx).map(p => claveExistencia(p.lote_id, p.sucursal_id))
    )
    return lotes
      .filter(l => !usados.has(claveExistencia(l.id, l.sucursal_id)))
      .map(l => ({
        value: claveExistencia(l.id, l.sucursal_id),
        label: `${l.numero_serie} — ${l.descripcion} · ${l.sucursal} (disp: ${l.cantidad_disponible}, ${formatMXN(l.costo_unitario)})`,
      }))
  }

  /** La existencia elegida en ese renglón. De ella sale el tipo, que decide en
   *  qué posiciones de la unidad puede montarse. */
  function loteDe(idx: number) {
    const linea = piezas[idx]
    if (!linea?.lote_id) return undefined
    return lotes.find(l => claveExistencia(l.id, l.sucursal_id) === claveExistencia(linea.lote_id, linea.sucursal_id))
  }

  function setLote(idx: number, value: string | null) {
    const [loteId = '', sucursalId = ''] = (value ?? '').split(':')
    form.setFieldValue(`piezas.${idx}.lote_id`, loteId)
    form.setFieldValue(`piezas.${idx}.sucursal_id`, sucursalId)
    // Cambiar de refacción cambia el tipo, y con él los renglones donde cabe:
    // conservar las posiciones anteriores dejaría elegido algo de otro tipo.
    form.setFieldValue(`piezas.${idx}.posiciones`, POSICIONES_VACIAS)
    const lote = lotes.find(l => claveExistencia(l.id, l.sucursal_id) === value)
    // El costo del lote es solo el valor de arranque: se puede ajustar a mano.
    if (lote) form.setFieldValue(`piezas.${idx}.costo_unitario`, lote.costo_unitario)
  }

  // El técnico recién dado de alta queda seleccionado, que es para lo que se
  // abrió el alta desde aquí.
  function handleTecnicoCreado(tecnico: Tecnico) {
    setTecnicosNuevos((prev) => [...prev, tecnico])
    form.setFieldValue('tecnico_id', String(tecnico.id))
  }

  // La compra que se acaba de registrar entra ya capturada: cada refacción de
  // la factura queda como un renglón más del mantenimiento. Se compró para esta
  // reparación, así que darla de alta y volver a buscarla en el selector sería
  // hacer dos veces el mismo trabajo.
  function handleCompraRegistrada(lotes: LoteDisponible[]) {
    setLotesNuevos((prev) => [...prev, ...lotes])
    for (const lote of lotes) {
      form.insertListItem('piezas', {
        lote_id: String(lote.id), sucursal_id: String(lote.sucursal_id),
        cantidad: 1, costo_unitario: lote.costo_unitario,
        posiciones: POSICIONES_VACIAS,
      })
    }
  }

  const totalPiezas = piezas.reduce(
    (s, p) => s + (Number(p.cantidad) || 0) * (Number(p.costo_unitario) || 0), 0
  )

  // Al registrar, el km capturado se vuelve el del vehículo si es mayor al que
  // tiene (si es menor, el odómetro no se mueve). Se avisa y se pide aceptar
  // antes de guardar. Al editar no aplica: la edición no toca el odómetro.
  const [porConfirmarKm, setPorConfirmarKm] = useState<MantForm | null>(null)

  function handleSubmit(vals: MantForm) {
    const km = vals.km_actual !== '' ? Number(vals.km_actual) : 0
    // `vehiculoData` puede no haber llegado todavía; sin él no se sabe contra
    // qué comparar, y avisar de un avance que quizá no ocurre sería peor.
    if (!isEdit && tieneKilometraje && vehiculoData && avanzaOdometro(km, kmVehiculo)) {
      setPorConfirmarKm(vals)
      return
    }
    enviar(vals)
  }

  function enviar(vals: MantForm) {
    onSubmit(
      {
        fecha:             vals.fecha,
        tipo:              vals.tipo.trim()          || null,
        tecnico_id:        Number(vals.tecnico_id),
        costo:             vals.costo !== '' ? Number(vals.costo) : 0,
        km_actual:         vals.km_actual !== '' ? Number(vals.km_actual) : 0,
        observaciones:     vals.observaciones.trim(),
        // El fijo no vive en el selector: se agrega aquí para que el alta lo
        // incluya sin que se haya podido quitar.
        pendiente_ids: [
          ...(pendienteFijo ? [pendienteFijo.id] : []),
          ...vals.pendiente_ids.map(Number).filter(id => id !== pendienteFijo?.id),
        ],
      },
      vals.piezas.map(p => ({
        lote_id:        Number(p.lote_id),
        sucursal_id:    Number(p.sucursal_id),
        cantidad:       Number(p.cantidad),
        costo_unitario: Number(p.costo_unitario),
        // Dónde queda puesta cada una. Vacío = solo se gasta, no se monta.
        montajes:       aMontajes(p.posiciones),
      })),
    )
  }

  return (
    <>
    <form onSubmit={form.onSubmit(handleSubmit)}>
      <Stack gap="sm">
        {error && <Alert color="red" title="Error">{error}</Alert>}
        <Grid>
          <Grid.Col span={6}>
            <FechaInput
              label="Fecha" required
              clearable maxDate={hoyIso()}
              value={form.values.fecha}
              onChange={(d) => form.setFieldValue('fecha', d)}
              error={form.errors.fecha as string}
            />
          </Grid.Col>
          <Grid.Col span={6}>
            <Select
              label="Tipo" required
              placeholder="Selecciona el tipo"
              data={[
                { value: 'Preventivo', label: 'Preventivo' },
                { value: 'Correctivo', label: 'Correctivo' },
              ]}
              {...form.getInputProps('tipo')}
            />
          </Grid.Col>
          <Grid.Col span={6}>
            <SelectCatalogo
              estado={tecnicosQuery}
              nombre="técnicos"
              label="Técnico" required
              placeholder="Selecciona un técnico"
              data={tecnicoOptions}
              nothingFoundMessage='Sin coincidencias: usa "Nuevo técnico"'
              {...form.getInputProps('tecnico_id')}
              onChange={(v) => form.setFieldValue('tecnico_id', v ?? '')}
            />
            <Button
              variant="subtle" size="compact-xs" mt={4} leftSection={<IconPlus size={12} />}
              onClick={() => setNuevoTecnicoOpen(true)}
            >
              Nuevo técnico
            </Button>
          </Grid.Col>
          {tieneKilometraje && (
            <Grid.Col span={3}>
              <NumberInput
                label="Kilometraje" placeholder="0" min={0} max={KM_MAX} required
                thousandSeparator=","
                allowDecimal={false} allowNegative={false} clampBehavior="strict"
                description={!isEdit && kmVehiculo != null
                  ? `Actual: ${kmVehiculo.toLocaleString('es-MX')} km`
                  : undefined}
                {...form.getInputProps('km_actual')}
              />
            </Grid.Col>
          )}
          <Grid.Col span={tieneKilometraje ? 3 : 6}>
            <NumberInput
              label="Costo de mano de obra" placeholder="0.00" min={0} decimalScale={2}
              thousandSeparator="," prefix="$" required
              {...form.getInputProps('costo')}
            />
          </Grid.Col>
          <Grid.Col span={12}>
            <Textarea
              label="Observaciones" autosize minRows={2} required maxLength={255}
              {...form.getInputProps('observaciones')}
              onChange={(e) => form.setFieldValue('observaciones', limpiarTextoLibre(e.currentTarget.value, 255))}
            />
          </Grid.Col>
          <Grid.Col span={12}>
            {fijo ? (
              <Input.Wrapper
                label="Qué atiende este mantenimiento"
                description="Por qué se hizo: las incidencias que quedan cubiertas y, si es un servicio del programa, la columna que cierra"
                error={form.errors.pendiente_ids as string}
              >
                <Stack gap={6} mt={4}>
                  <Tooltip multiline w={260} withArrow label={fijo.ayuda}>
                    <Pill
                      // Difuminada y sin botón de quitar: es la razón de ser de
                      // este mantenimiento, no una opción más.
                      styles={{ root: { opacity: 0.65, cursor: 'not-allowed', alignSelf: 'flex-start' } }}
                    >
                      {fijo.etiqueta}
                    </Pill>
                  </Tooltip>
                  <MultiSelect
                    placeholder={hayPendientes
                      ? 'Agrega otros pendientes que se hayan atendido…'
                      : 'Esta unidad no tiene nada más pendiente'}
                    data={pendienteGroups}
                    searchable
                    clearable
                    {...form.getInputProps('pendiente_ids')}
                    error={undefined}
                  />
                </Stack>
              </Input.Wrapper>
            ) : (
              <Stack gap={6}>
                <MultiSelect
                  label="Qué atiende este mantenimiento"
                  description="Por qué se hizo: las incidencias que quedan cubiertas y, si es un servicio del programa, la columna que cierra"
                  placeholder={hayPendientes ? 'Selecciona los pendientes…' : 'Esta unidad no tiene nada pendiente'}
                  data={pendienteGroups}
                  searchable
                  clearable
                  {...form.getInputProps('pendiente_ids')}
                />
                {/* TEMPORAL — mantenimiento sin origen. Dejarlo vacío se permite
                    solo para capturar mantenimientos antiguos; el aviso está
                    para que no se vuelva la costumbre mientras dure. Se quita
                    junto con el resto de los puntos marcados. */}
                {form.values.pendiente_ids.length === 0 && (
                  <Alert color="yellow" variant="light" py={6}>
                    <Text size="xs">
                      Sin nada seleccionado el mantenimiento queda sin razón registrada. Déjalo así
                      solo para mantenimientos antiguos cuyo motivo ya no se conserva: más adelante
                      volverá a ser obligatorio vincularlos.
                    </Text>
                  </Alert>
                )}
              </Stack>
            )}
          </Grid.Col>
        </Grid>

        {!isEdit && (
          <>
            <Divider
              label={
                <Group gap="xs">
                  <Text size="sm" fw={500}>Refacciones usadas ({piezas.length})</Text>
                  <Text size="xs" c="dimmed">opcional</Text>
                </Group>
              }
              labelPosition="left"
            />

            {piezas.length === 0 ? (
              <Text size="sm" c="dimmed">
                Este mantenimiento no usa refacciones. Agrégalas si se consumieron refacciones del inventario.
              </Text>
            ) : (
              <Stack gap="xs">
                {piezas.map((_, idx) => (
                  <div key={idx}>
                  <Grid align="flex-start" gap="xs">
                    <Grid.Col span={6}>
                      <SelectCatalogo
                        estado={lotesQuery}
                        nombre="refacciones con existencia"
                        label={idx === 0 ? 'Refacción / lote' : undefined}
                        placeholder="Selecciona la refacción"
                        data={loteOptions(idx)}
                        nothingFoundMessage={
                          lotes.length === 0
                            ? 'Nada con existencias: usa "Registrar compra" o "Dar de alta refacción"'
                            : 'Sin coincidencias: si existe pero no tiene stock, usa "Registrar compra"'
                        }
                        value={piezas[idx].lote_id
                          ? claveExistencia(piezas[idx].lote_id, piezas[idx].sucursal_id)
                          : null}
                        onChange={(v) => setLote(idx, v)}
                        error={form.errors[`piezas.${idx}.lote_id`]}
                      />
                    </Grid.Col>
                    <Grid.Col span={2}>
                      <NumberInput
                        label={idx === 0 ? 'Cantidad' : undefined}
                        placeholder="0" min={1} allowDecimal={false}
                        {...form.getInputProps(`piezas.${idx}.cantidad`)}
                      />
                    </Grid.Col>
                    <Grid.Col span={3}>
                      <NumberInput
                        label={idx === 0 ? 'Costo unit.' : undefined}
                        placeholder="0.00" min={0} decimalScale={2} thousandSeparator="," prefix="$"
                        {...form.getInputProps(`piezas.${idx}.costo_unitario`)}
                      />
                    </Grid.Col>
                    <Grid.Col span={1}>
                      <ActionIcon
                        variant="subtle" color="red"
                        mt={idx === 0 ? 25 : 4}
                        aria-label="Quitar refacción"
                        onClick={() => form.removeListItem('piezas', idx)}
                      >
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Grid.Col>
                  </Grid>

                  {/* Solo aparece si la unidad lleva renglones de ese tipo: lo
                      que se gasta sin instalarse no pregunta nada. */}
                  <PosicionesMontaje
                    vehiculoId={vehiculoId}
                    tipoPiezaId={loteDe(idx)?.tipo_pieza_id}
                    cantidad={Number(piezas[idx].cantidad) || 1}
                    fechaServicio={form.values.fecha || null}
                    value={piezas[idx].posiciones}
                    onChange={(v) => form.setFieldValue(`piezas.${idx}.posiciones`, v)}
                  />
                  </div>
                ))}
              </Stack>
            )}

            {/* Los dos botones tocan el inventario de formas distintas, así que
                se nombran por lo que hacen con él: gastarlo o surtirlo. El
                normal va solo en su renglón; el otro queda abajo, como la salida
                para cuando ese no alcanza. */}
            <Stack gap={8}>
              <Group justify="space-between">
                <Button
                  variant="light" size="sm" leftSection={<IconPlus size={16} />}
                  onClick={() => form.insertListItem('piezas', {
                    lote_id: '', sucursal_id: '', cantidad: 1, costo_unitario: '',
                    posiciones: POSICIONES_VACIAS,
                  })}
                >
                  Usar del inventario
                </Button>
                {piezas.length > 0 && (
                  <Text size="sm" c="dimmed">
                    Total refacciones: <Text component="span" fw={600}>
                      {totalPiezas.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })}
                    </Text>
                  </Text>
                )}
              </Group>

              <Group gap={6} align="center" wrap="nowrap">
                <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>¿No aparece?</Text>
                <Tooltip
                  multiline w={280}
                  label="Registra la factura de la compra, con todas las refacciones que traiga. Las que no estén en el catálogo se dan de alta ahí mismo."
                >
                  <Button
                    variant="subtle" size="compact-xs" leftSection={<IconPlus size={12} />}
                    onClick={() => setCompraOpen(true)}
                  >
                    Registrar compra
                  </Button>
                </Tooltip>
              </Group>
            </Stack>
          </>
        )}

        <Group justify="flex-end" mt="xs">
          <Button variant="default" onClick={onCancel} disabled={isPending}>Cancelar</Button>
          <Button type="submit" loading={isPending}>{initial ? 'Guardar cambios' : 'Registrar'}</Button>
        </Group>
      </Stack>
    </form>

    {/* Una factura con todas sus partidas: las del catálogo y las que se dan de
        alta en el propio renglón. */}
    <CompraModal
      opened={compraOpen}
      onClose={() => setCompraOpen(false)}
      onCreated={handleCompraRegistrada}
    />

    <NuevoTecnicoModal
      opened={nuevoTecnicoOpen}
      onClose={() => setNuevoTecnicoOpen(false)}
      onCreated={handleTecnicoCreado}
    />

    <ConfirmarAvanceKm
      opened={porConfirmarKm !== null}
      kmVehiculo={kmVehiculo}
      kmNuevo={Number(porConfirmarKm?.km_actual ?? 0)}
      isPending={isPending}
      onCancel={() => setPorConfirmarKm(null)}
      onConfirm={() => {
        const vals = porConfirmarKm!
        setPorConfirmarKm(null)
        enviar(vals)
      }}
    />
    </>
  )
}
