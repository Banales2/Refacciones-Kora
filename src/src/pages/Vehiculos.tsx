import { useState, useEffect } from 'react'
import {
  Stack, Group, Text, TextInput, Textarea, Table, Badge,
  Pagination, Loader, Center, Alert, Button, Select,
  Modal, ActionIcon, Tooltip, NumberInput, Switch,
  Divider, Grid, Paper,
} from '@mantine/core'
import { useForm } from '@mantine/form'
import { useDebouncedValue } from '@mantine/hooks'
import { IconPencil, IconTrash, IconPlus, IconArrowLeft, IconChevronRight } from '@tabler/icons-react'
import {
  useVehiculos, useCreateVehiculo, useUpdateVehiculo, useDeleteVehiculo,
} from '../hooks/useVehiculos'
import {
  useRequerimientos, useCreateRequerimiento, useUpdateRequerimiento, useDeleteRequerimiento,
} from '../hooks/useRequerimientos'
import type { TipoVehiculo, VehiculoRow, VehiculoCreatePayload, VehiculoUpdatePayload } from '../hooks/useVehiculos'
import type { RequerimientoExclusivo, RequerimientoPayload, TriggerMode, TipoReq, StatusReq } from '../hooks/useRequerimientos'
import { VehiculoForm } from '../components/VehiculoForm'

// ── Constantes ────────────────────────────────────────────────────────────────

const TIPOS: { value: TipoVehiculo; label: string; color: string }[] = [
  { value: 'camion',       label: 'Camión',            color: 'blue'   },
  { value: 'tractocamion', label: 'Tractocamión',      color: 'violet' },
  { value: 'caja_trailer', label: 'Caja de trailer',   color: 'orange' },
  { value: 'utilitario',   label: 'Vehículo unitario', color: 'teal'   },
]

const TRIGGER_META: Record<TriggerMode, { label: string; color: string }> = {
  km:    { label: 'Kilometraje', color: 'blue'   },
  meses: { label: 'Tiempo',      color: 'green'  },
  ambos: { label: 'Km + tiempo', color: 'orange' },
}

const TIPO_META: Record<TipoReq, { label: string; color: string }> = {
  recurrente: { label: 'Recurrente', color: 'indigo' },
  unica:      { label: 'Única',      color: 'cyan'   },
}

const STATUS_META: Record<StatusReq, { label: string; color: string }> = {
  activo:     { label: 'Activo',      color: 'green'  },
  completado: { label: 'Completado',  color: 'blue'   },
  pausado:    { label: 'Pausado',     color: 'yellow' },
  cancelado:  { label: 'Cancelado',   color: 'red'    },
}

function tipoInfo(t: TipoVehiculo) {
  return TIPOS.find((x) => x.value === t)!
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

function fmtIntervalo(item: RequerimientoExclusivo) {
  const parts: string[] = []
  if (item.intervalo_km)    parts.push(`${item.intervalo_km.toLocaleString('es-MX')} km`)
  if (item.intervalo_meses) parts.push(`${item.intervalo_meses} mes${item.intervalo_meses !== 1 ? 'es' : ''}`)
  return parts.join(' / ') || '—'
}

// ── Formulario de requerimiento ───────────────────────────────────────────────

function RequerimientoForm({
  initial, isPending, error, onSubmit, onCancel,
}: {
  initial?: RequerimientoExclusivo
  isPending: boolean
  error: string | null
  onSubmit: (p: RequerimientoPayload) => void
  onCancel: () => void
}) {
  const form = useForm({
    initialValues: {
      nombre:          initial?.nombre ?? '',
      descripcion:     initial?.descripcion ?? '',
      categoria:       initial?.categoria ?? '',
      trigger_mode:    (initial?.trigger_mode ?? 'km') as TriggerMode,
      tipo:            (initial?.tipo ?? 'recurrente') as TipoReq,
      intervalo_km:    initial?.intervalo_km ?? (null as number | null),
      intervalo_meses: initial?.intervalo_meses ?? (null as number | null),
      status:          (initial?.status ?? 'activo') as StatusReq,
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
      status:          vals.status,
    })
  }

  return (
    <form onSubmit={form.onSubmit(handleSubmit)}>
      <Stack gap="sm">
        <TextInput label="Nombre" placeholder="Ej. Cambio de filtro de aceite" required {...form.getInputProps('nombre')} />
        <Textarea label="Descripción" autosize minRows={2} {...form.getInputProps('descripcion')} />
        <TextInput label="Categoría" placeholder="Ej. Motor, Frenos, Eléctrico" {...form.getInputProps('categoria')} />
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
          <NumberInput label="Intervalo de kilometraje" required min={1} suffix=" km" thousandSeparator="," {...form.getInputProps('intervalo_km')} />
        )}
        {(mode === 'meses' || mode === 'ambos') && (
          <NumberInput label="Intervalo en meses" required min={1} suffix=" meses" {...form.getInputProps('intervalo_meses')} />
        )}
        <Select
          label="Status" required
          data={[
            { value: 'activo',     label: 'Activo' },
            { value: 'completado', label: 'Completado' },
            { value: 'pausado',    label: 'Pausado' },
            { value: 'cancelado',  label: 'Cancelado' },
          ]}
          {...form.getInputProps('status')}
        />
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

// ── Sección de requerimientos ─────────────────────────────────────────────────

function RequerimientosSection({ vehiculoId }: { vehiculoId: number }) {
  const [formOpen, setFormOpen]   = useState(false)
  const [editing, setEditing]     = useState<RequerimientoExclusivo | null>(null)
  const [deleting, setDeleting]   = useState<RequerimientoExclusivo | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const { data, isLoading } = useRequerimientos(vehiculoId)
  const items     = data?.data ?? []
  const createMut = useCreateRequerimiento(vehiculoId)
  const updateMut = useUpdateRequerimiento(vehiculoId)
  const deleteMut = useDeleteRequerimiento(vehiculoId)

  function openCreate() { setEditing(null); setFormError(null); setFormOpen(true) }
  function openEdit(item: RequerimientoExclusivo) { setEditing(item); setFormError(null); setFormOpen(true) }

  function handleSubmit(payload: RequerimientoPayload) {
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
            <Text size="sm" fw={500}>Requerimientos exclusivos ({items.length})</Text>
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
            <Text c="dimmed" size="sm">No hay requerimientos exclusivos para este vehículo.</Text>
            <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={openCreate}>
              Agregar requerimiento
            </Button>
          </Stack>
        </Center>
      ) : (
        <Table.ScrollContainer minWidth={600}>
          <Table striped highlightOnHover withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Nombre</Table.Th>
                <Table.Th>Categoría</Table.Th>
                <Table.Th>Tipo</Table.Th>
                <Table.Th>Disparador</Table.Th>
                <Table.Th>Intervalo</Table.Th>
                <Table.Th style={{ textAlign: 'center' }}>Status</Table.Th>
                <Table.Th style={{ width: 80 }} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {items.map((item) => (
                <Table.Tr key={item.id}>
                  <Table.Td fw={500}>
                    {item.nombre}
                    {item.plantilla_origen_id && (
                      <Text component="span" size="xs" c="dimmed" ml={6}>(plantilla)</Text>
                    )}
                  </Table.Td>
                  <Table.Td>{item.categoria ?? <Text component="span" c="dimmed" size="sm">—</Text>}</Table.Td>
                  <Table.Td>
                    <Badge variant="light" color={TIPO_META[item.tipo].color} size="sm">
                      {TIPO_META[item.tipo].label}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Badge variant="light" color={TRIGGER_META[item.trigger_mode].color} size="sm">
                      {TRIGGER_META[item.trigger_mode].label}
                    </Badge>
                  </Table.Td>
                  <Table.Td><Text size="sm">{fmtIntervalo(item)}</Text></Table.Td>
                  <Table.Td style={{ textAlign: 'center' }}>
                    <Badge variant="light" color={STATUS_META[item.status].color} size="sm">
                      {STATUS_META[item.status].label}
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
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}

      <Modal
        opened={formOpen} onClose={() => setFormOpen(false)}
        title={editing ? 'Editar requerimiento' : 'Nuevo requerimiento exclusivo'}
        centered size="md"
      >
        <RequerimientoForm
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

function InfoItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <Text size="xs" c="dimmed">{label}</Text>
      <Text size="sm">{value ?? <Text component="span" c="dimmed">—</Text>}</Text>
    </div>
  )
}

function VehiculoDetalle({
  vehiculo, onBack, onEdit,
}: {
  vehiculo: VehiculoRow
  onBack: () => void
  onEdit: (v: VehiculoRow) => void
}) {
  const ti = tipoInfo(vehiculo.tipo)

  return (
    <Stack gap="md">
      {/* Navegación */}
      <Group gap="xs">
        <ActionIcon variant="subtle" color="gray" onClick={onBack}>
          <IconArrowLeft size={18} />
        </ActionIcon>
        <Text size="sm" c="dimmed">Vehículos</Text>
        <Text size="sm" c="dimmed">/</Text>
        <Text size="sm">{vehiculo.vehiculo}</Text>
      </Group>

      {/* Ficha */}
      <Paper withBorder p="md" radius="md">
        <Group justify="space-between" align="flex-start">
          <Stack gap={6}>
            <Group gap="sm" align="center">
              <Text size="xl" fw={700}>{vehiculo.vehiculo}</Text>
              <Badge color={ti.color} variant="light" size="lg">{ti.label}</Badge>
              {vehiculo.status && (
                <Badge color={statusColor(vehiculo.status)} variant="filled" size="sm">
                  {vehiculo.status}
                </Badge>
              )}
            </Group>
            <Grid mt={4} gutter="md">
              <Grid.Col span={{ base: 6, sm: 3 }}>
                <InfoItem label="Marca / Modelo" value={`${vehiculo.marca} ${vehiculo.modelo}`} />
              </Grid.Col>
              <Grid.Col span={{ base: 6, sm: 3 }}>
                <InfoItem label="Serie" value={vehiculo.serie} />
              </Grid.Col>
              {vehiculo.kilometraje !== null && (
                <Grid.Col span={{ base: 6, sm: 3 }}>
                  <InfoItem label="Kilometraje" value={`${vehiculo.kilometraje.toLocaleString('es-MX')} km`} />
                </Grid.Col>
              )}
              {vehiculo.combustible && (
                <Grid.Col span={{ base: 6, sm: 3 }}>
                  <InfoItem label="Combustible" value={vehiculo.combustible} />
                </Grid.Col>
              )}
              {vehiculo.tipo === 'camion' && vehiculo.sucursal && (
                <Grid.Col span={{ base: 6, sm: 3 }}>
                  <InfoItem label="Sucursal" value={vehiculo.sucursal} />
                </Grid.Col>
              )}
              {vehiculo.tipo === 'tractocamion' && (
                <>
                  {vehiculo.ruta && (
                    <Grid.Col span={{ base: 6, sm: 3 }}>
                      <InfoItem label="Ruta" value={vehiculo.ruta} />
                    </Grid.Col>
                  )}
                  {vehiculo.tonelaje !== null && (
                    <Grid.Col span={{ base: 6, sm: 3 }}>
                      <InfoItem label="Tonelaje" value={`${vehiculo.tonelaje} ton`} />
                    </Grid.Col>
                  )}
                  {vehiculo.tenencia && (
                    <Grid.Col span={{ base: 6, sm: 3 }}>
                      <InfoItem label="Tenencia" value={vehiculo.tenencia} />
                    </Grid.Col>
                  )}
                </>
              )}
              {vehiculo.tipo === 'caja_trailer' && vehiculo.pies !== null && (
                <Grid.Col span={{ base: 6, sm: 3 }}>
                  <InfoItem label="Pies" value={`${vehiculo.pies} pies`} />
                </Grid.Col>
              )}
              {vehiculo.ubicacion && (
                <Grid.Col span={{ base: 6, sm: 4 }}>
                  <InfoItem label="Ubicación" value={vehiculo.ubicacion} />
                </Grid.Col>
              )}
            </Grid>
          </Stack>
          <Tooltip label="Editar vehículo">
            <ActionIcon variant="light" color="blue" size="lg" onClick={() => onEdit(vehiculo)}>
              <IconPencil size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Paper>

      {/* Requerimientos exclusivos */}
      <RequerimientosSection vehiculoId={vehiculo.id} />
    </Stack>
  )
}

// ── Lista de vehículos ────────────────────────────────────────────────────────

export default function Vehiculos() {
  const [page, setPage]         = useState(1)
  const [search, setSearch]     = useState('')
  const [debouncedSearch]       = useDebouncedValue(search, 400)
  const [tipo, setTipo]         = useState<TipoVehiculo | undefined>(undefined)
  const [selected, setSelected] = useState<VehiculoRow | null>(null)

  const [formOpen,   setFormOpen]   = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [editing,    setEditing]    = useState<VehiculoRow | null>(null)
  const [deleting,   setDeleting]   = useState<VehiculoRow | null>(null)
  const [formError,  setFormError]  = useState<string | null>(null)

  useEffect(() => { setPage(1) }, [debouncedSearch, tipo])

  const { data, isLoading, isError } = useVehiculos(page, debouncedSearch, tipo)
  const totalPages = Math.ceil(
    (data?.pagination?.total ?? 0) / (data?.pagination?.pageSize ?? 20)
  )

  const createMut = useCreateVehiculo()
  const updateMut = useUpdateVehiculo()
  const deleteMut = useDeleteVehiculo()

  function toggleTipo(t: TipoVehiculo) { setTipo((prev) => (prev === t ? undefined : t)) }

  function openCreate() { setEditing(null); setFormError(null); setFormOpen(true) }

  function openEdit(v: VehiculoRow, e?: React.MouseEvent) {
    e?.stopPropagation()
    setEditing(v); setFormError(null); setFormOpen(true)
  }

  function openDelete(v: VehiculoRow, e: React.MouseEvent) {
    e.stopPropagation(); setDeleting(v); setDeleteOpen(true)
  }

  function handleFormSubmit(payload: VehiculoCreatePayload | VehiculoUpdatePayload) {
    setFormError(null)
    if (editing) {
      updateMut.mutate(
        { id: editing.id, payload: payload as VehiculoUpdatePayload },
        {
          onSuccess: (res) => {
            setFormOpen(false)
            if (selected?.id === editing.id) setSelected(res.data)
          },
          onError: (e: Error) => setFormError(e.message),
        }
      )
    } else {
      createMut.mutate(payload as VehiculoCreatePayload, {
        onSuccess: () => setFormOpen(false),
        onError:   (e: Error) => setFormError(e.message),
      })
    }
  }

  function handleDelete() {
    if (!deleting) return
    deleteMut.mutate(deleting.id, {
      onSuccess: () => { setDeleteOpen(false); if (selected?.id === deleting.id) setSelected(null) },
      onError:   (e: Error) => alert(e.message),
    })
  }

  const isPending = createMut.isPending || updateMut.isPending

  // ── Vista detalle ──
  if (selected) {
    return (
      <>
        <VehiculoDetalle
          vehiculo={selected}
          onBack={() => setSelected(null)}
          onEdit={(v) => openEdit(v)}
        />
        <Modal
          opened={formOpen} onClose={() => setFormOpen(false)}
          title={`Editar — ${editing?.vehiculo}`}
          size="lg" closeOnClickOutside={false}
        >
          <VehiculoForm
            initial={editing ?? undefined}
            isPending={updateMut.isPending} error={formError}
            onSubmit={handleFormSubmit} onCancel={() => setFormOpen(false)}
          />
        </Modal>
      </>
    )
  }

  // ── Vista lista ──
  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end">
        <div>
          <Text size="xl" fw={600}>Vehículos</Text>
          <Text size="sm" c="dimmed">Camiones y tractocamiones</Text>
        </div>
        <Group gap="sm">
          {data?.pagination && (
            <Text size="sm" c="dimmed">{data.pagination.total} vehículos</Text>
          )}
          <Button size="sm" onClick={openCreate}>+ Nuevo vehículo</Button>
        </Group>
      </Group>

      <TextInput
        placeholder="Buscar por nombre, marca, modelo o serie…"
        value={search}
        onChange={(e) => setSearch(e.currentTarget.value)}
        rightSection={
          search ? (
            <Text component="button" size="xs" c="dimmed"
              style={{ cursor: 'pointer', background: 'none', border: 'none', padding: 0 }}
              onClick={() => setSearch('')}>✕</Text>
          ) : null
        }
      />

      <Group gap="xs">
        {TIPOS.map((t) => (
          <Button key={t.value} size="sm" color={t.color}
            variant={tipo === t.value ? 'filled' : 'light'}
            onClick={() => toggleTipo(t.value)}>
            {t.label}
          </Button>
        ))}
      </Group>

      {isLoading ? (
        <Center py="xl"><Loader /></Center>
      ) : isError ? (
        <Alert color="red" title="Error al cargar">No se pudieron obtener los vehículos.</Alert>
      ) : data?.data?.length === 0 ? (
        <Center py="xl">
          <Text c="dimmed">
            No se encontraron vehículos
            {tipo ? ` de tipo "${TIPOS.find((t) => t.value === tipo)?.label}"` : ''}
            {search ? ` para "${search}"` : ''}.
          </Text>
        </Center>
      ) : (
        <Table.ScrollContainer minWidth={650}>
          <Table striped highlightOnHover withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Vehículo</Table.Th>
                <Table.Th>Tipo</Table.Th>
                <Table.Th>Marca / Modelo</Table.Th>
                <Table.Th>Serie</Table.Th>
                <Table.Th style={{ textAlign: 'center' }}>Status</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Kilometraje</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data?.data?.map((v) => {
                const ti = tipoInfo(v.tipo)
                return (
                  <Table.Tr key={v.id} onClick={() => setSelected(v)} style={{ cursor: 'pointer' }}>
                    <Table.Td fw={500}>{v.vehiculo}</Table.Td>
                    <Table.Td>
                      <Badge color={ti.color} variant="light" size="sm">{ti.label}</Badge>
                    </Table.Td>
                    <Table.Td c="dimmed">{v.marca} {v.modelo}</Table.Td>
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
                    <Table.Td>
                      <Group gap={4} justify="flex-end" wrap="nowrap">
                        <Tooltip label="Editar">
                          <ActionIcon variant="subtle" color="blue" size="sm" onClick={(e) => openEdit(v, e)}>
                            <IconPencil size={14} />
                          </ActionIcon>
                        </Tooltip>
                        <Tooltip label="Eliminar">
                          <ActionIcon variant="subtle" color="red" size="sm" onClick={(e) => openDelete(v, e)}>
                            <IconTrash size={14} />
                          </ActionIcon>
                        </Tooltip>
                        <IconChevronRight size={14} color="var(--mantine-color-dimmed)" />
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                )
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}

      {totalPages > 1 && (
        <Group justify="center">
          <Pagination total={totalPages} value={page} onChange={setPage} size="sm" />
        </Group>
      )}

      <Modal opened={formOpen} onClose={() => setFormOpen(false)}
        title={editing ? `Editar — ${editing.vehiculo}` : 'Nuevo vehículo'}
        size="lg" closeOnClickOutside={false}>
        <VehiculoForm
          initial={editing ?? undefined}
          isPending={isPending} error={formError}
          onSubmit={handleFormSubmit} onCancel={() => setFormOpen(false)}
        />
      </Modal>

      <Modal opened={deleteOpen} onClose={() => setDeleteOpen(false)}
        title="Eliminar vehículo" size="sm">
        <Stack gap="md">
          <Text>¿Eliminar <strong>{deleting?.vehiculo}</strong>? Esta acción no se puede deshacer.</Text>
          <Text size="sm" c="dimmed">Los requerimientos exclusivos se eliminarán automáticamente.</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDeleteOpen(false)} disabled={deleteMut.isPending}>Cancelar</Button>
            <Button color="red" onClick={handleDelete} loading={deleteMut.isPending}>Eliminar</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  )
}
