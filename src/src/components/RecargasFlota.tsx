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
import { IconPlus, IconSearch } from '@tabler/icons-react'
import { useRecargasTodas, useCreateRecarga } from '../hooks/useRecargas'
import type { RecargaConVehiculo, RecargaPayload } from '../hooks/useRecargas'
import { useVehiculos, vehiculoLabel } from '../hooks/useVehiculos'
import { RecargaForm, RecargasTabla, ResumenGrupo } from './RecargasSection'
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

// ── Alta: vehículo + recarga ──────────────────────────────────────────────────

type VehiculoElegido = { id: number; label: string; km: number | null }

function NuevaRecarga({
  valesUsados, isPending, error, onSubmit, onCancel,
}: {
  valesUsados: Set<number>
  isPending: boolean
  error: string | null
  onSubmit: (vehiculoId: number, payload: RecargaPayload) => void
  onCancel: () => void
}) {
  // La flota puede pasar de una página de vehículos, así que el Select busca
  // contra la API (que ya acota al responsable a su sucursal).
  const [busqueda, setBusqueda] = useState('')
  const [debounced] = useDebouncedValue(busqueda, 300)
  const { data: vehData, isLoading } = useVehiculos(1, debounced, undefined, undefined, 20)
  const [elegido, setElegido] = useState<VehiculoElegido | null>(null)

  // El elegido se conserva en las opciones aunque la búsqueda activa —que
  // Mantine llena con su etiqueta al seleccionarlo— ya no lo devuelva.
  const opciones = useMemo(() => {
    const opts = (vehData?.data ?? []).map((v) => ({ value: String(v.id), label: vehiculoLabel(v) }))
    if (elegido && !opts.some((o) => o.value === String(elegido.id))) {
      opts.unshift({ value: String(elegido.id), label: elegido.label })
    }
    return opts
  }, [vehData, elegido])

  function seleccionar(id: string | null) {
    if (!id) { setElegido(null); return }
    if (elegido && String(elegido.id) === id) return
    const v = (vehData?.data ?? []).find((x) => String(x.id) === id)
    if (v) setElegido({ id: v.id, label: vehiculoLabel(v), km: v.kilometraje })
  }

  return (
    <Stack gap="sm">
      <Select
        label="Vehículo"
        placeholder="Busca por marca, modelo, serie o placas"
        data={opciones}
        searchable
        required
        value={elegido ? String(elegido.id) : null}
        onChange={seleccionar}
        searchValue={busqueda}
        onSearchChange={setBusqueda}
        rightSection={isLoading ? <Loader size="xs" /> : undefined}
        nothingFoundMessage={isLoading ? 'Buscando…' : 'Sin resultados'}
      />
      {elegido ? (
        // `key`: al cambiar de vehículo el formulario empieza de cero, porque
        // el vale elegido era del vehículo anterior y la API lo rechazaría.
        <RecargaForm
          key={elegido.id}
          vehiculoId={elegido.id}
          kmVehiculo={elegido.km}
          valesUsados={valesUsados}
          isPending={isPending}
          error={error}
          onSubmit={(payload) => onSubmit(elegido.id, payload)}
          onCancel={onCancel}
        />
      ) : (
        <Group justify="flex-end" mt="xs">
          <Button variant="default" onClick={onCancel}>Cancelar</Button>
        </Group>
      )}
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
  const [formError, setFormError] = useState<string | null>(null)
  const [busqueda, setBusqueda]   = useState('')

  const { data, isLoading, error } = useRecargasTodas()
  const createMut = useCreateRecarga()

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
      [vehiculoLabel(r), r.placas, r.conductor, r.gasolinera, r.vale_folio]
        .some((t) => t?.toLowerCase().includes(q))
    )
  }, [items, busqueda])
  const anios = useMemo(() => agrupar(filtradas), [filtradas])

  const [anioAbierto, setAnioAbierto] = useState<string | null>(null)
  const [mesAbierto, setMesAbierto]   = useState<string | null>(null)
  const anioVisible = anioAbierto ?? anios[0]?.key ?? null
  const mesVisible  = mesAbierto  ?? anios[0]?.meses[0]?.key ?? null

  function abrir() { setFormError(null); setFormOpen(true) }

  function registrar(vehiculoId: number, payload: RecargaPayload) {
    setFormError(null)
    createMut.mutate({ vehiculoId, payload }, {
      onSuccess: () => setFormOpen(false),
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
            <Button leftSection={<IconPlus size={16} />} onClick={abrir}>
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
        title="Registrar recarga" centered size="md"
      >
        {formOpen && (
          <NuevaRecarga
            valesUsados={valesUsados}
            isPending={createMut.isPending}
            error={formError}
            onSubmit={registrar}
            onCancel={() => setFormOpen(false)}
          />
        )}
      </Modal>
    </>
  )
}
