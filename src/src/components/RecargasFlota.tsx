// Recargas de combustible de toda la flota: la pestaña Recargas de Vales de
// gasolina. Es la misma recarga que se captura en la ficha del vehículo, pero
// aquí el vehículo se elige en el formulario y el listado junta todos.
//
// Qué recargas llegan lo decide la API: al responsable sólo le manda las de
// los vehículos de su sucursal (y los de translado), igual que en la flota.
//
// El listado se agrupa año → mes como en la ficha del vehículo. El rendimiento
// se calcula por vehículo —km/L sale de la recarga anterior de la misma
// unidad—, sobre todas las recargas y no sobre las que deja la búsqueda: filtrar
// no debe cambiar el tramo contra el que se mide.
import { useMemo, useState } from 'react'
import {
  Stack, Group, Text, Loader, Center, Alert, Button, Modal, Select,
  TextInput, Accordion, Anchor,
} from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import { IconAlertTriangle, IconPlus, IconSearch } from '@tabler/icons-react'
import {
  useRecargasTodas, useCreateRecarga, useCreateRecargaEmergencia, useUpdateRecarga,
} from '../hooks/useRecargas'
import type { RecargaConVehiculo, RecargaEmergenciaPayload, RecargaPayload } from '../hooks/useRecargas'
import { usePermisos } from '../hooks/usePermisos'
import { useVehiculo, useVehiculos, vehiculoLabel } from '../hooks/useVehiculos'
import { useValesGasolina } from '../hooks/useValesGasolina'
import SelectCatalogo from './SelectCatalogo'
import { opcionVehiculo, renderOpcionVehiculo, sinFiltroLocal, vehiculoLabelCorto } from './OpcionVehiculo'
import { opcionVale, renderOpcionVale, filtrarVales } from './OpcionVale'
import {
  RecargaEmergenciaForm, RecargaForm, RecargasTabla, ResumenGrupo, recargaAFormulario,
  emergenciaAFormulario,
} from './RecargasSection'
import { agrupar, calcularRendimientos } from '../lib/recargas'

// Rendimientos de todas las unidades en un solo mapa id de recarga → km/L.
function rendimientosPorVehiculo(items: RecargaConVehiculo[]): Map<number, number | null> {
  const porVehiculo = new Map<number, RecargaConVehiculo[]>()
  for (const r of items) {
    if (!porVehiculo.has(r.vehiculo_id)) porVehiculo.set(r.vehiculo_id, [])
    porVehiculo.get(r.vehiculo_id)!.push(r)
  }
  const todos = new Map<number, number | null>()
  for (const rs of porVehiculo.values()) {
    for (const [id, rend] of calcularRendimientos(rs)) todos.set(id, rend)
  }
  return todos
}

// ── Alta: vale + vehículo + recarga ───────────────────────────────────────────

type VehiculoElegido = { id: number; label: string }

/** Lo que se le dice a quien capturó cuando la recarga le corrigió la unidad al vale. */
type CorreccionVale = { folio: string; antes: string; ahora: string }

// Primero el vale: es el papel que el chofer trae en la mano, y ya dice a qué
// unidad y a qué chofer se le entregó. Elegirlo llena los dos; se pueden
// cambiar si el vale venía mal, y al guardar la API le corrige la unidad.
//
// Con `onSubmitEmergencia` el alta es de emergencia: no hay vale, así que se
// empieza por el vehículo y el formulario no lleva gasolinera, vale ni
// kilometraje.
function NuevaRecarga({
  valesUsados, isPending, error, onSubmit, onSubmitEmergencia, onCancel,
}: {
  valesUsados: Set<number>
  isPending: boolean
  error: string | null
  onSubmit: (vehiculoId: number, payload: RecargaPayload, correccion?: CorreccionVale) => void
  onSubmitEmergencia?: (vehiculoId: number, payload: RecargaEmergenciaPayload) => void
  onCancel: () => void
}) {
  const conVale = !onSubmitEmergencia
  // Corregir la unidad del vale cambia un papel que no es la recarga: no debe
  // pasar de callado, como el avance del odómetro. Se pide aceptar al guardar.
  const [porConfirmarVale, setPorConfirmarVale] = useState<RecargaPayload | null>(null)

  // La flota puede pasar de una página de vehículos, así que el Select busca
  // contra la API (que ya acota al responsable a su sucursal).
  const [busqueda, setBusqueda] = useState('')
  const [debounced] = useDebouncedValue(busqueda, 300)
  const { data: vehData, isLoading } = useVehiculos(1, debounced, undefined, undefined, 20)
  const [elegido, setElegido] = useState<VehiculoElegido | null>(null)
  // El odómetro y el combustible de la unidad elegida. Se piden aparte porque
  // la que trae el vale no tiene por qué estar en la búsqueda.
  const vehQuery = useVehiculo(elegido?.id)
  const vehiculo = vehQuery.data?.data

  // Vales que todavía se pueden gastar. Los archivados ya no llegan, y los
  // usados se descartan también por las recargas a la vista: la consulta de
  // vales puede venir de antes de la última recarga.
  const valesQuery = useValesGasolina()
  const [valeId, setValeId] = useState<string | null>(null)
  const valesLibres = useMemo(
    () => (valesQuery.data?.data ?? [])
      .filter((v) => v.estado !== 'usado' && v.estado !== 'archivado' && !valesUsados.has(v.id)),
    [valesQuery.data, valesUsados],
  )
  const vale = valesLibres.find((v) => String(v.id) === valeId)
  const opcionesVale = valesLibres.map(opcionVale)

  // El elegido se conserva en las opciones aunque la búsqueda activa —que
  // Mantine llena con su etiqueta al seleccionarlo— ya no lo devuelva.
  const opciones = useMemo(() => {
    const opts = (vehData?.data ?? []).map(opcionVehiculo)
    if (elegido && !opts.some((o) => o.value === String(elegido.id))) {
      opts.unshift({ value: String(elegido.id), label: elegido.label })
    }
    return opts
  }, [vehData, elegido])

  function elegirVale(id: string | null) {
    setValeId(id)
    const v = valesLibres.find((x) => String(x.id) === id)
    if (v) {
      setElegido({ id: v.vehiculo_id, label: vehiculoLabelCorto(v) })
      setBusqueda(vehiculoLabelCorto(v))
    }
  }

  function seleccionar(id: string | null) {
    if (!id) { setElegido(null); return }
    if (elegido && String(elegido.id) === id) return
    const v = (vehData?.data ?? []).find((x) => String(x.id) === id)
    if (v) setElegido({ id: v.id, label: vehiculoLabelCorto(v) })
  }

  const otraUnidad = vale && elegido && vale.vehiculo_id !== elegido.id

  function guardar(payload: RecargaPayload) {
    if (!elegido) return
    if (payload.corregir_vale) { setPorConfirmarVale(payload); return }
    onSubmit(elegido.id, payload)
  }

  function confirmarCorreccion() {
    const payload = porConfirmarVale!
    setPorConfirmarVale(null)
    if (!elegido || !vale) return
    onSubmit(elegido.id, payload, {
      folio: vale.folio, antes: vehiculoLabelCorto(vale), ahora: elegido.label,
    })
  }

  return (
    <Stack gap="sm">
      {conVale && (
        <>
          <SelectCatalogo
            estado={valesQuery}
            nombre="vales"
            label="Vale de gasolina"
            placeholder={opcionesVale.length ? 'Busca por folio, chofer o unidad' : 'No hay vales libres'}
            data={opcionesVale}
            renderOption={renderOpcionVale}
            filter={filtrarVales}
            required
            value={valeId}
            onChange={elegirVale}
          />
          {!valesQuery.isLoading && !valesQuery.isError && opcionesVale.length === 0 && (
            <Text size="xs" c="dimmed">
              No hay vales libres. Registra uno en la pestaña Vales.
            </Text>
          )}
        </>
      )}
      {(!conVale || vale) && (
        <Select
          label="Vehículo"
          placeholder="Busca por marca, modelo, serie o placas"
          description={conVale ? 'El del vale. Cámbialo solo si el vale se emitió para otra unidad.' : undefined}
          data={opciones}
          searchable
          filter={sinFiltroLocal}
          renderOption={renderOpcionVehiculo}
          required
          value={elegido ? String(elegido.id) : null}
          onChange={seleccionar}
          searchValue={busqueda}
          onSearchChange={setBusqueda}
          rightSection={isLoading ? <Loader size="xs" /> : undefined}
          nothingFoundMessage={isLoading ? 'Buscando…' : 'Sin resultados'}
        />
      )}
      {otraUnidad && (
        <Alert color="yellow" icon={<IconAlertTriangle size={16} />}>
          El vale {vale.folio} se emitió para {vehiculoLabelCorto(vale)}. Al guardar, el vale
          también se corrige a esta unidad.
        </Alert>
      )}
      {elegido && vehQuery.isError ? (
        <Alert color="red" title="No se pudo cargar el vehículo">
          {(vehQuery.error as Error).message}
        </Alert>
      ) : elegido && !vehiculo ? (
        <Center py="md"><Loader size="sm" /></Center>
      ) : elegido && vehiculo && !conVale ? (
        <RecargaEmergenciaForm
          key={elegido.id}
          combustibleVehiculo={vehiculo.combustible}
          isPending={isPending}
          error={error}
          onSubmit={(payload) => onSubmitEmergencia!(elegido.id, payload)}
          onCancel={onCancel}
        />
      ) : elegido && vehiculo && vale ? (
        // `key`: otro vale empieza el formulario de cero, con su chofer.
        // Cambiar de vehículo no: lo capturado sigue valiendo.
        <RecargaForm
          key={vale.id}
          vehiculoId={elegido.id}
          kmVehiculo={vehiculo.kilometraje}
          combustibleVehiculo={vehiculo.combustible}
          valesUsados={valesUsados}
          vale={vale}
          isPending={isPending}
          error={error}
          onSubmit={guardar}
          onCancel={onCancel}
        />
      ) : (
        <Group justify="flex-end" mt="xs">
          <Button variant="default" onClick={onCancel}>Cancelar</Button>
        </Group>
      )}

      <Modal
        opened={porConfirmarVale !== null}
        onClose={() => setPorConfirmarVale(null)}
        title="Se corregirá el vale"
        centered size="sm"
      >
        {vale && elegido && (
          <Stack gap="md">
            <Alert color="yellow" icon={<IconAlertTriangle size={16} />}>
              <Text size="sm">
                El vale <strong>{vale.folio}</strong> se emitió para{' '}
                <strong>{vehiculoLabelCorto(vale)}</strong>. Al guardar la recarga, el vale
                pasa a <strong>{elegido.label}</strong>.
              </Text>
            </Alert>
            <Text size="xs" c="dimmed">
              Si el vale está bien, cancela y elige el vehículo del vale.
            </Text>
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setPorConfirmarVale(null)} disabled={isPending}>
                Cancelar
              </Button>
              <Button color="yellow" onClick={confirmarCorreccion} loading={isPending}>
                Guardar y corregir el vale
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  )
}

// ── Pestaña ───────────────────────────────────────────────────────────────────

export default function RecargasFlota({
  onNavigateVehiculo,
}: {
  onNavigateVehiculo?: (id: number) => void
}) {
  const [formOpen, setFormOpen]   = useState(false)
  const [emergencia, setEmergencia] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [busqueda, setBusqueda]   = useState('')
  // La recarga que se está corrigiendo. Aquí corrige el admin, que revisa lo que
  // capturaron las sucursales sin ir vehículo por vehículo, y el practicante
  // las que él capturó: es desde aquí que las registra.
  const [editing, setEditing]     = useState<RecargaConVehiculo | null>(null)
  // El vale que la última recarga le corrigió de unidad, para decirlo después
  // de cerrar el formulario: el cambio no se ve en este listado.
  const [valeCorregido, setValeCorregido] = useState<CorreccionVale | null>(null)

  const { data, isLoading, error } = useRecargasTodas()
  const createMut = useCreateRecarga()
  const emergenciaMut = useCreateRecargaEmergencia()
  const updateMut = useUpdateRecarga()
  // Registrar una recarga de emergencia es solo del admin (la API lo impone).
  const { esAdmin, esPracticante, puedeCorregirCaptura } = usePermisos()

  const items = useMemo(() => data?.data ?? [], [data])
  const rendimientos = useMemo(() => rendimientosPorVehiculo(items), [items])
  // Cada vale sirve para una sola recarga; aquí están todas las del vehículo
  // que se elija, porque si se ve el vehículo se ven todas sus recargas.
  const valesUsados = useMemo(
    () => new Set(items.map((r) => r.vale_id).filter((id): id is number => id != null)),
    [items]
  )

  const filtradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    if (!q) return items
    return items.filter((r) =>
      [vehiculoLabel(r), r.placas, r.conductor, r.gasolinera, r.vale_folio,
       r.emergencia ? 'emergencia' : null]
        .some((t) => t?.toLowerCase().includes(q))
    )
  }, [items, busqueda])
  const anios = useMemo(() => agrupar(filtradas), [filtradas])

  const [anioAbierto, setAnioAbierto] = useState<string | null>(null)
  const [mesAbierto, setMesAbierto]   = useState<string | null>(null)
  const anioVisible = anioAbierto ?? anios[0]?.key ?? null
  const mesVisible  = mesAbierto  ?? anios[0]?.meses[0]?.key ?? null

  function abrir(deEmergencia: boolean) {
    setFormError(null); setValeCorregido(null); setEmergencia(deEmergencia); setFormOpen(true)
  }

  function registrarEmergencia(vehiculoId: number, payload: RecargaEmergenciaPayload) {
    setFormError(null)
    emergenciaMut.mutate({ vehiculoId, payload }, {
      onSuccess: () => setFormOpen(false),
      onError:   (e: Error) => setFormError(e.message),
    })
  }

  function registrar(vehiculoId: number, payload: RecargaPayload, correccion?: CorreccionVale) {
    setFormError(null)
    createMut.mutate({ vehiculoId, payload }, {
      onSuccess: () => { setFormOpen(false); setValeCorregido(correccion ?? null) },
      onError:   (e: Error) => setFormError(e.message),
    })
  }

  function abrirEdicion(r: RecargaConVehiculo) {
    setFormError(null); updateMut.reset(); setEditing(r)
  }

  function corregir(payload: RecargaPayload | RecargaEmergenciaPayload) {
    if (!editing) return
    setFormError(null)
    updateMut.mutate({ id: editing.id, payload }, {
      onSuccess: () => setEditing(null),
      onError:   (e: Error) => setFormError(e.message),
    })
  }

  const celdaVehiculo = (r: RecargaConVehiculo) => (
    <>
      {onNavigateVehiculo ? (
        <Anchor component="button" type="button" size="sm"
          onClick={() => onNavigateVehiculo(r.vehiculo_id)}>
          {vehiculoLabel(r)}
        </Anchor>
      ) : (
        <Text size="sm">{vehiculoLabel(r)}</Text>
      )}
      <Text size="xs" c="dimmed">{r.placas ?? 'Sin placas'}</Text>
    </>
  )

  return (
    <>
      <Stack gap="md">
        {valeCorregido && (
          <Alert
            color="green" withCloseButton onClose={() => setValeCorregido(null)}
            title="Recarga registrada y vale corregido"
          >
            El vale {valeCorregido.folio} pasó de {valeCorregido.antes} a {valeCorregido.ahora}.
          </Alert>
        )}
        <Group justify="space-between" align="flex-end">
          <TextInput
            placeholder="Buscar vehículo, placas, conductor, gasolinera o vale"
            leftSection={<IconSearch size={14} />}
            value={busqueda}
            onChange={(e) => setBusqueda(e.currentTarget.value)}
            style={{ flex: 1, maxWidth: 420 }}
          />
          <Group gap="sm" align="flex-end">
            {items.length > 0 && (
              <Text size="sm" c="dimmed">{filtradas.length} recargas</Text>
            )}
            {esAdmin && (
              <Button
                variant="light" color="orange"
                leftSection={<IconAlertTriangle size={16} />}
                onClick={() => abrir(true)}
              >
                Recarga de emergencia
              </Button>
            )}
            <Button leftSection={<IconPlus size={16} />} onClick={() => abrir(false)}>
              Registrar recarga
            </Button>
          </Group>
        </Group>

        {isLoading ? (
          <Center py="xl"><Loader /></Center>
        ) : error ? (
          <Alert color="red" title="Error al cargar">{(error as Error).message}</Alert>
        ) : filtradas.length === 0 ? (
          <Center py="xl">
            <Text c="dimmed">
              {items.length === 0 ? 'No hay recargas registradas.' : 'Ninguna recarga coincide con la búsqueda.'}
            </Text>
          </Center>
        ) : (
          <Accordion variant="separated" value={anioVisible} onChange={setAnioAbierto}>
            {anios.map((a) => (
              <Accordion.Item key={a.key} value={a.key}>
                <Accordion.Control>
                  <ResumenGrupo label={a.label} litros={a.litros} costo={a.costo} fw={600} />
                </Accordion.Control>
                <Accordion.Panel>
                  <Accordion variant="contained" value={mesVisible} onChange={setMesAbierto}>
                    {a.meses.map((m) => (
                      <Accordion.Item key={m.key} value={m.key}>
                        <Accordion.Control>
                          <ResumenGrupo label={m.label} litros={m.litros} costo={m.costo} fw={500} />
                        </Accordion.Control>
                        <Accordion.Panel>
                          <RecargasTabla
                            items={m.items}
                            rendimientos={rendimientos}
                            vehiculo={celdaVehiculo}
                            onEdit={esAdmin || esPracticante ? abrirEdicion : undefined}
                            editable={(r) => esAdmin || (!r.emergencia && puedeCorregirCaptura(r.capturado_por))}
                          />
                        </Accordion.Panel>
                      </Accordion.Item>
                    ))}
                  </Accordion>
                </Accordion.Panel>
              </Accordion.Item>
            ))}
          </Accordion>
        )}
      </Stack>

      <Modal
        opened={formOpen} onClose={() => setFormOpen(false)}
        title={emergencia ? 'Registrar recarga de emergencia' : 'Registrar recarga'}
        centered size="md"
      >
        {formOpen && (
          <NuevaRecarga
            valesUsados={valesUsados}
            isPending={createMut.isPending || emergenciaMut.isPending}
            error={formError}
            onSubmit={registrar}
            onSubmitEmergencia={emergencia ? registrarEmergencia : undefined}
            onCancel={() => setFormOpen(false)}
          />
        )}
      </Modal>

      <Modal
        opened={editing !== null} onClose={() => setEditing(null)}
        title={editing
          ? `${editing.emergencia ? 'Corregir recarga de emergencia' : 'Corregir recarga'} · ${vehiculoLabel(editing)}`
          : ''}
        centered size="md"
      >
        {/* `key`: cada recarga abre su formulario desde cero. */}
        {editing && (editing.emergencia ? (
          <RecargaEmergenciaForm
            key={editing.id}
            combustibleVehiculo={editing.vehiculo_combustible}
            initial={emergenciaAFormulario(editing)}
            isPending={updateMut.isPending}
            error={formError}
            onSubmit={corregir}
            onCancel={() => setEditing(null)}
          />
        ) : (
          // Sin km del vehículo: al corregir no se toca el odómetro.
          <RecargaForm
            key={editing.id}
            vehiculoId={editing.vehiculo_id}
            kmVehiculo={null}
            combustibleVehiculo={editing.vehiculo_combustible}
            valesUsados={valesUsados}
            initial={recargaAFormulario(editing)}
            isPending={updateMut.isPending}
            error={formError}
            onSubmit={corregir}
            onCancel={() => setEditing(null)}
          />
        ))}
      </Modal>
    </>
  )
}
