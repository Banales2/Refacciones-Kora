// Página Vehículos: administración de la flota. La vista de lista agrupa por
// ubicación (rutas / sucursales / unitarios) y tipo, con búsqueda paginada,
// edición rápida de kilometraje, alta/edición/baja y reporte PDF del
// inventario. La vista de detalle de un vehículo concentra sus datos, sus
// mantenimientos realizados, sus incidencias y su programa de mantenimiento.
// El formulario de mantenimiento vive en components/MantenimientoForm: lo usan
// también el calendario, las incidencias y la sección del programa.
import { Fragment, useState, useEffect, useMemo, useRef } from 'react'
import {
  Stack, Group, Text, TextInput, Table, Badge,
  Pagination, Loader, Center, Alert, Button, Select,
  Modal, ActionIcon, Tooltip, NumberInput,
  Divider, Grid, Paper, Accordion,
} from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import {
  IconPencil, IconTrash, IconPlus, IconArrowLeft, IconChevronRight, IconAlertTriangle,
  IconFileTypePdf, IconReportAnalytics, IconTool,
} from '@tabler/icons-react'
import {
  useVehiculos, useVehiculo, useCreateVehiculo, useUpdateVehiculo, useDeleteVehiculo, vehiculoLabel,
  fetchTodosLosVehiculos,
} from '../hooks/useVehiculos'
import { useSucursales } from '../hooks/useSucursales'
import type { Sucursal } from '../hooks/useSucursales'
import { exportVehiculosReporteToPdf } from '../lib/exportVehiculosReporte'
import { exportVehiculoPdf, exportVehiculoExcel } from '../lib/reportes/vehiculo'
import ExpedienteVehiculoModal from '../components/ExpedienteVehiculoModal'
import { type Periodo, dentroDelPeriodo, PERIODO_DEFAULT } from '../lib/reportes/periodo'
import { useRecargas } from '../hooks/useRecargas'
import { limpiarTextoSimple, KM_MAX } from '../lib/validaciones'
import {
  useMantenimientos, useCreateMantenimiento, useUpdateMantenimiento, useDeleteMantenimiento,
} from '../hooks/useMantenimientos'
import type { Mantenimiento, MantenimientoPayload } from '../hooks/useMantenimientos'
import MantenimientoForm from '../components/MantenimientoForm'
import type { AlertaDocumento, AlertaVehiculo, TipoVehiculo, VehiculoRow, VehiculoCreatePayload, VehiculoUpdatePayload } from '../hooks/useVehiculos'
import { useDocumentosPorVencer, useRequerimientosVencidos } from '../hooks/useDashboard'
import { useGarantiasVehiculo } from '../hooks/useGarantias'
import GarantiasVehiculoSection from '../components/GarantiasVehiculoSection'
import ProgramaVehiculoSection from '../components/ProgramaVehiculoSection'
import { useProgramaVehiculo } from '../hooks/useProgramaVehiculo'
import {
  useIncidenciasVehiculo, useCreateIncidencia, useUpdateIncidencia, useDeleteIncidencia,
} from '../hooks/useIncidencias'
import type { Incidencia, IncidenciaPayload, StatusIncidencia } from '../hooks/useIncidencias'
import IncidenciaForm from '../components/IncidenciaForm'
import { SEVERIDAD_META, STATUS_INCIDENCIA_META } from '../lib/incidenciaMeta'
import { llevaPermiso, llevaSeguro } from '../lib/tipoVehiculo'
import { VehiculoForm } from '../components/VehiculoForm'
import MantenimientoDetalleDrawer from '../components/MantenimientoDetalleDrawer'
import RecargasSection from '../components/RecargasSection'
import {
  usePiezasVehiculo, useSetPiezaVehiculo, useRemovePiezaVehiculo, useHistorialPiezas,
} from '../hooks/usePiezasVehiculo'
import type { PiezaDeVehiculo, DatosMontaje, DatosRetiro } from '../hooks/usePiezasVehiculo'
import { formatearFecha } from '../lib/fechas'
import MontajePiezaModal from '../components/MontajePiezaModal'
import type { ModoMontaje } from '../components/MontajePiezaModal'
import {
  useAddTiposPiezaVehiculo, useRemoveTipoPiezaVehiculo, useRenameEtiquetaVehiculo,
} from '../hooks/useTiposPiezaVehiculo'
import EtiquetaEditable from '../components/EtiquetaEditable'
import { useTiposPieza } from '../hooks/useTiposPieza'
import { useTodasLasPiezas } from '../hooks/useRefacciones'
import { useCreateDetallesMtto } from '../hooks/useDetalleMtto'
import { avisarMontajes, avisarHistoricos } from '../lib/montajes'
import type { DetalleMttoPayload } from '../hooks/useDetalleMtto'

// ── Constantes ────────────────────────────────────────────────────────────────

const TIPOS: { value: TipoVehiculo; label: string; abrev: string; color: string }[] = [
  { value: 'camion',       label: 'Unidad de reparto',   abrev: 'UR', color: 'blue'   },
  { value: 'tractocamion', label: 'Unidad de translado', abrev: 'UT', color: 'violet' },
  { value: 'caja_trailer', label: 'Caja de trailer',     abrev: 'CT', color: 'orange' },
  { value: 'utilitario',   label: 'Vehículo utilitario', abrev: 'VU', color: 'teal'   },
  { value: 'montacargas',  label: 'Montacargas',         abrev: 'MC', color: 'yellow' },
]

function sinKilometraje(tipo: TipoVehiculo): boolean {
  return tipo === 'caja_trailer' || tipo === 'montacargas'
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

function fmtShort(iso: string | null | undefined) {
  if (!iso) return null
  return new Date(`${iso.split('T')[0]}T12:00:00`).toLocaleDateString('es-MX', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

// Antigüedad desde la compra, en años y meses cumplidos. Devuelve null si la
// fecha falta o es futura (compras capturadas por adelantado).
function antiguedad(iso: string | null | undefined) {
  if (!iso) return null
  const compra = new Date(`${iso.split('T')[0]}T12:00:00`)
  if (isNaN(compra.getTime())) return null
  const hoy = new Date()
  let meses = (hoy.getFullYear() - compra.getFullYear()) * 12 + (hoy.getMonth() - compra.getMonth())
  if (hoy.getDate() < compra.getDate()) meses--
  if (meses < 0) return null
  const anios = Math.floor(meses / 12)
  const resto = meses % 12
  const partes: string[] = []
  if (anios) partes.push(`${anios} año${anios !== 1 ? 's' : ''}`)
  if (resto) partes.push(`${resto} mes${resto !== 1 ? 'es' : ''}`)
  return partes.join(' ') || 'Menos de 1 mes'
}

// Textos del chip que queda bajo la barra de búsqueda cuando hay un filtro de
// atención activo, y la línea que explica qué se está mostrando.
const ALERTA_CHIP: Record<AlertaVehiculo, string> = {
  sin_tenencia:            'Solo sin tenencia',
  sin_seguro:              'Solo sin seguro',
  programa_atrasado:       'Solo atrasados en su programa',
  permiso_por_vencer:      'Solo con permiso por vencer',
}

// Cómo se pinta cada documento faltante que reporta la API, en la ficha (Alert)
// y en el renglón del listado (triángulo con tooltip). El "qué" lo decide el
// backend; aquí solo está el "cómo se ve".
const AVISO_DOCUMENTO: Record<AlertaDocumento, {
  color: string; iconColor: string; titulo: string; tooltip: string; detalle: string
}> = {
  sin_seguro: {
    color: 'red', iconColor: 'var(--mantine-color-red-6)',
    titulo: 'Sin seguro', tooltip: 'Sin seguro asignado',
    detalle: 'Este vehículo no tiene un seguro asignado. Asígnale uno desde el botón de editar.',
  },
  sin_tenencia: {
    color: 'yellow', iconColor: 'var(--mantine-color-yellow-7)',
    titulo: 'Sin tenencia', tooltip: 'Sin tenencia registrada',
    detalle: 'Este vehículo no tiene tenencia registrada, así que no aparecerá en los avisos de ' +
             'vencimiento. Regístrala desde el botón de editar.',
  },
}

const ALERTA_DETALLE: Record<AlertaVehiculo, string> = {
  sin_tenencia:            'Camiones de reparto y utilitarios sin fecha de tenencia.',
  sin_seguro:              'Unidades que se aseguran (todas menos las cajas de trailer) sin póliza asignada.',
  programa_atrasado:       'Con la visita de su programa de mantenimiento ya vencida, o con una operación vencida por tiempo.',
  permiso_por_vencer:      'Con permiso de circulación ya vencido o que vence dentro de 30 días.',
}

// Edad del modelo, en años. `modelo_anio` es texto y a veces trae la versión
// pegada ("2018-1"), así que solo se toma el año de adelante.
function edadModelo(modeloAnio: string | null | undefined) {
  const m = modeloAnio?.match(/^\s*(\d{4})/)
  if (!m) return null
  const anios = new Date().getFullYear() - Number(m[1])
  if (anios < 0) return null
  return anios === 0 ? 'Del año' : `${anios} año${anios !== 1 ? 's' : ''}`
}

function formatMXN(n: number) {
  return n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })
}

function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ── Sección de incidencias ────────────────────────────────────────────────────

// Cómo deshacer el cierre de una incidencia si el mantenimiento que lo
// justifica no llega a registrarse. Se comparte con la página de Incidencias.
export type DeshacerAtencion =
  | { tipo: 'eliminar' }
  | { tipo: 'revertir'; status: StatusIncidencia }

function IncidenciasSection({ vehiculoId, tipoVehiculo }: { vehiculoId: number; tipoVehiculo?: TipoVehiculo }) {
  const { data, isLoading } = useIncidenciasVehiculo(vehiculoId)
  const createMut = useCreateIncidencia(vehiculoId)
  const updateMut = useUpdateIncidencia(vehiculoId)
  const deleteMut = useDeleteIncidencia(vehiculoId)
  const mantMut   = useCreateMantenimiento(vehiculoId)
  const piezasMut = useCreateDetallesMtto()

  const [formOpen, setFormOpen]   = useState(false)
  const [editing, setEditing]     = useState<Incidencia | null>(null)
  const [deleting, setDeleting]   = useState<Incidencia | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  // Incidencia marcada como atendida: hay que registrarle el mantenimiento que
  // la cerró antes de darla por buena. `deshacer` dice cómo revertir el cambio
  // si se cancela: borrarla si nació así, o devolverle su status si se editó.
  const [atendiendo, setAtendiendo]   = useState<Incidencia | null>(null)
  // La ficha que se abre al hacer clic en el renglón. Es aparte de `atendiendo`
  // porque atender se dispara también desde el formulario (al marcarla como
  // completada), sin pasar por aquí.
  const [detalle, setDetalle]         = useState<Incidencia | null>(null)
  const [deshacer, setDeshacer]       = useState<DeshacerAtencion | null>(null)
  const [mantError, setMantError]     = useState<string | null>(null)
  const [detalleMttoId, setDetalleMttoId] = useState<number | null>(null)

  const items = data?.data ?? []
  // Lo que sigue sin atender primero, y dentro de eso lo más grave arriba.
  const orden = { grave: 0, moderada: 1, superficial: 2 }
  const ordenados = [...items].sort((a, b) => {
    const abiertaA = a.status === 'activo' ? 0 : 1
    const abiertaB = b.status === 'activo' ? 0 : 1
    if (abiertaA !== abiertaB) return abiertaA - abiertaB
    if (orden[a.severidad] !== orden[b.severidad]) return orden[a.severidad] - orden[b.severidad]
    return b.fecha.localeCompare(a.fecha)
  })
  const abiertas = items.filter(i => i.status === 'activo').length

  function openCreate() { setEditing(null); setFormError(null); setFormOpen(true) }
  function openEdit(item: Incidencia) { setEditing(item); setFormError(null); setFormOpen(true) }

  // Atenderla es registrarle el mantenimiento que la cierra, con ella ya
  // vinculada y en correctivo —una incidencia no se atiende con un preventivo—.
  // No hay nada que deshacer: la incidencia sigue como está y es el alta del
  // mantenimiento la que la cierra, así que cancelar solo cierra el modal.
  function abrirAtender(i: Incidencia) {
    setMantError(null)
    setDeshacer(null)
    setDetalle(null)
    setAtendiendo(i)
  }

  // Marcar una incidencia como atendida obliga a registrar el mantenimiento que
  // la cerró: si no, quedaría cerrada sin nada que explique cómo (y de hecho la
  // sincronización diaria la volvería a abrir). El cambio se guarda primero
  // porque el mantenimiento la vincula por id; si no llega a registrarse, se
  // deshace (ver `cancelarAtencion`).
  function handleSubmit(payload: IncidenciaPayload) {
    setFormError(null)
    const onError = (e: unknown) => setFormError((e as Error).message)
    const pideMantenimiento = payload.status === 'completado'

    if (editing) {
      const statusPrevio = editing.status
      updateMut.mutate({ id: editing.id, payload }, {
        onSuccess: ({ data }) => {
          setFormOpen(false)
          if (pideMantenimiento && statusPrevio !== 'completado') {
            setMantError(null)
            setDeshacer({ tipo: 'revertir', status: statusPrevio })
            setAtendiendo(data)
          }
        },
        onError,
      })
      return
    }

    createMut.mutate(payload, {
      onSuccess: ({ data }) => {
        setFormOpen(false)
        if (pideMantenimiento) {
          setMantError(null)
          setDeshacer({ tipo: 'eliminar' })
          setAtendiendo(data)
        }
      },
      onError,
    })
  }

  // Cancelar deja la incidencia como estaba: borrada si nació atendida (sin el
  // mantenimiento el alta nunca se completó) o con su status anterior si se
  // editó para cerrarla.
  function cancelarAtencion() {
    if (!atendiendo || !deshacer) { setAtendiendo(null); return }
    setMantError(null)
    const cerrar = () => { setAtendiendo(null); setDeshacer(null) }
    const onError = (e: unknown) =>
      setMantError(`No se pudo deshacer el cambio en la incidencia: ${(e as Error).message}`)

    if (deshacer.tipo === 'eliminar') {
      deleteMut.mutate(atendiendo.id, { onSuccess: cerrar, onError })
    } else {
      updateMut.mutate(
        { id: atendiendo.id, payload: { status: deshacer.status } },
        { onSuccess: cerrar, onError },
      )
    }
  }

  function handleAtender(payload: MantenimientoPayload, piezas: DetalleMttoPayload[]) {
    setMantError(null)
    mantMut.mutate(payload, {
      onSuccess: (res) => {
        setDeshacer(null)
        if (!piezas.length) { setAtendiendo(null); return }
        piezasMut.mutate({ mantenimientoId: res.data.id, piezas }, {
          onSuccess: ({ avisos, historicos }) => {
            avisarMontajes(avisos)
            avisarHistoricos(historicos)
            setAtendiendo(null)
          },
          // El mantenimiento ya quedó registrado: no hay forma de deshacer el
          // alta, así que se abre su detalle para capturar a mano lo que faltó.
          onError: (e: Error) => {
            setAtendiendo(null)
            setDetalleMttoId(res.data.id)
            alert(
              `El mantenimiento se registró, pero no se pudieron guardar todas las refacciones: ${e.message}\n\n` +
              'Revisa el detalle del mantenimiento para agregar las que falten.'
            )
          },
        })
      },
      onError: (e: Error) => setMantError(e.message),
    })
  }

  return (
    <>
      <Divider
        label={
          <Group gap="xs">
            <Text size="sm" fw={500}>Incidencias ({abiertas} sin atender)</Text>
            <Tooltip label="Reportar incidencia">
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
            <Text c="dimmed" size="sm">No hay incidencias reportadas para este vehículo.</Text>
            <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={openCreate}>
              Reportar incidencia
            </Button>
          </Stack>
        </Center>
      ) : (
        <Table.ScrollContainer minWidth={700}>
          <Table striped highlightOnHover withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Incidencia</Table.Th>
                <Table.Th>Categoría</Table.Th>
                <Table.Th>Severidad</Table.Th>
                <Table.Th>Reportada</Table.Th>
                <Table.Th>Ubicación</Table.Th>
                <Table.Th style={{ textAlign: 'center' }}>Status</Table.Th>
                <Table.Th style={{ width: 110 }} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {ordenados.map((i) => {
                const sev  = SEVERIDAD_META[i.severidad]
                const st   = STATUS_INCIDENCIA_META[i.status]
                const urge = i.status === 'activo' && i.severidad === 'grave'
                return (
                  <Table.Tr
                    key={i.id}
                    onClick={() => setDetalle(i)}
                    style={{
                      backgroundColor: urge ? 'var(--mantine-color-red-0)' : undefined,
                      cursor: 'pointer',
                    }}
                  >
                    <Table.Td fw={500}>
                      <Group gap={6} wrap="nowrap">
                        {urge && <IconAlertTriangle size={14} color="var(--mantine-color-red-6)" />}
                        <span style={urge ? { color: 'var(--mantine-color-red-7)' } : undefined}>{i.nombre}</span>
                      </Group>
                    </Table.Td>
                    <Table.Td>{i.categoria ?? <Text component="span" c="dimmed" size="sm">—</Text>}</Table.Td>
                    <Table.Td><Badge variant="light" color={sev.color} size="sm">{sev.label}</Badge></Table.Td>
                    <Table.Td>
                      <Text size="sm">
                        {fmtShort(i.fecha)}{i.hora ? `, ${i.hora.slice(0, 5)}` : ''}
                      </Text>
                    </Table.Td>
                    <Table.Td>{i.ubicacion ?? <Text component="span" c="dimmed" size="sm">—</Text>}</Table.Td>
                    <Table.Td style={{ textAlign: 'center' }}>
                      <Badge variant="light" color={st.color} size="sm">{st.label}</Badge>
                    </Table.Td>
                    {/* Los botones hacen lo suyo sin abrir además la ficha. */}
                    <Table.Td onClick={(e) => e.stopPropagation()}>
                      <Group gap={4} justify="flex-end">
                        {/* Solo las que siguen abiertas: registrarle un
                            mantenimiento a una ya cerrada no cierra nada. */}
                        {i.status === 'activo' && (
                          <Tooltip label="Registrar el mantenimiento que la atiende">
                            <ActionIcon variant="subtle" color="teal" size="sm"
                              onClick={() => abrirAtender(i)}>
                              <IconTool size={14} />
                            </ActionIcon>
                          </Tooltip>
                        )}
                        <Tooltip label="Editar">
                          <ActionIcon variant="subtle" color="blue" size="sm" onClick={() => openEdit(i)}>
                            <IconPencil size={14} />
                          </ActionIcon>
                        </Tooltip>
                        <Tooltip label="Eliminar">
                          <ActionIcon variant="subtle" color="red" size="sm" onClick={() => setDeleting(i)}>
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
        title={editing ? 'Editar incidencia' : 'Reportar incidencia'}
        centered size="md"
      >
        <IncidenciaForm
          initial={editing ?? undefined}
          isPending={createMut.isPending || updateMut.isPending}
          error={formError}
          onSubmit={handleSubmit}
          onCancel={() => setFormOpen(false)}
        />
      </Modal>

      {/* ── Ficha de la incidencia ── */}
      <Modal
        opened={detalle !== null} onClose={() => setDetalle(null)}
        title="Detalle de la incidencia" centered size="lg"
      >
        {detalle && (
          <Stack gap="md">
            <div>
              <Group gap="xs" align="center">
                <Text fw={600} size="lg">{detalle.nombre}</Text>
                <Badge variant="light" size="sm" color={SEVERIDAD_META[detalle.severidad].color}>
                  {SEVERIDAD_META[detalle.severidad].label}
                </Badge>
                <Badge variant="light" size="sm" color={STATUS_INCIDENCIA_META[detalle.status].color}>
                  {STATUS_INCIDENCIA_META[detalle.status].label}
                </Badge>
              </Group>
              <Text size="sm" c="dimmed" mt={4}>
                {detalle.descripcion || 'Sin descripción capturada.'}
              </Text>
            </div>

            <Divider />

            <Grid>
              <Grid.Col span={{ base: 6, sm: 6 }}>
                <InfoItem label="Categoría" value={detalle.categoria} />
              </Grid.Col>
              <Grid.Col span={{ base: 6, sm: 6 }}>
                <InfoItem
                  label="Ocurrió"
                  value={`${fmtShort(detalle.fecha)}${detalle.hora ? `, ${detalle.hora.slice(0, 5)}` : ''}`}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 6, sm: 6 }}>
                <InfoItem label="Ubicación" value={detalle.ubicacion} />
              </Grid.Col>
              <Grid.Col span={{ base: 6, sm: 6 }}>
                <InfoItem label="Reportó" value={detalle.reportado_por} />
              </Grid.Col>
              <Grid.Col span={{ base: 6, sm: 6 }}>
                <InfoItem label="Autorizó" value={detalle.autorizado_por} />
              </Grid.Col>
            </Grid>

            <Group justify="space-between" mt="xs">
              <Button variant="subtle" leftSection={<IconPencil size={16} />}
                onClick={() => { setDetalle(null); openEdit(detalle) }}>
                Editar
              </Button>
              {detalle.status === 'activo' && (
                <Button color="teal" leftSection={<IconTool size={16} />}
                  onClick={() => abrirAtender(detalle)}>
                  Registrar mantenimiento
                </Button>
              )}
            </Group>
          </Stack>
        )}
      </Modal>

      {/* Atender la incidencia con el mantenimiento que la cierra. También se
          llega aquí desde el formulario, al marcarla como atendida: en ese caso
          `deshacer` trae cómo revertir el cambio si no se registra. */}
      <Modal
        opened={atendiendo !== null} onClose={cancelarAtencion}
        title={atendiendo
          ? `${deshacer ? 'Registra el mantenimiento' : 'Atender'} — ${atendiendo.nombre}`
          : ''}
        centered size="md" closeOnClickOutside={false} withCloseButton={!deshacer}
      >
        {atendiendo && (
          <Stack gap="sm">
            {deshacer ? (
              <Alert color="orange" variant="light" title="Falta el mantenimiento que la cierra">
                Marcaste la incidencia como <strong>atendida</strong>, así que hay que registrar el
                mantenimiento con el que se atendió. Si cancelas,{' '}
                {deshacer.tipo === 'revertir'
                  ? 'la incidencia vuelve a como estaba.'
                  : 'la incidencia se descarta y no queda registrada.'}
              </Alert>
            ) : (
              <Alert color="teal" variant="light">
                Al registrarlo, la incidencia queda atendida. Puedes agregarle los demás
                pendientes que se hayan resuelto en el mismo servicio.
              </Alert>
            )}
            <MantenimientoForm
              vehiculoId={vehiculoId}
              tipoVehiculo={tipoVehiculo}
              pendienteFijo={{ id: atendiendo.id, nombre: atendiendo.nombre }}
              tipoInicial="Correctivo"
              isPending={mantMut.isPending || piezasMut.isPending
                || deleteMut.isPending || updateMut.isPending}
              error={mantError}
              onSubmit={handleAtender}
              onCancel={cancelarAtencion}
            />
          </Stack>
        )}
      </Modal>

      {detalleMttoId !== null && (
        <MantenimientoDetalleDrawer
          mantenimientoId={detalleMttoId}
          onClose={() => setDetalleMttoId(null)}
        />
      )}

      <Modal
        opened={deleting !== null} onClose={() => setDeleting(null)}
        title="Eliminar incidencia" centered size="sm"
      >
        <Stack gap="md">
          <Text>¿Eliminar <strong>{deleting?.nombre}</strong>? Esta acción no se puede deshacer.</Text>
          <Text size="sm" c="dimmed">
            Si solo quieres que deje de alertar sin perder el registro, edítala y ponla como cancelada.
          </Text>
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

// ── Sección mantenimientos ────────────────────────────────────────────────────

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

function groupByYearMonth<T>(
  items: T[], getFecha: (item: T) => string | null | undefined
): { sinFecha: T[]; anios: Array<[number, Map<number, T[]>]> } {
  const sorted = [...items].sort((a, b) => (getFecha(b) ?? '').localeCompare(getFecha(a) ?? ''))
  const sinFecha: T[] = []
  const porAnio = new Map<number, Map<number, T[]>>()
  for (const item of sorted) {
    const fecha = getFecha(item)
    if (!fecha) { sinFecha.push(item); continue }
    const d = new Date(`${fecha.split('T')[0]}T12:00:00`)
    const y = d.getFullYear()
    const mo = d.getMonth()
    if (!porAnio.has(y)) porAnio.set(y, new Map())
    const months = porAnio.get(y)!
    if (!months.has(mo)) months.set(mo, [])
    months.get(mo)!.push(item)
  }
  return { sinFecha, anios: [...porAnio.entries()] }
}

// El lápiz NO abre el formulario: abre el detalle del mantenimiento, que es
// donde está todo lo que se hace con uno ya registrado —agregar refacciones,
// comprarlas si faltan y montarlas en la unidad—. Cambiar fecha, técnico o
// costo es solo una parte, y se llega desde el propio detalle con su lápiz.
// Antes se entraba directo al formulario y lo demás quedaba escondido detrás de
// un clic en la fila que nadie descubría.
function MantenimientoTable({
  items, mostrarKm = true, onOpenDetalle, onDelete,
}: {
  items:         Mantenimiento[]
  mostrarKm?:    boolean
  onOpenDetalle: (id: number) => void
  onDelete:      (m: Mantenimiento) => void
}) {
  function fmtFecha(iso: string | null) {
    if (!iso) return '—'
    return new Date(`${iso.split('T')[0]}T12:00:00`).toLocaleDateString('es-MX', {
      day: '2-digit', month: 'short', year: 'numeric',
    })
  }

  return (
    <Table.ScrollContainer minWidth={500}>
      <Table striped highlightOnHover withTableBorder>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Fecha</Table.Th>
            <Table.Th>Tipo</Table.Th>
            <Table.Th>Técnico</Table.Th>
            {mostrarKm && <Table.Th style={{ textAlign: 'right' }}>Kilometraje</Table.Th>}
            <Table.Th style={{ textAlign: 'right' }}>Costo total</Table.Th>
            <Table.Th style={{ width: 80 }} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {items.map((m) => {
            const programado = !!m.fecha && m.fecha.split('T')[0] > todayIso()
            return (
            <Table.Tr key={m.id} onClick={() => onOpenDetalle(m.id)} style={{ cursor: 'pointer' }}>
              <Table.Td fw={500}>
                <Group gap={6} wrap="nowrap">
                  {fmtFecha(m.fecha)}
                  {programado && <Badge size="xs" variant="light" color="blue">Programado</Badge>}
                </Group>
              </Table.Td>
              <Table.Td>{m.tipo ?? <Text component="span" c="dimmed" size="sm">—</Text>}</Table.Td>
              <Table.Td>{m.tecnico ?? <Text component="span" c="dimmed" size="sm">—</Text>}</Table.Td>
              {mostrarKm && (
                <Table.Td style={{ textAlign: 'right' }}>
                  {m.km_actual ? `${m.km_actual.toLocaleString('es-MX')} km` : <Text component="span" c="dimmed" size="sm">—</Text>}
                </Table.Td>
              )}
              <Table.Td style={{ textAlign: 'right' }}>
                {m.costo || m.piezas_total ? (
                  <Tooltip
                    label={`Mantenimiento: ${formatMXN(m.costo)} + Refacciones: ${formatMXN(m.piezas_total)}`}
                    disabled={!m.piezas_total}
                  >
                    <Text component="span" size="sm">
                      {formatMXN(m.costo + m.piezas_total)}
                    </Text>
                  </Tooltip>
                ) : <Text component="span" c="dimmed" size="sm">—</Text>}
              </Table.Td>
              <Table.Td onClick={(e) => e.stopPropagation()}>
                <Group gap={4} justify="flex-end">
                  <Tooltip label="Ver detalle y editar">
                    <ActionIcon variant="subtle" color="blue" size="sm" onClick={() => onOpenDetalle(m.id)}>
                      <IconPencil size={14} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label="Eliminar">
                    <ActionIcon variant="subtle" color="red" size="sm" onClick={() => onDelete(m)}>
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
  )
}

function MantenimientosSection({ vehiculoId, tipoVehiculo }: { vehiculoId: number; tipoVehiculo?: TipoVehiculo }) {
  const [formOpen, setFormOpen]     = useState(false)
  const [editing, setEditing]       = useState<Mantenimiento | null>(null)
  const [deleting, setDeleting]     = useState<Mantenimiento | null>(null)
  const [formError, setFormError]   = useState<string | null>(null)
  const [detalleId, setDetalleId]   = useState<number | null>(null)

  const { data, isLoading } = useMantenimientos(vehiculoId)
  const items      = data?.data ?? []
  const createMut  = useCreateMantenimiento(vehiculoId)
  const updateMut  = useUpdateMantenimiento(vehiculoId)
  const deleteMut  = useDeleteMantenimiento()
  const piezasMut  = useCreateDetallesMtto()

  function openCreate() { setEditing(null); setFormError(null); setFormOpen(true) }
  function openEdit(m: Mantenimiento) { setEditing(m); setFormError(null); setFormOpen(true) }

  function handleSubmit(payload: MantenimientoPayload, piezas: DetalleMttoPayload[]) {
    setFormError(null)
    if (editing) {
      updateMut.mutate({ id: editing.id, payload }, {
        onSuccess: () => setFormOpen(false),
        onError:   (e: Error) => setFormError(e.message),
      })
      return
    }
    createMut.mutate(payload, {
      onSuccess: (res) => {
        if (!piezas.length) { setFormOpen(false); return }
        piezasMut.mutate({ mantenimientoId: res.data.id, piezas }, {
          onSuccess: ({ avisos, historicos }) => {
            avisarMontajes(avisos)
            avisarHistoricos(historicos)
            setFormOpen(false)
          },
          // El mantenimiento ya quedó registrado: no se puede "deshacer" el alta,
          // así que se abre su detalle para completar a mano las piezas que faltaron.
          onError: (e: Error) => {
            setFormOpen(false)
            setDetalleId(res.data.id)
            setFormError(null)
            alert(
              `El mantenimiento se registró, pero no se pudieron guardar todas las refacciones: ${e.message}\n\n` +
              'Revisa el detalle del mantenimiento para agregar las que falten.'
            )
          },
        })
      },
      onError: (e: Error) => setFormError(e.message),
    })
  }

  function fmtFecha(iso: string | null) {
    if (!iso) return '—'
    return new Date(`${iso.split('T')[0]}T12:00:00`).toLocaleDateString('es-MX', {
      day: '2-digit', month: 'short', year: 'numeric',
    })
  }

  return (
    <>
      <Divider
        label={
          <Group gap="xs">
            <Text size="sm" fw={500}>Mantenimientos ({items.length})</Text>
            <Tooltip label="Registrar mantenimiento">
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
            <Text c="dimmed" size="sm">No hay mantenimientos registrados.</Text>
            <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={openCreate}>
              Registrar mantenimiento
            </Button>
          </Stack>
        </Center>
      ) : (
        (() => {
          const { anios } = groupByYearMonth(items, m => m.fecha)
          const anioMasReciente = anios[0]?.[0]
          return (
            <Accordion multiple defaultValue={anioMasReciente != null ? [String(anioMasReciente)] : []} variant="separated">
              {anios.map(([anio, porMes]) => {
                const totalAnio = [...porMes.values()].reduce((s, arr) => s + arr.length, 0)
                return (
                  <Accordion.Item key={anio} value={String(anio)}>
                    <Accordion.Control>
                      <Group justify="space-between" pr="md" wrap="nowrap">
                        <Text fw={600}>{anio}</Text>
                        <Badge variant="light" color="gray">{totalAnio}</Badge>
                      </Group>
                    </Accordion.Control>
                    <Accordion.Panel>
                      <Stack gap="md">
                        {[...porMes.entries()].map(([mes, mesItems]) => (
                          <div key={mes}>
                            <Text size="sm" fw={500} c="dimmed" mb={4} tt="capitalize">{MESES[mes]}</Text>
                            <MantenimientoTable
                              items={mesItems}
                              mostrarKm={!tipoVehiculo || !sinKilometraje(tipoVehiculo)}
                              onOpenDetalle={setDetalleId} onDelete={setDeleting}
                            />
                          </div>
                        ))}
                      </Stack>
                    </Accordion.Panel>
                  </Accordion.Item>
                )
              })}
            </Accordion>
          )
        })()
      )}

      <Modal
        opened={formOpen} onClose={() => setFormOpen(false)}
        title={editing ? 'Editar mantenimiento' : 'Registrar mantenimiento'}
        centered size="md"
      >
        <MantenimientoForm
          vehiculoId={vehiculoId}
          tipoVehiculo={tipoVehiculo}
          initial={editing ?? undefined}
          isPending={createMut.isPending || updateMut.isPending || piezasMut.isPending}
          error={formError}
          onSubmit={handleSubmit}
          onCancel={() => setFormOpen(false)}
        />
      </Modal>

      <Modal
        opened={deleting !== null} onClose={() => setDeleting(null)}
        title="Eliminar mantenimiento" centered size="sm"
      >
        <Stack gap="md">
          <Text>¿Eliminar el mantenimiento del <strong>{fmtFecha(deleting?.fecha ?? null)}</strong>?</Text>
          {/* Si además cerró una columna del programa, borrarlo deshace ese
              avance: era el único respaldo de que el servicio se hizo. */}
          {deleting?.servicio_programa_km != null && (
            <Alert color="orange" title="Es la visita de un servicio del programa" variant="light">
              Este mantenimiento cerró el servicio de{' '}
              <strong>{deleting.servicio_programa_km.toLocaleString('es-MX')} km</strong> del
              programa de mantenimiento. Al borrarlo, esa columna vuelve a pedirse.
            </Alert>
          )}
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

      <MantenimientoDetalleDrawer
        mantenimientoId={detalleId}
        onClose={() => setDetalleId(null)}
        onEdit={(m) => { setDetalleId(null); openEdit(m) }}
      />
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

// Refacción que usa este vehículo para cada tipo de pieza que necesita. Los
// tipos salen del modelo (se gestionan allá), más los que se agreguen aquí para
// esta unidad sola. Lo que se decide en ambos casos es cuál refacción cubre cada
// uno: dos unidades del mismo modelo pueden usar filtros de aire distintos.
// Lo que el modal de montaje necesita saber para plantear el cambio. Vive en
// estado en lugar de aplicarse de inmediato porque el lote de compra y el
// motivo del retiro solo los sabe quien está haciendo el cambio, y una vez
// guardado el renglón sin ellos ya no hay a quién preguntarle.
type CambioPendiente = {
  modo:            ModoMontaje
  tipoId:          number
  // Qué renglón de ese tipo se está tocando: una unidad puede llevar dos filtros
  // de aire y el cambio es de uno solo.
  etiqueta:        string
  tipoNombre:      string
  piezaEntranteId: number | null
  salienteNombre:  string | null
}

// Cómo se nombra un renglón cuando hay que decirlo en una frase (el modal de
// montaje, un aria-label): "Filtro de aire (delantero)". Sin etiqueta —el caso
// de siempre— queda solo el tipo.
function nombreDeFila(f: { tipo_nombre: string; etiqueta: string }): string {
  return f.etiqueta ? `${f.tipo_nombre} (${f.etiqueta})` : f.tipo_nombre
}

function PiezasVehiculoSection({ vehiculoId, kmVehiculo }: { vehiculoId: number; kmVehiculo?: number | null }) {
  const { data, isLoading } = usePiezasVehiculo(vehiculoId)
  const { data: piezasData } = useTodasLasPiezas()
  const { data: tiposData } = useTiposPieza()
  const setMut       = useSetPiezaVehiculo()
  const removeMut    = useRemovePiezaVehiculo()
  const addTipoMut   = useAddTiposPiezaVehiculo()
  const quitaTipoMut = useRemoveTipoPiezaVehiculo()
  const renameMut    = useRenameEtiquetaVehiculo()

  const [nuevoTipo, setNuevoTipo] = useState<string | null>(null)
  const [nuevaEtiqueta, setNuevaEtiqueta] = useState('')
  const [cambio, setCambio] = useState<CambioPendiente | null>(null)

  // Memoizado porque el `?? []` daría un arreglo nuevo en cada render y con él
  // se recalcularían los useMemo que dependen de la lista.
  const filas  = useMemo(() => data?.data ?? [], [data])
  const piezas = piezasData?.data ?? []

  // Solo se ofrecen refacciones marcadas con ese tipo en el catálogo: el backend
  // rechaza cualquier otra.
  function opcionesDeTipo(tipoId: number) {
    return piezas
      .filter((p) => p.tipo_pieza_id === tipoId)
      .map((p) => ({ value: String(p.id), label: `${p.numero_serie} · ${p.descripcion}` }))
  }

  // Ningún tipo se filtra: la unidad puede necesitar dos piezas del mismo tipo
  // mientras cada renglón lleve etiqueta distinta, incluso si su modelo ya lo
  // pide. Lo que ya está se marca en la opción para no repetir una etiqueta.
  const tipoOptions = useMemo(() => {
    return (tiposData?.data ?? []).map((t) => {
      const puestos = filas
        .filter((f) => f.tipo_pieza_id === t.id)
        .map((f) => f.etiqueta || 'sin etiqueta')
      return {
        value: String(t.id),
        label: puestos.length ? `${t.nombre} — ya: ${puestos.join(', ')}` : t.nombre,
      }
    })
  }, [tiposData, filas])

  // Repetir un tipo exige etiqueta nueva: sin ella el backend rechaza el alta.
  const choque = useMemo(() => {
    if (!nuevoTipo) return null
    const et = nuevaEtiqueta.trim()
    const ya = filas.find((f) => String(f.tipo_pieza_id) === nuevoTipo && f.etiqueta === et)
    if (!ya) return null
    return et === ''
      ? `Este vehículo ya necesita ${ya.tipo_nombre}. Ponle una etiqueta para agregarlo otra vez.`
      : `Este vehículo ya necesita ${ya.tipo_nombre} con la etiqueta "${et}".`
  }, [filas, nuevoTipo, nuevaEtiqueta])

  // No guarda todavía: abre el modal para capturar el lote y, si había pieza,
  // el motivo con que sale la anterior.
  function handleChange(fila: PiezaDeVehiculo, value: string | null) {
    const saliente = fila.pieza_id != null
      ? `${fila.numero_serie ?? ''} ${fila.descripcion ?? ''}`.trim()
      : null
    setCambio({
      modo: value == null ? 'retiro' : saliente ? 'reemplazo' : 'montaje',
      tipoId:          fila.tipo_pieza_id,
      etiqueta:        fila.etiqueta,
      tipoNombre:      nombreDeFila(fila),
      piezaEntranteId: value != null ? Number(value) : null,
      salienteNombre:  saliente,
    })
  }

  function confirmarCambio(datos: DatosMontaje & DatosRetiro) {
    if (!cambio) return
    const listo = { onSuccess: () => setCambio(null) }
    const renglon = { vehiculoId, tipoId: cambio.tipoId, etiqueta: cambio.etiqueta }
    if (cambio.piezaEntranteId != null) {
      setMut.mutate({ ...renglon, piezaId: cambio.piezaEntranteId, datos }, listo)
    } else {
      removeMut.mutate({ ...renglon, datos }, listo)
    }
  }

  function cerrarModal() {
    setCambio(null)
    setMut.reset()
    removeMut.reset()
  }

  function handleAgregarTipo() {
    if (!nuevoTipo || choque) return
    addTipoMut.mutate(
      { vehiculoId, tipoIds: [Number(nuevoTipo)], etiqueta: nuevaEtiqueta.trim() },
      { onSuccess: () => { setNuevoTipo(null); setNuevaEtiqueta('') } }
    )
  }

  const sinCapturar = filas.filter((f) => f.pieza_id == null).length

  return (
    <>
      <Divider
        label={<Text size="sm" fw={500}>Piezas de este vehículo ({filas.length})</Text>}
        labelPosition="left"
      />
      <Text size="xs" c="dimmed">
        Qué refacción usa esta unidad para cada pieza que necesita. Los renglones del modelo se
        gestionan desde el modelo; aquí puedes agregar los que solo requiera esta unidad, incluso
        otro del mismo tipo: dale una etiqueta distinta (delantero / trasero) y cada uno lleva su
        refacción, su lote y su historial por separado. Al cambiar una pieza
        se registra en el historial de qué lote salió y por qué se retiró la anterior. Elegir el lote
        no descuenta existencias: eso sigue haciéndose al capturar el mantenimiento.
      </Text>
      {setMut.error       && <Alert color="red">{(setMut.error as Error).message}</Alert>}
      {removeMut.error    && <Alert color="red">{(removeMut.error as Error).message}</Alert>}
      {addTipoMut.error   && <Alert color="red">{(addTipoMut.error as Error).message}</Alert>}
      {quitaTipoMut.error && <Alert color="red">{(quitaTipoMut.error as Error).message}</Alert>}
      {renameMut.error    && <Alert color="red">{(renameMut.error    as Error).message}</Alert>}

      <Group gap="xs" align="flex-end">
        <Select
          size="xs"
          style={{ flex: 1 }}
          searchable
          placeholder="Agrega una pieza que solo necesita este vehículo"
          data={tipoOptions}
          value={nuevoTipo}
          onChange={setNuevoTipo}
          disabled={addTipoMut.isPending}
          nothingFoundMessage="No hay más tipos en el catálogo"
        />
        <TextInput
          size="xs"
          w={180}
          placeholder="Etiqueta (opcional)"
          value={nuevaEtiqueta}
          onChange={(e) => setNuevaEtiqueta(limpiarTextoSimple(e.currentTarget.value, 40))}
          disabled={addTipoMut.isPending}
        />
        <Button
          size="xs"
          variant="light"
          leftSection={<IconPlus size={14} />}
          disabled={!nuevoTipo || choque !== null}
          loading={addTipoMut.isPending}
          onClick={handleAgregarTipo}
        >
          Agregar
        </Button>
      </Group>
      {choque && <Alert color="yellow" variant="light">{choque}</Alert>}

      {isLoading ? (
        <Center py="md"><Loader size="sm" /></Center>
      ) : filas.length === 0 ? (
        <Text c="dimmed" size="sm" py="sm">
          Este vehículo no necesita ningún tipo de pieza todavía: su modelo no tiene tipos registrados
          y no le has agregado ninguno propio.
        </Text>
      ) : (
        <>
          {sinCapturar > 0 && (
            <Text size="xs" c="dimmed">
              {sinCapturar} pieza(s) sin refacción asignada.
            </Text>
          )}
          <Table.ScrollContainer minWidth={800}>
            <Table striped withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th style={{ width: '24%' }}>Pieza que necesita</Table.Th>
                  <Table.Th style={{ width: 170 }}>Etiqueta</Table.Th>
                  <Table.Th>Refacción que usa</Table.Th>
                  <Table.Th style={{ width: 130 }}>Montada desde</Table.Th>
                  <Table.Th style={{ width: 40 }} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {/* La clave es el renglón (tipo + etiqueta), no el tipo: la unidad
                    puede llevar dos piezas del mismo tipo en renglones distintos. */}
                {filas.map((f) => {
                  const opciones = opcionesDeTipo(f.tipo_pieza_id)
                  const propio   = f.origen === 'vehiculo'
                  const esteRenglon = (v?: { tipoId: number; etiqueta?: string }) =>
                    v?.tipoId === f.tipo_pieza_id && (v?.etiqueta ?? '') === f.etiqueta
                  const pendiente =
                    (setMut.isPending    && esteRenglon(setMut.variables)) ||
                    (removeMut.isPending && esteRenglon(removeMut.variables))
                  return (
                    <Table.Tr key={`${f.tipo_pieza_id}|${f.etiqueta}`}>
                      <Table.Td>
                        <Group gap={6} wrap="nowrap">
                          <Text size="sm" fw={500}>{f.tipo_nombre}</Text>
                          {propio && (
                            <Badge size="xs" variant="light" color="teal">Solo este vehículo</Badge>
                          )}
                        </Group>
                      </Table.Td>
                      <Table.Td>
                        {/* Los renglones del modelo se renombran desde el modelo:
                            hacerlo aquí sacaría a esta unidad de la plantilla que
                            comparte con las demás del mismo modelo. */}
                        <EtiquetaEditable
                          etiqueta={f.etiqueta}
                          motivoBloqueo={propio ? undefined : 'La etiqueta de un renglón del modelo se cambia desde el modelo'}
                          isPending={renameMut.isPending && esteRenglon(renameMut.variables)}
                          onGuardar={(etiquetaNueva) => renameMut.mutate({
                            vehiculoId, tipoId: f.tipo_pieza_id, etiqueta: f.etiqueta, etiquetaNueva,
                          })}
                        />
                      </Table.Td>
                      <Table.Td>
                        <Select
                          size="xs"
                          searchable clearable
                          disabled={pendiente}
                          placeholder={
                            opciones.length
                              ? 'Selecciona la refacción'
                              : 'Sin refacciones de este tipo en el catálogo'
                          }
                          data={opciones}
                          value={f.pieza_id != null ? String(f.pieza_id) : null}
                          onChange={(v) => handleChange(f, v)}
                          nothingFoundMessage="Marca refacciones con este tipo desde el catálogo"
                        />
                      </Table.Td>
                      <Table.Td>
                        {f.pieza_id == null ? null : f.fecha_instalacion == null ? (
                          // Las piezas que ya estaban asignadas cuando se
                          // empezó a llevar el historial no tienen fecha, y
                          // ya no hay de dónde sacarla.
                          <Text size="xs" c="dimmed">Sin registrar</Text>
                        ) : (
                          <>
                            <Text size="xs">{formatearFecha(f.fecha_instalacion)}</Text>
                            {f.km_instalacion != null && (
                              <Text size="xs" c="dimmed">
                                {f.km_instalacion.toLocaleString('es-MX')} km
                              </Text>
                            )}
                          </>
                        )}
                      </Table.Td>
                      <Table.Td>
                        {/* Los tipos del modelo se quitan desde el modelo: hacerlo
                            aquí afectaría a toda la flota de ese modelo. */}
                        {propio && (
                          <ActionIcon
                            variant="subtle"
                            color="red"
                            aria-label={`Quitar ${nombreDeFila(f)} de este vehículo`}
                            loading={
                              quitaTipoMut.isPending &&
                              esteRenglon(quitaTipoMut.variables)
                            }
                            onClick={() => quitaTipoMut.mutate({
                              vehiculoId, tipoId: f.tipo_pieza_id, etiqueta: f.etiqueta,
                            })}
                          >
                            <IconTrash size={14} />
                          </ActionIcon>
                        )}
                      </Table.Td>
                    </Table.Tr>
                  )
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </>
      )}

      <HistorialPiezasSection vehiculoId={vehiculoId} />

      {/* Se monta de cero en cada cambio: así el modal nace con los campos
          limpios sin necesitar un efecto que los resetee. */}
      {cambio && (
      <MontajePiezaModal
        key={`${cambio.tipoId}|${cambio.etiqueta}-${cambio.piezaEntranteId ?? 'quitar'}`}
        opened
        modo={cambio.modo}
        vehiculoId={vehiculoId}
        tipoPiezaId={cambio.tipoId}
        etiqueta={cambio.etiqueta}
        tipoNombre={cambio.tipoNombre}
        piezaEntranteId={cambio.piezaEntranteId}
        piezaSalienteNombre={cambio.salienteNombre}
        kmVehiculo={kmVehiculo}
        isPending={setMut.isPending || removeMut.isPending}
        error={
          (setMut.error as Error | null)?.message ??
          (removeMut.error as Error | null)?.message ??
          null
        }
        onConfirm={confirmarCambio}
        onClose={cerrarModal}
      />
      )}
    </>
  )
}

const ETIQUETA_MOTIVO: Record<string, string> = {
  desgaste: 'Desgaste', falla: 'Falla', garantia: 'Garantía',
  preventivo: 'Preventivo', siniestro: 'Siniestro', robo: 'Robo',
}

const ETIQUETA_DESTINO: Record<string, string> = {
  desecho: 'Desecho', reacondicionar: 'A reacondicionar',
  devolucion_proveedor: 'Devolución a proveedor', venta: 'Venta', stock: 'A almacén',
}

// Todo lo que la unidad ha traído montado, no solo lo vigente. Se carga
// plegado: son datos de consulta ocasional (una garantía, un lote sospechoso) y
// no vale la pena pagarlos en cada apertura del detalle.
function HistorialPiezasSection({ vehiculoId }: { vehiculoId: number }) {
  const [abierto, setAbierto] = useState(false)
  const { data, isLoading } = useHistorialPiezas(vehiculoId, abierto)

  const filas = data?.data ?? []

  return (
    <>
      <Group justify="space-between" align="center" mt="xs">
        <Text size="sm" fw={500}>Historial de piezas</Text>
        <Button size="xs" variant="subtle" onClick={() => setAbierto((v) => !v)}>
          {abierto ? 'Ocultar' : 'Ver historial'}
        </Button>
      </Group>

      {abierto && (
        isLoading ? (
          <Center py="md"><Loader size="sm" /></Center>
        ) : filas.length === 0 ? (
          <Text c="dimmed" size="sm" py="sm">
            Todavía no hay movimientos registrados para esta unidad.
          </Text>
        ) : (
          <Table.ScrollContainer minWidth={760}>
            <Table striped withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Tipo</Table.Th>
                  <Table.Th>Refacción</Table.Th>
                  <Table.Th>Compra</Table.Th>
                  <Table.Th>Montada</Table.Th>
                  <Table.Th>Retirada</Table.Th>
                  <Table.Th>Duró</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {filas.map((h) => {
                  const vigente = h.fecha_retiro == null
                  // Solo cuando se capturaron los dos kilometrajes; si falta uno
                  // la resta daría un número inventado.
                  const duracion =
                    h.km_instalacion != null && h.km_retiro != null
                      ? `${(h.km_retiro - h.km_instalacion).toLocaleString('es-MX')} km`
                      : '—'
                  return (
                    <Table.Tr key={h.id}>
                      <Table.Td>
                        <Text size="sm">{h.tipo_nombre}</Text>
                        {/* Sin la etiqueta, dos filtros de aire dan renglones
                            idénticos y no se sabe cuál se cambió. */}
                        {h.etiqueta && <Text size="xs" c="dimmed">{h.etiqueta}</Text>}
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">{h.numero_serie}</Text>
                        <Text size="xs" c="dimmed">{h.descripcion}</Text>
                      </Table.Td>
                      <Table.Td>
                        {h.lote_id == null ? (
                          <Text size="xs" c="dimmed">Sin lote</Text>
                        ) : (
                          <>
                            <Text size="xs">{h.proveedor ?? '—'}</Text>
                            <Text size="xs" c="dimmed">
                              {h.num_factura ? `Fact. ${h.num_factura}` : 'Sin factura'}
                            </Text>
                          </>
                        )}
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs">
                          {h.fecha_instalacion ? formatearFecha(h.fecha_instalacion) : 'Sin fecha'}
                        </Text>
                        {h.km_instalacion != null && (
                          <Text size="xs" c="dimmed">{h.km_instalacion.toLocaleString('es-MX')} km</Text>
                        )}
                      </Table.Td>
                      <Table.Td>
                        {vigente ? (
                          <Badge size="xs" variant="light" color="green">Montada</Badge>
                        ) : (
                          <>
                            <Text size="xs">{formatearFecha(h.fecha_retiro!)}</Text>
                            <Text size="xs" c="dimmed">
                              {[h.motivo_retiro && ETIQUETA_MOTIVO[h.motivo_retiro],
                                h.destino && ETIQUETA_DESTINO[h.destino]]
                                .filter(Boolean).join(' · ') || 'Sin motivo'}
                            </Text>
                          </>
                        )}
                      </Table.Td>
                      <Table.Td><Text size="xs">{vigente ? '—' : duracion}</Text></Table.Td>
                    </Table.Tr>
                  )
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )
      )}
    </>
  )
}

function VehiculoDetalle({
  vehiculo, onBack, backLabel, onEdit, onDelete, onVehiculoUpdate, onNavigateModelo,
}: {
  vehiculo: VehiculoRow
  onBack: () => void
  // Etiqueta de la sección de origen (p. ej. "Dashboard"). Si viene, el botón de
  // regreso vuelve ahí; si no, regresa a la lista de vehículos.
  backLabel?: string
  onEdit: (v: VehiculoRow) => void
  onDelete: (v: VehiculoRow) => void
  onVehiculoUpdate: (v: VehiculoRow) => void
  onNavigateModelo?: (modeloId: number) => void
}) {
  const ti = tipoInfo(vehiculo.tipo)

  const { data: mantData } = useMantenimientos(vehiculo.id)
  // Las secciones de abajo ya piden estas tres listas; React Query las comparte
  // por clave, asi que pedirlas aqui para el expediente no agrega peticiones.
  const { data: incidData }   = useIncidenciasVehiculo(vehiculo.id)
  const { data: piezasData }  = usePiezasVehiculo(vehiculo.id)
  const { data: recargasData } = useRecargas(vehiculo.id)
  // Misma clave que usa la sección de garantías de abajo: React Query la
  // comparte, así que pedirla aquí para el expediente no agrega una petición.
  const { data: garantiasData } = useGarantiasVehiculo(vehiculo.id)
  // Misma clave que usa la sección del programa de abajo: React Query la
  // comparte, así que pedirla aquí para el expediente no agrega una petición.
  const { data: programaData } = useProgramaVehiculo(vehiculo.id)
  const [generando, setGenerando] = useState<'pdf' | 'excel' | null>(null)
  const [expedienteAbierto, setExpedienteAbierto] = useState(false)

  const updateKmMut = useUpdateVehiculo()
  const [editingKm, setEditingKm] = useState(false)
  const [kmDraft, setKmDraft]     = useState<number | ''>(vehiculo.kilometraje ?? '')

  function startEditKm() {
    setKmDraft(vehiculo.kilometraje ?? '')
    setEditingKm(true)
  }

  function saveKm() {
    if (kmDraft === '' || Number(kmDraft) === vehiculo.kilometraje) { setEditingKm(false); return }
    updateKmMut.mutate({ id: vehiculo.id, payload: { kilometraje: Number(kmDraft) } }, {
      onSuccess: (res) => { setEditingKm(false); onVehiculoUpdate(res.data) },
      onError:   () => setEditingKm(false),
    })
  }

  // El expediente sale con lo que ya esta en pantalla: si algo sigue cargando,
  // esa seccion sale vacia en vez de bloquear el boton.
  //
  // El periodo acota solo lo que tiene fecha de ocurrencia —mantenimientos,
  // incidencias y cargas—; el programa, las garantías, las piezas montadas y los
  // datos de la unidad son el estado de hoy y no se filtran: recortarlos daria un
  // expediente que dice que la unidad no tiene refacciones montadas.
  async function generarExpediente(formato: 'pdf' | 'excel', periodo: Periodo = PERIODO_DEFAULT) {
    setGenerando(formato)
    try {
      const datos = {
        vehiculo,
        mantenimientos: (mantData?.data ?? []).filter((m) => dentroDelPeriodo(m.fecha, periodo)),
        incidencias:    (incidData?.data ?? []).filter((i) => dentroDelPeriodo(i.fecha, periodo)),
        piezas:         piezasData?.data ?? [],
        recargas:       (recargasData?.data ?? []).filter((r) => dentroDelPeriodo(r.fecha, periodo)),
        // Sin filtrar por periodo, como los demás datos de estado: una garantía
        // que arrancó antes del periodo sigue siendo la que cubre la unidad hoy.
        garantias:      garantiasData?.data ?? [],
        // Tampoco se filtra: en qué punto del programa va la unidad es su
        // estado de hoy, no algo que ocurriera dentro del periodo.
        programa:       programaData?.data ?? null,
        periodo,
      }
      await (formato === 'pdf' ? exportVehiculoPdf : exportVehiculoExcel)(datos)
    } finally {
      setGenerando(null)
    }
  }

  // Los avisos de arriba de la ficha. Salen del programa, que es lo único que
  // se vence: la visita completa por kilometraje y, aparte, cada operación por
  // su propio límite de meses. El detalle de qué es cada cosa vive en la sección
  // del programa; aquí solo se cuenta, para que quien abre la ficha lo vea sin
  // tener que bajar.
  const { vencidos, porVencer } = useMemo(() => {
    const pr = programaData?.data
    if (!pr) return { vencidos: 0, porVencer: 0 }
    const tiempo = pr.operaciones_tiempo
    return {
      vencidos:
        (pr.proxima?.vencida ? 1 : 0) + tiempo.filter((o) => o.vencida).length,
      porVencer:
        (pr.proxima && !pr.proxima.vencida && pr.proxima.por_vencer ? 1 : 0) +
        tiempo.filter((o) => !o.vencida && o.por_vencer).length,
    }
  }, [programaData])

  return (
    <Stack gap="md">
      {/* Navegación */}
      <Group gap="xs">
        <Tooltip label={backLabel ? `Regresar a ${backLabel}` : 'Regresar a Vehículos'}>
          <ActionIcon variant="subtle" color="gray" onClick={onBack}>
            <IconArrowLeft size={18} />
          </ActionIcon>
        </Tooltip>
        <Text size="sm" c="dimmed" style={{ cursor: 'pointer' }} onClick={onBack}>
          {backLabel ?? 'Vehículos'}
        </Text>
        <Text size="sm" c="dimmed">/</Text>
        <Text size="sm">{vehiculoLabel(vehiculo)}</Text>
      </Group>

      {vencidos > 0 && (
        <Alert color="red" title="Mantenimiento requerido" icon={<IconAlertTriangle size={16} />}>
          Esta unidad trae{' '}
          <strong>{vencidos} {vencidos !== 1 ? 'servicios vencidos' : 'servicio vencido'}</strong>{' '}
          de su programa de mantenimiento.
        </Alert>
      )}
      {porVencer > 0 && (
        <Alert color="yellow" title="Próximo a vencer" icon={<IconAlertTriangle size={16} />}>
          <strong>{porVencer} {porVencer !== 1 ? 'servicios están próximos' : 'servicio está próximo'}</strong>{' '}
          a vencer.
        </Alert>
      )}
      {/* Documentos faltantes, tal como los resuelve la API: ya vienen filtrados
          por tipo (una caja no lleva seguro) y sin las unidades dadas de baja,
          a las que ya no se les va a capturar nada. */}
      {vehiculo.alertas.map((a) => (
        <Alert key={a} color={AVISO_DOCUMENTO[a].color} title={AVISO_DOCUMENTO[a].titulo}
               icon={<IconAlertTriangle size={16} />}>
          {AVISO_DOCUMENTO[a].detalle}
        </Alert>
      ))}

      {/* Ficha */}
      <Paper withBorder p="md" radius="md">
        <Group justify="space-between" align="flex-start">
          <Stack gap={6}>
            <Group gap="sm" align="center">
              <Text size="xl" fw={700}>{vehiculoLabel(vehiculo)}</Text>
              <Badge color={ti.color} variant="light" size="lg">{ti.label}</Badge>
              {vehiculo.status && (
                <Badge color={statusColor(vehiculo.status)} variant="filled" size="sm">
                  {vehiculo.status}
                </Badge>
              )}
            </Group>
            <Grid mt={4} gap="md">
              <Grid.Col span={{ base: 6, sm: 3 }}>
                <InfoItem label="Marca / Modelo" value={`${vehiculo.marca} ${vehiculo.modelo}`} />
              </Grid.Col>
              <Grid.Col span={{ base: 6, sm: 3 }}>
                <InfoItem label="Año del modelo" value={vehiculo.modelo_anio} />
              </Grid.Col>
              {edadModelo(vehiculo.modelo_anio) && (
                <Grid.Col span={{ base: 6, sm: 3 }}>
                  <InfoItem label="Edad del modelo" value={edadModelo(vehiculo.modelo_anio)} />
                </Grid.Col>
              )}
              <Grid.Col span={{ base: 6, sm: 3 }}>
                <InfoItem label="Serie" value={vehiculo.serie} />
              </Grid.Col>
              {vehiculo.tipo !== 'montacargas' && (
                <Grid.Col span={{ base: 6, sm: 3 }}>
                  <InfoItem label="Placas" value={vehiculo.placas} />
                </Grid.Col>
              )}
              {/* Cómo se le dice a la unidad en el patio. Es informativa: no
                  cambia ninguna regla, a diferencia del tipo. */}
              {vehiculo.categoria && (
                <Grid.Col span={{ base: 6, sm: 3 }}>
                  <InfoItem label="Categoría" value={vehiculo.categoria} />
                </Grid.Col>
              )}
              {/* Una caja de trailer no se asegura y solo reparto y utilitarios
                  tramitan permiso: donde no aplica, el dato no se muestra en
                  blanco (parecía un pendiente por capturar). */}
              {llevaSeguro(vehiculo.tipo) && (
                <Grid.Col span={{ base: 6, sm: 3 }}>
                  <InfoItem
                    label="Seguro"
                    value={vehiculo.seguro_id !== null
                      ? `${vehiculo.seguro_poliza} — ${vehiculo.seguro_compania}`
                      : null}
                  />
                </Grid.Col>
              )}
              {llevaPermiso(vehiculo.tipo) && (
                <Grid.Col span={{ base: 6, sm: 3 }}>
                  <InfoItem
                    label="Permiso de circulación"
                    value={vehiculo.permiso_id !== null
                      ? `${vehiculo.permiso_zona} (expira ${vehiculo.permiso_expiracion})`
                      : null}
                  />
                </Grid.Col>
              )}
              {vehiculo.kilometraje !== null && (
                <Grid.Col span={{ base: 6, sm: 3 }}>
                  {editingKm ? (
                    <NumberInput
                      label="Kilometraje" size="xs" autoFocus min={0} max={KM_MAX}
                      suffix=" km" thousandSeparator="," clampBehavior="strict"
                      value={kmDraft}
                      onChange={(v) => setKmDraft(v as number | '')}
                      onBlur={saveKm}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter')  { e.preventDefault(); saveKm() }
                        if (e.key === 'Escape') setEditingKm(false)
                      }}
                    />
                  ) : (
                    <Tooltip label="Doble clic para editar" openDelay={400}>
                      <div onDoubleClick={startEditKm} style={{ cursor: 'pointer' }}>
                        <InfoItem label="Kilometraje" value={`${vehiculo.kilometraje.toLocaleString('es-MX')} km`} />
                      </div>
                    </Tooltip>
                  )}
                </Grid.Col>
              )}
              {vehiculo.combustible && (
                <Grid.Col span={{ base: 6, sm: 3 }}>
                  <InfoItem label="Combustible" value={vehiculo.combustible} />
                </Grid.Col>
              )}
              {(vehiculo.tipo === 'camion' || vehiculo.tipo === 'montacargas') && vehiculo.sucursal && (
                <Grid.Col span={{ base: 6, sm: 3 }}>
                  <InfoItem label="Sucursal" value={vehiculo.sucursal} />
                </Grid.Col>
              )}
              {vehiculo.tipo === 'tractocamion' && (
                <>
                  {vehiculo.ruta && (
                    <Grid.Col span={{ base: 6, sm: 3 }}>
                      <InfoItem label="Translado" value={vehiculo.ruta} />
                    </Grid.Col>
                  )}
                  {vehiculo.tonelaje !== null && (
                    <Grid.Col span={{ base: 6, sm: 3 }}>
                      <InfoItem label="Tonelaje" value={`${vehiculo.tonelaje} ton`} />
                    </Grid.Col>
                  )}
                </>
              )}
              {/* Tenencia: fuera del bloque del tractocamión, que era donde
                  vivía cuando se creía que él la llevaba. La pagan las unidades
                  de reparto y las utilitarias, y solo tiene fecha. */}
              {vehiculo.tenencia_expiracion && (
                <Grid.Col span={{ base: 6, sm: 3 }}>
                  <InfoItem label="Tenencia expira" value={fmtShort(vehiculo.tenencia_expiracion)} />
                </Grid.Col>
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
              {vehiculo.fecha_compra && (
                <Grid.Col span={{ base: 6, sm: 3 }}>
                  <InfoItem
                    label="Fecha de compra"
                    value={new Date(vehiculo.fecha_compra).toLocaleDateString('es-MX', {
                      day: '2-digit', month: 'short', year: 'numeric',
                    })}
                  />
                </Grid.Col>
              )}
              {antiguedad(vehiculo.fecha_compra) && (
                <Grid.Col span={{ base: 6, sm: 3 }}>
                  <InfoItem label="Antigüedad en flota" value={antiguedad(vehiculo.fecha_compra)} />
                </Grid.Col>
              )}
            </Grid>
          </Stack>
          <Group gap="xs" wrap="nowrap">
            {/* El expediente completo de la unidad: todo lo que esta en esta
                pantalla mas el consumo y el costo por kilometro, que es lo que
                se necesita para decidir si conviene seguir reparandola. */}
            <Button
              variant="light" size="xs"
              leftSection={<IconReportAnalytics size={16} />}
              loading={generando !== null}
              onClick={() => setExpedienteAbierto(true)}
            >
              Expediente
            </Button>
            <ExpedienteVehiculoModal
              opened={expedienteAbierto}
              onClose={() => setExpedienteAbierto(false)}
              etiqueta={`${vehiculo.marca} ${vehiculo.modelo} — ${vehiculo.serie}`}
              onGenerar={generarExpediente}
            />
            <Tooltip label="Editar vehículo">
              <ActionIcon variant="light" color="blue" size="lg" onClick={() => onEdit(vehiculo)}>
                <IconPencil size={16} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Eliminar vehículo">
              <ActionIcon variant="light" color="red" size="lg"
                aria-label="Eliminar vehículo" onClick={() => onDelete(vehiculo)}>
                <IconTrash size={16} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>
      </Paper>

      {/* Refacción que usa esta unidad por cada tipo que pide su modelo */}
      <PiezasVehiculoSection vehiculoId={vehiculo.id} kmVehiculo={vehiculo.kilometraje} />

      {/* Garantías: van antes del programa porque son su explicación. El
          programa del fabricante existe para no perder la principal, y cuando
          esa se acaba la unidad pasa al de después de la garantía. */}
      <GarantiasVehiculoSection
        vehiculoId={vehiculo.id}
        fechaCompra={vehiculo.fecha_compra?.split('T')[0] ?? null}
        soportaKm={!sinKilometraje(vehiculo.tipo)}
      />

      {/* El programa de mantenimiento: lo que manda el manual mientras haya
          garantía, y lo que se acordó para después. */}
      <ProgramaVehiculoSection
        vehiculoId={vehiculo.id}
        modeloId={vehiculo.modelo_id}
        kilometraje={vehiculo.kilometraje}
        tipoVehiculo={vehiculo.tipo}
        onNavigateModelo={onNavigateModelo}
      />

      {/* Incidencias reportadas */}
      <IncidenciasSection vehiculoId={vehiculo.id} tipoVehiculo={vehiculo.tipo} />

      {/* Mantenimientos */}
      <MantenimientosSection vehiculoId={vehiculo.id} tipoVehiculo={vehiculo.tipo} />

      {/* Recargas de combustible */}
      <RecargasSection vehiculoId={vehiculo.id} kmVehiculo={vehiculo.kilometraje} />
    </Stack>
  )
}

// ── Tabla reutilizable de vehículos ────────────────────────────────────────────

function tipoOrden(t: TipoVehiculo): number {
  return TIPOS.findIndex((x) => x.value === t)
}

function compareVehiculos(a: VehiculoRow, b: VehiculoRow): number {
  const porTipo = tipoOrden(a.tipo) - tipoOrden(b.tipo)
  if (porTipo !== 0) return porTipo
  const porModelo = `${a.marca} ${a.modelo}`.localeCompare(`${b.marca} ${b.modelo}`, 'es-MX')
  if (porModelo !== 0) return porModelo
  return a.serie.localeCompare(b.serie, 'es-MX', { numeric: true })
}

interface KmEditProps {
  editingKmId:    number | null
  kmDraft:        number | ''
  setKmDraft:     (v: number | '') => void
  startEditKm:    (v: VehiculoRow, e: React.MouseEvent) => void
  saveKm:         (v: VehiculoRow) => void
  setEditingKmId: (id: number | null) => void
}

function VehiculosTable({
  items, showTipo = false, extraColumn, onSelect, onEdit, onDelete, km,
}: {
  items:        VehiculoRow[]
  showTipo?:    boolean
  extraColumn?: { header: string; render: (v: VehiculoRow) => string | null }
  onSelect:     (v: VehiculoRow) => void
  onEdit:       (v: VehiculoRow, e?: React.MouseEvent) => void
  onDelete:     (v: VehiculoRow, e: React.MouseEvent) => void
  km:           KmEditProps
}) {
  if (items.length === 0) {
    return <Text c="dimmed" size="sm" py="sm">Sin vehículos en este grupo.</Text>
  }
  const sorted = [...items].sort(compareVehiculos)
  return (
    <Table.ScrollContainer minWidth={showTipo ? 780 : 730}>
      <Table striped highlightOnHover withTableBorder>
        <Table.Thead>
          <Table.Tr>
            {showTipo && <Table.Th style={{ width: 60 }}>Tipo</Table.Th>}
            <Table.Th>Marca / Modelo</Table.Th>
            <Table.Th style={{ width: 90 }}>Año</Table.Th>
            <Table.Th>Serie</Table.Th>
            <Table.Th>Placas</Table.Th>
            {extraColumn && <Table.Th>{extraColumn.header}</Table.Th>}
            <Table.Th style={{ textAlign: 'center' }}>Status</Table.Th>
            <Table.Th style={{ textAlign: 'right', width: 140 }}>Kilometraje</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {sorted.map((v) => {
            const ti = tipoInfo(v.tipo)
            return (
              <Table.Tr key={v.id} onClick={() => onSelect(v)} style={{ cursor: 'pointer' }}>
                {showTipo && (
                  <Table.Td>
                    <Tooltip label={ti.label}>
                      <Badge color={ti.color} variant="light" size="sm">{ti.abrev}</Badge>
                    </Tooltip>
                  </Table.Td>
                )}
                <Table.Td fw={500}>
                  <Group gap={6} wrap="nowrap">
                    <span>{v.marca} {v.modelo}</span>
                    {v.alertas.map((a) => (
                      <Tooltip key={a} label={AVISO_DOCUMENTO[a].tooltip}>
                        <IconAlertTriangle size={16} color={AVISO_DOCUMENTO[a].iconColor} />
                      </Tooltip>
                    ))}
                  </Group>
                  {/* Debajo y en gris: es cómo se le dice a la unidad en el
                      patio, no parte de su nombre. Sin columna propia para no
                      volver a ensanchar la tabla. */}
                  {v.categoria && (
                    <Text size="xs" c="dimmed" fw={400}>{v.categoria}</Text>
                  )}
                </Table.Td>
                {/* El año trae la versión pegada cuando el modelo la tiene ("2018-1"). */}
                <Table.Td>{v.modelo_anio ?? <Text component="span" c="dimmed" size="sm">—</Text>}</Table.Td>
                <Table.Td>{v.serie}</Table.Td>
                <Table.Td>{v.placas ?? (v.tipo === 'montacargas' ? '' : <Text component="span" c="dimmed" size="sm">—</Text>)}</Table.Td>
                {extraColumn && (
                  <Table.Td>{extraColumn.render(v) ?? <Text component="span" c="dimmed" size="sm">—</Text>}</Table.Td>
                )}
                <Table.Td style={{ textAlign: 'center' }}>
                  {v.status
                    ? <Badge color={statusColor(v.status)} variant="light" size="sm">{v.status}</Badge>
                    : <Text c="dimmed" size="sm">—</Text>}
                </Table.Td>
                <Table.Td
                  style={{ textAlign: 'right', width: 140 }}
                  onClick={sinKilometraje(v.tipo) ? undefined : (e) => e.stopPropagation()}
                  onDoubleClick={sinKilometraje(v.tipo) ? undefined : (e) => km.startEditKm(v, e)}
                >
                  {km.editingKmId === v.id ? (
                    <NumberInput
                      autoFocus size="xs" min={0} max={KM_MAX} thousandSeparator="," hideControls
                      clampBehavior="strict"
                      value={km.kmDraft}
                      onChange={(val) => km.setKmDraft(val as number | '')}
                      onBlur={() => km.saveKm(v)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter')  { e.preventDefault(); km.saveKm(v) }
                        if (e.key === 'Escape') km.setEditingKmId(null)
                      }}
                      styles={{ input: { textAlign: 'right' } }}
                    />
                  ) : sinKilometraje(v.tipo) ? null : (
                    <Tooltip label="Doble clic para editar" openDelay={400}>
                      <span>
                        {v.kilometraje !== null
                          ? `${v.kilometraje.toLocaleString('es-MX')} km`
                          : <Text component="span" c="dimmed" size="sm">—</Text>}
                      </span>
                    </Tooltip>
                  )}
                </Table.Td>
                <Table.Td>
                  <Group gap={4} justify="flex-end" wrap="nowrap">
                    <Tooltip label="Editar">
                      <ActionIcon variant="subtle" color="blue" size="sm" onClick={(e) => onEdit(v, e)}>
                        <IconPencil size={14} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label="Eliminar">
                      <ActionIcon variant="subtle" color="red" size="sm" onClick={(e) => onDelete(v, e)}>
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
  )
}

// ── Vista agrupada (Rutas / Sucursales / Unitarios) ────────────────────────────

// Encabezado de cada grupo del acordeón: nombre del grupo + conteo de vehículos.
// Vive a nivel de módulo para no recrearse en cada render del acordeón.
function GroupHeader({ label, count }: { label: string; count: number }) {
  return (
    <Group justify="space-between" pr="md" wrap="nowrap">
      <Text fw={600}>{label}</Text>
      <Badge variant="light" color="gray">{count}</Badge>
    </Group>
  )
}

function VehiculosAgrupados({
  vehiculos, sucursales, onSelect, onEdit, onDelete, km,
}: {
  vehiculos:  VehiculoRow[]
  sucursales: Sucursal[]
  onSelect:   (v: VehiculoRow) => void
  onEdit:     (v: VehiculoRow, e?: React.MouseEvent) => void
  onDelete:   (v: VehiculoRow, e: React.MouseEvent) => void
  km:         KmEditProps
}) {
  const rutas       = vehiculos.filter(v => v.tipo === 'tractocamion' || v.tipo === 'caja_trailer')
  const conSucursal = vehiculos.filter(v => v.tipo === 'camion' || v.tipo === 'montacargas')
  const unitarios   = vehiculos.filter(v => v.tipo === 'utilitario')
  const porSucursal = sucursales.map(s => ({ sucursal: s, items: conSucursal.filter(v => v.sucursal_id === s.id) }))
  const sinSucursal = conSucursal.filter(v => !sucursales.some(s => s.id === v.sucursal_id))

  const defaultOpen = [
    'rutas',
    ...porSucursal.map(({ sucursal }) => `suc-${sucursal.id}`),
    ...(sinSucursal.length ? ['sin-sucursal'] : []),
    'unitarios',
  ]

  return (
    <Accordion key={sucursales.map(s => s.id).join(',')} multiple defaultValue={defaultOpen} variant="separated">
      <Accordion.Item value="rutas">
        <Accordion.Control><GroupHeader label="Translados" count={rutas.length} /></Accordion.Control>
        <Accordion.Panel>
          <VehiculosTable
            items={rutas} showTipo
            extraColumn={{ header: 'Translado', render: v => v.ruta }}
            onSelect={onSelect} onEdit={onEdit} onDelete={onDelete} km={km}
          />
        </Accordion.Panel>
      </Accordion.Item>

      {porSucursal.map(({ sucursal, items }) => (
        <Accordion.Item key={sucursal.id} value={`suc-${sucursal.id}`}>
          <Accordion.Control><GroupHeader label={sucursal.nombre} count={items.length} /></Accordion.Control>
          <Accordion.Panel>
            <VehiculosTable items={items} showTipo onSelect={onSelect} onEdit={onEdit} onDelete={onDelete} km={km} />
          </Accordion.Panel>
        </Accordion.Item>
      ))}

      {sinSucursal.length > 0 && (
        <Accordion.Item value="sin-sucursal">
          <Accordion.Control><GroupHeader label="Sin sucursal" count={sinSucursal.length} /></Accordion.Control>
          <Accordion.Panel>
            <VehiculosTable items={sinSucursal} showTipo onSelect={onSelect} onEdit={onEdit} onDelete={onDelete} km={km} />
          </Accordion.Panel>
        </Accordion.Item>
      )}

      <Accordion.Item value="unitarios">
        <Accordion.Control><GroupHeader label="Vehículos utilitarios" count={unitarios.length} /></Accordion.Control>
        <Accordion.Panel>
          <VehiculosTable
            items={unitarios}
            extraColumn={{ header: 'Ubicación', render: v => v.ubicacion }}
            onSelect={onSelect} onEdit={onEdit} onDelete={onDelete} km={km}
          />
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  )
}

// ── Lista de vehículos ────────────────────────────────────────────────────────

export default function Vehiculos({
  initialVehiculo, initialVehiculoId, onBack, backLabel, onNavigateModelo,
}: {
  initialVehiculo?:   VehiculoRow
  initialVehiculoId?: number
  // Cuando se llegó al detalle desde otra sección (Dashboard, Calendario,
  // Catálogos…), onBack regresa exactamente ahí y backLabel la nombra.
  onBack?:    () => void
  backLabel?: string
  /**
   * Salto a la ficha del modelo de la unidad. El programa de mantenimiento se
   * captura ahí y no aquí —es del modelo, no de la unidad—, así que desde el
   * vehículo solo se puede ir a hacerlo.
   */
  onNavigateModelo?: (modeloId: number) => void
}) {
  const [page, setPage]         = useState(1)
  const [search, setSearch]     = useState('')
  const [debouncedSearch]       = useDebouncedValue(search, 400)
  // Filtro por motivo de atención: convive con la búsqueda por texto y, como
  // ella, se resuelve en el servidor (la lista viene paginada, así que filtrar
  // en pantalla solo alcanzaría a la página visible).
  const [alerta, setAlerta]     = useState<AlertaVehiculo | null>(null)
  const [selected, setSelected] = useState<VehiculoRow | null>(initialVehiculo ?? null)
  // True mientras se muestra el vehículo con el que se entró desde otra sección;
  // se apaga en cuanto el usuario elige otro vehículo de la lista.
  const [externalEntry, setExternalEntry] = useState(!!(initialVehiculo || initialVehiculoId))
  // Con cualquiera de los dos activos se usa la lista paginada del servidor en
  // vez de la vista agrupada.
  const searching = debouncedSearch.length > 0 || alerta !== null

  // Elegir un vehículo de la lista: deja de ser una entrada externa, así que el
  // botón de regreso vuelve a la lista y ya no a la sección de origen.
  function selectFromList(v: VehiculoRow) {
    setExternalEntry(false)
    setSelected(v)
  }

  function handleDetailBack() {
    if (externalEntry && onBack) onBack()
    else setSelected(null)
  }

  const [pendingId]      = useState(initialVehiculo ? undefined : initialVehiculoId)
  const { data: pendingVehiculoData } = useVehiculo(pendingId)
  const appliedPendingId = useRef(false)

  useEffect(() => {
    if (pendingVehiculoData && !appliedPendingId.current) {
      appliedPendingId.current = true
      setSelected(pendingVehiculoData.data)
    }
  }, [pendingVehiculoData])

  // Se borró el vehículo con el que se entró desde otra sección. Sin esto, el
  // guard de abajo volvería a mostrar el loader esperando una ficha que ya no
  // existe. Se marca desde el manejador de la baja, no durante el render.
  const [pendingBorrado, setPendingBorrado] = useState(false)

  const [formOpen,   setFormOpen]   = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [editing,    setEditing]    = useState<VehiculoRow | null>(null)
  const [deleting,   setDeleting]   = useState<VehiculoRow | null>(null)
  const [formError,  setFormError]  = useState<string | null>(null)

  // Al cambiar la búsqueda se vuelve a la página 1. Se ajusta durante el
  // render (patrón recomendado por React) en vez de en un efecto, para no
  // disparar un render extra con la página vieja.
  const filtroActual = `${debouncedSearch}|${alerta ?? ''}`
  const [prevBusqueda, setPrevBusqueda] = useState(filtroActual)
  if (prevBusqueda !== filtroActual) {
    setPrevBusqueda(filtroActual)
    setPage(1)
  }

  const { data, isLoading, isError } =
    useVehiculos(page, debouncedSearch, undefined, undefined, undefined, searching, alerta ?? undefined)
  const totalPages = Math.ceil(
    (data?.pagination?.total ?? 0) / (data?.pagination?.pageSize ?? 20)
  )

  const { data: allData, isLoading: allLoading, isError: allError } =
    useVehiculos(1, '', undefined, undefined, 100, !searching)
  const { data: sucursalesData } = useSucursales()

  // Conteos de toda la flota (no de la página visible): salen de los mismos
  // endpoints que alimentan los avisos del tablero, así que ambas pantallas
  // cuentan lo mismo.
  const { data: documentosData }   = useDocumentosPorVencer()
  const { data: requerimientosData } = useRequerimientosVencidos()

  const sinTenencia = documentosData?.data.sin_tenencia.length ?? 0
  const sinSeguro   = documentosData?.data.sin_seguro.length   ?? 0
  // Un vehículo puede traer varios servicios vencidos; aquí se cuentan unidades,
  // no servicios.
  const conVencidos = new Set((requerimientosData?.data ?? []).map((r) => r.vehiculo_id)).size
  // Cada vehículo tiene un solo permiso, así que sumar los vehículos de cada
  // permiso por vencer no repite unidades.
  const conPermisoPorVencer = (documentosData?.data.permisos ?? [])
    .reduce((total, p) => total + p.vehiculos, 0)

  const todosLosAvisos: { alerta: AlertaVehiculo; total: number; texto: string; boton: string }[] = [
    { alerta: 'sin_tenencia', total: sinTenencia,
      texto: `${sinTenencia !== 1 ? 'no tienen' : 'no tiene'} tenencia registrada`,
      boton: 'Ver sin tenencia' },
    { alerta: 'sin_seguro', total: sinSeguro,
      texto: `${sinSeguro !== 1 ? 'no tienen' : 'no tiene'} seguro asignado`,
      boton: 'Ver sin seguro' },
    { alerta: 'programa_atrasado', total: conVencidos,
      texto: `${conVencidos !== 1 ? 'están atrasados' : 'está atrasado'} en su programa de mantenimiento`,
      boton: 'Ver atrasados' },
    { alerta: 'permiso_por_vencer', total: conPermisoPorVencer,
      texto: `${conPermisoPorVencer !== 1 ? 'traen' : 'trae'} el permiso de circulación vencido o por vencer`,
      boton: 'Ver permiso por vencer' },
  ]
  const avisos = todosLosAvisos.filter((a) => a.total > 0)

  const createMut = useCreateVehiculo()
  const updateMut = useUpdateVehiculo()
  const deleteMut = useDeleteVehiculo()

  const [exportando, setExportando] = useState(false)

  async function handleExportPdf() {
    setExportando(true)
    try {
      const vehiculosRes = await fetchTodosLosVehiculos()
      await exportVehiculosReporteToPdf(vehiculosRes.data, sucursalesData?.data ?? [])
    } catch (e) {
      alert((e as Error).message)
    } finally {
      setExportando(false)
    }
  }

  const [editingKmId, setEditingKmId] = useState<number | null>(null)
  const [kmDraft, setKmDraft]         = useState<number | ''>('')

  function startEditKm(v: VehiculoRow, e: React.MouseEvent) {
    e.stopPropagation()
    setKmDraft(v.kilometraje ?? '')
    setEditingKmId(v.id)
  }

  function saveKm(v: VehiculoRow) {
    if (kmDraft === '' || Number(kmDraft) === v.kilometraje) { setEditingKmId(null); return }
    updateMut.mutate({ id: v.id, payload: { kilometraje: Number(kmDraft) } }, {
      onSuccess: () => setEditingKmId(null),
      onError:   () => setEditingKmId(null),
    })
  }

  const kmEdit: KmEditProps = { editingKmId, kmDraft, setKmDraft, startEditKm, saveKm, setEditingKmId }

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
        // Tras crearlo se abre su ficha, para seguir capturando sus datos
        // (requerimientos, mantenimientos) sin tener que buscarlo en la lista.
        onSuccess: (res) => {
          setFormOpen(false)
          setSelected(res.data)
        },
        onError:   (e: Error) => setFormError(e.message),
      })
    }
  }

  function handleDelete() {
    if (!deleting) return
    deleteMut.mutate(deleting.id, {
      onSuccess: () => {
        setDeleteOpen(false)
        // Si se borró el vehículo que estaba abierto ya no hay ficha que
        // mostrar: se sale por la misma vía que el botón de regreso.
        if (selected?.id === deleting.id) {
          setPendingBorrado(true)
          handleDetailBack()
        }
      },
      onError:   (e: Error) => alert(e.message),
    })
  }

  const isPending = createMut.isPending || updateMut.isPending

  // ── Esperando el vehículo referenciado desde otra pantalla ──
  if (pendingId !== undefined && !selected && !pendingBorrado) {
    return <Center py="xl"><Loader /></Center>
  }

  // ── Vista detalle ──
  if (selected) {
    return (
      <>
        <VehiculoDetalle
          vehiculo={selected}
          onBack={handleDetailBack}
          backLabel={externalEntry ? backLabel : undefined}
          onEdit={(v) => openEdit(v)}
          onDelete={(v) => { setDeleting(v); setDeleteOpen(true) }}
          onVehiculoUpdate={(v) => setSelected(v)}
          onNavigateModelo={onNavigateModelo}
        />
        <Modal
          opened={formOpen} onClose={() => setFormOpen(false)}
          title={`Editar — ${editing ? vehiculoLabel(editing) : ''}`}
          size="lg" closeOnClickOutside={false}
        >
          <VehiculoForm
            initial={editing ?? undefined}
            isPending={updateMut.isPending} error={formError}
            onSubmit={handleFormSubmit} onCancel={() => setFormOpen(false)}
          />
        </Modal>

        {/* El modal de baja se repite aquí porque la vista de detalle sale por
            este return y no llega al de la lista. Al confirmar, handleDelete
            limpia `selected` y la pantalla regresa sola al listado. */}
        <Modal opened={deleteOpen} onClose={() => setDeleteOpen(false)}
          title="Eliminar vehículo" centered size="sm">
          <Stack gap="md">
            <Text>¿Eliminar <strong>{deleting ? vehiculoLabel(deleting) : ''}</strong>? Esta acción no se puede deshacer.</Text>
            <Text size="sm" c="dimmed">
              Su avance en el programa de mantenimiento se elimina automáticamente. No podrá
              eliminarse si tiene mantenimientos, recargas o vales registrados.
            </Text>
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setDeleteOpen(false)} disabled={deleteMut.isPending}>Cancelar</Button>
              <Button color="red" onClick={handleDelete} loading={deleteMut.isPending}>Eliminar</Button>
            </Group>
          </Stack>
        </Modal>
      </>
    )
  }

  // ── Vista lista ──
  const totalVehiculos = searching ? data?.pagination?.total : allData?.data?.length

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end">
        <div>
          <Text size="xl" fw={600}>Vehículos</Text>
          <Text size="sm" c="dimmed">Por translado, sucursal y vehículos utilitarios</Text>
        </div>
        <Group gap="sm">
          {totalVehiculos != null && (
            <Text size="sm" c="dimmed">{totalVehiculos} vehículos</Text>
          )}
          <Button
            size="sm" variant="default"
            leftSection={<IconFileTypePdf size={16} />}
            loading={exportando}
            onClick={handleExportPdf}
          >
            Generar reporte
          </Button>
          <Button size="sm" onClick={openCreate}>+ Nuevo vehículo</Button>
        </Group>
      </Group>

      {avisos.length > 0 && (
        <Alert color="orange" title="Unidades que necesitan atención" icon={<IconAlertTriangle size={16} />}>
          <Stack gap="xs">
            <Text size="sm">
              {avisos.map((a, i) => (
                <Fragment key={a.alerta}>
                  {i > 0 && ' '}
                  <strong>{a.total} vehículo{a.total !== 1 ? 's' : ''}</strong> {a.texto}.
                </Fragment>
              ))}
            </Text>
            <Group gap="xs">
              {avisos.map((a) => (
                <Button
                  key={a.alerta} size="xs"
                  variant={alerta === a.alerta ? 'filled' : 'default'}
                  onClick={() => setAlerta(alerta === a.alerta ? null : a.alerta)}
                >
                  {a.boton}
                </Button>
              ))}
            </Group>
          </Stack>
        </Alert>
      )}

      <TextInput
        placeholder="Buscar por marca, modelo, categoría, serie o placas…"
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

      {/* El filtro se ve como un chip bajo la barra: así queda claro que la lista
          de abajo está recortada, aunque la búsqueda esté vacía. */}
      {alerta !== null && (
        <Group gap="xs">
          <Badge
            size="lg" variant="light" color="orange"
            rightSection={
              <Text component="span" size="xs" style={{ cursor: 'pointer' }}
                onClick={() => setAlerta(null)}>✕</Text>
            }
          >
            {ALERTA_CHIP[alerta]}
          </Badge>
          <Text size="xs" c="dimmed">{ALERTA_DETALLE[alerta]}</Text>
        </Group>
      )}

      {searching ? (
        isLoading ? (
          <Center py="xl"><Loader /></Center>
        ) : isError ? (
          <Alert color="red" title="Error al cargar">No se pudieron obtener los vehículos.</Alert>
        ) : data?.data?.length === 0 ? (
          <Center py="xl">
            <Text c="dimmed">
              {search
                ? `No se encontraron vehículos para "${search}".`
                : 'No se encontraron vehículos con ese filtro.'}
            </Text>
          </Center>
        ) : (
          <>
            <VehiculosTable
              items={data?.data ?? []} showTipo
              onSelect={selectFromList} onEdit={openEdit} onDelete={openDelete} km={kmEdit}
            />
            {totalPages > 1 && (
              <Group justify="center">
                <Pagination total={totalPages} value={page} onChange={setPage} size="sm" />
              </Group>
            )}
          </>
        )
      ) : allLoading ? (
        <Center py="xl"><Loader /></Center>
      ) : allError ? (
        <Alert color="red" title="Error al cargar">No se pudieron obtener los vehículos.</Alert>
      ) : (
        <VehiculosAgrupados
          vehiculos={allData?.data ?? []}
          sucursales={sucursalesData?.data ?? []}
          onSelect={selectFromList} onEdit={openEdit} onDelete={openDelete} km={kmEdit}
        />
      )}

      <Modal opened={formOpen} onClose={() => setFormOpen(false)}
        title={editing ? `Editar — ${vehiculoLabel(editing)}` : 'Nuevo vehículo'}
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
          <Text>¿Eliminar <strong>{deleting ? vehiculoLabel(deleting) : ''}</strong>? Esta acción no se puede deshacer.</Text>
          <Text size="sm" c="dimmed">Su avance en el programa de mantenimiento se eliminará automáticamente.</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDeleteOpen(false)} disabled={deleteMut.isPending}>Cancelar</Button>
            <Button color="red" onClick={handleDelete} loading={deleteMut.isPending}>Eliminar</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  )
}
