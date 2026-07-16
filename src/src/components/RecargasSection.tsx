// Recargas de combustible de un vehículo: se muestra al final de la vista de
// detalle del vehículo y permite dar de alta, editar y eliminar recargas.
// Cada recarga apunta a una gasolinera y a un conductor del catálogo
// (Catálogos → Gasolineras / Conductores).
//
// El listado se agrupa en un acordeón año → mes, con subtotales de litros y
// costo por grupo. La API devuelve todas las recargas del vehículo en una sola
// llamada, ya ordenadas por fecha descendente; el agrupado es en el cliente.
import { useMemo, useState } from 'react'
import {
  Stack, Group, Text, Table, Divider, Loader, Center, Alert, Button,
  ActionIcon, Modal, Tooltip, TextInput, NumberInput, Select, Badge, Accordion,
} from '@mantine/core'
import { useForm } from '@mantine/form'
import { IconPencil, IconTrash, IconPlus } from '@tabler/icons-react'
import {
  useRecargas, useCreateRecarga, useUpdateRecarga, useDeleteRecarga,
} from '../hooks/useRecargas'
import type { Recarga, RecargaPayload } from '../hooks/useRecargas'
import { useGasolineras } from '../hooks/useGasolineras'
import { useConductores } from '../hooks/useConductores'

function formatMXN(n: number) {
  return n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })
}

function formatLitros(n: number) {
  return `${n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} L`
}

function formatKm(n: number) {
  return `${n.toLocaleString('es-MX')} km`
}

// Rendimiento por recarga: los km recorridos son el kilometraje de esta recarga
// menos el de la recarga anterior (en orden cronológico); en la primera el
// anterior se toma como 0. km/L = km recorridos / litros.
//
// Devuelve un mapa id → km por litro (null si no se puede calcular: recarga sin
// kilometraje, sin litros, o si el kilometraje bajó respecto al anterior).
function calcularRendimientos(items: Recarga[]): Map<number, number | null> {
  const asc = [...items].sort((a, b) => {
    const fa = a.fecha.split('T')[0]
    const fb = b.fecha.split('T')[0]
    return fa === fb ? a.id - b.id : fa.localeCompare(fb)
  })

  const rend = new Map<number, number | null>()
  let kmAnterior = 0
  for (const r of asc) {
    if (r.kilometraje == null) {
      rend.set(r.id, null)
      continue
    }
    const kmRecorridos = r.kilometraje - kmAnterior
    const litros = Number(r.litros)
    rend.set(r.id, litros > 0 && kmRecorridos >= 0 ? kmRecorridos / litros : null)
    kmAnterior = r.kilometraje
  }
  return rend
}

function formatRendimiento(n: number) {
  return `${n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km/L`
}

function formatFecha(iso: string) {
  return new Date(`${iso.split('T')[0]}T12:00:00`).toLocaleDateString('es-MX', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

// Solo día + mes: dentro de un grupo el año ya lo da el encabezado.
function formatDiaMes(iso: string) {
  return new Date(`${iso.split('T')[0]}T12:00:00`).toLocaleDateString('es-MX', {
    day: '2-digit', month: 'short',
  })
}

function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

// ── Agrupado año → mes ────────────────────────────────────────────────────────

type Grupo = {
  key:    string
  label:  string
  litros: number
  costo:  number
}

type GrupoMes  = Grupo & { items: Recarga[] }
type GrupoAnio = Grupo & { meses: GrupoMes[] }

// La fecha llega como "YYYY-MM-DD" (o ISO con hora). Se parte el string en vez
// de construir un Date para que el mes no se recorra por zona horaria.
function agrupar(items: Recarga[]): GrupoAnio[] {
  const anios = new Map<string, Map<string, Recarga[]>>()

  for (const r of items) {
    const [anio, mes] = r.fecha.split('T')[0].split('-')
    if (!anios.has(anio)) anios.set(anio, new Map())
    const meses = anios.get(anio)!
    if (!meses.has(mes)) meses.set(mes, [])
    meses.get(mes)!.push(r)
  }

  const sumar = (rs: Recarga[]) => ({
    litros: rs.reduce((s, r) => s + Number(r.litros), 0),
    costo:  rs.reduce((s, r) => s + Number(r.costo),  0),
  })

  return [...anios.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([anio, mesesMap]) => {
      const meses: GrupoMes[] = [...mesesMap.entries()]
        .sort((a, b) => b[0].localeCompare(a[0]))
        .map(([mes, rs]) => ({
          key:   `${anio}-${mes}`,
          label: MESES[parseInt(mes, 10) - 1],
          items: rs,
          ...sumar(rs),
        }))

      return {
        key:   anio,
        label: anio,
        meses,
        ...sumar(meses.flatMap((m) => m.items)),
      }
    })
}

// ── Formulario ────────────────────────────────────────────────────────────────

type RecargaFormValues = {
  gasolinera_id: string
  conductor_id:  string
  fecha:         string
  litros:        number | string
  costo:         number | string
  kilometraje:   number | string
}

function RecargaForm({
  initial, isPending, error, onSubmit, onCancel,
}: {
  initial?: RecargaFormValues
  isPending: boolean
  error: string | null
  onSubmit: (payload: RecargaPayload) => void
  onCancel: () => void
}) {
  const hoy = todayIso()
  const { data: gasData } = useGasolineras()
  const { data: conData } = useConductores()

  const gasolineras = (gasData?.data ?? []).map((g) => ({
    value: String(g.id),
    label: `${g.nombre} — ${g.ubicacion}`,
  }))
  const conductores = (conData?.data ?? []).map((c) => ({
    value: String(c.id),
    label: c.nombre,
  }))

  const form = useForm<RecargaFormValues>({
    initialValues: initial ?? {
      gasolinera_id: '', conductor_id: '', fecha: hoy, litros: '', costo: '', kilometraje: '',
    },
    validate: {
      gasolinera_id: (v) => (!v ? 'Gasolinera requerida' : null),
      conductor_id:  (v) => (!v ? 'Conductor requerido' : null),
      fecha: (v) => {
        if (!v) return 'Fecha requerida'
        if (v > hoy) return 'No puede ser una fecha futura'
        return null
      },
      litros: (v) => (v === '' || Number(v) <= 0 ? 'Debe ser mayor a 0' : null),
      costo:  (v) => (v === '' || Number(v) < 0 ? 'No puede ser negativo' : null),
      kilometraje: (v) => (v === '' || Number(v) < 0 ? 'No puede ser negativo' : null),
    },
  })

  const litros = Number(form.values.litros)
  const costo  = Number(form.values.costo)
  const precioLitro = litros > 0 && costo > 0 ? costo / litros : null

  return (
    <form
      onSubmit={form.onSubmit((v) => onSubmit({
        gasolinera_id: parseInt(v.gasolinera_id, 10),
        conductor_id:  parseInt(v.conductor_id, 10),
        fecha:  v.fecha,
        litros: Number(v.litros),
        costo:  Number(v.costo),
        kilometraje: Number(v.kilometraje),
      }))}
    >
      <Stack gap="sm">
        <Select
          label="Gasolinera"
          placeholder={gasolineras.length ? 'Selecciona una gasolinera' : 'No hay gasolineras registradas'}
          data={gasolineras}
          searchable
          required
          {...form.getInputProps('gasolinera_id')}
        />
        {gasolineras.length === 0 && (
          <Text size="xs" c="dimmed">
            Da de alta las gasolineras en Catálogos → Gasolineras.
          </Text>
        )}
        <Select
          label="Conductor"
          placeholder={conductores.length ? 'Selecciona un conductor' : 'No hay conductores registrados'}
          data={conductores}
          searchable
          required
          {...form.getInputProps('conductor_id')}
        />
        {conductores.length === 0 && (
          <Text size="xs" c="dimmed">
            Da de alta los conductores en Catálogos → Conductores.
          </Text>
        )}
        <TextInput
          label="Fecha"
          type="date"
          required
          max={hoy}
          {...form.getInputProps('fecha')}
        />
        <NumberInput
          label="Litros" placeholder="0.00" required
          min={0} decimalScale={2} step={0.01} suffix=" L"
          {...form.getInputProps('litros')}
        />
        <NumberInput
          label="Costo total" placeholder="0.00" required
          min={0} decimalScale={2} step={0.01} prefix="$" thousandSeparator=","
          {...form.getInputProps('costo')}
        />
        <NumberInput
          label="Kilometraje" placeholder="0" required
          min={0} step={1} suffix=" km" thousandSeparator=","
          description="Kilometraje del vehículo al momento de la recarga"
          {...form.getInputProps('kilometraje')}
        />
        {precioLitro !== null && (
          <Text size="xs" c="dimmed">Precio por litro: {formatMXN(precioLitro)}</Text>
        )}
        {error && <Alert color="red" title="Error">{error}</Alert>}
        <Group justify="flex-end" mt="xs">
          <Button variant="default" onClick={onCancel} disabled={isPending}>Cancelar</Button>
          <Button type="submit" loading={isPending}>Guardar</Button>
        </Group>
      </Stack>
    </form>
  )
}

// ── Tabla de las recargas de un mes ───────────────────────────────────────────

function RecargasTabla({
  items, rendimientos, onEdit, onDelete,
}: {
  items: Recarga[]
  rendimientos: Map<number, number | null>
  onEdit: (r: Recarga) => void
  onDelete: (r: Recarga) => void
}) {
  return (
    <Table highlightOnHover verticalSpacing="xs">
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Fecha</Table.Th>
          <Table.Th>Gasolinera</Table.Th>
          <Table.Th>Conductor</Table.Th>
          <Table.Th style={{ textAlign: 'right' }}>Kilometraje</Table.Th>
          <Table.Th style={{ textAlign: 'right' }}>Litros</Table.Th>
          <Table.Th style={{ textAlign: 'right' }}>Costo</Table.Th>
          <Table.Th style={{ textAlign: 'right' }}>$/L</Table.Th>
          <Table.Th style={{ textAlign: 'right' }}>km/L</Table.Th>
          <Table.Th style={{ width: 90 }} />
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {items.map((r) => {
          const litros = Number(r.litros)
          const costo  = Number(r.costo)
          const rendimiento = rendimientos.get(r.id) ?? null
          return (
            <Table.Tr key={r.id}>
              <Table.Td>{formatDiaMes(r.fecha)}</Table.Td>
              <Table.Td>
                <Text size="sm">{r.gasolinera}</Text>
                <Text size="xs" c="dimmed">{r.ubicacion}</Text>
              </Table.Td>
              <Table.Td><Text size="sm">{r.conductor}</Text></Table.Td>
              <Table.Td style={{ textAlign: 'right' }}>
                {r.kilometraje != null ? formatKm(r.kilometraje) : '—'}
              </Table.Td>
              <Table.Td style={{ textAlign: 'right' }}>{formatLitros(litros)}</Table.Td>
              <Table.Td style={{ textAlign: 'right' }}>{formatMXN(costo)}</Table.Td>
              <Table.Td style={{ textAlign: 'right' }} c="dimmed">
                {litros > 0 ? formatMXN(costo / litros) : '—'}
              </Table.Td>
              <Table.Td style={{ textAlign: 'right' }} fw={500}>
                {rendimiento != null ? formatRendimiento(rendimiento) : '—'}
              </Table.Td>
              <Table.Td>
                <Group gap={4} justify="flex-end" wrap="nowrap">
                  <Tooltip label="Editar">
                    <ActionIcon variant="subtle" color="blue" size="sm" onClick={() => onEdit(r)}>
                      <IconPencil size={14} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label="Eliminar">
                    <ActionIcon variant="subtle" color="red" size="sm" onClick={() => onDelete(r)}>
                      <IconTrash size={14} />
                    </ActionIcon>
                  </Tooltip>
                </Group>
              </Table.Td>
            </Table.Tr>
          )
        })}
      </Table.Tbody>
    </Table>
  )
}

// Encabezado de un grupo: etiqueta a la izquierda, subtotales a la derecha.
function ResumenGrupo({
  label, litros, costo, fw,
}: {
  label:  string
  litros: number
  costo:  number
  fw:     number
}) {
  return (
    <Group justify="space-between" wrap="nowrap" pr="sm">
      <Text size="sm" fw={fw}>{label}</Text>
      <Group gap="md" wrap="nowrap">
        <Badge variant="light" color="gray">{formatLitros(litros)}</Badge>
        <Text size="sm" fw={fw}>{formatMXN(costo)}</Text>
      </Group>
    </Group>
  )
}

// ── Sección ───────────────────────────────────────────────────────────────────

export default function RecargasSection({ vehiculoId }: { vehiculoId: number }) {
  const [formOpen, setFormOpen]   = useState(false)
  const [editing, setEditing]     = useState<Recarga | null>(null)
  const [deleting, setDeleting]   = useState<Recarga | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const { data, isLoading, error } = useRecargas(vehiculoId)
  const items = useMemo(() => data?.data ?? [], [data])
  const anios = useMemo(() => agrupar(items), [items])
  const rendimientos = useMemo(() => calcularRendimientos(items), [items])

  // Al entrar se abre el año y el mes más recientes, que es lo que se quiere
  // ver de primera. `anios` (y sus meses) vienen ordenados descendente.
  const [anioAbierto, setAnioAbierto] = useState<string | null>(null)
  const [mesAbierto, setMesAbierto]   = useState<string | null>(null)
  const anioVisible = anioAbierto ?? anios[0]?.key ?? null
  const mesVisible  = mesAbierto  ?? anios[0]?.meses[0]?.key ?? null

  const createMut = useCreateRecarga(vehiculoId)
  const updateMut = useUpdateRecarga(vehiculoId)
  const deleteMut = useDeleteRecarga(vehiculoId)

  const totalLitros = items.reduce((s, r) => s + Number(r.litros), 0)
  const totalCosto  = items.reduce((s, r) => s + Number(r.costo), 0)

  function openCreate() { setEditing(null); setFormError(null); setFormOpen(true) }
  function openEdit(r: Recarga) { setEditing(r); setFormError(null); setFormOpen(true) }

  function handleSubmit(payload: RecargaPayload) {
    setFormError(null)
    const opts = {
      onSuccess: () => setFormOpen(false),
      onError:   (e: Error) => setFormError(e.message),
    }
    if (editing) updateMut.mutate({ id: editing.id, payload }, opts)
    else         createMut.mutate(payload, opts)
  }

  return (
    <>
      <Divider
        label={
          <Group gap="xs">
            <Text size="sm" fw={500}>Recargas de combustible ({items.length})</Text>
            <Tooltip label="Registrar recarga">
              <ActionIcon variant="light" color="blue" size="xs" onClick={openCreate}>
                <IconPlus size={12} />
              </ActionIcon>
            </Tooltip>
          </Group>
        }
        labelPosition="left"
      />

      {isLoading ? (
        <Center py="md"><Loader size="sm" /></Center>
      ) : error ? (
        <Alert color="red" title="Error">{(error as Error).message}</Alert>
      ) : items.length === 0 ? (
        <Center py="md">
          <Stack align="center" gap="xs">
            <Text c="dimmed" size="sm">No hay recargas registradas.</Text>
            <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={openCreate}>
              Registrar recarga
            </Button>
          </Stack>
        </Center>
      ) : (
        <Stack gap="sm">
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
                          <RecargasTabla items={m.items} rendimientos={rendimientos} onEdit={openEdit} onDelete={setDeleting} />
                        </Accordion.Panel>
                      </Accordion.Item>
                    ))}
                  </Accordion>
                </Accordion.Panel>
              </Accordion.Item>
            ))}
          </Accordion>

          <Group justify="space-between" px="sm">
            <Text size="sm" fw={600}>Total histórico</Text>
            <Group gap="md" wrap="nowrap">
              <Badge variant="light" color="gray">{formatLitros(totalLitros)}</Badge>
              <Text size="sm" fw={600}>{formatMXN(totalCosto)}</Text>
            </Group>
          </Group>
        </Stack>
      )}

      <Modal
        opened={formOpen} onClose={() => setFormOpen(false)}
        title={editing ? 'Editar recarga' : 'Registrar recarga'}
        centered size="md"
      >
        <RecargaForm
          initial={editing ? {
            gasolinera_id: String(editing.gasolinera_id),
            conductor_id:  String(editing.conductor_id),
            fecha:  editing.fecha.split('T')[0],
            litros: Number(editing.litros),
            costo:  Number(editing.costo),
            kilometraje: editing.kilometraje ?? '',
          } : undefined}
          isPending={createMut.isPending || updateMut.isPending}
          error={formError}
          onSubmit={handleSubmit}
          onCancel={() => setFormOpen(false)}
        />
      </Modal>

      <Modal
        opened={deleting !== null} onClose={() => setDeleting(null)}
        title="Eliminar recarga" centered size="sm"
      >
        <Stack gap="md">
          <Text>
            ¿Eliminar la recarga del{' '}
            <strong>{deleting ? formatFecha(deleting.fecha) : ''}</strong> en{' '}
            <strong>{deleting?.gasolinera}</strong>? Esta acción no se puede deshacer.
          </Text>
          {deleteMut.error && <Alert color="red" title="Error">{(deleteMut.error as Error).message}</Alert>}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDeleting(null)} disabled={deleteMut.isPending}>
              Cancelar
            </Button>
            <Button color="red" loading={deleteMut.isPending}
              onClick={() => deleteMut.mutate(deleting!.id, { onSuccess: () => setDeleting(null) })}>
              Eliminar
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  )
}
