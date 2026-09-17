// Pestaña "Fugas" del tablero: por dónde se va el dinero sin aparecer como gasto.
//
// Vive aparte de Dashboard.tsx por lo mismo que DashboardCostos: son ocho
// bloques con su propia lógica de presentación, y meterlos en el archivo del
// tablero lo habría dejado en mil quinientas líneas.
//
// La pestaña de costos contesta "¿en qué se gastó y estoy pagando de más?".
// Esta contesta otra cosa: capital parado, merma, combustible sin destino,
// garantía no cobrada y lo que se pierde justamente porque parecía barato. Son
// pérdidas que ninguna factura registra.
import { useMemo, useState } from 'react'
import {
  Card, Text, Group, Stack, Loader, Center, Table, Badge, Alert, Select,
  SimpleGrid, Divider, Tooltip,
} from '@mantine/core'
import { BarChart } from '@mantine/charts'
import {
  IconAlertTriangle, IconBox, IconGasStation, IconShieldCheck, IconTrendingUp,
  IconScale, IconTool,
} from '@tabler/icons-react'
import { useFugas, type Fugas, type VidaPorMarca } from '../hooks/useDashboard'
import { formatMXN, formatNum } from '../lib/formato'
import { StatCard } from './StatCard'

// Orden fijo de colores para las series por sucursal. Validado con el script de
// la guía de visualización: pasa banda de luminosidad, piso de croma, separación
// para daltonismo y piso de visión normal sobre superficie clara. El orden
// importa —cyan y teal juntos no se distinguen— así que no se reordena ni se
// cicla: cuatro series es el tope, y lo que no cabe se lee en la tabla.
const COLORES_SUCURSAL = ['cyan.6', 'orange.6', 'violet.6', 'teal.6']
const MAX_SERIES = 4

function Seccion({ titulo, descripcion, accion, children }: {
  titulo: string; descripcion?: string; accion?: React.ReactNode; children: React.ReactNode
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
  return <Center py="lg"><Text c="dimmed" size="sm">{children}</Text></Center>
}

// ─── 1. Costo por kilómetro de vida ──────────────────────────────────────────

function VidaUtil({ filas }: { filas: VidaPorMarca[] }) {
  const tipos = useMemo(() => {
    const vistos = new Map<number, string>()
    for (const f of filas) vistos.set(f.tipo_pieza_id, f.tipo_pieza)
    return [...vistos].map(([id, nombre]) => ({ value: String(id), label: nombre }))
  }, [filas])

  const [tipo, setTipo] = useState<string | null>(null)
  const tipoActivo = tipo ?? tipos[0]?.value ?? null

  const delTipo = useMemo(
    () => filas
      .filter((f) => String(f.tipo_pieza_id) === tipoActivo)
      .sort((a, b) => a.costo_por_mil - b.costo_por_mil),
    [filas, tipoActivo],
  )

  if (filas.length === 0) {
    return (
      <Vacio>
        Todavía no hay montajes cerrados con odómetro al instalar y al retirar. Sin esas dos
        lecturas no se puede medir cuánto duró una pieza.
      </Vacio>
    )
  }

  // El ahorro de comprar siempre la marca más barata por kilómetro, contra
  // seguir comprando la más cara. Es el tamaño de la decisión, no una pérdida ya
  // ocurrida.
  const mejor = delTipo[0]
  const peor  = delTipo[delTipo.length - 1]
  const brecha = mejor && peor && mejor !== peor
    ? ((peor.costo_por_mil - mejor.costo_por_mil) / peor.costo_por_mil) * 100
    : null

  return (
    <Stack gap="md">
      <Group justify="space-between" wrap="wrap" gap="sm">
        <Select
          data={tipos}
          value={tipoActivo}
          onChange={setTipo}
          allowDeselect={false}
          w={260}
          aria-label="Tipo de refacción"
        />
        {brecha != null && brecha > 0 && (
          <Text size="sm">
            <strong>{mejor.marca}</strong> sale {brecha.toFixed(0)}% más barata por kilómetro
            que <strong>{peor.marca}</strong>.
          </Text>
        )}
      </Group>

      {/* Una sola serie: el título ya dice qué mide, así que no lleva leyenda.
          Color único y no por posición — pintar de rojo "la peor" haría que el
          color cambiara de dueño en cuanto entre otra marca. */}
      <BarChart
        h={40 + delTipo.length * 38}
        data={delTipo.map((f) => ({ marca: f.marca, costo: Number(f.costo_por_mil.toFixed(2)) }))}
        dataKey="marca"
        orientation="vertical"
        series={[{ name: 'costo', color: 'violet.6', label: 'Costo por 1 000 km' }]}
        valueFormatter={(v) => formatMXN(v)}
        yAxisProps={{ width: 110 }}
        gridAxis="x"
        barProps={{ radius: 4 }}
      />

      <Table striped withTableBorder>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Marca</Table.Th>
            <Table.Th ta="right">Costo / 1 000 km</Table.Th>
            <Table.Th ta="right">Vida promedio</Table.Th>
            <Table.Th ta="right">Precio promedio</Table.Th>
            <Table.Th ta="right">Montajes</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {delTipo.map((f) => (
            <Table.Tr key={`${f.tipo_pieza_id}-${f.marca}`}>
              <Table.Td>
                <Text size="sm" fw={500}>{f.marca}</Text>
              </Table.Td>
              <Table.Td ta="right"><Text size="sm" fw={600}>{formatMXN(f.costo_por_mil)}</Text></Table.Td>
              <Table.Td ta="right"><Text size="sm">{formatNum(Math.round(f.km_promedio))} km</Text></Table.Td>
              <Table.Td ta="right"><Text size="sm">{formatMXN(f.costo_promedio)}</Text></Table.Td>
              <Table.Td ta="right">
                {/* La muestra es parte del dato: tres montajes no deciden una
                    política de compras. */}
                <Text size="xs" c={f.montajes < 4 ? 'orange' : 'dimmed'}>{f.montajes}</Text>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Stack>
  )
}

// ─── 2. Merma valorizada ─────────────────────────────────────────────────────

function Merma({ filas }: { filas: Fugas['merma'] }) {
  const { data, series, sucursales } = useMemo(() => {
    // Las sucursales con más merma acumulada se llevan las series del gráfico;
    // el resto se lee completo en la tabla de abajo. Se recortan y no se
    // agrupan en "Otras" porque ese bucket necesitaría un quinto color que no
    // pasa las comprobaciones de contraste.
    const porSucursal = new Map<string, number>()
    for (const f of filas) {
      porSucursal.set(f.sucursal, (porSucursal.get(f.sucursal) ?? 0) + Math.max(0, f.monto))
    }
    const top = [...porSucursal.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_SERIES)
      .map(([nombre]) => nombre)

    const meses = new Map<string, Record<string, number | string>>()
    for (const f of filas) {
      if (!top.includes(f.sucursal)) continue
      const fila = meses.get(f.mes) ?? { mes: f.mes }
      fila[f.sucursal] = Math.max(0, f.monto)
      meses.set(f.mes, fila)
    }

    return {
      data: [...meses.values()].sort((a, b) => String(a.mes).localeCompare(String(b.mes))),
      series: top.map((nombre, i) => ({ name: nombre, color: COLORES_SUCURSAL[i] })),
      sucursales: porSucursal,
    }
  }, [filas])

  if (filas.length === 0) return <Vacio>No se ha registrado ningún descuadre de inventario.</Vacio>

  return (
    <Stack gap="md">
      {series.length > 0 && (
        <BarChart
          h={260}
          data={data}
          dataKey="mes"
          type="stacked"
          withLegend={series.length > 1}
          series={series}
          valueFormatter={(v) => formatMXN(v)}
          yAxisProps={{ width: 80 }}
          barProps={{ radius: 4 }}
        />
      )}
      {sucursales.size > MAX_SERIES && (
        <Text size="xs" c="dimmed">
          El gráfico muestra las {MAX_SERIES} sucursales con más merma. La tabla las trae todas.
        </Text>
      )}
      <Table striped withTableBorder>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Sucursal</Table.Th>
            <Table.Th ta="right">Faltante acumulado</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {[...sucursales.entries()].sort((a, b) => b[1] - a[1]).map(([nombre, monto]) => (
            <Table.Tr key={nombre}>
              <Table.Td><Text size="sm">{nombre}</Text></Table.Td>
              <Table.Td ta="right"><Text size="sm" fw={500}>{formatMXN(monto)}</Text></Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Stack>
  )
}

// ─── Panel ───────────────────────────────────────────────────────────────────

export default function DashboardFugas() {
  const { data, isLoading, isError } = useFugas()

  if (isLoading) return <Center py="xl"><Loader /></Center>
  if (isError || !data) {
    return <Alert color="red" title="Error">No se pudo calcular el análisis de fugas.</Alert>
  }

  const f = data.data
  const t = f.totales
  const inmovilesVivos = f.lotes_inmoviles.filter((l) => !l.descontinuada)
  const inmovilesMuertos = f.lotes_inmoviles.filter((l) => l.descontinuada)
  const subidas = f.deriva_precios.filter((d) => d.variacion_pct > 0)

  return (
    <Stack gap="lg">
      {/* Cada cruce se calcula por su cuenta: si uno falla, el resto sigue
          sirviendo y aquí se dice cuál se cayó y por qué. */}
      {f.errores.length > 0 && (
        <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}
          title={`${f.errores.length} bloque(s) no se pudieron calcular`}>
          <Stack gap={2}>
            {f.errores.map((e) => <Text key={e} size="xs">{e}</Text>)}
          </Stack>
        </Alert>
      )}

      <SimpleGrid cols={{ base: 1, sm: 2, md: 3, xl: 5 }} spacing="md">
        <StatCard
          label="Merma valorizada"
          value={formatMXN(t.merma)}
          sub={`Últimos ${f.ventanas.merma} días`}
          color="red" icon={IconScale}
          ayuda="Descuadres de inventario convertidos a pesos al costo del lote. Solo los faltantes: los sobrantes no son dinero recuperable."
        />
        <StatCard
          label="Capital parado"
          value={formatMXN(t.capital_parado)}
          sub={`${inmovilesVivos.length} lote(s) sin movimiento`}
          color="orange" icon={IconBox}
          ayuda={`Existencias sin consumirse ni traspasarse en ${f.ventanas.inmovil} días, valuadas al costo. Es dinero inmovilizado que además se deteriora.`}
        />
        <StatCard
          label="Capital obsoleto"
          value={formatMXN(t.capital_obsoleto)}
          sub={`${inmovilesMuertos.length} lote(s) sin modelo vivo`}
          color="grape" icon={IconAlertTriangle}
          ayuda="Refacciones cuyo único modelo ya se descontinuó. No es capital lento: es capital que no se va a recuperar usándolo."
        />
        <StatCard
          label="Correctivos en garantía"
          value={formatMXN(t.correctivos_garantia)}
          sub={`${new Set(f.correctivos_garantia.map((c) => c.mantenimiento_id)).size} por revisar`}
          color="teal" icon={IconShieldCheck}
          ayuda="Reparaciones pagadas mientras había una garantía vigente. Hay que revisarlas una por una: la garantía no cubre desgaste normal."
        />
        <StatCard
          label="Vales sin recarga"
          value={String(t.vales_sin_recarga)}
          sub={`Últimos ${f.ventanas.vales} días`}
          color="yellow" icon={IconGasStation}
          ayuda="Vales entregados que ninguna recarga menciona. Puede ser captura pendiente o combustible que se fue sin registrarse."
        />
      </SimpleGrid>

      {/* ── 1 ── */}
      <Seccion
        titulo="Qué marca sale más barata por kilómetro"
        descripcion="Precio de la refacción dividido entre los kilómetros que aguantó puesta, medidos con el odómetro al instalarla y al retirarla. Es la única comparación que dice la verdad: una pieza a mitad de precio que dura un tercio es más cara, pero en la factura se ve como ahorro."
      >
        <VidaUtil filas={f.vida_por_marca} />
      </Seccion>

      {/* ── 2 ── */}
      <Seccion
        titulo="Merma de inventario, en pesos"
        descripcion={`Descuadres de los últimos ${f.ventanas.merma} días valuados al costo del lote. En piezas, diez tornillos y diez inyectores pesan lo mismo; en pesos se ve cuál importa.`}
        accion={t.merma > 0 && <Badge color="red" variant="light" size="lg">{formatMXN(t.merma)}</Badge>}
      >
        <Merma filas={f.merma} />
      </Seccion>

      {/* ── 3 ── */}
      <Seccion
        titulo="Capital parado en el almacén"
        descripcion={`Lotes con existencia que no se han consumido ni traspasado en ${f.ventanas.inmovil} días. Los marcados como obsoletos ya no tienen ningún modelo vivo que los use.`}
        accion={
          <Badge color="orange" variant="light" size="lg">
            {formatMXN(t.capital_parado + t.capital_obsoleto)}
          </Badge>
        }
      >
        {f.lotes_inmoviles.length === 0 ? (
          <Vacio>Todo el inventario se ha movido en el periodo.</Vacio>
        ) : (
          <Table.ScrollContainer minWidth={760}>
            <Table striped withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Refacción</Table.Th>
                  <Table.Th>Sucursal</Table.Th>
                  <Table.Th ta="right">Piezas</Table.Th>
                  <Table.Th ta="right">Valor</Table.Th>
                  <Table.Th ta="right">Sin moverse</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {f.lotes_inmoviles.slice(0, 40).map((l) => (
                  <Table.Tr key={`${l.lote_id}-${l.sucursal}`}>
                    <Table.Td>
                      <Group gap={6} wrap="nowrap">
                        <Text size="sm" fw={500}>{l.numero_serie}</Text>
                        {l.descontinuada && (
                          <Tooltip label="Ningún modelo vivo usa esta refacción">
                            <Badge color="grape" variant="light" size="xs">Obsoleta</Badge>
                          </Tooltip>
                        )}
                      </Group>
                      <Text size="xs" c="dimmed">{l.marca} · {l.descripcion}</Text>
                    </Table.Td>
                    <Table.Td><Text size="xs">{l.sucursal}</Text></Table.Td>
                    <Table.Td ta="right"><Text size="sm">{l.cantidad}</Text></Table.Td>
                    <Table.Td ta="right"><Text size="sm" fw={500}>{formatMXN(l.monto)}</Text></Table.Td>
                    <Table.Td ta="right">
                      <Text size="xs" c="dimmed">
                        {l.dias_parado != null ? `${formatNum(l.dias_parado)} días` : '—'}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Seccion>

      {/* ── 4 ── */}
      <Seccion
        titulo="Vales entregados que nadie usó"
        descripcion={`Vales de los últimos ${f.ventanas.vales} días sin ninguna recarga que los mencione, dejando fuera la última semana por si la captura viene en camino. El tablero de costos ya detecta el caso contrario —una recarga sin vale—; este es el otro extremo del mismo hueco.`}
      >
        {f.vales_sin_recarga.length === 0 ? (
          <Vacio>Todos los vales del periodo tienen su recarga.</Vacio>
        ) : (
          <Table.ScrollContainer minWidth={640}>
            <Table striped withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Folio</Table.Th>
                  <Table.Th>Entregado</Table.Th>
                  <Table.Th>Conductor</Table.Th>
                  <Table.Th>Vehículo</Table.Th>
                  <Table.Th ta="right">Sin usar</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {f.vales_sin_recarga.map((v) => (
                  <Table.Tr key={v.id}>
                    <Table.Td><Text size="sm" fw={500}>{v.folio}</Text></Table.Td>
                    <Table.Td><Text size="xs">{v.fecha}</Text></Table.Td>
                    <Table.Td><Text size="sm">{v.conductor}</Text></Table.Td>
                    <Table.Td><Text size="xs" c="dimmed">{v.vehiculo}</Text></Table.Td>
                    <Table.Td ta="right">
                      <Badge size="sm" variant="light" color={v.dias >= 30 ? 'red' : 'yellow'}>
                        {v.dias} días
                      </Badge>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Seccion>

      {/* ── 5 ── */}
      <Seccion
        titulo="Refacciones que subieron de precio sin que nadie lo notara"
        descripcion={`Primera contra última compra de los últimos ${f.ventanas.compras} días. La comparación de precios dice quién está más barato hoy; esto dice que el mismo proveedor viene subiendo, que es invisible cuando cada compra por separado parecía razonable.`}
      >
        {subidas.length === 0 ? (
          <Vacio>Ninguna refacción se compró más cara que la primera vez en el periodo.</Vacio>
        ) : (
          <Table.ScrollContainer minWidth={700}>
            <Table striped withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Refacción</Table.Th>
                  <Table.Th ta="right">Primera</Table.Th>
                  <Table.Th ta="right">Última</Table.Th>
                  <Table.Th ta="right">Variación</Table.Th>
                  <Table.Th ta="right">Compras</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {subidas.slice(0, 25).map((d) => (
                  <Table.Tr key={d.pieza_id}>
                    <Table.Td>
                      <Text size="sm" fw={500}>{d.numero_serie}</Text>
                      <Text size="xs" c="dimmed">{d.marca} · {d.descripcion}</Text>
                    </Table.Td>
                    <Table.Td ta="right">
                      <Text size="sm">{formatMXN(d.primer_precio)}</Text>
                      <Text size="xs" c="dimmed">{d.primera_fecha}</Text>
                    </Table.Td>
                    <Table.Td ta="right">
                      <Text size="sm">{formatMXN(d.ultimo_precio)}</Text>
                      <Text size="xs" c="dimmed">{d.ultima_fecha}</Text>
                    </Table.Td>
                    <Table.Td ta="right">
                      <Badge
                        size="sm" variant="light"
                        color={d.variacion_pct >= 20 ? 'red' : 'orange'}
                        leftSection={<IconTrendingUp size={12} />}
                      >
                        {d.variacion_pct.toFixed(0)}%
                      </Badge>
                    </Table.Td>
                    <Table.Td ta="right"><Text size="xs" c="dimmed">{d.compras}</Text></Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Seccion>

      {/* ── 6 ── */}
      <Seccion
        titulo="Reparaciones pagadas con garantía vigente"
        descripcion="Correctivos registrados mientras el vehículo tenía una garantía sin cancelar que seguía dentro de su plazo o de su kilometraje."
        accion={
          f.correctivos_garantia.length > 0 &&
          <Badge color="teal" variant="light" size="lg">{formatMXN(t.correctivos_garantia)}</Badge>
        }
      >
        <Stack gap="sm">
          <Alert color="yellow" variant="light" icon={<IconAlertTriangle size={16} />}>
            Esto es una lista para revisar, no una pérdida confirmada. El sistema sabe que había
            cobertura vigente ese día, pero no qué se reparó, y la garantía no cubre desgaste
            normal ni mal uso. Cada renglón hay que contrastarlo contra la póliza.
          </Alert>
          {f.correctivos_garantia.length === 0 ? (
            <Vacio>Ningún correctivo del periodo cayó dentro de una garantía vigente.</Vacio>
          ) : (
            <Table.ScrollContainer minWidth={720}>
              <Table striped withTableBorder>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Vehículo</Table.Th>
                    <Table.Th>Fecha</Table.Th>
                    <Table.Th>Garantía</Table.Th>
                    <Table.Th>Cobertura</Table.Th>
                    <Table.Th ta="right">Se pagó</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {f.correctivos_garantia.map((c) => (
                    <Table.Tr key={`${c.mantenimiento_id}-${c.garantia}`}>
                      <Table.Td><Text size="sm">{c.vehiculo}</Text></Table.Td>
                      <Table.Td><Text size="xs">{c.fecha}</Text></Table.Td>
                      <Table.Td>
                        <Text size="sm">{c.garantia}</Text>
                        {c.folio && <Text size="xs" c="dimmed">Folio {c.folio}</Text>}
                      </Table.Td>
                      <Table.Td><Text size="xs" c="dimmed">{c.cobertura}</Text></Table.Td>
                      <Table.Td ta="right"><Text size="sm" fw={500}>{formatMXN(c.costo)}</Text></Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )}
        </Stack>
      </Seccion>

      {/* ── 7 ── */}
      <Seccion
        titulo="Lo que cuesta el preventivo diferido"
        descripcion={`Gasto correctivo por kilómetro de los últimos ${f.ventanas.correctivo} días, separando las unidades que hoy traen servicios del programa preventivo vencidos de las que están al corriente.`}
      >
        <Stack gap="sm">
          <Alert color="blue" variant="light">
            Es una comparación entre dos grupos, no una relación causa-efecto. Que el grupo
            atrasado gaste más encaja con «posponer el preventivo sale caro», pero también con
            «las unidades que más fallan son las que menos alcanzan a entrar al taller». El dato
            no distingue en qué dirección va la flecha. Se divide entre kilómetros para descartar
            al menos la explicación aburrida: que un grupo simplemente trabaje más.
          </Alert>

          <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
            <GrupoCard
              titulo="Con preventivos vencidos"
              grupo={f.preventivo_diferido.con_atraso}
              color="red"
            />
            <GrupoCard
              titulo="Al corriente"
              grupo={f.preventivo_diferido.al_corriente}
              color="teal"
            />
            <Card withBorder padding="md" radius="md">
              <Text size="xs" c="dimmed">Diferencia por 1 000 km</Text>
              <Text fw={700} size="xl" mt={4}>
                {f.preventivo_diferido.sobrecosto_por_mil != null
                  ? formatMXN(f.preventivo_diferido.sobrecosto_por_mil)
                  : '—'}
              </Text>
              <Text size="xs" c="dimmed" mt={4}>
                {f.preventivo_diferido.sobrecosto_por_mil == null
                  ? 'Falta kilometraje en alguno de los dos grupos para poder compararlos.'
                  : 'Lo que separa a los dos grupos en correctivo por kilómetro recorrido.'}
              </Text>
            </Card>
          </SimpleGrid>
        </Stack>
      </Seccion>
    </Stack>
  )
}

function GrupoCard({ titulo, grupo, color }: {
  titulo: string
  grupo: Fugas['preventivo_diferido']['con_atraso']
  color: string
}) {
  return (
    <Card withBorder padding="md" radius="md">
      <Group gap={6} wrap="nowrap">
        <IconTool size={14} />
        <Text size="xs" c="dimmed">{titulo}</Text>
      </Group>
      <Text fw={700} size="xl" mt={4} c={color}>
        {grupo.costo_por_mil != null ? formatMXN(grupo.costo_por_mil) : '—'}
      </Text>
      <Text size="xs" c="dimmed">por 1 000 km</Text>
      <Divider my="xs" />
      <Text size="xs" c="dimmed">
        {grupo.vehiculos} unidad(es) · {grupo.correctivos} correctivo(s) · {formatMXN(grupo.costo)}
      </Text>
    </Card>
  )
}
