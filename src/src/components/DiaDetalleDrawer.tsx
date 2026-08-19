// Bitácora de un día: todo lo que la flota registró con esa fecha, junta en un
// solo panel. Antes el calendario solo abría un modal con los mantenimientos y
// las agendas del día; el resto de la actividad (combustible, vales,
// incidencias, compras, traspasos) había que ir a buscarla pantalla por
// pantalla.
//
// Las secciones vacías no se dibujan: un día con tres recargas y nada más se lee
// de un vistazo en vez de obligar a recorrer siete encabezados en cero.
import type { ReactNode } from 'react'
import {
  Drawer, Stack, Group, Text, Card, Badge, Center, Loader, Alert, Divider,
  SimpleGrid, ThemeIcon, ActionIcon, Tooltip, Table, Anchor,
} from '@mantine/core'
import {
  IconTool, IconGasStation, IconTicket, IconAlertTriangle, IconCircleCheck,
  IconShoppingCart, IconArrowsExchange, IconCalendarEvent, IconChevronLeft,
  IconChevronRight, IconCoin, IconCalendarOff,
} from '@tabler/icons-react'
import type { Icon } from '@tabler/icons-react'
import { useActividadDia } from '../hooks/useActividadDia'
import type {
  MantenimientoDia, RecargaDia, ValeDia, IncidenciaDia, IncidenciaCerradaDia,
  CompraDia, TraspasoDia,
} from '../hooks/useActividadDia'
import type { AgendaConVehiculo } from '../hooks/useAgendasMantenimiento'
import { formatMXN, formatNum, formatFecha } from '../lib/formato'
import { TIPO_COLORS, TIPO_LABELS } from '../lib/tipoVehiculo'
import { SEVERIDAD_META } from '../lib/incidenciaMeta'

function fmtFechaLarga(iso: string) {
  return new Date(`${iso.split('T')[0]}T12:00:00`).toLocaleDateString('es-MX', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
}

function addDiasIso(iso: string, delta: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + delta)
  return d.toISOString().split('T')[0]
}

// ─── Bloques de presentación ─────────────────────────────────────────────────

function VehiculoBadge({ tipo }: { tipo: string }) {
  return (
    <Badge size="xs" variant="light" color={TIPO_COLORS[tipo] ?? 'gray'}>
      {TIPO_LABELS[tipo] ?? tipo}
    </Badge>
  )
}

// El nombre del vehículo es el enlace natural para saltar a su ficha; si el
// calendario no pasó `onNavigateVehiculo`, se degrada a texto plano.
function VehiculoNombre({
  nombre, vehiculoId, onNavigate,
}: {
  nombre: string; vehiculoId: number; onNavigate?: (id: number) => void
}) {
  if (!onNavigate) return <Text size="sm" fw={500}>{nombre}</Text>
  return (
    <Anchor size="sm" fw={500} onClick={() => onNavigate(vehiculoId)}>
      {nombre}
    </Anchor>
  )
}

function Seccion({
  titulo, icon: Icono, color, count, extra, children,
}: {
  titulo: string; icon: Icon; color: string; count: number; extra?: ReactNode; children: ReactNode
}) {
  return (
    <div>
      <Group justify="space-between" align="center" mb={6} wrap="nowrap">
        <Group gap={8} wrap="nowrap">
          <ThemeIcon color={color} variant="light" size="sm" radius="sm">
            <Icono size={14} />
          </ThemeIcon>
          <Text size="sm" fw={600}>{titulo}</Text>
          <Badge size="xs" variant="light" color={color} circle>{count}</Badge>
        </Group>
        {extra}
      </Group>
      {children}
    </div>
  )
}

function Fila({ children }: { children: ReactNode }) {
  return (
    <Card withBorder padding="xs" radius="sm">
      {children}
    </Card>
  )
}

// ─── Panel ───────────────────────────────────────────────────────────────────

export default function DiaDetalleDrawer({
  fecha,
  agendasDelDia,
  onClose,
  onSelectFecha,
  onNavigateVehiculo,
  onVerMantenimiento,
}: {
  /** Día en 'YYYY-MM-DD'; null cierra el panel. */
  fecha:               string | null
  /** Agendas que cubren el día. Ya las tiene el calendario, no se vuelven a pedir. */
  agendasDelDia:       AgendaConVehiculo[]
  onClose:             () => void
  /** Para las flechas de día anterior / siguiente. */
  onSelectFecha:       (fecha: string) => void
  onNavigateVehiculo?: (vehiculoId: number) => void
  onVerMantenimiento?: (mantenimientoId: number) => void
}) {
  const { data, isLoading, error } = useActividadDia(fecha)
  const act = data?.data

  const totales = act?.totales
  const mantenimientos:  MantenimientoDia[]      = act?.mantenimientos ?? []
  const recargas:        RecargaDia[]            = act?.recargas ?? []
  const vales:           ValeDia[]               = act?.vales ?? []
  const incAbiertas:     IncidenciaDia[]         = act?.incidencias_abiertas ?? []
  const incCerradas:     IncidenciaCerradaDia[]  = act?.incidencias_cerradas ?? []
  const compras:         CompraDia[]             = act?.compras ?? []
  const traspasos:       TraspasoDia[]           = act?.traspasos ?? []

  const sinActividad =
    !isLoading && !error &&
    mantenimientos.length === 0 && recargas.length === 0 && vales.length === 0 &&
    incAbiertas.length === 0 && incCerradas.length === 0 && compras.length === 0 &&
    traspasos.length === 0 && agendasDelDia.length === 0

  const valesSinUsar = vales.filter(v => !v.usado).length

  return (
    <Drawer
      opened={fecha !== null}
      onClose={onClose}
      position="right"
      size="xl"
      title={
        <Group gap="xs" wrap="nowrap">
          <Tooltip label="Día anterior">
            <ActionIcon
              variant="subtle" color="gray" size="sm"
              onClick={() => fecha && onSelectFecha(addDiasIso(fecha, -1))}
            >
              <IconChevronLeft size={16} />
            </ActionIcon>
          </Tooltip>
          <Text fw={600} tt="capitalize">{fecha ? fmtFechaLarga(fecha) : ''}</Text>
          <Tooltip label="Día siguiente">
            <ActionIcon
              variant="subtle" color="gray" size="sm"
              onClick={() => fecha && onSelectFecha(addDiasIso(fecha, 1))}
            >
              <IconChevronRight size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      }
    >
      {isLoading ? (
        <Center py="xl"><Loader /></Center>
      ) : error ? (
        <Alert color="red" title="No se pudo cargar el día">
          {(error as Error).message}
        </Alert>
      ) : (
        <Stack gap="lg">
          {/* ── Dinero del día ── */}
          {totales && (
            <Card withBorder padding="md" radius="md">
              <Group justify="space-between" align="center" mb="xs" wrap="nowrap">
                <Group gap={8} wrap="nowrap">
                  <ThemeIcon color="teal" variant="light" size="sm" radius="sm">
                    <IconCoin size={14} />
                  </ThemeIcon>
                  <Text size="sm" fw={600}>Gasto del día</Text>
                </Group>
                <Text fz="1.5rem" fw={700} lh={1} style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {formatMXN(totales.total)}
                </Text>
              </Group>
              <SimpleGrid cols={3} spacing="xs">
                <div>
                  <Text size="xs" c="dimmed">Mano de obra</Text>
                  <Text size="sm" fw={500}>{formatMXN(totales.mano_obra)}</Text>
                </div>
                <div>
                  <Text size="xs" c="dimmed">Refacciones compradas</Text>
                  <Text size="sm" fw={500}>{formatMXN(totales.refacciones)}</Text>
                </div>
                <div>
                  <Text size="xs" c="dimmed">Combustible</Text>
                  <Text size="sm" fw={500}>
                    {formatMXN(totales.combustible)}
                    {totales.litros > 0 && (
                      <Text component="span" size="xs" c="dimmed"> · {formatNum(totales.litros, 1)} L</Text>
                    )}
                  </Text>
                </div>
              </SimpleGrid>
              {totales.piezas_usadas > 0 && (
                <Text size="xs" c="dimmed" mt={6}>
                  Los mantenimientos del día consumieron {formatMXN(totales.piezas_usadas)} en refacciones,
                  que no se suman aquí: ya se pagaron el día que se compraron.
                </Text>
              )}
            </Card>
          )}

          {sinActividad && (
            <Center py="xl" style={{ flexDirection: 'column' }}>
              <ThemeIcon variant="light" color="gray" size={44} radius="xl" mb="xs">
                <IconCalendarOff size={22} />
              </ThemeIcon>
              <Text c="dimmed" size="sm">Sin actividad registrada este día.</Text>
            </Center>
          )}

          {/* ── Agendado ── */}
          {agendasDelDia.length > 0 && (
            <Seccion titulo="Agendado" icon={IconCalendarEvent} color="orange" count={agendasDelDia.length}>
              {agendasDelDia.length > 1 && (
                <Alert color="orange" variant="light" mb="xs" icon={<IconAlertTriangle size={16} />} p="xs">
                  {agendasDelDia.length} vehículos agendados el mismo día — revisa disponibilidad de
                  técnicos y refacciones.
                </Alert>
              )}
              <Stack gap={6}>
                {agendasDelDia.map(a => (
                  <Fila key={a.id}>
                    <Group justify="space-between" wrap="nowrap">
                      <Group gap={6} wrap="nowrap">
                        <VehiculoBadge tipo={a.vehiculo_tipo} />
                        <VehiculoNombre
                          nombre={a.vehiculo_nombre} vehiculoId={a.vehiculo_id}
                          onNavigate={onNavigateVehiculo}
                        />
                      </Group>
                      <Text size="xs" c="dimmed">
                        {a.tipo ?? '—'}{a.tecnico ? ` · ${a.tecnico}` : ''}
                      </Text>
                    </Group>
                  </Fila>
                ))}
              </Stack>
            </Seccion>
          )}

          {/* ── Mantenimientos ── */}
          {mantenimientos.length > 0 && (
            <Seccion
              titulo="Mantenimientos realizados" icon={IconTool} color="blue" count={mantenimientos.length}
              extra={
                <Text size="xs" c="dimmed">
                  {formatMXN(mantenimientos.reduce((s, m) => s + m.costo, 0))} de mano de obra
                </Text>
              }
            >
              <Stack gap={6}>
                {mantenimientos.map(m => (
                  <Card
                    key={m.id} withBorder padding="xs" radius="sm"
                    style={{ cursor: onVerMantenimiento ? 'pointer' : undefined }}
                    onClick={onVerMantenimiento ? () => onVerMantenimiento(m.id) : undefined}
                  >
                    <Group justify="space-between" wrap="nowrap" align="flex-start">
                      <div style={{ minWidth: 0 }}>
                        <Group gap={6} wrap="nowrap">
                          <VehiculoBadge tipo={m.vehiculo_tipo} />
                          <Text size="sm" fw={500} truncate>{m.vehiculo_nombre}</Text>
                        </Group>
                        <Text size="xs" c="dimmed">
                          {m.tipo ?? 'Sin tipo'}
                          {m.tecnico ? ` · ${m.tecnico}` : ''}
                          {m.km_actual != null ? ` · ${formatNum(m.km_actual)} km` : ''}
                        </Text>
                      </div>
                      <Stack gap={0} align="flex-end">
                        <Text size="sm" fw={600}>{formatMXN(m.costo)}</Text>
                        {m.piezas_total > 0 && (
                          <Text size="xs" c="dimmed">+{formatMXN(m.piezas_total)} en piezas</Text>
                        )}
                      </Stack>
                    </Group>
                  </Card>
                ))}
              </Stack>
            </Seccion>
          )}

          {/* ── Incidencias reportadas ── */}
          {incAbiertas.length > 0 && (
            <Seccion titulo="Incidencias reportadas" icon={IconAlertTriangle} color="red" count={incAbiertas.length}>
              <Stack gap={6}>
                {incAbiertas.map(i => (
                  <Fila key={i.id}>
                    <Group justify="space-between" wrap="nowrap" align="flex-start">
                      <div style={{ minWidth: 0 }}>
                        <Group gap={6} wrap="nowrap">
                          <Badge size="xs" variant="light" color={SEVERIDAD_META[i.severidad]?.color ?? 'gray'}>
                            {SEVERIDAD_META[i.severidad]?.label ?? i.severidad}
                          </Badge>
                          <Text size="sm" fw={500} truncate>{i.nombre}</Text>
                        </Group>
                        <Text size="xs" c="dimmed">
                          {i.vehiculo_nombre} · {i.ubicacion}
                          {i.hora ? ` · ${i.hora}` : ''} · reportó {i.reportado_por}
                        </Text>
                      </div>
                      {i.status === 'completado' && (
                        <Badge size="xs" variant="light" color="green">Ya atendida</Badge>
                      )}
                    </Group>
                  </Fila>
                ))}
              </Stack>
            </Seccion>
          )}

          {/* ── Incidencias cerradas ── */}
          {incCerradas.length > 0 && (
            <Seccion titulo="Incidencias cerradas" icon={IconCircleCheck} color="green" count={incCerradas.length}>
              <Stack gap={6}>
                {incCerradas.map(i => (
                  <Card
                    key={i.id} withBorder padding="xs" radius="sm"
                    style={{ cursor: onVerMantenimiento ? 'pointer' : undefined }}
                    onClick={onVerMantenimiento ? () => onVerMantenimiento(i.mantenimiento_id) : undefined}
                  >
                    <Group justify="space-between" wrap="nowrap" align="flex-start">
                      <div style={{ minWidth: 0 }}>
                        <Text size="sm" fw={500} truncate>{i.nombre}</Text>
                        <Text size="xs" c="dimmed">
                          {i.vehiculo_nombre}
                          {i.categoria ? ` · ${i.categoria}` : ''}
                        </Text>
                      </div>
                      <Badge size="xs" variant="light" color="green">
                        Cerrada por mantenimiento
                      </Badge>
                    </Group>
                  </Card>
                ))}
              </Stack>
            </Seccion>
          )}

          {/* ── Combustible ── */}
          {recargas.length > 0 && (
            <Seccion
              titulo="Recargas de combustible" icon={IconGasStation} color="grape" count={recargas.length}
              extra={
                <Text size="xs" c="dimmed">
                  {formatNum(recargas.reduce((s, r) => s + r.litros, 0), 1)} L ·{' '}
                  {formatMXN(recargas.reduce((s, r) => s + r.costo, 0))}
                </Text>
              }
            >
              <Table.ScrollContainer minWidth={480}>
                <Table striped highlightOnHover verticalSpacing={6} fz="xs">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Vehículo</Table.Th>
                      <Table.Th>Gasolinera</Table.Th>
                      <Table.Th>Conductor</Table.Th>
                      <Table.Th ta="right">Litros</Table.Th>
                      <Table.Th ta="right">Costo</Table.Th>
                      <Table.Th>Vale</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {recargas.map(r => (
                      <Table.Tr key={r.id}>
                        <Table.Td>
                          <VehiculoNombre
                            nombre={r.vehiculo_nombre} vehiculoId={r.vehiculo_id}
                            onNavigate={onNavigateVehiculo}
                          />
                        </Table.Td>
                        <Table.Td>{r.gasolinera}</Table.Td>
                        <Table.Td>{r.conductor}</Table.Td>
                        <Table.Td ta="right">{formatNum(r.litros, 1)}</Table.Td>
                        <Table.Td ta="right">{formatMXN(r.costo)}</Table.Td>
                        <Table.Td>
                          {r.vale_folio ?? <Text c="dimmed" size="xs">sin vale</Text>}
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </Seccion>
          )}

          {/* ── Vales ── */}
          {vales.length > 0 && (
            <Seccion
              titulo="Vales de gasolina emitidos" icon={IconTicket} color="yellow" count={vales.length}
              extra={valesSinUsar > 0 ? (
                <Badge size="xs" variant="light" color="orange">{valesSinUsar} sin cobrar</Badge>
              ) : undefined}
            >
              <Stack gap={6}>
                {vales.map(v => (
                  <Fila key={v.id}>
                    <Group justify="space-between" wrap="nowrap" align="flex-start">
                      <div style={{ minWidth: 0 }}>
                        <Group gap={6} wrap="nowrap">
                          <Badge size="xs" variant="outline" color="gray">{v.folio}</Badge>
                          <Text size="sm" truncate>{v.vehiculo_nombre}</Text>
                        </Group>
                        <Text size="xs" c="dimmed">
                          {v.conductor} · emitió {v.creado_por}
                        </Text>
                      </div>
                      <Badge size="xs" variant="light" color={v.usado ? 'green' : 'orange'}>
                        {v.usado ? 'Cobrado' : 'Sin cobrar'}
                      </Badge>
                    </Group>
                  </Fila>
                ))}
              </Stack>
            </Seccion>
          )}

          {/* ── Compras ── */}
          {compras.length > 0 && (
            <Seccion
              titulo="Refacciones compradas" icon={IconShoppingCart} color="indigo" count={compras.length}
              extra={
                <Text size="xs" c="dimmed">
                  {formatMXN(compras.reduce((s, c) => s + c.cantidad_inicial * c.costo_unitario, 0))}
                </Text>
              }
            >
              <Table.ScrollContainer minWidth={480}>
                <Table striped highlightOnHover verticalSpacing={6} fz="xs">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Pieza</Table.Th>
                      <Table.Th>Proveedor</Table.Th>
                      <Table.Th>Sucursal</Table.Th>
                      <Table.Th ta="right">Cant.</Table.Th>
                      <Table.Th ta="right">Unitario</Table.Th>
                      <Table.Th ta="right">Total</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {compras.map(c => (
                      <Table.Tr key={c.id}>
                        <Table.Td>
                          <Text size="xs" fw={500}>{c.descripcion}</Text>
                          <Text size="xs" c="dimmed">{c.numero_serie}</Text>
                        </Table.Td>
                        <Table.Td>{c.proveedor}</Table.Td>
                        <Table.Td>{c.sucursal ?? '—'}</Table.Td>
                        <Table.Td ta="right">{formatNum(c.cantidad_inicial)}</Table.Td>
                        <Table.Td ta="right">{formatMXN(c.costo_unitario)}</Table.Td>
                        <Table.Td ta="right" fw={600}>
                          {formatMXN(c.cantidad_inicial * c.costo_unitario)}
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </Seccion>
          )}

          {/* ── Traspasos ── */}
          {traspasos.length > 0 && (
            <Seccion titulo="Traspasos entre sucursales" icon={IconArrowsExchange} color="cyan" count={traspasos.length}>
              <Stack gap={6}>
                {traspasos.map(t => (
                  <Fila key={t.id}>
                    <Group justify="space-between" wrap="nowrap" align="flex-start">
                      <div style={{ minWidth: 0 }}>
                        <Text size="sm" truncate>{t.descripcion}</Text>
                        <Text size="xs" c="dimmed">
                          {t.numero_serie} · {t.origen} → {t.destino}
                        </Text>
                      </div>
                      <Badge size="xs" variant="light" color="cyan">{formatNum(t.cantidad)} u.</Badge>
                    </Group>
                  </Fila>
                ))}
              </Stack>
            </Seccion>
          )}

          {!sinActividad && (
            <>
              <Divider />
              <Text size="xs" c="dimmed" ta="center">
                Actividad registrada con fecha {fecha ? formatFecha(fecha) : ''}
              </Text>
            </>
          )}
        </Stack>
      )}
    </Drawer>
  )
}
