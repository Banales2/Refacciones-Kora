// Pestaña "Costos y ahorro" del tablero.
//
// El resto del tablero responde "¿cuánto llevamos gastado?". Esta pestaña
// responde la que sigue: "¿de eso, cuánto no debimos gastar?". Cada bloque es
// una comparación contra una referencia —el mismo modelo, la otra gasolinera,
// el otro proveedor, el servicio anterior— y termina en pesos, porque un
// porcentaje no autoriza una decisión y una cifra en pesos sí.
import { useMemo, useState } from 'react'
import {
  Alert, Badge, Button, Card, Center, Group, Loader, Popover, Progress, SegmentedControl, Select,
  SimpleGrid, Stack, Table, Text, Tooltip,
} from '@mantine/core'
import { AreaChart, BarChart, LineChart } from '@mantine/charts'
import {
  IconAlertTriangle, IconCashBanknote, IconDiscount2, IconDroplet,
  IconFileTypePdf, IconGasStation, IconRoad,
} from '@tabler/icons-react'
import {
  useAnalisisCostos, useCobrosCasetas, fetchAnomaliasCostos, NOMBRE_GRUPO,
  type AnalisisCostos, type CobrosCasetas, type TipoAnomalia, type VentanaCostos,
} from '../hooks/useDashboard'
import { useErroresCaptura } from '../hooks/useRevision'
import { usePermisos, type Seccion } from '../hooks/usePermisos'
import { COLOR_HALLAZGO, TITULO_HALLAZGO } from '../lib/hallazgosCasetas'
import { StatCard } from './StatCard'
import { IrASeccion } from './IrASeccion'
import { formatMXN, formatMXNCorto, formatMes, formatNum, formatLitros, formatFecha } from '../lib/formato'
import { TIPO_LABELS } from '../lib/tipoVehiculo'
import { SIN_PRODUCTO } from '../lib/combustible'
import { exportAnomaliasPdf } from '../lib/reportes/costos'

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
    ayuda: 'Se pagó el litro muy por encima de lo que costó ese combustible el mismo mes.',
  },
  precio_bajo: {
    label: 'Precio por litro sospechosamente bajo', color: 'orange',
    ayuda: 'Nadie vende el litro tan barato: casi siempre es un dígito mal capturado en el costo o en los litros. Corrígelo contra el ticket; mientras tanto no entra al precio de su gasolinera.',
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
  ventana, onVentanaChange, onNavigateVehiculo, onNavigatePieza, onNavigateSeccion,
}: {
  ventana:          VentanaCostos
  onVentanaChange:  (v: VentanaCostos) => void
  onNavigateVehiculo?: (vehiculoId: number) => void
  onNavigatePieza?:    (piezaId: number) => void
  onNavigateSeccion?:  (s: Seccion) => void
}) {
  const { data, isLoading } = useAnalisisCostos(ventana)
  // Aparte del análisis: recalcula los hallazgos de cada factura de PASE del
  // periodo y tarda más. El resto de la pestaña no tiene por qué esperarlo.
  const cobros = useCobrosCasetas(ventana)

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
        cobros={cobros.data?.data} cargandoCobros={cobros.isLoading} errorCobros={cobros.isError}
        onNavigateVehiculo={onNavigateVehiculo} onNavigatePieza={onNavigatePieza}
        onNavigateSeccion={onNavigateSeccion} />
    </Stack>
  )
}

// ─── Gasolineras ────────────────────────────────────────────────────────────

// Un color fijo por gasolinera, asignado por id: el color sigue a la
// gasolinera y no a su lugar en la gráfica, así que cambiar de combustible no
// la repinta. Validada para daltonismo sobre fondo claro y oscuro. De la
// séptima en adelante salen en gris; con más gasolineras habría que agrupar.
const COLORES_GASOLINERA = ['blue.7', 'orange.8', 'teal.7', 'grape.7', 'red.8', 'indigo.7']

/** El mismo mínimo que usa el servicio para juzgar lo que rinde una gasolinera. */
const TRAMOS_MIN_GASOLINERA = 5
/**
 * Cuánto tiene que ganarle al segundo lugar el litro efectivo para llamarse
 * "rinde más por peso": 1 %. Por debajo es ruido de la medición —el tanque
 * nunca queda igual de lleno— y la etiqueta sugería una diferencia que no hay.
 */
const VENTAJA_MIN_EFECTIVO = 0.01

function SeccionGasolineras({ data }: { data: AnalisisCostos }) {
  const t = data.totales

  // Ya vienen en orden (Diesel, Magna, Premium y al final lo que no se sabe).
  const productos = useMemo(
    () => [...new Set(data.gasolineras.map((g) => g.producto))],
    [data.gasolineras],
  )
  // Arranca en el combustible donde más litros se cargan: es donde está el dinero.
  const masCargado = useMemo(
    () => [...data.precios_litro]
      .filter((p) => p.producto !== SIN_PRODUCTO && productos.includes(p.producto))
      .sort((a, b) => b.litros - a.litros)[0]?.producto ?? productos[0],
    [data.precios_litro, productos],
  )
  const [elegido, setElegido] = useState<string | null>(null)
  const producto = elegido != null && productos.includes(elegido) ? elegido : masCargado

  const colorDe = useMemo(() => {
    const ids = [...new Set([
      ...data.gasolineras.map((g) => g.gasolinera_id),
      ...data.precios_mensuales.map((p) => p.gasolinera_id),
    ])].sort((a, b) => a - b)
    return (id: number) => COLORES_GASOLINERA[ids.indexOf(id)] ?? 'gray.6'
  }, [data.gasolineras, data.precios_mensuales])

  if (data.gasolineras.length === 0) {
    return (
      <Seccion titulo="Precio y rendimiento por gasolinera">
        <Vacio>Sin recargas registradas en el periodo.</Vacio>
      </Seccion>
    )
  }

  const renglones = data.gasolineras.filter((g) => g.producto === producto)
  const minimo = data.precios_litro.find((p) => p.producto === producto)?.precio_minimo ?? null

  // La diferencia contra la más barata y no el precio: entre $26.99 y $27.90
  // hay 3 %, y en barras que arrancan en cero se ven idénticas. La diferencia
  // sí arranca en cero de verdad.
  const diferencias = minimo == null ? [] : renglones
    .filter((g) => g.precio_litro != null)
    .map((g) => ({ gasolinera: g.gasolinera, diferencia: Math.round((g.precio_litro! - minimo) * 100) / 100 }))
    .sort((a, b) => b.diferencia - a.diferencia)

  // Lo que rinde, contra el modelo de cada unidad. Solo las que juntaron
  // suficientes tramos; las demás salen en la tabla sin el dato.
  // Tráileres y unidades en barras separadas: revueltos, la gasolinera donde
  // cargan más tractocamiones salía rindiendo menos solo por quién carga ahí.
  const grupoDe = (g: typeof renglones[number], grupo: 'traileres' | 'unidades') =>
    g.por_grupo.find((p) => p.grupo === grupo)?.eficiencia_pct ?? null
  const rinden = renglones
    .filter((g) => g.por_grupo.some((p) => p.eficiencia_pct != null))
    .map((g) => ({
      gasolinera: g.gasolinera,
      [NOMBRE_GRUPO.traileres]: grupoDe(g, 'traileres'),
      [NOMBRE_GRUPO.unidades]:  grupoDe(g, 'unidades'),
    }))
  const seriesRinden = (['traileres', 'unidades'] as const)
    .filter((k) => rinden.some((r) => r[NOMBRE_GRUPO[k]] != null))
    .map((k) => ({
      name: NOMBRE_GRUPO[k],
      // Fijos por grupo: el color sigue al grupo aunque el otro no aparezca.
      color: k === 'traileres' ? 'orange.7' : 'blue.6',
    }))
  // Con una sola no hay a quién ganarle, y por centavos tampoco: Vázquez y
  // Dakota quedaban en $26.92 contra $26.93 y la etiqueta coronaba un empate.
  const efectivos = renglones
    .map((g) => g.precio_efectivo)
    .filter((p): p is number => p != null)
    .sort((a, b) => a - b)
  const mejorEfectivo = efectivos.length > 1 && efectivos[1] - efectivos[0] >= efectivos[0] * VENTAJA_MIN_EFECTIVO
    ? efectivos[0]
    : null

  const mensual = data.precios_mensuales.filter((p) => p.producto === producto && p.precio_litro != null)
  const meses = [...new Set(mensual.map((p) => p.mes))].sort()
  const series = [...new Map(mensual.map((p) => [p.gasolinera_id, p.gasolinera])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([id, nombre]) => ({ name: nombre, color: colorDe(id) }))
  const tendencia = meses.map((mes) => {
    const fila: Record<string, string | number> = { mes: formatMes(mes) }
    for (const p of mensual) if (p.mes === mes) fila[p.gasolinera] = p.precio_litro!
    return fila
  })

  return (
    <Seccion
      titulo="Precio y rendimiento por gasolinera"
      descripcion="Lo que costó el litro en cada una durante el periodo. El sobreprecio es lo que se pagó de más contra la más barata de las que ya se visitan con regularidad (al menos tres cargas), en el mismo combustible: un ahorro que solo requiere cambiar a dónde se manda a cargar. Las cargas con el litro a más de 15 % de lo normal no entran al precio —casi siempre son un dígito mal capturado— y aparecen en Anomalías."
      accion={t.ahorro_combustible > 0 && (
        <Tooltip label="Sobreprecio de todos los combustibles juntos" withArrow>
          <Badge color="teal" variant="light" size="lg">{formatMXN(t.ahorro_combustible)}</Badge>
        </Tooltip>
      )}
    >
      <Stack gap="md">
        <Group justify="space-between" align="center" wrap="wrap">
          <SegmentedControl size="xs" value={producto} onChange={setElegido} data={productos} />
          {minimo != null && (
            <Text size="sm" c="dimmed">
              La más barata en {producto}: <Text component="span" fw={600} c="var(--mantine-color-text)">${minimo.toFixed(2)}/L</Text>
            </Text>
          )}
        </Group>

        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
          <div>
            <Text size="sm" fw={500} mb={4}>Cuánto más cuesta el litro que en la más barata</Text>
            {producto === SIN_PRODUCTO ? (
              <Vacio>Sin combustible especificado no se compara: puede ser Magna o Premium.</Vacio>
            ) : diferencias.length === 0 ? (
              <Vacio>Todavía ninguna gasolinera tiene tres cargas de {producto} en el periodo para servir de referencia.</Vacio>
            ) : (
              <BarChart
                h={Math.max(160, diferencias.length * 40)}
                data={diferencias}
                dataKey="gasolinera"
                orientation="vertical"
                yAxisProps={{ width: 150 }}
                series={[{ name: 'diferencia', color: 'cyan.6', label: 'Más que la más barata' }]}
                valueFormatter={(v) => (v > 0 ? `+$${v.toFixed(2)}/L` : v < 0 ? `−$${Math.abs(v).toFixed(2)}/L` : 'La más barata')}
                gridAxis="x"
              />
            )}
          </div>
          <div>
            <Text size="sm" fw={500} mb={4}>Cómo se ha movido, mes por mes (últimos 12 meses)</Text>
            {producto === SIN_PRODUCTO ? (
              <Vacio>Sin combustible especificado no hay tendencia: la mezcla movería la línea, no el precio.</Vacio>
            ) : meses.length === 0 ? (
              <Vacio>Sin cargas de {producto} en los últimos 12 meses.</Vacio>
            ) : (
              <>
                <LineChart
                  h={240}
                  data={tendencia}
                  dataKey="mes"
                  series={series}
                  withLegend={series.length > 1}
                  legendProps={{ verticalAlign: 'bottom' }}
                  connectNulls
                  curveType="linear"
                  strokeWidth={2}
                  yAxisProps={{ domain: ['dataMin - 0.5', 'dataMax + 0.5'], width: 60 }}
                  valueFormatter={(v) => `$${v.toFixed(2)}`}
                />
                {meses.length === 1 && (
                  <Text size="xs" c="dimmed" mt={4}>Con un solo mes de cargas todavía no hay tendencia.</Text>
                )}
              </>
            )}
          </div>
        </SimpleGrid>

        <div>
          <Text size="sm" fw={500}>Cuánto rinde cada litro</Text>
          <Text size="xs" c="dimmed" mb={4}>
            Los kilómetros que recorrieron las unidades con lo que cargaron aquí, contra el promedio de
            su mismo modelo, con los tráileres aparte: rinden mucho menos por su tamaño, y donde cargan
            más tráileres el rendimiento baja aunque la gasolinera no tenga nada. Cada tramo se le cuenta
            a la carga que lo cierra, que es donde sale una bomba que marca más de lo que despacha.
            Hacen falta {TRAMOS_MIN_GASOLINERA} tramos con kilometraje por grupo para juzgarla.
          </Text>
          {producto === SIN_PRODUCTO ? (
            <Vacio>Sin combustible especificado no se compara: puede ser Magna o Premium.</Vacio>
          ) : rinden.length === 0 ? (
            <Vacio>Ninguna gasolinera tiene todavía {TRAMOS_MIN_GASOLINERA} tramos de {producto} con kilometraje en el periodo.</Vacio>
          ) : (
            <BarChart
              h={Math.max(120, rinden.length * seriesRinden.length * 28)}
              data={rinden}
              dataKey="gasolinera"
              orientation="vertical"
              withLegend={seriesRinden.length > 1}
              yAxisProps={{ width: 150 }}
              xAxisProps={{ tickFormatter: (v: number) => `${v > 0 ? '+' : ''}${v}%` }}
              series={seriesRinden}
              valueFormatter={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}% contra su modelo`}
              gridAxis="x"
            />
          )}
        </div>

        <Table.ScrollContainer minWidth={820}>
          <Table striped withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Gasolinera</Table.Th>
                <Table.Th style={{ textAlign: 'center' }}>Cargas</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Litros</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Gasto</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>$/L</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Sobreprecio</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Rendimiento</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>
                  <Tooltip
                    withArrow multiline w={280}
                    label="El litro corregido por lo que rinde. Un litro más barato que recorre 10 % menos sale más caro: con este se decide a dónde mandar a cargar."
                  >
                    <span>$/L efectivo</span>
                  </Tooltip>
                </Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {renglones.map((g) => (
                <Table.Tr key={`${g.gasolinera_id}-${g.producto}`}>
                  <Table.Td fw={500}>{g.gasolinera}</Table.Td>
                  <Table.Td style={{ textAlign: 'center' }}>{g.recargas}</Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>{formatLitros(g.litros)}</Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>{formatMXN(g.costo)}</Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>
                    <Group gap={6} justify="flex-end" wrap="nowrap">
                      {g.atipicas > 0 && (
                        <Tooltip
                          withArrow multiline w={260}
                          label={`${g.atipicas === 1 ? 'Una carga' : `${g.atipicas} cargas`} con el litro muy lejos de lo normal no ${g.atipicas === 1 ? 'entra' : 'entran'} a este precio, aunque sí a litros y gasto. ${g.atipicas === 1 ? 'Está' : 'Están'} en Anomalías.`}
                        >
                          <Badge size="xs" variant="light" color="orange">
                            {g.atipicas} {g.atipicas === 1 ? 'atípica' : 'atípicas'}
                          </Badge>
                        </Tooltip>
                      )}
                      {g.precio_litro != null ? `$${g.precio_litro.toFixed(2)}` : <Guion />}
                    </Group>
                  </Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>
                    {g.sobreprecio > 0
                      ? <Text size="sm" c="orange" fw={600}>{formatMXN(g.sobreprecio)}</Text>
                      // Sin referencia (sin producto, o nadie con tres cargas) no
                      // se comparó con nadie: no es "la más barata", es no saberlo.
                      : minimo == null || g.precio_litro == null
                        ? <Guion />
                        : <Badge size="sm" variant="light" color="teal">La más barata</Badge>}
                  </Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>
                    {g.por_grupo.length === 0 ? <Guion /> : (
                      <Stack gap={2} align="flex-end">
                        {/* Un renglón por grupo: el km/L de un tráiler no se compara
                            con el de una camioneta. */}
                        {g.por_grupo.map((p) => (
                          <Group key={p.grupo} gap={6} justify="flex-end" wrap="nowrap">
                            <Text size="xs" c="dimmed">{NOMBRE_GRUPO[p.grupo]}</Text>
                            {p.rendimiento == null ? (
                              <Tooltip label={`${p.tramos} de ${TRAMOS_MIN_GASOLINERA} tramos con kilometraje`} withArrow>
                                <Text size="xs" c="dimmed">pocos datos</Text>
                              </Tooltip>
                            ) : (
                              <>
                                <Text size="sm">{p.rendimiento.toFixed(2)} km/L</Text>
                                {p.eficiencia_pct != null && (
                                  <Badge variant="light" color={colorEficiencia(p.eficiencia_pct)} size="sm">
                                    {p.eficiencia_pct > 0 ? '+' : ''}{p.eficiencia_pct.toFixed(1)}%
                                  </Badge>
                                )}
                              </>
                            )}
                          </Group>
                        ))}
                      </Stack>
                    )}
                  </Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>
                    {g.precio_efectivo == null ? <Guion /> : (
                      <Group gap={6} justify="flex-end" wrap="nowrap">
                        {g.precio_efectivo === mejorEfectivo && (
                          <Badge size="sm" variant="light" color="teal">Rinde más por peso</Badge>
                        )}
                        <Text size="sm" fw={600}>${g.precio_efectivo.toFixed(2)}</Text>
                      </Group>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Stack>
    </Seccion>
  )
}

/** El último día del periodo, YYYY-MM-DD: el rango llega semiabierto. */
// ─── Sucursales ─────────────────────────────────────────────────────────────

/** Mismos cortes que la tabla de rendimiento por unidad. */
function colorEficiencia(d: number | null): string {
  return d == null ? 'gray' : d <= -15 ? 'red' : d < -5 ? 'orange' : d > 5 ? 'teal' : 'gray'
}

// Cada unidad cuenta en la sucursal donde tiene base. El gasto total depende de
// cuántas unidades tiene cada patio, así que lo que compara de verdad es el
// costo por km y la eficiencia contra el propio modelo: una sucursal con
// camionetas siempre tiene mejor km/L que una con camiones.
function SeccionSucursales({ data, notaCasetas }: { data: AnalisisCostos; notaCasetas: string }) {
  const sucursales = data.sucursales
  const conBase = sucursales.filter((s) => s.sucursal_id != null)
  const hayCasetas = sucursales.some((s) => s.casetas > 0)
  const maxCostoKm = Math.max(...conBase.map((s) => s.costo_por_km ?? 0), 0.01)

  const grafica = sucursales.map((s) => ({
    sucursal: s.sucursal,
    'Combustible': s.combustible,
    'Taller': s.mano_obra + s.refacciones,
    'Casetas': s.casetas,
  }))

  return (
    <Seccion
      titulo="Sucursales lado a lado"
      descripcion={`Cada unidad cuenta en la sucursal donde tiene base. El total depende de cuántas unidades tiene cada una; lo que se compara es el costo por kilómetro y el rendimiento contra las unidades del mismo modelo en otras sucursales. Los km se suman lectura por lectura y se descartan los saltos imposibles del odómetro. "Sin base fija" son los tractocamiones, las unidades que rotan entre sucursales y los utilitarios sin sucursal asignada: van aparte.${notaCasetas}`}
    >
      {conBase.length === 0 ? (
        <Vacio>Ninguna unidad con sucursal tuvo movimiento en el periodo.</Vacio>
      ) : (
        <Stack gap="md">
          <BarChart
            h={Math.max(140, grafica.length * 44)}
            data={grafica}
            dataKey="sucursal"
            type="stacked"
            orientation="vertical"
            withLegend
            gridAxis="x"
            yAxisProps={{ width: 120 }}
            xAxisProps={{ tickFormatter: formatMXNCorto }}
            valueFormatter={(v) => formatMXN(v)}
            series={[
              // Los mismos colores que la gráfica de gasto mensual.
              { name: 'Combustible', color: 'cyan.6'   },
              { name: 'Taller',      color: 'violet.6' },
              ...(hayCasetas ? [{ name: 'Casetas', color: 'teal.6' }] : []),
            ]}
          />

          <Table.ScrollContainer minWidth={1080}>
            <Table striped withTableBorder highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Sucursal</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Km</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Combustible</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Taller</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Casetas</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Total</Table.Th>
                  <Table.Th style={{ width: 160 }}>
                    <Tooltip label="Solo con las unidades que tienen kilometraje: el gasto de las demás no se reparte sobre km ajenos" withArrow multiline w={260}>
                      <span>Costo por km</span>
                    </Tooltip>
                  </Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Combustible por km</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>
                    <Tooltip label="El km/L revuelve modelos. La etiqueta es la comparación justa: qué tanto rinden sus unidades contra el promedio de su mismo modelo" withArrow multiline w={280}>
                      <span>Rendimiento</span>
                    </Tooltip>
                  </Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Sobrecosto anual</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Por revisar</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {sucursales.map((s) => {
                  const sinBase = s.sucursal_id == null
                  return (
                    <Table.Tr key={s.sucursal_id ?? 'sin-base'}>
                      <Table.Td>
                        <Text size="sm" fw={500} c={sinBase ? 'dimmed' : undefined}>{s.sucursal}</Text>
                        <Text size="xs" c="dimmed">
                          {s.unidades} de {s.unidades_flota} unidad{s.unidades_flota !== 1 ? 'es' : ''} con movimiento
                        </Text>
                      </Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>
                        {s.km_recorridos > 0 ? formatNum(s.km_recorridos) : <Guion />}
                        {s.unidades_con_km < s.unidades && (
                          <Text size="xs" c="dimmed">{s.unidades_con_km} de {s.unidades} medibles</Text>
                        )}
                      </Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>
                        <Text size="sm">{formatMXN(s.combustible)}</Text>
                        <Text size="xs" c="dimmed">
                          {formatLitros(s.litros)} L{s.precio_litro != null ? ` · $${s.precio_litro.toFixed(2)}/L` : ''}
                        </Text>
                      </Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>{formatMXN(s.mano_obra + s.refacciones)}</Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>
                        {s.casetas > 0 ? formatMXN(s.casetas) : <Guion />}
                      </Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>
                        <Text size="sm" fw={600}>{formatMXN(s.total)}</Text>
                        {s.gasto_por_unidad != null && (
                          <Text size="xs" c="dimmed">{formatMXN(s.gasto_por_unidad)} por unidad</Text>
                        )}
                      </Table.Td>
                      <Table.Td>
                        {s.costo_por_km == null ? (
                          <Text size="xs" c="dimmed">Sin kilometraje</Text>
                        ) : (
                          <Group gap="xs" wrap="nowrap">
                            <Text size="sm" fw={600} style={{ minWidth: 62, fontVariantNumeric: 'tabular-nums' }}>
                              {formatMXN(s.costo_por_km)}
                            </Text>
                            {/* La barra solo entre sucursales con base: "Sin base fija"
                                son tractocamiones y no se mide contra un patio. */}
                            {!sinBase && (
                              <Progress
                                value={(s.costo_por_km / maxCostoKm) * 100}
                                size="sm" radius="xl" style={{ flex: 1 }}
                                color={s.costo_por_km >= maxCostoKm * 0.75 ? 'red'
                                     : s.costo_por_km >= maxCostoKm * 0.4  ? 'orange' : 'teal'}
                              />
                            )}
                          </Group>
                        )}
                      </Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>
                        {s.combustible_por_km != null ? formatMXN(s.combustible_por_km) : <Guion />}
                      </Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>
                        {s.rendimiento == null ? <Guion /> : (
                          <Group gap={6} justify="flex-end" wrap="nowrap">
                            <Text size="sm">{s.rendimiento.toFixed(2)} km/L</Text>
                            {s.eficiencia_pct != null ? (
                              <Tooltip label="Contra las unidades del mismo modelo en otras sucursales" withArrow>
                                <Badge variant="light" color={colorEficiencia(s.eficiencia_pct)} size="sm">
                                  {s.eficiencia_pct > 0 ? '+' : ''}{s.eficiencia_pct.toFixed(1)}%
                                </Badge>
                              </Tooltip>
                            ) : (
                              <Tooltip
                                label="Ninguno de sus modelos tiene en otra sucursal unidades con suficientes cargas para comparar. El km/L solo no sirve: revuelve modelos."
                                withArrow multiline w={260}
                              >
                                <Text size="xs" c="dimmed">sin con quién comparar</Text>
                              </Tooltip>
                            )}
                          </Group>
                        )}
                      </Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>
                        {s.sobrecosto_anual > 0
                          ? <Text size="sm" fw={600} c="red">{formatMXN(s.sobrecosto_anual)}</Text>
                          : <Guion />}
                      </Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>
                        {s.anomalias === 0 ? <Guion /> : (
                          <Tooltip
                            label={`${s.sin_vale} carga${s.sin_vale !== 1 ? 's' : ''} sin vale · ${s.sin_odometro} sin kilometraje · ${s.anomalias - s.sin_vale - s.sin_odometro} más`}
                            withArrow
                          >
                            <Badge variant="light" color="orange" size="sm">{s.anomalias}</Badge>
                          </Tooltip>
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
  )
}

function ultimoDiaDe(rango: { end: string }): string {
  const d = new Date(`${rango.end}T12:00:00`)
  d.setDate(d.getDate() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function Contenido({
  data, ventana, cobros, cargandoCobros, errorCobros,
  onNavigateVehiculo, onNavigatePieza, onNavigateSeccion,
}: {
  data: AnalisisCostos
  ventana: VentanaCostos
  cobros?: CobrosCasetas
  cargandoCobros: boolean
  errorCobros: boolean
  onNavigateVehiculo?: (vehiculoId: number) => void
  onNavigatePieza?:    (piezaId: number) => void
  onNavigateSeccion?:  (s: Seccion) => void
}) {
  const t = data.totales
  const { esAdmin } = usePermisos()

  // PASE factura cada diez días: si su último cruce facturado no llega al fin
  // del periodo, las casetas de esos días todavía no están sumadas.
  const casetasIncompletas = t.casetas_hasta != null && t.casetas_hasta < ultimoDiaDe(data.rango)
  const notaCasetas = casetasIncompletas
    ? ` Las casetas están facturadas hasta el ${formatFecha(t.casetas_hasta!)}: los cruces posteriores todavía no se suman.`
    : ''

  // La barra de cada renglón se mide contra el peor del periodo, no contra un
  // valor fijo: lo que interesa es el orden relativo dentro de la flota.
  const maxCostoKm = Math.max(...data.vehiculos.map((v) => v.costo_por_km ?? 0), 0.01)
  const maxGasto   = Math.max(...data.vehiculos.map((v) => v.total), 1)

  const gastoMensual = data.gasto_mensual.map((g) => ({
    mes: formatMes(g.mes),
    'Combustible': g.combustible,
    'Mano de obra': g.mano_obra,
    'Refacciones': g.refacciones,
    'Casetas': g.casetas,
  }))
  const hayCasetas = data.gasto_mensual.some((g) => g.casetas > 0)

  // Solo las unidades con suficientes cargas para que el km/L signifique algo;
  // el backend ya deja en null las que no llegan, aquí solo se filtran.
  const conRendimiento = data.vehiculos
    .filter((v) => v.rendimiento != null)
    .sort((a, b) => (a.desviacion_pct ?? 0) - (b.desviacion_pct ?? 0))

  const retrabajoTotal = data.retrabajos.reduce((s, r) => s + r.costo, 0)

  const preciosProducto = data.precios_litro
    .filter((p) => p.precio_litro != null)
    .map((p) => `${p.producto} $${p.precio_litro!.toFixed(2)}`)
    .join(' · ')

  return (
    <>
      {/* ── El titular: lo identificado como recuperable ── */}
      {(t.ahorro_total > 0 || (cobros?.total ?? 0) > 0) && (
        <Alert color="teal" icon={<IconDiscount2 size={18} />} title="Ahorro identificado en el periodo">
          {t.ahorro_total > 0 && (
            <Text size="sm">
              <strong>{formatMXN(t.ahorro_total)}</strong> se pudieron no gastar:{' '}
              {formatMXN(t.ahorro_refacciones)} comprando cada refacción con el proveedor
              que la tiene más barata y {formatMXN(t.ahorro_combustible)} cargando siempre
              en la gasolinera más económica de las que ya se visitan. El detalle de cada
              peso está en las tablas de abajo.
            </Text>
          )}
          {/* Aparte y sin sumarse: aquello se ahorra cambiando de proveedor, esto
              se le reclama a PASE. Son dos acciones distintas. */}
          {cobros && cobros.total > 0 && (
            <Text size="sm" mt={t.ahorro_total > 0 ? 4 : 0}>
              Además, PASE pudo cobrar <strong>{formatMXN(cobros.total)}</strong> de más en
              casetas: eso no se ahorra cambiando de proveedor, se le reclama.
            </Text>
          )}
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
          ayuda="Combustible + mano de obra + refacciones consumidas + casetas de cada unidad, entre los kilómetros que avanzó el odómetro de la flota en el periodo. Las casetas de un tag sin unidad no entran: no se sabe de quién son."
        />
        <StatCard
          label="Rendimiento de la flota"
          value={t.rendimiento != null ? `${t.rendimiento.toFixed(2)} km/L` : '—'}
          sub={t.rendimiento_grupos.length > 1
            ? t.rendimiento_grupos
                .map((g) => `${NOMBRE_GRUPO[g.grupo]} ${g.rendimiento != null ? g.rendimiento.toFixed(2) : '—'}`)
                .join(' · ') + ' km/L'
            : `${formatLitros(t.litros)} L cargados`}
          color="blue" icon={IconDroplet}
          ayuda="Kilómetros recorridos entre litros cargados, midiendo de una carga a la siguiente. Solo entran las unidades con al menos tres tramos completos. Abajo, tráileres y el resto por separado: un tractocamión rinde mucho menos por su tamaño, y el número de arriba depende de cuántos hay."
        />
        <StatCard
          label="Precio por litro"
          value={t.precio_litro != null ? `$${t.precio_litro.toFixed(2)}` : '—'}
          sub={preciosProducto || 'Promedio ponderado del periodo'}
          color="cyan" icon={IconGasStation}
          ayuda="Lo pagado entre los litros cargados, de todos los combustibles juntos y ponderado: una carga grande pesa más que una chica. Abajo, el de cada combustible, que es el que sirve para comparar: el Premium siempre cuesta más que la Magna."
        />
        <StatCard
          label="Salida de caja"
          value={formatMXNCorto(t.total_caja)}
          sub={`Combustible ${formatMXNCorto(t.combustible)} · Taller ${formatMXNCorto(t.mano_obra)} · Casetas ${formatMXNCorto(t.casetas)}`}
          color="grape" icon={IconCashBanknote}
          ayuda={`Combustible + mano de obra + refacciones compradas al almacén + casetas. Las refacciones consumidas por los mantenimientos no se suman aparte: ya se pagaron al comprarlas.${notaCasetas}`}
        />
      </SimpleGrid>

      {/* ── Tendencia de gasto ── */}
      <Seccion
        titulo="En qué se va el dinero"
        descripcion={`Gasto mensual de los últimos doce meses, una línea por concepto. Las refacciones son las compradas al almacén, no las consumidas. Las casetas van por el mes del cruce y llegan con la factura de PASE, así que el último mes suele venir corto.${notaCasetas}`}
      >
        {gastoMensual.length < 2 ? (
          <Vacio>Aún no hay suficiente historial para ver la tendencia.</Vacio>
        ) : (
          // Sin apilar: apiladas, cada línea marca la suma con las de abajo, y
          // cuando solo sube el combustible las de mano de obra y refacciones
          // suben con él aunque valgan cero. Así cada una va a su propia altura.
          <AreaChart
            h={280}
            data={gastoMensual}
            dataKey="mes"
            withLegend
            withDots={false}
            curveType="monotone"
            fillOpacity={0.15}
            valueFormatter={(v) => formatMXN(v)}
            yAxisProps={{ width: 70, tickFormatter: formatMXNCorto }}
            series={[
              { name: 'Combustible',  color: 'cyan.6'   },
              { name: 'Mano de obra', color: 'violet.6' },
              { name: 'Refacciones',  color: 'orange.6' },
              // Sin facturas de PASE no hay línea: una en cero solo estorba.
              ...(hayCasetas ? [{ name: 'Casetas', color: 'teal.6' }] : []),
            ]}
          />
        )}
      </Seccion>

      {/* ── Sucursales lado a lado ── */}
      <SeccionSucursales data={data} notaCasetas={notaCasetas} />

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
      <SeccionGasolineras data={data} />

      {/* ── Casetas: lo que PASE pudo cobrar de más ── */}
      <SeccionCobrosCasetas
        cobros={cobros} cargando={cargandoCobros} error={errorCobros}
        onNavigateSeccion={onNavigateSeccion}
      />

      {/* ── Costo por kilómetro ── */}
      <Seccion
        titulo="Cuánto cuesta cada kilómetro, unidad por unidad"
        descripcion="Todo lo que consumió la unidad entre los kilómetros que avanzó. Es la métrica que separa a la unidad cara de la unidad que simplemente trabaja mucho: la de arriba es la que conviene revisar, reasignar o dar de baja."
      >
        {data.vehiculos.length === 0 ? (
          <Vacio>Sin movimiento registrado en el periodo.</Vacio>
        ) : (
          <Table.ScrollContainer minWidth={860}>
            <Table striped withTableBorder highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Vehículo</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Km</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Combustible</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Taller</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Casetas</Table.Th>
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
                      <Text size="xs" c="dimmed">
                        {TIPO_LABELS[v.tipo] ?? v.tipo} · {v.sucursal ?? 'Sin base fija'}
                      </Text>
                    </Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>
                      {v.km_recorridos != null ? formatNum(v.km_recorridos) : <Guion />}
                    </Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>{formatMXN(v.combustible)}</Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>
                      {formatMXN(v.mano_obra + v.refacciones)}
                    </Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>
                      {v.casetas > 0 ? formatMXN(v.casetas) : <Guion />}
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
        accion={data.anomalias.length > 0 && (
          <PdfAnomalias ventana={ventana} sucursales={data.sucursales} />
        )}
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

      {/* El acumulado por persona es solo de admin: la API lo niega al resto, y
          la sección ni se pide para no enseñar un error que no le toca. */}
      {esAdmin && (
        <SeccionErroresCaptura desde={data.rango.start} onNavigateSeccion={onNavigateSeccion} />
      )}

      <Text size="xs" c="dimmed" ta="center">
        Periodo analizado: {formatFecha(data.rango.start)} a hoy ({ventana} días).
        El sobrecosto anual se extrapola del ritmo de este periodo.
      </Text>
    </>
  )
}

// El PDF se pide aparte y no sale de `data`: el tablero trae solo las 100
// anomalías más relevantes, y la hoja de una sucursal tiene que ir completa.
const TODAS = 'todas'

function PdfAnomalias({ ventana, sucursales }: {
  ventana:    VentanaCostos
  sucursales: AnalisisCostos['sucursales']
}) {
  const [abierto, setAbierto]   = useState(false)
  const [sucursal, setSucursal] = useState<string>(TODAS)
  const [generando, setGenerando] = useState(false)
  const [error, setError]       = useState<string | null>(null)

  const opciones = [
    { value: TODAS, label: 'Todas las sucursales' },
    ...sucursales
      .filter((s) => s.anomalias > 0)
      .map((s) => ({ value: String(s.sucursal_id ?? 'sin'), label: `${s.sucursal} (${s.anomalias})` })),
  ]

  async function generar() {
    setGenerando(true)
    setError(null)
    try {
      const { data } = await fetchAnomaliasCostos(ventana, sucursal === TODAS ? null : sucursal)
      await exportAnomaliasPdf(data)
      setAbierto(false)
    } catch (e) {
      setError((e as Error).message || 'No se pudo generar el reporte.')
    } finally {
      setGenerando(false)
    }
  }

  return (
    <Popover opened={abierto} onChange={setAbierto} position="bottom-end" width={280} withArrow shadow="md">
      <Popover.Target>
        <Button
          size="xs" variant="light" leftSection={<IconFileTypePdf size={14} />}
          onClick={() => setAbierto((o) => !o)}
        >
          PDF
        </Button>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="sm">
          <Select
            label="Sucursal"
            data={opciones}
            value={sucursal}
            onChange={(v) => setSucursal(v ?? TODAS)}
            allowDeselect={false}
            comboboxProps={{ withinPortal: false }}
          />
          <Text size="xs" c="dimmed">
            Incluye todas las cargas del periodo ({ventana} días), no solo las que caben en la pantalla.
          </Text>
          {error && <Text size="xs" c="red">{error}</Text>}
          <Button size="xs" loading={generando} onClick={generar} leftSection={<IconFileTypePdf size={14} />}>
            Generar reporte
          </Button>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  )
}

// ─── Casetas ────────────────────────────────────────────────────────────────

function SeccionCobrosCasetas({ cobros, cargando, error, onNavigateSeccion }: {
  cobros?: CobrosCasetas
  cargando: boolean
  error: boolean
  onNavigateSeccion?: (s: Seccion) => void
}) {
  const accion = (
    <Group gap="xs" wrap="nowrap">
      {cobros && cobros.total > 0 && (
        <Badge color="red" variant="light" size="lg">{formatMXN(cobros.total)}</Badge>
      )}
      <IrASeccion seccion="facturas-casetas" onNavigate={onNavigateSeccion}>Facturas</IrASeccion>
    </Group>
  )

  return (
    <Seccion
      titulo="Lo que PASE pudo cobrar de más"
      descripcion="Los hallazgos de cobro de las facturas de casetas del periodo, sumados igual que en la pantalla de cada factura: fuera de tarifa, doble cobro, ya cobrado en otra factura, clase arriba de la habitual. No se suma al ahorro identificado: aquel se logra cambiando de proveedor, esto se le reclama a PASE con la partida de la factura."
      accion={accion}
    >
      {cargando ? (
        <Center py="xl"><Loader size="sm" /></Center>
      ) : error || !cobros ? (
        <Alert color="red" variant="light">No se pudieron calcular los cobros de casetas.</Alert>
      ) : cobros.facturas.length === 0 ? (
        <Vacio>Ninguna factura de PASE cobra cruces de este periodo.</Vacio>
      ) : (
        <Stack gap="md">
          {cobros.errores.length > 0 && (
            <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>
              {cobros.errores.length} factura(s) no se pudieron revisar: {cobros.errores.join(' · ')}
            </Alert>
          )}
          {cobros.por_tipo.length === 0 ? (
            <Text size="sm" c="dimmed">
              Ningún cruce de las {cobros.facturas.length} facturas del periodo se cobró de más.
            </Text>
          ) : (
            <Group gap="xs" wrap="wrap">
              {cobros.por_tipo.map((p) => (
                <Badge key={p.tipo} variant="light" color={COLOR_HALLAZGO[p.tipo]} size="lg">
                  {TITULO_HALLAZGO[p.tipo]}: {p.cantidad} · {formatMXNCorto(p.monto)}
                </Badge>
              ))}
            </Group>
          )}

          <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="lg">
            <div>
              <Text size="sm" fw={500} mb={4}>Por factura</Text>
              <Table.ScrollContainer minWidth={420}>
                <Table striped withTableBorder>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Factura</Table.Th>
                      <Table.Th style={{ textAlign: 'right' }}>Total</Table.Th>
                      <Table.Th style={{ textAlign: 'right' }}>De más</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {cobros.facturas.map((f) => (
                      <Table.Tr key={f.id}>
                        <Table.Td>
                          <Group gap={6} wrap="nowrap">
                            <Text size="sm" fw={500}>{f.serie ? `${f.serie}-` : ''}{f.folio}</Text>
                            {!f.revisada && <Badge size="xs" variant="light" color="gray">Sin revisar</Badge>}
                          </Group>
                          <Text size="xs" c="dimmed" lineClamp={1}>{f.periodo ?? `Hasta ${formatFecha(f.hasta)}`}</Text>
                        </Table.Td>
                        <Table.Td style={{ textAlign: 'right' }}>{formatMXN(f.total)}</Table.Td>
                        <Table.Td style={{ textAlign: 'right' }}>
                          {f.cobro > 0
                            ? <Text size="sm" fw={600} c="red">{formatMXN(f.cobro)}</Text>
                            : <Guion />}
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </div>
            <div>
              <Text size="sm" fw={500} mb={4}>Los que más pesan</Text>
              {cobros.principales.length === 0 ? (
                <Vacio>Nada que reclamar en el periodo.</Vacio>
              ) : (
                <Table.ScrollContainer minWidth={480}>
                  <Table striped withTableBorder>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Hallazgo</Table.Th>
                        <Table.Th>Factura</Table.Th>
                        <Table.Th style={{ textAlign: 'right' }}>De más</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {cobros.principales.map((h, i) => (
                        <Table.Tr key={`${h.factura_id}-${h.tipo}-${h.renglones.join(',')}-${i}`}>
                          <Table.Td>
                            <Tooltip label={h.detalle} multiline w={320} withArrow>
                              <Badge size="xs" variant="light" color={COLOR_HALLAZGO[h.tipo]} style={{ cursor: 'help' }}>
                                {TITULO_HALLAZGO[h.tipo]}
                              </Badge>
                            </Tooltip>
                            <Text size="xs" c="dimmed" lineClamp={1}>
                              {h.vehiculo ?? h.tag}{h.caseta ? ` · ${h.caseta}` : ''}
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            <Text size="sm">{h.serie ? `${h.serie}-` : ''}{h.folio}</Text>
                            {/* La partida es como se le reclama a PASE. */}
                            <Text size="xs" c="dimmed">
                              Partida{h.renglones.length !== 1 ? 's' : ''} {h.renglones.slice(0, 4).join(', ')}
                              {h.renglones.length > 4 ? '…' : ''}
                            </Text>
                          </Table.Td>
                          <Table.Td style={{ textAlign: 'right' }}>
                            <Text size="sm" fw={600} c="red">{formatMXN(h.monto)}</Text>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
              )}
            </div>
          </SimpleGrid>
        </Stack>
      )}
    </Seccion>
  )
}

// ─── Errores de captura ─────────────────────────────────────────────────────

/** El correo sin dominio: es como se reconoce a la gente en el resto del sistema. */
function persona(email: string | null): string {
  return email ? email.split('@')[0] : 'Sin identificar'
}

/**
 * Lo que la revisión de facturas de refacciones y taller corrigió en el
 * periodo, por persona. Es el resumen de Administración → Errores de captura:
 * las dos sumas van separadas por lo mismo que allá, porque no significan lo
 * mismo y juntas dan un número que no quiere decir nada.
 */
function SeccionErroresCaptura({ desde, onNavigateSeccion }: {
  desde: string
  onNavigateSeccion?: (s: Seccion) => void
}) {
  const { data, isLoading, isError } = useErroresCaptura({ desde })
  const filas = data?.data ?? []
  const deMas = filas.reduce((s, f) => s + Number(f.de_mas), 0)
  const sinRegistrar = filas.reduce((s, f) => s + Number(f.subregistrado), 0)

  return (
    <Seccion
      titulo="Errores de captura que encontró la revisión"
      descripcion="Lo que se corrigió al cuadrar las facturas de refacciones y de taller contra el papel, en el periodo. «De más» es dinero que el sistema tenía y no se debía: eso es lo que la revisión evita que se pague. «Sin registrar» es gasto que sí ocurrió y no estaba capturado: corregirlo no ahorra nada, deja de esconderlo."
      accion={<IrASeccion seccion="errores-captura" onNavigate={onNavigateSeccion}>Detalle</IrASeccion>}
    >
      {isLoading ? (
        <Center py="xl"><Loader size="sm" /></Center>
      ) : isError ? (
        <Alert color="red" variant="light">No se pudieron leer los errores de captura.</Alert>
      ) : filas.length === 0 ? (
        <Vacio>La revisión no corrigió nada en el periodo.</Vacio>
      ) : (
        <Stack gap="sm">
          <Group gap="xs">
            <Badge variant="light" color="teal" size="lg">De más: {formatMXN(deMas)}</Badge>
            <Badge variant="light" color="orange" size="lg">Sin registrar: {formatMXN(sinRegistrar)}</Badge>
          </Group>
          <Table.ScrollContainer minWidth={480}>
            <Table striped withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Capturó</Table.Th>
                  <Table.Th style={{ textAlign: 'center' }}>Correcciones</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>De más</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Sin registrar</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {filas.slice(0, 8).map((f) => (
                  <Table.Tr key={f.capturado_por ?? '—'}>
                    <Table.Td>
                      <Tooltip label={f.capturado_por ?? 'Capturado antes de que se guardara quién'} withArrow>
                        <Text size="sm" fw={500}>{persona(f.capturado_por)}</Text>
                      </Tooltip>
                    </Table.Td>
                    <Table.Td style={{ textAlign: 'center' }}>{f.correcciones}</Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>
                      {Number(f.de_mas) > 0 ? formatMXN(Number(f.de_mas)) : <Guion />}
                    </Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>
                      {Number(f.subregistrado) > 0 ? formatMXN(Number(f.subregistrado)) : <Guion />}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
          {filas.length > 8 && (
            <Text size="xs" c="dimmed">Se muestran las 8 personas con más dinero corregido; el detalle las trae todas.</Text>
          )}
        </Stack>
      )}
    </Seccion>
  )
}
