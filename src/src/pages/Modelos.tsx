import { useState } from 'react'
import {
  Stack, Group, Text, TextInput, Textarea, Table, Badge,
  Loader, Center, Alert, Button, ActionIcon,
  Modal, Tooltip, Divider, Grid, Paper, Select, Switch, NumberInput,
} from '@mantine/core'
import { useForm } from '@mantine/form'
import { useDebouncedValue } from '@mantine/hooks'
import { IconPencil, IconTrash, IconPlus, IconArrowLeft, IconChevronRight } from '@tabler/icons-react'
import {
  useModelos, useCreateModelo, useUpdateModelo, useDeleteModelo,
} from '../hooks/useModelos'
import {
  usePlantillaModelo, useCreatePlantilla, useUpdatePlantilla, useDeletePlantilla,
} from '../hooks/usePlantilla'
import { useVehiculos } from '../hooks/useVehiculos'
import type { Modelo, ModeloPayload } from '../hooks/useModelos'
import type { PlantillaRequerimiento, PlantillaPayload, TriggerMode, TipoPlantilla } from '../hooks/usePlantilla'
import type { TipoVehiculo } from '../hooks/useVehiculos'

// ── Helpers ───────────────────────────────────────────────────────────────────

const TIPOS: Record<TipoVehiculo, { label: string; color: string }> = {
  camion:       { label: 'Camión',            color: 'blue'   },
  tractocamion: { label: 'Tractocamión',      color: 'violet' },
  caja_trailer: { label: 'Caja de trailer',   color: 'orange' },
  utilitario:   { label: 'Vehículo unitario', color: 'teal'   },
}

const TRIGGER_META: Record<TriggerMode, { label: string; color: string }> = {
  km:    { label: 'Kilometraje',  color: 'blue'   },
  meses: { label: 'Tiempo',       color: 'green'  },
  ambos: { label: 'Km + tiempo',  color: 'orange' },
}

const TIPO_META: Record<TipoPlantilla, { label: string; color: string }> = {
  recurrente: { label: 'Recurrente', color: 'indigo' },
  unica:      { label: 'Única',      color: 'cyan'   },
}

function statusColor(s: string) {
  const v = s.toLowerCase()
  if (v === 'activo')   return 'green'
  if (v === 'inactivo') return 'red'
  if (v === 'taller')   return 'orange'
  return 'gray'
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('es-MX', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function fmtIntervalo(item: PlantillaRequerimiento) {
  const parts: string[] = []
  if (item.intervalo_km)    parts.push(`${item.intervalo_km.toLocaleString('es-MX')} km`)
  if (item.intervalo_meses) parts.push(`${item.intervalo_meses} mes${item.intervalo_meses !== 1 ? 'es' : ''}`)
  return parts.join(' / ') || '—'
}

// ── Formulario de modelo ──────────────────────────────────────────────────────

function ModeloForm({
  initial, isPending, error, onSubmit, onCancel,
}: {
  initial?: Modelo
  isPending: boolean
  error: string | null
  onSubmit: (payload: ModeloPayload) => void
  onCancel: () => void
}) {
  const isEdit = !!initial
  const form = useForm({
    initialValues: { marca: initial?.marca ?? '', nombre: initial?.nombre ?? '' },
    validate: {
      marca:  (v) => !v.trim() ? 'Requerido' : v.length > 80  ? 'Máximo 80 caracteres'  : null,
      nombre: (v) => !v.trim() ? 'Requerido' : v.length > 120 ? 'Máximo 120 caracteres' : null,
    },
  })

  return (
    <form onSubmit={form.onSubmit((v) => onSubmit({ marca: v.marca, nombre: v.nombre }))}>
      <Stack gap="sm">
        <TextInput label="Marca"          placeholder="Ej. Kenworth" required {...form.getInputProps('marca')}  />
        <TextInput label="Nombre de modelo" placeholder="Ej. T680"  required {...form.getInputProps('nombre')} />

        {isEdit && initial && (
          <>
            <Divider mt={4} />
            <Stack gap={6}>
              <Grid>
                <Grid.Col span={6}>
                  <Text size="xs" c="dimmed">Creado</Text>
                  <Text size="sm">{fmtDate(initial.created_at)}</Text>
                </Grid.Col>
                <Grid.Col span={6}>
                  <Text size="xs" c="dimmed">Última modificación</Text>
                  <Text size="sm">{fmtDate(initial.updated_at)}</Text>
                </Grid.Col>
              </Grid>
            </Stack>
          </>
        )}

        {error && <Alert color="red" title="Error">{error}</Alert>}
        <Group justify="flex-end" mt="xs">
          <Button variant="default" onClick={onCancel} disabled={isPending}>Cancelar</Button>
          <Button type="submit" loading={isPending}>
            {isEdit ? 'Guardar cambios' : 'Crear modelo'}
          </Button>
        </Group>
      </Stack>
    </form>
  )
}

// ── Formulario de plantilla ───────────────────────────────────────────────────

function PlantillaForm({
  initial, isPending, error, onSubmit, onCancel,
}: {
  initial?: PlantillaRequerimiento
  isPending: boolean
  error: string | null
  onSubmit: (payload: PlantillaPayload) => void
  onCancel: () => void
}) {
  const form = useForm({
    initialValues: {
      nombre:          initial?.nombre ?? '',
      descripcion:     initial?.descripcion ?? '',
      categoria:       initial?.categoria ?? '',
      trigger_mode:    (initial?.trigger_mode ?? 'km') as TriggerMode,
      tipo:            (initial?.tipo ?? 'recurrente') as TipoPlantilla,
      intervalo_km:    initial?.intervalo_km ?? (null as number | null),
      intervalo_meses: initial?.intervalo_meses ?? (null as number | null),
      activo:          initial?.activo ?? true,
    },
    validate: {
      nombre: (v) => !v.trim() ? 'Requerido' : v.length > 120 ? 'Máximo 120 caracteres' : null,
      intervalo_km: (v, vals) =>
        (vals.trigger_mode === 'km' || vals.trigger_mode === 'ambos') && !v ? 'Requerido' : null,
      intervalo_meses: (v, vals) =>
        (vals.trigger_mode === 'meses' || vals.trigger_mode === 'ambos') && !v ? 'Requerido' : null,
    },
  })

  const mode = form.values.trigger_mode

  function handleSubmit(vals: typeof form.values) {
    onSubmit({
      nombre:          vals.nombre.trim(),
      descripcion:     vals.descripcion?.trim() || null,
      categoria:       vals.categoria?.trim()   || null,
      trigger_mode:    vals.trigger_mode,
      tipo:            vals.tipo,
      intervalo_km:    (mode === 'km'    || mode === 'ambos') ? vals.intervalo_km    : null,
      intervalo_meses: (mode === 'meses' || mode === 'ambos') ? vals.intervalo_meses : null,
      activo:          vals.activo,
    })
  }

  return (
    <form onSubmit={form.onSubmit(handleSubmit)}>
      <Stack gap="sm">
        <TextInput
          label="Nombre" placeholder="Ej. Cambio de filtro de aceite"
          required {...form.getInputProps('nombre')}
        />
        <Textarea
          label="Descripción" placeholder="Instrucciones o detalles adicionales"
          autosize minRows={2} {...form.getInputProps('descripcion')}
        />
        <TextInput
          label="Categoría" placeholder="Ej. Motor, Frenos, Eléctrico"
          {...form.getInputProps('categoria')}
        />
        <Select
          label="Disparador" required
          data={[
            { value: 'km',    label: 'Por kilometraje' },
            { value: 'meses', label: 'Por tiempo (meses)' },
            { value: 'ambos', label: 'Kilometraje y tiempo' },
          ]}
          {...form.getInputProps('trigger_mode')}
        />
        <Select
          label="Tipo" required
          data={[
            { value: 'recurrente', label: 'Recurrente — se repite periódicamente' },
            { value: 'unica',      label: 'Única — se realiza una sola vez' },
          ]}
          {...form.getInputProps('tipo')}
        />
        {(mode === 'km' || mode === 'ambos') && (
          <NumberInput
            label="Intervalo de kilometraje" required min={1}
            suffix=" km" thousandSeparator=","
            {...form.getInputProps('intervalo_km')}
          />
        )}
        {(mode === 'meses' || mode === 'ambos') && (
          <NumberInput
            label="Intervalo en meses" required min={1}
            suffix=" meses"
            {...form.getInputProps('intervalo_meses')}
          />
        )}
        <Switch label="Activo" {...form.getInputProps('activo', { type: 'checkbox' })} />

        {error && <Alert color="red" title="Error">{error}</Alert>}
        <Group justify="flex-end" mt="xs">
          <Button variant="default" onClick={onCancel} disabled={isPending}>Cancelar</Button>
          <Button type="submit" loading={isPending}>
            {initial ? 'Guardar cambios' : 'Crear requerimiento'}
          </Button>
        </Group>
      </Stack>
    </form>
  )
}

// ── Sección plantilla ─────────────────────────────────────────────────────────

function PlantillaSection({ modeloId }: { modeloId: number }) {
  const [formOpen, setFormOpen]   = useState(false)
  const [editing, setEditing]     = useState<PlantillaRequerimiento | null>(null)
  const [deleting, setDeleting]   = useState<PlantillaRequerimiento | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const { data, isLoading } = usePlantillaModelo(modeloId)
  const items      = data?.data ?? []
  const createMut  = useCreatePlantilla(modeloId)
  const updateMut  = useUpdatePlantilla(modeloId)
  const deleteMut  = useDeletePlantilla(modeloId)

  function openCreate() { setEditing(null); setFormError(null); setFormOpen(true) }
  function openEdit(item: PlantillaRequerimiento) { setEditing(item); setFormError(null); setFormOpen(true) }

  function handleSubmit(payload: PlantillaPayload) {
    setFormError(null)
    if (editing) {
      updateMut.mutate({ id: editing.id, payload }, {
        onSuccess: () => setFormOpen(false),
        onError:   (e: Error) => setFormError(e.message),
      })
    } else {
      createMut.mutate(payload, {
        onSuccess: () => setFormOpen(false),
        onError:   (e: Error) => setFormError(e.message),
      })
    }
  }

  return (
    <>
      <Divider
        label={
          <Group gap="xs">
            <Text size="sm" fw={500}>Plantilla de requerimientos ({items.length})</Text>
            <Tooltip label="Agregar requerimiento">
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
      ) : items.length === 0 ? (
        <Center py="md">
          <Stack align="center" gap="xs">
            <Text c="dimmed" size="sm">No hay requerimientos definidos para este modelo.</Text>
            <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={openCreate}>
              Agregar requerimiento
            </Button>
          </Stack>
        </Center>
      ) : (
        <Table.ScrollContainer minWidth={500}>
          <Table striped highlightOnHover withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Nombre</Table.Th>
                <Table.Th>Categoría</Table.Th>
                <Table.Th>Tipo</Table.Th>
                <Table.Th>Disparador</Table.Th>
                <Table.Th>Intervalo</Table.Th>
                <Table.Th style={{ textAlign: 'center' }}>Activo</Table.Th>
                <Table.Th style={{ width: 80 }} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {items.map((item) => {
                const tm = TRIGGER_META[item.trigger_mode]
                return (
                  <Table.Tr key={item.id}>
                    <Table.Td fw={500}>{item.nombre}</Table.Td>
                    <Table.Td>
                      {item.categoria ?? <Text component="span" c="dimmed" size="sm">—</Text>}
                    </Table.Td>
                    <Table.Td>
                      <Badge variant="light" color={TIPO_META[item.tipo].color} size="sm">
                        {TIPO_META[item.tipo].label}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Badge variant="light" color={tm.color} size="sm">{tm.label}</Badge>
                    </Table.Td>
                    <Table.Td><Text size="sm">{fmtIntervalo(item)}</Text></Table.Td>
                    <Table.Td style={{ textAlign: 'center' }}>
                      <Badge variant="dot" color={item.activo ? 'green' : 'gray'} size="sm">
                        {item.activo ? 'Sí' : 'No'}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Group gap={4} justify="flex-end">
                        <Tooltip label="Editar">
                          <ActionIcon variant="subtle" color="blue" size="sm" onClick={() => openEdit(item)}>
                            <IconPencil size={14} />
                          </ActionIcon>
                        </Tooltip>
                        <Tooltip label="Eliminar">
                          <ActionIcon variant="subtle" color="red" size="sm" onClick={() => setDeleting(item)}>
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
        </Table.ScrollContainer>
      )}

      <Modal
        opened={formOpen} onClose={() => setFormOpen(false)}
        title={editing ? 'Editar requerimiento' : 'Nuevo requerimiento de plantilla'}
        centered size="md"
      >
        <PlantillaForm
          initial={editing ?? undefined}
          isPending={createMut.isPending || updateMut.isPending}
          error={formError}
          onSubmit={handleSubmit}
          onCancel={() => setFormOpen(false)}
        />
      </Modal>

      <Modal
        opened={deleting !== null} onClose={() => setDeleting(null)}
        title="Eliminar requerimiento" centered size="sm"
      >
        <Stack gap="md">
          <Text>¿Eliminar <strong>{deleting?.nombre}</strong>? Esta acción no se puede deshacer.</Text>
          <Text size="sm" c="dimmed">No podrá eliminarse si ya fue asignado a vehículos.</Text>
          {deleteMut.error && <Alert color="red" title="Error">{(deleteMut.error as Error).message}</Alert>}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDeleting(null)} disabled={deleteMut.isPending}>Cancelar</Button>
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

// ── Vista de detalle ──────────────────────────────────────────────────────────

function ModeloDetalle({
  modelo, onBack, onEdit,
}: {
  modelo: Modelo
  onBack: () => void
  onEdit: (m: Modelo) => void
}) {
  const { data, isLoading, isError } = useVehiculos(1, '', undefined, modelo.id)
  const vehiculos = data?.data ?? []

  return (
    <Stack gap="md">
      {/* Navegación */}
      <Group gap="xs">
        <ActionIcon variant="subtle" color="gray" onClick={onBack}>
          <IconArrowLeft size={18} />
        </ActionIcon>
        <Text size="sm" c="dimmed">Modelos</Text>
        <Text size="sm" c="dimmed">/</Text>
        <Text size="sm">{modelo.marca} {modelo.nombre}</Text>
      </Group>

      {/* Datos del modelo */}
      <Paper withBorder p="md" radius="md">
        <Group justify="space-between" align="flex-start">
          <Stack gap={4}>
            <Group gap="sm" align="baseline">
              <Text size="xl" fw={700}>{modelo.nombre}</Text>
              <Badge variant="light" color="gray" size="lg">{modelo.marca}</Badge>
            </Group>
            <Grid mt={4}>
              <Grid.Col span={{ base: 12, sm: 6 }}>
                <Text size="xs" c="dimmed">Creado</Text>
                <Text size="sm">{fmtDate(modelo.created_at)}</Text>
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 6 }}>
                <Text size="xs" c="dimmed">Última modificación</Text>
                <Text size="sm">{fmtDate(modelo.updated_at)}</Text>
              </Grid.Col>
            </Grid>
          </Stack>
          <Tooltip label="Editar modelo">
            <ActionIcon variant="light" color="blue" size="lg" onClick={() => onEdit(modelo)}>
              <IconPencil size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Paper>

      {/* Plantilla de requerimientos */}
      <PlantillaSection modeloId={modelo.id} />

      {/* Vehículos asignados */}
      <Divider label={`Vehículos asignados (${vehiculos.length})`} labelPosition="left" />

      {isLoading ? (
        <Center py="xl"><Loader /></Center>
      ) : isError ? (
        <Alert color="red" title="Error">No se pudieron cargar los vehículos.</Alert>
      ) : vehiculos.length === 0 ? (
        <Center py="xl">
          <Text c="dimmed">No hay vehículos asignados a este modelo.</Text>
        </Center>
      ) : (
        <Table.ScrollContainer minWidth={500}>
          <Table striped highlightOnHover withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Vehículo</Table.Th>
                <Table.Th>Tipo</Table.Th>
                <Table.Th>Serie</Table.Th>
                <Table.Th style={{ textAlign: 'center' }}>Status</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Kilometraje</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {vehiculos.map((v) => {
                const t = TIPOS[v.tipo]
                return (
                  <Table.Tr key={v.id}>
                    <Table.Td fw={500}>{v.vehiculo}</Table.Td>
                    <Table.Td>
                      <Badge color={t.color} variant="light" size="sm">{t.label}</Badge>
                    </Table.Td>
                    <Table.Td>{v.serie}</Table.Td>
                    <Table.Td style={{ textAlign: 'center' }}>
                      {v.status
                        ? <Badge color={statusColor(v.status)} variant="light" size="sm">{v.status}</Badge>
                        : <Text c="dimmed" size="sm">—</Text>}
                    </Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>
                      {v.kilometraje !== null
                        ? `${v.kilometraje.toLocaleString('es-MX')} km`
                        : <Text component="span" c="dimmed" size="sm">—</Text>}
                    </Table.Td>
                  </Table.Tr>
                )
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </Stack>
  )
}

// ── Lista de modelos ──────────────────────────────────────────────────────────

export default function Modelos() {
  const [search, setSearch]       = useState('')
  const [debounced]               = useDebouncedValue(search, 300)
  const [formOpen, setFormOpen]   = useState(false)
  const [editing, setEditing]     = useState<Modelo | null>(null)
  const [deleting, setDeleting]   = useState<Modelo | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [selected, setSelected]   = useState<Modelo | null>(null)

  const { data, isLoading, isError } = useModelos()
  const createMut = useCreateModelo()
  const updateMut = useUpdateModelo()
  const deleteMut = useDeleteModelo()

  function openCreate() { setEditing(null); setFormError(null); setFormOpen(true) }
  function openEdit(m: Modelo, e?: React.MouseEvent) {
    e?.stopPropagation()
    setEditing(m); setFormError(null); setFormOpen(true)
  }
  function openDelete(m: Modelo, e: React.MouseEvent) {
    e.stopPropagation(); setDeleting(m)
  }
  function handleSubmit(payload: ModeloPayload) {
    setFormError(null)
    if (editing) {
      updateMut.mutate({ id: editing.id, payload }, {
        onSuccess: (res) => {
          setFormOpen(false)
          if (selected?.id === editing.id) setSelected(res.data)
        },
        onError: (e: Error) => setFormError(e.message),
      })
    } else {
      createMut.mutate(payload, {
        onSuccess: () => setFormOpen(false),
        onError:   (e: Error) => setFormError(e.message),
      })
    }
  }

  // Vista de detalle
  if (selected) {
    return (
      <>
        <ModeloDetalle
          modelo={selected}
          onBack={() => setSelected(null)}
          onEdit={(m) => openEdit(m)}
        />
        <Modal
          opened={formOpen} onClose={() => setFormOpen(false)}
          title={`Editar — ${editing?.marca} ${editing?.nombre}`}
          centered size="sm"
        >
          <ModeloForm
            initial={editing ?? undefined}
            isPending={updateMut.isPending} error={formError}
            onSubmit={handleSubmit} onCancel={() => setFormOpen(false)}
          />
        </Modal>
      </>
    )
  }

  const modelos = (data?.data ?? []).filter((m) => {
    if (!debounced) return true
    const q = debounced.toLowerCase()
    return m.marca.toLowerCase().includes(q) || m.nombre.toLowerCase().includes(q)
  })
  const marcas = [...new Set(modelos.map((m) => m.marca))].sort()
  const isPending = createMut.isPending || updateMut.isPending

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end">
        <div>
          <Text size="xl" fw={600}>Modelos de vehículos</Text>
          <Text size="sm" c="dimmed">Catálogo de marcas y modelos</Text>
        </div>
        <Group gap="sm">
          {data?.data && (
            <Text size="sm" c="dimmed">
              {modelos.length} modelo{modelos.length !== 1 ? 's' : ''}
              {marcas.length > 0 && ` · ${marcas.length} marca${marcas.length !== 1 ? 's' : ''}`}
            </Text>
          )}
          <Button leftSection={<IconPlus size={16} />} onClick={openCreate}>
            Nuevo modelo
          </Button>
        </Group>
      </Group>

      <TextInput
        placeholder="Buscar por marca o modelo…"
        value={search}
        onChange={(e) => setSearch(e.currentTarget.value)}
        rightSection={
          search ? (
            <Text
              component="button" size="xs" c="dimmed"
              style={{ cursor: 'pointer', background: 'none', border: 'none', padding: 0 }}
              onClick={() => setSearch('')}
            >✕</Text>
          ) : null
        }
      />

      {isLoading ? (
        <Center py="xl"><Loader /></Center>
      ) : isError ? (
        <Alert color="red" title="Error al cargar">No se pudieron obtener los modelos.</Alert>
      ) : modelos.length === 0 ? (
        <Center py="xl">
          <Text c="dimmed">
            {search ? `No hay modelos para "${search}".` : 'No hay modelos registrados.'}
          </Text>
        </Center>
      ) : (
        <Table.ScrollContainer minWidth={400}>
          <Table striped highlightOnHover withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Marca</Table.Th>
                <Table.Th>Modelo</Table.Th>
                <Table.Th>Creado</Table.Th>
                <Table.Th style={{ width: 100 }} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {modelos.map((m) => (
                <Table.Tr
                  key={m.id}
                  onClick={() => setSelected(m)}
                  style={{ cursor: 'pointer' }}
                >
                  <Table.Td>
                    <Badge variant="light" color="gray" size="sm">{m.marca}</Badge>
                  </Table.Td>
                  <Table.Td fw={500}>{m.nombre}</Table.Td>
                  <Table.Td c="dimmed" size="sm">
                    {new Date(m.created_at).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </Table.Td>
                  <Table.Td>
                    <Group gap={4} justify="flex-end" wrap="nowrap">
                      <Tooltip label="Editar">
                        <ActionIcon variant="subtle" color="blue" size="sm" onClick={(e) => openEdit(m, e)}>
                          <IconPencil size={14} />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label="Eliminar">
                        <ActionIcon variant="subtle" color="red" size="sm" onClick={(e) => openDelete(m, e)}>
                          <IconTrash size={14} />
                        </ActionIcon>
                      </Tooltip>
                      <IconChevronRight size={14} color="var(--mantine-color-dimmed)" />
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}

      <Modal
        opened={formOpen} onClose={() => setFormOpen(false)}
        title={editing ? `Editar — ${editing.marca} ${editing.nombre}` : 'Nuevo modelo'}
        centered size="sm"
      >
        <ModeloForm
          initial={editing ?? undefined}
          isPending={isPending} error={formError}
          onSubmit={handleSubmit} onCancel={() => setFormOpen(false)}
        />
      </Modal>

      <Modal
        opened={deleting !== null} onClose={() => setDeleting(null)}
        title="Eliminar modelo" centered size="sm"
      >
        <Stack gap="md">
          <Text>¿Eliminar <strong>{deleting?.marca} {deleting?.nombre}</strong>? Esta acción no se puede deshacer.</Text>
          <Text size="sm" c="dimmed">No podrá eliminarse si tiene vehículos asignados.</Text>
          {deleteMut.error && <Alert color="red" title="Error">{(deleteMut.error as Error).message}</Alert>}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDeleting(null)} disabled={deleteMut.isPending}>Cancelar</Button>
            <Button color="red" loading={deleteMut.isPending}
              onClick={() => deleteMut.mutate(deleting!.id, { onSuccess: () => setDeleting(null) })}>
              Eliminar
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  )
}
