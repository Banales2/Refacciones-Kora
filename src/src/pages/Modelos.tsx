// Página Modelos: catálogo de marcas/modelos de vehículos con sus garantías, su
// programa de mantenimiento y sus tipos de pieza. Lista + vista de detalle.
import { useState, useMemo } from 'react'
import {
  Stack, Group, Text, TextInput, Table, Badge,
  Loader, Center, Alert, Button, ActionIcon,
  Modal, Tooltip, Divider, Grid, Paper, MultiSelect,
  Autocomplete, Switch,
} from '@mantine/core'
import { useForm } from '@mantine/form'
import { useDebouncedValue } from '@mantine/hooks'
import {
  IconPencil, IconTrash, IconPlus, IconArrowLeft, IconChevronRight,
  IconArchive, IconArchiveOff,
} from '@tabler/icons-react'
import {
  useModelos, useCreateModelo, useUpdateModelo, useBajaModelo, useReactivarModelo,
} from '../hooks/useModelos'
import { useVehiculos, useCreateVehiculo } from '../hooks/useVehiculos'
import {
  useTiposPiezaModelo, useAddTiposPiezaModelo, useRemoveTipoPiezaModelo,
  useRenameEtiquetaModelo,
} from '../hooks/useTiposPiezaModelo'
import EtiquetaEditable from '../components/EtiquetaEditable'
import { useTiposPieza, useCreateTipoPieza } from '../hooks/useTiposPieza'
import type { Modelo, ModeloPayload } from '../hooks/useModelos'
import GarantiasModeloSection from '../components/GarantiasModeloSection'
import ProgramaModeloSection from '../components/ProgramaModeloSection'
import type {
  TipoVehiculo, VehiculoRow, VehiculoCreatePayload, VehiculoUpdatePayload,
} from '../hooks/useVehiculos'
import { VehiculoForm } from '../components/VehiculoForm'
import {
  TEXTO_SIMPLE, ANIO_MODELO, limpiarTextoSimple, limpiarAnioModelo,
} from '../lib/validaciones'

// ── Helpers ───────────────────────────────────────────────────────────────────

const TIPOS: Record<TipoVehiculo, { label: string; color: string }> = {
  camion:       { label: 'Unidad de reparto', color: 'blue'   },
  tractocamion: { label: 'Unidad de translado', color: 'violet' },
  caja_trailer: { label: 'Caja de trailer',   color: 'orange' },
  utilitario:   { label: 'Vehículo utilitario', color: 'teal'   },
  montacargas:  { label: 'Montacargas',       color: 'yellow' },
}

const TIPOS_VEHICULO_OPTIONS = (Object.keys(TIPOS) as TipoVehiculo[])
  .map((t) => ({ value: t, label: TIPOS[t].label }))

// Tipos de vehículo que llevan kilometraje. Los que no (caja_trailer,
// montacargas) no admiten un programa que avance por kilometraje.
const KM_TIPOS: TipoVehiculo[] = ['camion', 'tractocamion', 'utilitario']

// Un modelo admite requerimientos por km solo si está restringido a tipos que
// llevan kilometraje. Si no tiene restricción (permite todos, incluidos
// montacargas/caja sin km) o si alguno de sus tipos permitidos no lleva km, no
// se ofrecen disparadores por kilometraje: un vehículo sin km no podría cumplirlos.
function modeloSoportaKm(tiposPermitidos: TipoVehiculo[]) {
  return tiposPermitidos.length > 0 && tiposPermitidos.every((t) => KM_TIPOS.includes(t))
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
  const AÑO_MAX = new Date().getFullYear() + 1
  const { data: modelosData } = useModelos()
  const modelos = modelosData?.data
  const form = useForm({
    initialValues: {
      marca:            initial?.marca ?? '',
      nombre:           initial?.nombre ?? '',
      anio:             initial?.anio ?? '',
      tipos_permitidos: (initial?.tipos_permitidos ?? []) as TipoVehiculo[],
    },
    validate: {
      marca: (v) =>
        !v.trim() ? 'Requerido' :
        v.length > 40 ? 'Máximo 40 caracteres' :
        !TEXTO_SIMPLE.test(v.trim()) ? 'Solo letras, números, espacios y guiones' : null,
      nombre: (v) =>
        !v.trim() ? 'Requerido' :
        v.length > 40 ? 'Máximo 40 caracteres' :
        !TEXTO_SIMPLE.test(v.trim()) ? 'Solo letras, números, espacios y guiones' : null,
      anio: (v) => {
        const s = v.trim()
        if (!s) return 'Requerido'
        if (!ANIO_MODELO.test(s)) return 'Usa AAAA o AAAA-versión (ej. 2024 o 2024-1)'
        const n = Number(s.slice(0, 4))
        if (n < 1950 || n > AÑO_MAX) return `El año debe estar entre 1950 y ${AÑO_MAX}`
        return null
      },
    },
  })

  // Marcas y nombres ya existentes, para sugerirlos (sin impedir escribir uno
  // nuevo). Los nombres se acotan a la marca elegida; si es una marca nueva o
  // sin coincidencias, se ofrecen todos.
  const marcasOpts = useMemo(
    () => [...new Set((modelos ?? []).map((m) => m.marca))].sort((a, b) => a.localeCompare(b, 'es-MX')),
    [modelos]
  )
  const marcaActual = form.values.marca.trim().toLowerCase()
  const nombresOpts = useMemo(() => {
    const delaMarca = (modelos ?? []).filter((m) => m.marca.toLowerCase() === marcaActual)
    const base = delaMarca.length ? delaMarca : (modelos ?? [])
    return [...new Set(base.map((m) => m.nombre))].sort((a, b) => a.localeCompare(b, 'es-MX'))
  }, [modelos, marcaActual])

  return (
    <form onSubmit={form.onSubmit((v) => onSubmit({
      marca: v.marca, nombre: v.nombre, anio: v.anio.trim(), tipos_permitidos: v.tipos_permitidos,
    }))}>
      <Stack gap="sm">
        <Autocomplete
          label="Marca" placeholder="Ej. Kenworth" required
          maxLength={40}
          data={marcasOpts}
          {...form.getInputProps('marca')}
          onChange={(v) => form.setFieldValue('marca', limpiarTextoSimple(v, 40))}
        />
        <Group grow align="flex-start">
          <Autocomplete
            label="Nombre de modelo" placeholder="Ej. T680" required
            maxLength={40}
            data={nombresOpts}
            {...form.getInputProps('nombre')}
            onChange={(v) => form.setFieldValue('nombre', limpiarTextoSimple(v, 40))}
          />
          <TextInput
            label="Año" placeholder="Ej. 2024" required
            maxLength={6}
            inputMode="numeric"
            {...form.getInputProps('anio')}
            onChange={(e) => form.setFieldValue('anio', limpiarAnioModelo(e.currentTarget.value))}
          />
        </Group>
        <MultiSelect
          label="Tipos de vehículo permitidos"
          description="Qué tipos se pueden crear con este modelo. Vacío = todos permitidos."
          placeholder={form.values.tipos_permitidos.length ? undefined : 'Todos los tipos'}
          data={TIPOS_VEHICULO_OPTIONS}
          clearable
          {...form.getInputProps('tipos_permitidos')}
        />

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

// ── Sección de tipos de pieza del modelo (relación n-n informativa) ───────────

// Valor centinela del selector: al elegirlo se crea el tipo que el usuario
// escribió, en vez de asignar uno existente.
const CREAR_TIPO = '__crear__'

function TiposPiezaModeloSection({ modeloId }: { modeloId: number }) {
  const [seleccion, setSeleccion] = useState<string[]>([])
  const [busqueda, setBusqueda]   = useState('')
  const [etiqueta, setEtiqueta]   = useState('')
  const { data, isLoading }       = useTiposPiezaModelo(modeloId)
  const { data: tiposData }       = useTiposPieza()
  const addMut    = useAddTiposPiezaModelo()
  const removeMut = useRemoveTipoPiezaModelo()
  const renameMut = useRenameEtiquetaModelo()
  const crearMut  = useCreateTipoPieza()

  // Memoizado porque el `?? []` daría un arreglo nuevo en cada render y con él
  // se recalcularían los useMemo que dependen de la lista.
  const asignados = useMemo(() => data?.data ?? [], [data])

  // Ningún tipo se filtra: el modelo puede pedir el mismo varias veces mientras
  // cada renglón lleve una etiqueta distinta. Lo que ya está se marca en la
  // opción para que se vea con qué etiquetas se pidió y no se repita una.
  const opciones = useMemo(() => {
    const todos = tiposData?.data ?? []
    const opts = todos.map((t) => {
      const puestos = asignados
        .filter((a) => a.id === t.id)
        .map((a) => a.etiqueta || 'sin etiqueta')
      return {
        value: String(t.id),
        label: puestos.length ? `${t.nombre} — ya: ${puestos.join(', ')}` : t.nombre,
      }
    })

    const nuevo = busqueda.trim()
    const yaExiste = todos.some((t) => t.nombre.toLowerCase() === nuevo.toLowerCase())
    if (nuevo && !yaExiste) {
      opts.unshift({ value: CREAR_TIPO, label: `+ Crear tipo "${nuevo}"` })
    }
    return opts
  }, [tiposData, asignados, busqueda])

  // Repetir un tipo exige etiqueta nueva: sin ella el backend rechaza el alta.
  // Se avisa antes de mandarla para que el error no llegue después del clic.
  const choque = useMemo(() => {
    const et = etiqueta.trim()
    const ya = asignados.find(
      (a) => seleccion.includes(String(a.id)) && a.etiqueta === et
    )
    if (!ya) return null
    return et === ''
      ? `Este modelo ya pide ${ya.nombre}. Ponle una etiqueta para pedirlo otra vez.`
      : `Este modelo ya pide ${ya.nombre} con la etiqueta "${et}".`
  }, [asignados, seleccion, etiqueta])

  // Crear se resuelve al instante: el centinela no puede quedarse en la
  // selección porque no es un id que el backend pueda recibir.
  function handleChange(values: string[]) {
    if (!values.includes(CREAR_TIPO)) { setSeleccion(values); return }
    const nombre = busqueda.trim()
    if (!nombre) return
    crearMut.mutate(nombre, {
      onSuccess: ({ data: tipo }) => {
        setSeleccion([...values.filter((v) => v !== CREAR_TIPO), String(tipo.id)])
        setBusqueda('')
      },
    })
  }

  function handleAgregar() {
    if (seleccion.length === 0 || choque) return
    addMut.mutate(
      { modeloId, tipoIds: seleccion.map(Number), etiqueta: etiqueta.trim() },
      { onSuccess: () => { setSeleccion([]); setEtiqueta('') } },
    )
  }

  return (
    <>
      <Divider
        label={<Text size="sm" fw={500}>Tipos de pieza del modelo ({asignados.length})</Text>}
        labelPosition="left"
      />
      <Text size="xs" c="dimmed">
        Qué necesita este modelo, sin decir cuál: un filtro de aire, una batería… La refacción concreta
        que usa cada unidad se captura en el vehículo. Es informativo: no afecta el inventario.
        Si el modelo lleva dos piezas del mismo tipo, agrégalo dos veces con una etiqueta distinta
        (delantero / trasero): cada renglón lleva su propia refacción e historial en cada unidad.
      </Text>

      <Group align="flex-end" gap="sm" wrap="nowrap">
        <MultiSelect
          flex={1}
          searchable clearable
          placeholder="Selecciona o escribe para crear un tipo"
          data={opciones}
          value={seleccion}
          onChange={handleChange}
          searchValue={busqueda}
          // Allowlist: solo letras, números, espacios y guiones (máx. 40)
          onSearchChange={(v) => setBusqueda(limpiarTextoSimple(v, 40))}
          nothingFoundMessage="Escribe para crear un tipo nuevo"
        />
        <TextInput
          w={200}
          label="Etiqueta"
          description="Opcional"
          placeholder="Delantero, trasero…"
          value={etiqueta}
          onChange={(e) => setEtiqueta(limpiarTextoSimple(e.currentTarget.value, 40))}
        />
        <Button
          leftSection={<IconPlus size={16} />}
          onClick={handleAgregar}
          loading={addMut.isPending || crearMut.isPending}
          disabled={seleccion.length === 0 || choque !== null}
        >
          Agregar
        </Button>
      </Group>
      {choque && <Alert color="yellow" variant="light">{choque}</Alert>}
      {crearMut.error && <Alert color="red">{(crearMut.error as Error).message}</Alert>}
      {addMut.error   && <Alert color="red">{(addMut.error   as Error).message}</Alert>}
      {removeMut.error && <Alert color="red">{(removeMut.error as Error).message}</Alert>}
      {renameMut.error && <Alert color="red">{(renameMut.error as Error).message}</Alert>}

      {isLoading ? (
        <Center py="md"><Loader size="sm" /></Center>
      ) : asignados.length === 0 ? (
        <Text c="dimmed" size="sm" py="sm">Este modelo no tiene tipos de pieza registrados.</Text>
      ) : (
        <Table.ScrollContainer minWidth={360}>
          <Table striped highlightOnHover withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Tipo de pieza</Table.Th>
                <Table.Th style={{ width: 180 }}>Etiqueta</Table.Th>
                <Table.Th style={{ width: 48 }} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {/* La clave es el renglón, no el tipo: el mismo tipo puede aparecer
                  varias veces con etiquetas distintas. */}
              {asignados.map((t) => (
                <Table.Tr key={`${t.id}|${t.etiqueta}`}>
                  <Table.Td fw={500}>{t.nombre}</Table.Td>
                  <Table.Td>
                    <EtiquetaEditable
                      etiqueta={t.etiqueta}
                      isPending={
                        renameMut.isPending &&
                        renameMut.variables?.tipoId === t.id &&
                        renameMut.variables?.etiqueta === t.etiqueta
                      }
                      onGuardar={(etiquetaNueva) => renameMut.mutate({
                        modeloId, tipoId: t.id, etiqueta: t.etiqueta, etiquetaNueva,
                      })}
                    />
                  </Table.Td>
                  <Table.Td>
                    <Tooltip label="Quitar del modelo (borra la refacción que sus vehículos tenían elegida para este renglón)">
                      <ActionIcon
                        variant="subtle" color="red" size="sm"
                        loading={
                          removeMut.isPending &&
                          removeMut.variables?.tipoId === t.id &&
                          removeMut.variables?.etiqueta === t.etiqueta
                        }
                        onClick={() => removeMut.mutate({ modeloId, tipoId: t.id, etiqueta: t.etiqueta })}
                      >
                        <IconTrash size={14} />
                      </ActionIcon>
                    </Tooltip>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </>
  )
}

// ── Vista de detalle ──────────────────────────────────────────────────────────

function ModeloDetalle({
  modelo, onBack, onEdit, onBaja, onNavigateVehiculo,
}: {
  modelo: Modelo
  onBack: () => void
  onEdit: (m: Modelo) => void
  onBaja: (m: Modelo) => void
  onNavigateVehiculo?: (v: VehiculoRow) => void
}) {
  const { data, isLoading, isError } = useVehiculos(1, '', undefined, modelo.id)
  const vehiculos = data?.data ?? []

  const [vehiculoFormOpen, setVehiculoFormOpen] = useState(false)
  const [vehiculoError, setVehiculoError] = useState<string | null>(null)
  const createVehiculoMut = useCreateVehiculo()

  function openCreateVehiculo() {
    setVehiculoError(null)
    setVehiculoFormOpen(true)
  }

  function handleCreateVehiculo(payload: VehiculoCreatePayload | VehiculoUpdatePayload) {
    setVehiculoError(null)
    createVehiculoMut.mutate(payload as VehiculoCreatePayload, {
      onSuccess: () => setVehiculoFormOpen(false),
      onError:   (e: Error) => setVehiculoError(e.message),
    })
  }

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
              {modelo.anio != null && <Badge variant="light" color="blue" size="lg">{modelo.anio}</Badge>}
              {modelo.baja_en && (
                <Badge variant="filled" color="gray" size="lg">Dado de baja</Badge>
              )}
            </Group>
            {modelo.baja_en && (
              <Text size="sm" c="dimmed">
                De baja desde {fmtDate(modelo.baja_en)}: no se ofrece al dar de alta unidades
                nuevas{modelo.baja_motivo ? ` — ${modelo.baja_motivo}` : ''}.
              </Text>
            )}
            <Grid mt={4}>
              <Grid.Col span={{ base: 12, sm: 6 }}>
                <Text size="xs" c="dimmed">Creado</Text>
                <Text size="sm">{fmtDate(modelo.created_at)}</Text>
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 6 }}>
                <Text size="xs" c="dimmed">Última modificación</Text>
                <Text size="sm">{fmtDate(modelo.updated_at)}</Text>
              </Grid.Col>
              <Grid.Col span={12}>
                <Text size="xs" c="dimmed">Tipos de vehículo permitidos</Text>
                {(modelo.tipos_permitidos ?? []).length === 0 ? (
                  <Text size="sm" c="dimmed">Todos</Text>
                ) : (
                  <Group gap={4} mt={2}>
                    {(modelo.tipos_permitidos ?? []).map((t) => (
                      <Badge key={t} variant="light" color={TIPOS[t]?.color} size="sm">
                        {TIPOS[t]?.label ?? t}
                      </Badge>
                    ))}
                  </Group>
                )}
              </Grid.Col>
            </Grid>
          </Stack>
          <Group gap="xs" wrap="nowrap">
            <Tooltip label="Editar modelo">
              <ActionIcon variant="light" color="blue" size="lg" onClick={() => onEdit(modelo)}>
                <IconPencil size={16} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label={modelo.baja_en ? 'Reactivar modelo' : 'Dar de baja'}>
              <ActionIcon
                variant="light" color={modelo.baja_en ? 'teal' : 'orange'} size="lg"
                aria-label={modelo.baja_en ? 'Reactivar modelo' : 'Dar de baja el modelo'}
                onClick={() => onBaja(modelo)}
              >
                {modelo.baja_en ? <IconArchiveOff size={16} /> : <IconArchive size={16} />}
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>
      </Paper>

      {/* Las garantías van antes del programa porque son su explicación: el
          programa del fabricante existe para no perder la principal, y cuando
          esa se acaba la unidad pasa al programa de después de la garantía. */}
      <GarantiasModeloSection
        modeloId={modelo.id}
        soportaKm={modeloSoportaKm(modelo.tipos_permitidos ?? [])}
      />

      <ProgramaModeloSection modeloId={modelo.id} />

      {/* Piezas específicas del modelo */}
      <TiposPiezaModeloSection modeloId={modelo.id} />

      {/* Vehículos asignados */}
      <Divider
        label={
          <Group gap="xs">
            <Text size="sm" fw={500}>Vehículos asignados ({vehiculos.length})</Text>
            <Tooltip label="Agregar vehículo de este modelo">
              <ActionIcon variant="light" color="blue" size="xs" onClick={openCreateVehiculo}>
                <IconPlus size={12} />
              </ActionIcon>
            </Tooltip>
          </Group>
        }
        labelPosition="left"
      />

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
                <Table.Th>Serie</Table.Th>
                <Table.Th>Tipo</Table.Th>
                <Table.Th>Placas</Table.Th>
                <Table.Th style={{ textAlign: 'center' }}>Status</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Kilometraje</Table.Th>
                {onNavigateVehiculo && <Table.Th style={{ width: 32 }} />}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {vehiculos.map((v) => {
                const t = TIPOS[v.tipo]
                return (
                  <Table.Tr
                    key={v.id}
                    onClick={() => onNavigateVehiculo?.(v)}
                    style={{ cursor: onNavigateVehiculo ? 'pointer' : undefined }}
                  >
                    <Table.Td fw={500}>{v.serie}</Table.Td>
                    <Table.Td>
                      <Badge color={t.color} variant="light" size="sm">{t.label}</Badge>
                    </Table.Td>
                    <Table.Td>{v.placas ?? (v.tipo === 'montacargas' ? '' : <Text component="span" c="dimmed" size="sm">—</Text>)}</Table.Td>
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
                    {onNavigateVehiculo && (
                      <Table.Td>
                        <IconChevronRight size={14} color="var(--mantine-color-dimmed)" />
                      </Table.Td>
                    )}
                  </Table.Tr>
                )
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}

      <Modal
        opened={vehiculoFormOpen}
        onClose={() => setVehiculoFormOpen(false)}
        title={`Nuevo vehículo — ${modelo.marca} ${modelo.nombre}`}
        size="lg"
        closeOnClickOutside={false}
      >
        <VehiculoForm
          lockedModeloId={modelo.id}
          isPending={createVehiculoMut.isPending}
          error={vehiculoError}
          onSubmit={handleCreateVehiculo}
          onCancel={() => setVehiculoFormOpen(false)}
        />
      </Modal>
    </Stack>
  )
}

// ── Baja y reactivación ───────────────────────────────────────────────────────

// Un modelo no se borra. Es el padre del programa de mantenimiento, de las
// garantías del catálogo y de la lista de tipos de pieza, y esa configuración
// es lo que explica qué se le hacía a las unidades que lo usaron: sigue
// haciendo falta mucho después de que la última se venda. Lo que sí hace falta
// es dejar de ofrecerlo al dar de alta, y eso es la baja (migración 032).
function BajaModeloModal({ modelo, onClose }: { modelo: Modelo | null; onClose: () => void }) {
  const [motivo, setMotivo] = useState('')
  const bajaMut      = useBajaModelo()
  const reactivarMut = useReactivarModelo()

  const reactivando = modelo?.baja_en != null
  const mut = reactivando ? reactivarMut : bajaMut

  function cerrar() {
    bajaMut.reset()
    reactivarMut.reset()
    setMotivo('')
    onClose()
  }

  return (
    <Modal
      opened={modelo !== null} onClose={cerrar}
      title={reactivando ? 'Reactivar modelo' : 'Dar de baja el modelo'}
      centered size="sm"
    >
      <Stack gap="md">
        {reactivando ? (
          <>
            <Text>
              ¿Volver a ofrecer <strong>{modelo?.marca} {modelo?.nombre}</strong> al dar de alta
              unidades?
            </Text>
            {modelo?.baja_motivo && (
              <Text size="sm" c="dimmed">Se dio de baja por: {modelo.baja_motivo}</Text>
            )}
          </>
        ) : (
          <>
            <Text>
              ¿Dar de baja <strong>{modelo?.marca} {modelo?.nombre}</strong>?
            </Text>
            <Text size="sm" c="dimmed">
              Deja de aparecer al dar de alta unidades nuevas. No se borra nada: su programa,
              sus garantías y sus tipos de pieza siguen ahí, los vehículos que ya lo usan lo
              siguen mostrando, y puedes reactivarlo cuando quieras.
            </Text>
            <TextInput
              label="Motivo" placeholder="Ya no se compra este modelo"
              description="Opcional, pero evita que alguien lo vuelva a dar de alta duplicado."
              maxLength={200}
              value={motivo} onChange={(e) => setMotivo(e.currentTarget.value)}
            />
          </>
        )}
        {mut.error && <Alert color="red" title="Error">{(mut.error as Error).message}</Alert>}
        <Group justify="flex-end">
          <Button variant="default" onClick={cerrar} disabled={mut.isPending}>Cancelar</Button>
          <Button
            color={reactivando ? 'teal' : 'orange'} loading={mut.isPending}
            onClick={() => {
              if (reactivando) reactivarMut.mutate(modelo!.id, { onSuccess: cerrar })
              else bajaMut.mutate({ id: modelo!.id, motivo: motivo.trim() || undefined }, { onSuccess: cerrar })
            }}
          >
            {reactivando ? 'Reactivar' : 'Dar de baja'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}

// ── Lista de modelos ──────────────────────────────────────────────────────────

export default function Modelos({
  onNavigateVehiculo, openId, onOpenIdChange,
}: {
  onNavigateVehiculo?: (v: VehiculoRow) => void
  // Modelo cuyo detalle está abierto; vive en Layout para poder regresar
  // exactamente a él al volver desde un vehículo.
  openId?:         number | null
  onOpenIdChange?: (id: number | null) => void
}) {
  const [search, setSearch]       = useState('')
  const [debounced]               = useDebouncedValue(search, 300)
  const [formOpen, setFormOpen]   = useState(false)
  const [editing, setEditing]     = useState<Modelo | null>(null)
  // Modelo sobre el que se está por actuar la baja (o la reactivación, si ya
  // estaba de baja). Un modelo nunca se borra: ver useModelos y migración 032.
  const [bajaTarget, setBajaTarget] = useState<Modelo | null>(null)
  // Los dados de baja se ocultan por defecto: el catálogo es sobre todo la
  // lista de lo que se puede dar de alta. El switch los trae de vuelta, que es
  // la única forma de llegar a reactivarlos.
  const [verBajas, setVerBajas]   = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // Con bajas incluidas: esta es la única pantalla desde donde se reactivan, y
  // si no se listaran no habría forma de llegar a ellos.
  const { data, isLoading, isError } = useModelos(true)
  const createMut = useCreateModelo()
  const updateMut = useUpdateModelo()

  // El modelo abierto se deriva del id conservado por Layout.
  const selected = (data?.data ?? []).find((m) => m.id === openId) ?? null

  function openCreate() { setEditing(null); setFormError(null); setFormOpen(true) }
  function openEdit(m: Modelo, e?: React.MouseEvent) {
    e?.stopPropagation()
    setEditing(m); setFormError(null); setFormOpen(true)
  }
  function openBaja(m: Modelo, e: React.MouseEvent) {
    e.stopPropagation(); setBajaTarget(m)
  }
  function handleSubmit(payload: ModeloPayload) {
    setFormError(null)
    if (editing) {
      updateMut.mutate({ id: editing.id, payload }, {
        // El detalle abierto se deriva de la lista, que se refresca al invalidar
        // la query; no hay que re-sincronizar 'selected' a mano.
        onSuccess: () => setFormOpen(false),
        onError: (e: Error) => setFormError(e.message),
      })
    } else {
      createMut.mutate(payload, {
        // Se abre la ficha del modelo recién creado: lo que toca después del
        // alta es cargarle sus garantías, su programa y sus tipos de pieza, y
        // eso solo se hace desde ahí. `selected` sale de la lista, así que el detalle
        // aparece en cuanto llega el refetch que dispara la invalidación.
        onSuccess: ({ data: modelo }) => {
          setFormOpen(false)
          onOpenIdChange?.(modelo.id)
        },
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
          onBack={() => onOpenIdChange?.(null)}
          onEdit={(m) => openEdit(m)}
          onBaja={(m) => setBajaTarget(m)}
          onNavigateVehiculo={onNavigateVehiculo}
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

        {/* El modal se repite aquí porque el detalle sale por este return y no
            alcanza el de la lista. La ficha se queda abierta: el modelo sigue
            existiendo, solo cambia si se ofrece o no al dar de alta. */}
        <BajaModeloModal modelo={bajaTarget} onClose={() => setBajaTarget(null)} />
      </>
    )
  }

  const todos   = data?.data ?? []
  const deBaja  = todos.filter((m) => m.baja_en).length
  const modelos = todos.filter((m) => {
    if (m.baja_en && !verBajas) return false
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

      <Group justify="space-between" align="center" wrap="nowrap">
        <TextInput
          style={{ flex: 1 }}
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
        {deBaja > 0 && (
          <Switch
            size="sm" label={`Ver dados de baja (${deBaja})`}
            checked={verBajas} onChange={(e) => setVerBajas(e.currentTarget.checked)}
          />
        )}
      </Group>

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
        <Table.ScrollContainer minWidth={560}>
          <Table striped highlightOnHover withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Marca</Table.Th>
                <Table.Th>Modelo</Table.Th>
                <Table.Th>Año</Table.Th>
                <Table.Th>Tipos permitidos</Table.Th>
                <Table.Th>Creado</Table.Th>
                <Table.Th style={{ width: 100 }} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {modelos.map((m) => (
                <Table.Tr
                  key={m.id}
                  onClick={() => onOpenIdChange?.(m.id)}
                  style={{ cursor: 'pointer' }}
                >
                  <Table.Td>
                    <Badge variant="light" color="gray" size="sm">{m.marca}</Badge>
                  </Table.Td>
                  <Table.Td fw={500}>
                    <Group gap="xs" wrap="nowrap">
                      <span>{m.nombre}</span>
                      {m.baja_en && <Badge variant="light" color="gray" size="sm">Baja</Badge>}
                    </Group>
                  </Table.Td>
                  <Table.Td>{m.anio ?? <Text component="span" c="dimmed" size="sm">—</Text>}</Table.Td>
                  <Table.Td>
                    {(m.tipos_permitidos ?? []).length === 0 ? (
                      <Text size="sm" c="dimmed">Todos</Text>
                    ) : (
                      <Group gap={4}>
                        {m.tipos_permitidos.map((t) => (
                          <Badge key={t} variant="light" color={TIPOS[t]?.color} size="sm">
                            {TIPOS[t]?.label ?? t}
                          </Badge>
                        ))}
                      </Group>
                    )}
                  </Table.Td>
                  <Table.Td c="dimmed">
                    <Text size="sm">
                      {new Date(m.created_at).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Group gap={4} justify="flex-end" wrap="nowrap">
                      <Tooltip label="Editar">
                        <ActionIcon variant="subtle" color="blue" size="sm" onClick={(e) => openEdit(m, e)}>
                          <IconPencil size={14} />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label={m.baja_en ? 'Reactivar' : 'Dar de baja'}>
                        <ActionIcon
                          variant="subtle" color={m.baja_en ? 'teal' : 'orange'} size="sm"
                          aria-label={m.baja_en ? 'Reactivar modelo' : 'Dar de baja el modelo'}
                          onClick={(e) => openBaja(m, e)}
                        >
                          {m.baja_en ? <IconArchiveOff size={14} /> : <IconArchive size={14} />}
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

      <BajaModeloModal modelo={bajaTarget} onClose={() => setBajaTarget(null)} />
    </Stack>
  )
}
