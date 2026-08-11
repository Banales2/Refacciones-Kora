// Página Vales de gasolina: alta, edición y baja de los vales entregados a los
// choferes. Cada vale guarda quién lo creó (el usuario de la sesión, lo asigna
// la API), el chofer al que se entregó, el vehículo y la fecha.
import { useMemo, useState } from 'react'
import {
  Stack, Group, Text, Table, Loader, Center, Alert,
  Button, ActionIcon, Modal, TextInput, Select, Accordion, Badge,
} from '@mantine/core'
import { useForm } from '@mantine/form'
import { useDebouncedValue } from '@mantine/hooks'
import { IconPencil, IconTrash, IconPlus } from '@tabler/icons-react'
import {
  useValesGasolina, useCreateValeGasolina, useUpdateValeGasolina, useDeleteValeGasolina,
} from '../hooks/useValesGasolina'
import type { ValeGasolina, ValeGasolinaPayload } from '../hooks/useValesGasolina'
import { useConductores } from '../hooks/useConductores'
import { useVehiculos, vehiculoLabel } from '../hooks/useVehiculos'
import { useAuth } from '../hooks/useAuth'
import { FechaInput } from '../components/FechaInput'

function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatFecha(iso: string) {
  return new Date(`${iso.split('T')[0]}T12:00:00`).toLocaleDateString('es-MX', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

function valeVehiculoLabel(v: ValeGasolina) {
  return `${v.marca} ${v.modelo} — ${v.serie}`
}

// ── Agrupado persona → vehículo ───────────────────────────────────────────────

type GrupoVehiculo = {
  key:    string
  label:  string
  placas: string | null
  items:  ValeGasolina[]
}

type GrupoPersona = {
  key:       string
  label:     string
  total:     number
  vehiculos: GrupoVehiculo[]
}

// Agrupa los vales por quien los registró y, dentro de cada persona, por
// vehículo. Las personas y los vehículos van alfabéticos; los vales de cada
// vehículo, del más reciente al más antiguo (la fecha es "YYYY-MM-DD", así que
// ordena bien como texto y no hace falta construir Dates).
function agrupar(items: ValeGasolina[]): GrupoPersona[] {
  const personas = new Map<string, Map<number, ValeGasolina[]>>()

  for (const v of items) {
    if (!personas.has(v.creado_por)) personas.set(v.creado_por, new Map())
    const vehiculos = personas.get(v.creado_por)!
    if (!vehiculos.has(v.vehiculo_id)) vehiculos.set(v.vehiculo_id, [])
    vehiculos.get(v.vehiculo_id)!.push(v)
  }

  return [...personas.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], 'es-MX'))
    .map(([persona, vehiculosMap]) => {
      const vehiculos: GrupoVehiculo[] = [...vehiculosMap.entries()]
        .map(([vehiculoId, vales]) => ({
          key:    `${persona}|${vehiculoId}`,
          label:  valeVehiculoLabel(vales[0]),
          placas: vales[0].placas,
          items:  [...vales].sort((a, b) =>
            a.fecha === b.fecha ? b.id - a.id : b.fecha.localeCompare(a.fecha)
          ),
        }))
        .sort((a, b) => a.label.localeCompare(b.label, 'es-MX'))

      return {
        key:   persona,
        label: persona,
        total: vehiculos.reduce((s, g) => s + g.items.length, 0),
        vehiculos,
      }
    })
}

// ── Formulario ────────────────────────────────────────────────────────────────

type ValeFormValues = {
  conductor_id: string
  vehiculo_id:  string
  fecha:        string
}

function ValeForm({
  initial, isPending, error, onSubmit, onCancel,
}: {
  // Al editar, el vehículo ya elegido puede no venir en los resultados de la
  // búsqueda; su etiqueta se pasa aparte para poder mostrarlo en el Select.
  initial?: ValeFormValues & { vehiculo_label: string }
  isPending: boolean
  error: string | null
  onSubmit: (payload: ValeGasolinaPayload) => void
  onCancel: () => void
}) {
  const hoy = todayIso()
  const { user } = useAuth()
  const { data: conData } = useConductores()

  // La flota puede pasar de los 100 vehículos que devuelve una página, así que
  // el Select busca contra la API en vez de filtrar una lista completa.
  const [vehiculoSearch, setVehiculoSearch] = useState('')
  const [debouncedSearch] = useDebouncedValue(vehiculoSearch, 300)
  const { data: vehData, isLoading: loadingVehiculos } =
    useVehiculos(1, debouncedSearch, undefined, undefined, 20)

  // Al elegir una opción, Mantine copia su etiqueta al texto de búsqueda, lo
  // que lanza otra consulta que normalmente ya no devuelve ese vehículo. Por
  // eso se guarda su etiqueta al momento de seleccionarlo: sin esto, la opción
  // de respaldo se quedaba sin nombre y el campo mostraba el id.
  const [etiquetaSeleccionado, setEtiquetaSeleccionado] =
    useState(initial?.vehiculo_label ?? '')

  const form = useForm<ValeFormValues>({
    initialValues: initial ?? { conductor_id: '', vehiculo_id: '', fecha: hoy },
    validate: {
      conductor_id: (v) => (!v ? 'Chofer requerido' : null),
      vehiculo_id:  (v) => (!v ? 'Vehículo requerido' : null),
      fecha: (v) => {
        if (!v) return 'Fecha requerida'
        if (v > hoy) return 'No puede ser una fecha futura'
        return null
      },
    },
  })

  const conductores = (conData?.data ?? []).map((c) => ({
    value: String(c.id),
    label: c.nombre,
  }))

  // El vehículo seleccionado se conserva en las opciones aunque la búsqueda
  // activa ya no lo devuelva; si no, el Select se quedaría en blanco.
  const vehiculos = useMemo(() => {
    const opts = (vehData?.data ?? []).map((v) => ({
      value: String(v.id),
      label: vehiculoLabel(v),
    }))
    const seleccionado = form.values.vehiculo_id
    if (seleccionado && !opts.some((o) => o.value === seleccionado)) {
      opts.unshift({ value: seleccionado, label: etiquetaSeleccionado })
    }
    return opts
  }, [vehData, form.values.vehiculo_id, etiquetaSeleccionado])

  function seleccionarVehiculo(id: string | null) {
    form.setFieldValue('vehiculo_id', id ?? '')
    const elegido = (vehData?.data ?? []).find((v) => String(v.id) === id)
    setEtiquetaSeleccionado(elegido ? vehiculoLabel(elegido) : '')
  }

  return (
    <form
      onSubmit={form.onSubmit((v) => onSubmit({
        conductor_id: parseInt(v.conductor_id, 10),
        vehiculo_id:  parseInt(v.vehiculo_id, 10),
        fecha:        v.fecha,
      }))}
    >
      <Stack gap="sm">
        <TextInput
          label="Creado por"
          value={user?.userDetails ?? ''}
          disabled
          description="Se registra automáticamente con tu usuario"
        />
        <Select
          label="Chofer"
          placeholder={conductores.length ? 'Selecciona un chofer' : 'No hay choferes registrados'}
          data={conductores}
          searchable
          required
          {...form.getInputProps('conductor_id')}
        />
        {conductores.length === 0 && (
          <Text size="xs" c="dimmed">
            Da de alta los choferes en Catálogos → Conductores.
          </Text>
        )}
        <Select
          label="Vehículo"
          placeholder="Busca por marca, modelo, serie o placas"
          data={vehiculos}
          searchable
          required
          searchValue={vehiculoSearch}
          onSearchChange={setVehiculoSearch}
          rightSection={loadingVehiculos ? <Loader size="xs" /> : undefined}
          nothingFoundMessage={loadingVehiculos ? 'Buscando…' : 'Sin resultados'}
          {...form.getInputProps('vehiculo_id')}
          onChange={seleccionarVehiculo}
        />
        <FechaInput
          label="Fecha"
          required
          maxDate={hoy}
          value={form.values.fecha}
          onChange={(d) => form.setFieldValue('fecha', d)}
          error={form.errors.fecha as string}
        />
        {error && <Alert color="red" title="Error">{error}</Alert>}
        <Group justify="flex-end" mt="xs">
          <Button variant="default" onClick={onCancel} disabled={isPending}>
            Cancelar
          </Button>
          <Button type="submit" loading={isPending}>
            Guardar
          </Button>
        </Group>
      </Stack>
    </form>
  )
}

// ── Tabla de los vales de un vehículo ─────────────────────────────────────────

// Ni la persona ni el vehículo se repiten como columnas: ya los dice el
// encabezado del grupo que contiene esta tabla.
function ValesTabla({
  items, onEdit, onDelete,
}: {
  items: ValeGasolina[]
  onEdit: (v: ValeGasolina) => void
  onDelete: (v: ValeGasolina) => void
}) {
  return (
    <Table highlightOnHover verticalSpacing="xs">
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Fecha</Table.Th>
          <Table.Th>Chofer</Table.Th>
          <Table.Th style={{ width: 90 }} />
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {items.map((v) => (
          <Table.Tr key={v.id}>
            <Table.Td>{formatFecha(v.fecha)}</Table.Td>
            <Table.Td fw={500}>{v.conductor}</Table.Td>
            <Table.Td>
              <Group gap={4} justify="flex-end" wrap="nowrap">
                <ActionIcon variant="subtle" color="blue" size="sm"
                  aria-label="Editar" onClick={() => onEdit(v)}>
                  <IconPencil size={14} />
                </ActionIcon>
                <ActionIcon variant="subtle" color="red" size="sm"
                  aria-label="Eliminar" onClick={() => onDelete(v)}>
                  <IconTrash size={14} />
                </ActionIcon>
              </Group>
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  )
}

// Encabezado de un grupo: nombre a la izquierda, conteo de vales a la derecha.
function ResumenGrupo({
  label, detalle, total, fw,
}: {
  label:   string
  detalle: string
  total:   number
  fw:      number
}) {
  return (
    <Group justify="space-between" wrap="nowrap" pr="sm">
      <div>
        <Text size="sm" fw={fw}>{label}</Text>
        <Text size="xs" c="dimmed">{detalle}</Text>
      </div>
      <Badge variant="light" color="gray">
        {total} vale{total !== 1 ? 's' : ''}
      </Badge>
    </Group>
  )
}

// ── Página ────────────────────────────────────────────────────────────────────

export default function ValesGasolina() {
  const [createOpen, setCreateOpen] = useState(false)
  const [editVale, setEditVale]     = useState<ValeGasolina | null>(null)
  const [deleteVale, setDeleteVale] = useState<ValeGasolina | null>(null)

  const { data, isLoading, isError } = useValesGasolina()
  const createMut = useCreateValeGasolina()
  const updateMut = useUpdateValeGasolina()
  const deleteMut = useDeleteValeGasolina()

  const vales = useMemo(() => data?.data ?? [], [data])
  const personas = useMemo(() => agrupar(vales), [vales])

  // Al entrar viene abierta la primera persona y su primer vehículo, para no
  // dejar la pantalla en puros encabezados cerrados.
  const [personaAbierta, setPersonaAbierta] = useState<string | null>(null)
  const [vehiculoAbierto, setVehiculoAbierto] = useState<string | null>(null)
  const personaVisible  = personaAbierta  ?? personas[0]?.key ?? null
  const vehiculoVisible = vehiculoAbierto ?? personas[0]?.vehiculos[0]?.key ?? null

  return (
    <>
      <Stack gap="md">
        <Group justify="space-between" align="flex-end">
          <div>
            <Text size="xl" fw={600}>Vales de gasolina</Text>
            <Text size="sm" c="dimmed">Vales entregados a los choferes</Text>
          </div>
          <Group gap="sm" align="flex-end">
            {vales.length > 0 && (
              <Text size="sm" c="dimmed">{vales.length} vales</Text>
            )}
            <Button
              leftSection={<IconPlus size={16} />}
              onClick={() => setCreateOpen(true)}
            >
              Nuevo vale
            </Button>
          </Group>
        </Group>

        {isLoading ? (
          <Center py="xl"><Loader /></Center>
        ) : isError ? (
          <Alert color="red" title="Error al cargar">
            No se pudieron obtener los vales. Verifica la conexión.
          </Alert>
        ) : vales.length === 0 ? (
          <Center py="xl">
            <Text c="dimmed">No hay vales registrados.</Text>
          </Center>
        ) : (
          <Accordion variant="separated" value={personaVisible} onChange={setPersonaAbierta}>
            {personas.map((p) => (
              <Accordion.Item key={p.key} value={p.key}>
                <Accordion.Control>
                  <ResumenGrupo
                    label={p.label}
                    detalle={`${p.vehiculos.length} vehículo${p.vehiculos.length !== 1 ? 's' : ''}`}
                    total={p.total}
                    fw={600}
                  />
                </Accordion.Control>
                <Accordion.Panel>
                  <Accordion variant="contained" value={vehiculoVisible} onChange={setVehiculoAbierto}>
                    {p.vehiculos.map((g) => (
                      <Accordion.Item key={g.key} value={g.key}>
                        <Accordion.Control>
                          <ResumenGrupo
                            label={g.label}
                            detalle={g.placas ?? 'Sin placas'}
                            total={g.items.length}
                            fw={500}
                          />
                        </Accordion.Control>
                        <Accordion.Panel>
                          <ValesTabla items={g.items} onEdit={setEditVale} onDelete={setDeleteVale} />
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

      {/* Modal: nuevo vale */}
      <Modal
        opened={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Nuevo vale de gasolina"
        centered
        size="md"
      >
        <ValeForm
          isPending={createMut.isPending}
          error={createMut.error ? (createMut.error as Error).message : null}
          onSubmit={(payload) =>
            createMut.mutate(payload, { onSuccess: () => setCreateOpen(false) })
          }
          onCancel={() => setCreateOpen(false)}
        />
      </Modal>

      {/* Modal: editar vale */}
      <Modal
        opened={editVale !== null}
        onClose={() => setEditVale(null)}
        title="Editar vale de gasolina"
        centered
        size="md"
      >
        {editVale && (
          <ValeForm
            initial={{
              conductor_id:   String(editVale.conductor_id),
              vehiculo_id:    String(editVale.vehiculo_id),
              fecha:          editVale.fecha.split('T')[0],
              vehiculo_label: valeVehiculoLabel(editVale),
            }}
            isPending={updateMut.isPending}
            error={updateMut.error ? (updateMut.error as Error).message : null}
            onSubmit={(payload) =>
              updateMut.mutate(
                { id: editVale.id, payload },
                { onSuccess: () => setEditVale(null) }
              )
            }
            onCancel={() => setEditVale(null)}
          />
        )}
      </Modal>

      {/* Modal: confirmar eliminación */}
      <Modal
        opened={deleteVale !== null}
        onClose={() => setDeleteVale(null)}
        title="Eliminar vale"
        centered
        size="sm"
      >
        <Stack gap="md">
          <Text>
            ¿Eliminar el vale del{' '}
            <strong>{deleteVale ? formatFecha(deleteVale.fecha) : ''}</strong> a nombre de{' '}
            <strong>{deleteVale?.conductor}</strong>? Esta acción no se puede deshacer.
          </Text>
          {deleteMut.error && (
            <Alert color="red" title="Error">
              {(deleteMut.error as Error).message}
            </Alert>
          )}
          <Group justify="flex-end">
            <Button
              variant="default"
              onClick={() => setDeleteVale(null)}
              disabled={deleteMut.isPending}
            >
              Cancelar
            </Button>
            <Button
              color="red"
              loading={deleteMut.isPending}
              onClick={() =>
                deleteMut.mutate(deleteVale!.id, {
                  onSuccess: () => setDeleteVale(null),
                })
              }
            >
              Eliminar
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  )
}
