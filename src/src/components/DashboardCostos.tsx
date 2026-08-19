// Pestaña "Costos y ahorro" del tablero.
//
// El resto del tablero responde "¿cuánto llevamos gastado?". Esta pestaña
// responde la que sigue: "¿de eso, cuánto no debimos gastar?". Cada bloque es
// una comparación contra una referencia —el mismo modelo, la otra gasolinera,
// el otro proveedor, el servicio anterior— y termina en pesos, porque un
// porcentaje no autoriza una decisión y una cifra en pesos sí.
import {
  Alert, Badge, Card, Center, Group, Loader, Progress, SegmentedControl, SimpleGrid,
  Stack, Table, Text, Tooltip,
} from '@mantine/core'
import { AreaChart, BarChart } from '@mantine/charts'
import {
  IconAlertTriangle, IconCashBanknote, IconDiscount2, IconDroplet,
  IconGasStation, IconRoad,
} from '@tabler/icons-react'
import {
  useAnalisisCostos, type AnalisisCostos, type TipoAnomalia, type VentanaCostos,
} from '../hooks/useDashboard'
import { StatCard } from './StatCard'
import { formatMXN, formatMXNCorto, formatMes, formatNum, formatFecha } from '../lib/formato'
import { TIPO_LABELS } from '../lib/tipoVehiculo'

// ─── Piezas de presentación ─────────────────────────────────────────────────

function Seccion({ titulo, descripcion, children, accion }: {
  titulo: string; descripcion?: string; children: React.ReactNode; accion?: React.ReactNode
}) {
  return (
    <Card withBorder padding="lg" radius="md">
      <Group justify="space-between" align="flex-start" wrap="nowrap" mb={descripcion ? 2 : 'md'}>
        <Text fw={600}>{titulo}</Text>
        {accion}
      </Group>
      {descripcion && <Text size="xs" c="dimmed" mb="md">{descripcion}</Text>}
      {children}
    </Card>
  )
}

function Vacio({ children }: { children: React.ReactNode }) {
  return <Center py="xl"><Text c="dimmed" size="sm" ta="center">{children}</Text></Center>
}

function Guion() {
  return <Text component="span" c="dimmed" size="sm">—</Text>
}

// Botón-texto para saltar a la ficha del vehículo. Se repite en cada tabla.
function LinkVehiculo({ nombre, onClick }: { nombre: string; onClick?: () => void }) {
  if (!onClick) return <Text size="sm" fw={500}>{nombre}</Text>
  return (
    <Text
      component="button" size="sm" fw={500} c="blue"
      style={{
        cursor: 'pointer', background: 'none', border: 'none', padding: 0,
        textAlign: 'left', textDecoration: 'underline', textUnderlineOffset: 2,
      }}
      onClick={onClick}
    >
      {nombre}
    </Text>
  )
}

const ANOMALIA_META: Record<TipoAnomalia, { label: string; color: string; ayuda: string }> = {
  rendimiento_bajo: {
    label: 'Rendimiento bajo', color: 'red',
    ayuda: 'La unidad rinde bastante menos que otras del mismo modelo. Suele ser falla mecánica o combustible que no llega al tanque.',
  },
  odometro_retrocede: {
    label: 'Odómetro inconsistente', color: 'red',
    ayuda: 'El kilometraje capturado bajó respecto de la carga anterior. Mientras no cuadre, no se puede auditar el consumo.',
  },
  precio_alto: {
    label: 'Precio por litro alto', color: 'orange',
    ayuda: 'Se pagó el litro muy por encima del promedio del periodo.',
  },
  carga_duplicada: {
    label: 'Dos cargas el mismo día', color: 'orange',
    ayuda: 'Puede ser legítimo en un viaje largo, pero conviene revisar el vale.',
  },
  sin_vale: {
    label: 'Carga sin vale', color: 'yellow',
    ayuda: 'No hay vale que respalde quién autorizó la carga.',
  },
  sin_odometro: {
    label: 'Carga sin kilometraje', color: 'yellow',
    ayuda: 'Sin odómetro esa carga no entra al rendimiento: es gasto que no se puede medir.',
  },
}

// ─── Pestaña ────────────────────────────────────────────────────────────────

// La ventana la manda el Dashboard y no se guarda aqui: el boton de reportes
// vive en la cabecera y tiene que exportar el mismo periodo que se esta viendo.
export default function DashboardCostos({
  ventana, onVentanaChange, onNavigateVehiculo, onNavigatePieza,
}: {
  ventana:          VentanaCostos
  onVentanaChange:  (v: VentanaCostos) => void
  onNavigateVehiculo?: (vehiculoId: number) => void
  onNavigatePieza?:    (piezaId: number) => void
}) {
  const { data, isLoading } = useAnalisisCostos(ventana)

  const selector = (
    <SegmentedControl
      size="xs"
      value={String(ventana)}
      onChange={(v) => onVentanaChange(Number(v) as VentanaCostos)}
      data={[
        { label: '30 días', value: '30' },
        { label: '90 días', value: '90' },
        { label: '6 meses', value: '180' },
        { label: '1 año',   value: '365' },
      ]}
    />
  )

  if (isLoading || !data) {
    return (
      <Stack gap="xl">
        <Group justify="flex-end">{selector}</Group>
        <Center py="xl"><Loader /></Center>
      </Stack>
    )
  }

  return (
    <Stack gap="xl">
      <Group justify="space-between" align="center" wrap="wrap">
        <Text size="sm" c="dimmed">
          Analizando {formatNum(data.data.totales.vehiculos_analizados)} unidades con
          movimiento en los últimos {ventana} días.
        </Text>
        {selector}
      </Group>
      <Contenido data={data.data} ventana={ventana}
        onNavigateVehiculo={onNavigateVehiculo} onNavigatePieza={onNavigatePieza} />
    </Stack>
  )
}

function Contenido({ data, ventana, onNavigateVehiculo, onNavigatePieza }: {
  data: AnalisisCostos
  ventana: VentanaCostos
  onNavigateVehiculo?: (vehiculoId: number) => void
  onNavigatePieza?:    (piezaId: number) => void
}) {
  const t = data.totales

  // La barra de cada renglón se mide contra el peor del periodo, no contra un
  // valor fijo: lo que interesa es el orden relativo dentro de la flota.
  const maxCostoKm = Math.max(...data.vehiculos.map((v) => v.costo_por_km ?? 0), 0.01)
  const maxGasto   = Math.max(...data.vehiculos.map((v) => v.total), 1)

  const gastoMensual = data.gasto_mensual.map((g) => ({
    mes: formatMes(g.mes),
    'Combustible': g.combustible,
    'Mano de obra': g.mano_obra,
    'Refacciones': g.refacciones,
  }))

  const gasolinerasChart = data.gasolineras
    .filter((g) => g.precio_litro != null)
    .map((g) => ({ gasolinera: g.gasolinera, precio: g.precio_litro! }))

  // Solo las unidades con suficientes cargas para que el km/L signifique algo;
  // el backend ya deja en null las que no llegan, aquí solo se filtran.
  const conRendimiento = data.vehiculos
    .filter((v) => v.rendimiento != null)
    .sort((a, b) => (a.desviacion_pct ?? 0) - (b.desviacion_pct ?? 0))

  const retrabajoTotal = data.retrabajos.reduce((s, r) => s + r.costo, 0)

  return (
    <>
      {/* ── El titular: lo identificado como recuperable ── */}
      {t.ahorro_total > 0 && (
        <Alert color="teal" icon={<IconDiscount2 size={18} />} title="Ahorro identificado en el periodo">
          <Text size="sm">
            <strong>{formatMXN(t.ahorro_total)}</strong> se pudieron no gastar:{' '}
            {formatMXN(t.ahorro_refacciones)} comprando cada refacción con el proveedor
            que la tiene más barata y {formatMXN(t.ahorro_combustible)} cargando siempre
            en la gasolinera más económica de las que ya se visitan. El detalle de cada
            peso está en las tablas de abajo.
          </Text>
        </Alert>
      )}

      <SimpleGrid cols={{ base: 1, sm: 2, md: 3, xl: 5 }} spacing="md">
        <StatCard
          label="Ahorro identificado"
          value={formatMXN(t.ahorro_total)}
          sub="Recuperable sin dejar de operar"
          color="teal" icon={IconDiscount2}
          ayuda="Suma de comprar cada refacción con el proveedor más barato que la cotiza y de cargar combustible siempre en la gasolinera más económica del periodo."
        />
        <StatCard
          label="Costo por kilómetro"
          value={t.costo_por_km != null ? formatMXN(t.costo_por_km) : '—'}
          sub={`${formatNum(t.km_recorridos)} km recorridos`}
          color="violet" icon={IconRoad}
          ayuda="Combustible + mano de obra + refacciones consumidas, entre los kilómetros que avanzó el odómetro de la flota en el periodo."
        />
        <StatCard
          label="Rendimiento de la flota"
          value={t.rendimiento != null ? `${t.rendimiento.toFixed(2)} km/L` : '—'}
          sub={`${formatNum(t.litros)} L cargados`}
          color="blue" icon={IconDroplet}
          ayuda="Kilómetros recorridos entre litros cargados, midiendo de una carga a la siguiente. Solo entran las unidades con al menos tres tramos completos."
        />
        <StatCard
          label="Precio por litro"
          value={t.precio_litro != null ? `$${t.precio_litro.toFixed(2)}` : '—'}
          sub="Promedio ponderado del periodo"
          color="cyan" icon={IconGasStation}
          ayuda="Lo pagado entre los litros cargados. Ponderado: una carga grande pesa más que una chica."
        />
        <StatCard
          label="Salida de caja"
          value={formatMXNCorto(t.total_caja)}
          sub={`Combustible ${formatMXNCorto(t.combustible)} · Taller ${formatMXNCorto(t.mano_obra)}`}
          color="grape" icon={IconCashBanknote}
          ayuda="Combustible + mano de obra + refacciones compradas al almacén. Las refacciones consumidas por los mantenimientos no se suman aparte: ya se pagaron al comprarlas."
        />
      </SimpleGrid>

      {/* ── Tendencia de gasto ── */}
      <Seccion
        titulo="En qué se va el dinero"
        descripcion="Gasto mensual de los últimos doce meses, apilado por concepto. Las refacciones son las compradas al almacén, no las consumidas."
      >
        {gastoMensual.length < 2 ? (
          <Vacio>Aún no hay suficiente historial para ver la tendencia.</Vacio>
        ) : (
          <AreaChart
            h={280}
            data={gastoMensual}
            dataKey="mes"
            type="stacked"
            withLegend
            withDots={false}
            curveType="monotone"
            valueFormatter={(v) => formatMXN(v)}
            yAxisProps={{ width: 70, tickFormatter: formatMXNCorto }}
            series={[
              { name: 'Combustible',  color: 'cyan.6'   },
              { name: 'Mano de obra', color: 'violet.6' },
              { name: 'Refacciones',  color: 'orange.6' },
            ]}
          />
        )}
      </Seccion>

      {/* ── Refacciones: mismo repuesto, otro proveedor ── */}
      <Seccion
        titulo="Refacciones que se están comprando caras"
        descripcion="Compras del periodo comparadas contra el precio vigente más bajo cotizado para esa misma refacción. El ahorro es lo que se habría pagado de menos comprándole al otro proveedor."
        accion={data.ahorro_refacciones.length > 0 && (
          <Badge color="teal" variant="light" size="lg">{formatMXN(t.ahorro_refacciones)}</Badge>
        )}
      >
        {data.ahorro_refacciones.length === 0 ? (
          <Vacio>
            Ninguna compra del periodo salió más cara que el mejor precio cotizado.
            Si faltan comparaciones, captura más precios en Proveedores → Precios.
          </Vacio>
        ) : (
          <Table.ScrollContainer minWidth={720}>
            <Table striped withTableBorder highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Refacción</Table.Th>
                  <Table.Th>Se le compró a</Table.Th>
                  <Table.Th>Más barato con</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Pagado</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Mejor precio</Table.Th>
                  <Table.Th style={{ textAlign: 'center' }}>Cant.</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Ahorro</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data.ahorro_refacciones.map((o) => {
                  const pct = o.pagado > 0 ? ((o.pagado - o.mejor_precio) / o.pagado) * 100 : 0
                  return (
                    <Table.Tr key={o.pieza_id}>
                      <Table.Td>
                        <LinkVehiculo
                          nombre={o.numero_serie}
                          onClick={onNavigatePieza ? () => onNavigatePieza(o.pieza_id) : undefined}
                        />
                        <Text size="xs" c="dimmed" lineClamp={1}>{o.descripcion}</Text>
                      </Table.Td>
                      <Table.Td><Text size="sm">{o.proveedor}</Text></Table.Td>
                      <Table.Td><Text size="sm" fw={500} c="teal">{o.mejor_proveedor}</Text></Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>{formatMXN(o.pagado)}</Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>
                        <Group gap={6} justify="flex-end" wrap="nowrap">
                          <Text size="sm">{formatMXN(o.mejor_precio)}</Text>
                          <Badge size="xs" variant="light" color="teal">−{pct.toFixed(0)}%</Badge>
                        </Group>
                      </Table.Td>
                      <Table.Td style={{ textAlign: 'center' }}>{o.cantidad}</Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>
                        <Text size="sm" fw={600} c="teal">{formatMXN(o.ahorro)}</Text>
                      </Table.Td>
                    </Table.Tr>
                  )
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Seccion>

      {/* ── Gasolineras ── */}
      <Seccion
        titulo="Precio por litro por gasolinera"
        descripcion="Lo que costó el litro en cada una durante el periodo. El sobreprecio es lo que se pagó de más contra la más barata de las que ya se visitan con regularidad — un ahorro que solo requiere cambiar a dónde se manda a cargar."
        accion={t.ahorro_combustible > 0 && (
          <Badge color="teal" variant="light" size="lg">{formatMXN(t.ahorro_combustible)}</Badge>
        )}
      >
        {data.gasolineras.length === 0 ? (
          <Vacio>Sin recargas registradas en el periodo.</Vacio>
        ) : (
          <Stack gap="md">
            <BarChart
              h={Math.max(180, gasolinerasChart.length * 34)}
              data={gasolinerasChart}
              dataKey="gasolinera"
              orientation="vertical"
              yAxisProps={{ width: 150 }}
              series={[{ name: 'precio', color: 'cyan.6', label: 'Precio por litro' }]}
              valueFormatter={(v) => `$${v.toFixed(2)}`}
              gridAxis="x"
            />
            <Table.ScrollContainer minWidth={560}>
              <Table striped withTableBorder>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Gasolinera</Table.Th>
                    <Table.Th style={{ textAlign: 'center' }}>Cargas</Table.Th>
                    <Table.Th style={{ textAlign: 'right' }}>Litros</Table.Th>
                    <Table.Th style={{ textAlign: 'right' }}>Gasto</Table.Th>
                    <Table.Th style={{ textAlign: 'right' }}>$/L</Table.Th>
                    <Table.Th style={{ textAlign: 'right' }}>Sobreprecio</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {data.gasolineras.map((g) => (
                    <Table.Tr key={g.gasolinera_id}>
                      <Table.Td fw={500}>{g.gasolinera}</Table.Td>
                      <Table.Td style={{ textAlign: 'center' }}>{g.recargas}</Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>{formatNum(g.litros, 1)}</Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>{formatMXN(g.costo)}</Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>
                        {g.precio_litro != null ? `$${g.precio_litro.toFixed(2)}` : <Guion />}
                      </Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>
                        {g.sobreprecio > 0
                          ? <Text size="sm" c="orange" fw={600}>{formatMXN(g.sobreprecio)}</Text>
                          : <Badge size="sm" variant="light" color="teal">La más barata</Badge>}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Stack>
        )}
      </Seccion>

      {/* ── Costo por kilómetro ── */}
      <Seccion
        titulo="Cuánto cuesta cada kilómetro, unidad por unidad"
        descripcion="Todo lo que consumió la unidad entre los kilómetros que avanzó. Es la métrica que separa a la unidad cara de la unidad que simplemente trabaja mucho: la de arriba es la que conviene revisar, reasignar o dar de baja."
      >
        {data.vehiculos.length === 0 ? (
          <Vacio>Sin movimiento registrado en el periodo.</Vacio>
        ) : (
          <Table.ScrollContainer minWidth={760}>
            <Table striped withTableBorder highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Vehículo</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Km</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Combustible</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Taller</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Total</Table.Th>
                  <Table.Th style={{ width: 170 }}>Costo por km</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data.vehiculos.map((v) => (
                  <Table.Tr key={v.vehiculo_id}>
                    <Table.Td>
                      <LinkVehiculo
                        nombre={v.vehiculo}
                        onClick={onNavigateVehiculo ? () => onNavigateVehiculo(v.vehiculo_id) : undefined}
                      />
                      <Text size="xs" c="dimmed">{TIPO_LABELS[v.tipo] ?? v.tipo}</Text>
                    </Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>
                      {v.km_recorridos != null ? formatNum(v.km_recorridos) : <Guion />}
                    </Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>{formatMXN(v.combustible)}</Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>
                      {formatMXN(v.mano_obra + v.refacciones)}
                    </Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>
                      <Text size="sm" fw={600}>{formatMXN(v.total)}</Text>
                      <Progress
                        value={(v.total / maxGasto) * 100}
                        size={3} mt={4} color="violet" radius="xl"
                      />
                    </Table.Td>
                    <Table.Td>
                      {v.costo_por_km == null ? (
                        <Tooltip label="Faltan lecturas de odómetro para medir el recorrido" withArrow>
                          <Text size="xs" c="dimmed">Sin kilometraje</Text>
                        </Tooltip>
                      ) : (
                        <Group gap="xs" wrap="nowrap">
                          <Text size="sm" fw={600} style={{ minWidth: 62, fontVariantNumeric: 'tabular-nums' }}>
                            {formatMXN(v.costo_por_km)}
                          </Text>
                          <Progress
                            value={(v.costo_por_km / maxCostoKm) * 100}
                            size="sm" radius="xl" style={{ flex: 1 }}
                            color={v.costo_por_km >= maxCostoKm * 0.75 ? 'red'
                                 : v.costo_por_km >= maxCostoKm * 0.4  ? 'orange' : 'teal'}
                          />
                        </Group>
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Seccion>

      {/* ── Rendimiento contra el propio modelo ── */}
      <Seccion
        titulo="Rendimiento contra las unidades gemelas"
        descripcion="Cada unidad comparada contra el promedio de las de su mismo modelo, que es la única comparación justa. Una unidad muy por debajo casi siempre trae algo mecánico o combustible que no llega al tanque; la columna de la derecha estima lo que ese faltante cuesta al año si sigue igual."
      >
        {conRendimiento.length === 0 ? (
          <Vacio>
            Hacen falta al menos tres cargas con kilometraje capturado por unidad
            para poder medir el rendimiento.
          </Vacio>
        ) : (
          <Table.ScrollContainer minWidth={720}>
            <Table striped withTableBorder highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Vehículo</Table.Th>
                  <Table.Th>Modelo</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>km/L</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Promedio del modelo</Table.Th>
                  <Table.Th style={{ textAlign: 'center' }}>Diferencia</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Sobrecosto anual</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {conRendimiento.map((v) => {
                  const d = v.desviacion_pct
                  const color = d == null ? 'gray' : d <= -15 ? 'red' : d < -5 ? 'orange' : d > 5 ? 'teal' : 'gray'
                  return (
                    <Table.Tr key={v.vehiculo_id}>
                      <Table.Td>
                        <LinkVehiculo
                          nombre={v.vehiculo}
                          onClick={onNavigateVehiculo ? () => onNavigateVehiculo(v.vehiculo_id) : undefined}
                        />
                      </Table.Td>
                      <Table.Td><Text size="sm" c="dimmed">{v.modelo}</Text></Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>
                        <Text size="sm" fw={600}>{v.rendimiento!.toFixed(2)}</Text>
                      </Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>
                        {v.rendimiento_modelo != null ? v.rendimiento_modelo.toFixed(2) : <Guion />}
                      </Table.Td>
                      <Table.Td style={{ textAlign: 'center' }}>
                        {d == null ? <Guion /> : (
                          <Badge variant="light" color={color} size="sm">
                            {d > 0 ? '+' : ''}{d.toFixed(1)}%
                          </Badge>
                        )}
                      </Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>
                        {v.sobrecosto_anual != null && v.sobrecosto_anual > 0
                          ? <Text size="sm" fw={600} c="red">{formatMXN(v.sobrecosto_anual)}</Text>
                          : <Guion />}
                      </Table.Td>
                    </Table.Tr>
                  )
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Seccion>

      {/* ── Retrabajos ── */}
      <Seccion
        titulo="Servicios que se repitieron"
        descripcion="El mismo tipo de servicio hecho dos veces a la misma unidad en menos de un mes. Casi siempre significa que la primera vez no quedó: es trabajo que se pagó dos veces."
        accion={data.retrabajos.length > 0 && (
          <Badge color="orange" variant="light" size="lg">{formatMXN(retrabajoTotal)}</Badge>
        )}
      >
        {data.retrabajos.length === 0 ? (
          <Vacio>Ningún servicio se repitió en menos de 30 días. </Vacio>
        ) : (
          <Table.ScrollContainer minWidth={640}>
            <Table striped withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Vehículo</Table.Th>
                  <Table.Th>Servicio</Table.Th>
                  <Table.Th>Primera vez</Table.Th>
                  <Table.Th>Se repitió</Table.Th>
                  <Table.Th style={{ textAlign: 'center' }}>Días</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Costo repetido</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data.retrabajos.map((r) => (
                  <Table.Tr key={`${r.vehiculo_id}-${r.fecha}-${r.tipo}`}>
                    <Table.Td>
                      <LinkVehiculo
                        nombre={r.vehiculo}
                        onClick={onNavigateVehiculo ? () => onNavigateVehiculo(r.vehiculo_id) : undefined}
                      />
                    </Table.Td>
                    <Table.Td><Text size="sm">{r.tipo}</Text></Table.Td>
                    <Table.Td><Text size="sm" c="dimmed">{formatFecha(r.fecha_previa)}</Text></Table.Td>
                    <Table.Td><Text size="sm">{formatFecha(r.fecha)}</Text></Table.Td>
                    <Table.Td style={{ textAlign: 'center' }}>
                      <Badge variant="light" color={r.dias <= 7 ? 'red' : 'orange'} size="sm">{r.dias}</Badge>
                    </Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>{formatMXN(r.costo)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Seccion>

      {/* ── Anomalías de combustible ── */}
      <Seccion
        titulo="Cargas que conviene revisar"
        descripcion="Registros de combustible que no cuadran: rendimiento fuera de rango, odómetros que retroceden, cargas sin vale o sin kilometraje. No todas son un problema —una carga sin vale puede ser solo captura pendiente—, pero son las que hay que mirar antes de firmar el gasto del mes. El importe es lo que costó esa carga, salvo en el rendimiento bajo, que se anualiza."
      >
        {data.anomalias.length === 0 ? (
          <Vacio>Ninguna carga del periodo levanta bandera.</Vacio>
        ) : (
          <Stack gap="md">
            <Group gap="xs" wrap="wrap">
              {data.anomalias_resumen.map((r) => {
                const meta = ANOMALIA_META[r.tipo]
                return (
                  <Tooltip key={r.tipo} label={meta.ayuda} multiline w={280} withArrow>
                    <Badge variant="light" color={meta.color} size="lg" style={{ cursor: 'help' }}>
                      {meta.label}: {r.cantidad}
                      {r.monto > 0 && ` · ${formatMXNCorto(r.monto)}${r.tipo === 'rendimiento_bajo' ? '/año' : ''}`}
                    </Badge>
                  </Tooltip>
                )
              })}
            </Group>
            {data.anomalias.length >= 100 && (
              <Alert color="gray" icon={<IconAlertTriangle size={16} />}>
                Se muestran las 100 más relevantes. Los totales de las etiquetas de
                arriba sí consideran todas.
              </Alert>
            )}
            <Table.ScrollContainer minWidth={720}>
              <Table striped withTableBorder highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Tipo</Table.Th>
                    <Table.Th>Vehículo</Table.Th>
                    <Table.Th>Fecha</Table.Th>
                    <Table.Th>Detalle</Table.Th>
                    <Table.Th style={{ textAlign: 'right' }}>Importe</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {data.anomalias.map((a) => {
                    const meta = ANOMALIA_META[a.tipo]
                    return (
                      <Table.Tr key={a.key}>
                        <Table.Td>
                          <Badge variant="light" color={meta.color} size="sm">{meta.label}</Badge>
                        </Table.Td>
                        <Table.Td>
                          <LinkVehiculo
                            nombre={a.vehiculo}
                            onClick={onNavigateVehiculo ? () => onNavigateVehiculo(a.vehiculo_id) : undefined}
                          />
                        </Table.Td>
                        <Table.Td><Text size="sm" c="dimmed">{formatFecha(a.fecha)}</Text></Table.Td>
                        <Table.Td><Text size="sm">{a.detalle}</Text></Table.Td>
                        {/* El importe no significa lo mismo en todos los renglones: en
                            una carga es lo que costó esa carga, y en un rendimiento bajo
                            es lo que ese faltante cuesta al año. Se marca en el propio
                            renglón para que nadie sume peras con manzanas. */}
                        <Table.Td style={{ textAlign: 'right' }}>
                          {a.monto == null || a.monto <= 0 ? <Guion /> : (
                            <Text size="sm" style={{ whiteSpace: 'nowrap' }}>
                              {formatMXN(a.monto)}
                              {a.tipo === 'rendimiento_bajo' && (
                                <Text component="span" size="xs" c="dimmed"> /año</Text>
                              )}
                            </Text>
                          )}
                        </Table.Td>
                      </Table.Tr>
                    )
                  })}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Stack>
        )}
      </Seccion>

      <Text size="xs" c="dimmed" ta="center">
        Periodo analizado: {formatFecha(data.rango.start)} a hoy ({ventana} días).
        El sobrecosto anual se extrapola del ritmo de este periodo.
      </Text>
    </>
  )
}
