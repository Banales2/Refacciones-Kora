// Facturas de casetas: lo que PASE cobra por los cruces de los tags de la flota.
//
// PASE factura cada diez días con un renglón por cruce —unos 400—, así que la
// factura no se captura: se IMPORTA de su XML (ver `lib/xmlPase.ts`). La API
// comprueba que los cruces sumen el total impreso antes de guardar nada.
//
// AQUÍ NO SE CASA CONTRA NADA CAPTURADO, al revés que en gasolina. El cruce no
// existe en el sistema hasta que PASE lo cobra. Lo que la pantalla enseña son
// HALLAZGOS: lo que hay que mirar, con el dinero en juego al lado, separados en
// dos preguntas que no se suman:
//
//   cobro   lo que PASE pudo cobrar de más: cruces repetidos, importes que no
//           son de ningún tramo, clase arriba de la habitual, ajustes y cruces
//           de fuera del periodo
//   uso     cómo se usan las unidades: tags sin unidad, casetas que el tag nunca
//           había cruzado
//
// Ninguno es una conclusión. Un tráiler que paga clase 9 donde siempre paga 5
// puede llevar doble caja ese día; quien lo sabe es quien revisa.
//
// Ver `db/migrations/064_facturas_de_casetas.sql`.
import { useMemo, useState } from 'react'
import {
  Accordion, ActionIcon, Alert, Badge, Button, Card, Center, FileInput, Group, Loader, Modal,
  NumberInput, Pagination, SegmentedControl, Select, SimpleGrid, Stack, Switch, Table, Tabs, Text, TextInput, Textarea, Tooltip,
} from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import {
  IconAlertTriangle, IconArrowRight, IconCheck, IconFileImport, IconLockOpen, IconPencil, IconPlus,
  IconSearch,
} from '@tabler/icons-react'
import {
  FACTURA_DUPLICADA, useActualizarTagCaseta, useCrearTagCaseta, useFacturaCasetas,
  useFacturasCasetas, useImportarFacturaCasetas, useReabrirFacturaCasetas,
  useRevisarFacturaCasetas, useTagsCasetas, useTarifasCasetas, useActualizarTarifaCaseta,
  useCrearTarifaCaseta, useCrearTramoCaseta,
} from '../hooks/useFacturasCasetas'
import type {
  CasetaSinTarifa, CorreccionDeClase, CruceCaseta, CruceEnOtra, DetalleFacturaCasetas,
  TarifaTramo, TarifasDeCaseta, ValoresTarifa, Hallazgo, TagCaseta, TipoHallazgo,
} from '../hooks/useFacturasCasetas'
import { useVehiculos } from '../hooks/useVehiculos'
import { FechaInput } from '../components/FechaInput'
import { usePermisos } from '../hooks/usePermisos'
import { ApiError } from '../lib/api'
import { formatFecha, formatMXN } from '../lib/formato'
import { leerFacturaPase, XmlPaseError } from '../lib/xmlPase'
import type { FacturaPase } from '../lib/xmlPase'
import {
  opcionVehiculo, renderOpcionVehiculo, sinFiltroLocal,
} from '../components/OpcionVehiculo'

const PAGE_SIZE = 15
const CRUCES_POR_PAGINA = 50

const TITULO_HALLAZGO: Record<TipoHallazgo, string> = {
  cobrado_antes: 'Ya cobrado en otra factura',
  fuera_de_tarifa: 'Fuera de tarifa',
  doble_cobro: 'Posible doble cobro',
  clase_mayor: 'Clase arriba de la habitual',
  ajuste: 'Ajuste de PASE',
  corregido: 'Corregido después',
  fuera_de_periodo: 'Fuera del periodo',
  tag_sin_unidad: 'Tag sin unidad',
  caseta_inusual: 'Caseta que el tag no cruzaba',
}

const COLOR_HALLAZGO: Record<TipoHallazgo, string> = {
  cobrado_antes: 'red',
  fuera_de_tarifa: 'red',
  doble_cobro: 'red',
  clase_mayor: 'orange',
  ajuste: 'yellow',
  corregido: 'gray',
  fuera_de_periodo: 'yellow',
  tag_sin_unidad: 'grape',
  caseta_inusual: 'blue',
}

/** `2026-09-21T01:01:20` → `21 sep 2026 01:01`. */
function fechaHora(fh: string): string {
  return `${formatFecha(fh.slice(0, 10))} ${fh.slice(11, 16)}`
}

function sumar<T>(xs: T[], f: (x: T) => number): number {
  return xs.reduce((s, x) => s + f(x), 0)
}

// ── Elegir una unidad ────────────────────────────────────────────────────────

/**
 * Select de vehículo que busca contra la API: la flota puede pasar de una
 * página. Conserva el elegido entre las opciones aunque la búsqueda ya no lo
 * devuelva, igual que en recargas.
 */
function SelectVehiculo({
  value, etiqueta, onChange, label, size,
}: {
  value: number | null
  /** Cómo se llama la unidad ya elegida, para enseñarla antes de buscar. */
  etiqueta: string | null
  onChange: (id: number | null, etiqueta: string | null) => void
  label?: string
  size?: 'xs' | 'sm'
}) {
  const [busqueda, setBusqueda] = useState('')
  const [debounced] = useDebouncedValue(busqueda, 300)
  const { data, isLoading } = useVehiculos(1, debounced, undefined, undefined, 20)

  const opciones = useMemo(() => {
    const opts = (data?.data ?? []).map(opcionVehiculo)
    if (value !== null && !opts.some((o) => o.value === String(value))) {
      opts.unshift({ value: String(value), label: etiqueta ?? `Unidad ${value}` })
    }
    return opts
  }, [data, value, etiqueta])

  return (
    <Select
      label={label} size={size}
      placeholder="Busca por marca, modelo, serie o placas"
      data={opciones} searchable clearable
      filter={sinFiltroLocal} renderOption={renderOpcionVehiculo}
      value={value !== null ? String(value) : null}
      onChange={(id) => {
        const o = opciones.find((x) => x.value === id)
        onChange(id ? Number(id) : null, o?.label ?? null)
      }}
      searchValue={busqueda} onSearchChange={setBusqueda}
      rightSection={isLoading ? <Loader size="xs" /> : undefined}
      nothingFoundMessage={isLoading ? 'Buscando…' : 'Sin resultados'}
      comboboxProps={{ withinPortal: true }}
    />
  )
}

// ── Importar ─────────────────────────────────────────────────────────────────

interface ArchivoPase {
  nombre:  string
  factura: FacturaPase | null
  /** Por qué no se puede importar: no se leyó, o los cruces no suman el total. */
  error:   string | null
  estado:  'pendiente' | 'importando' | 'importada' | 'duplicada' | 'rechazada'
  mensaje: string | null
  /** La factura ya guardada, para abrirla desde aquí. */
  id:      number | null
}

/**
 * Lee los XML —uno o varios, como en las facturas de gasolinera— y enseña lo
 * que trae cada uno ANTES de guardar: folio, periodo, cuántos cruces y si suman
 * el total, y qué tags no están en el catálogo. El que no se puede leer entero,
 * o no cuadra, dice por qué y se queda fuera; los demás se importan igual.
 */
function ImportarModal({
  abierto, onClose, onImportada,
}: {
  abierto: boolean
  onClose: () => void
  onImportada: (id: number) => void
}) {
  const [archivos, setArchivos] = useState<ArchivoPase[]>([])
  const [trabajando, setTrabajando] = useState(false)
  const importar = useImportarFacturaCasetas()
  const { data: tagsData } = useTagsCasetas()

  async function elegir(files: File[]) {
    importar.reset()
    const leidos = await Promise.all(files.map(async (f): Promise<ArchivoPase> => {
      const base = { nombre: f.name, estado: 'pendiente' as const, mensaje: null, id: null }
      try {
        const factura = leerFacturaPase(await f.text())
        const cuadra = Math.abs(sumar(factura.cruces, (c) => c.total) - factura.total) < 0.01
        return {
          ...base, factura,
          error: cuadra ? null : 'Los cruces no suman el total de la factura. El archivo parece incompleto.',
        }
      } catch (e) {
        return { ...base, factura: null, error: e instanceof XmlPaseError ? e.message : 'No se pudo leer el archivo.' }
      }
    }))
    // El mismo XML dos veces es una sola factura.
    const vistos = new Set<string>()
    setArchivos(leidos.filter((a) => {
      if (!a.factura) return true
      if (vistos.has(a.factura.uuid)) return false
      vistos.add(a.factura.uuid)
      return true
    }))
  }

  function cerrar() {
    setArchivos([])
    importar.reset()
    onClose()
  }

  const conocidos = new Set((tagsData?.data ?? []).map((t) => t.tag))
  const listas = archivos.filter((a) => a.factura && !a.error && a.estado === 'pendiente')
  // Los tags nuevos de todo lo que se va a importar, sin repetir: dos facturas
  // del mismo mes traen casi los mismos.
  const nuevos = [...new Set(listas.flatMap((a) => a.factura!.cruces.map((c) => c.tag)))]
    .filter((t) => !conocidos.has(t))
  const actualizar = (nombre: string, cambio: Partial<ArchivoPase>) =>
    setArchivos((p) => p.map((x) => x.nombre === nombre ? { ...x, ...cambio } : x))

  async function importarTodas() {
    setTrabajando(true)
    // Una por una y no en paralelo: los tags nuevos de la primera se dan de alta
    // con ella, y la siguiente ya los encuentra en lugar de chocar por crearlos.
    const hechas: number[] = []
    for (const a of listas) {
      actualizar(a.nombre, { estado: 'importando' })
      try {
        const r = await importar.mutateAsync(a.factura!)
        hechas.push(r.data.id)
        actualizar(a.nombre, { estado: 'importada', mensaje: 'Importada', id: r.data.id })
      } catch (e) {
        const duplicada = e instanceof ApiError && e.code === FACTURA_DUPLICADA
        actualizar(a.nombre, { estado: duplicada ? 'duplicada' : 'rechazada', mensaje: (e as Error).message })
      }
    }
    setTrabajando(false)
    // Con un solo archivo se abre como antes: es lo que se quería revisar. Con
    // varios se queda la tabla, que dice qué entró y qué no.
    if (archivos.length === 1 && hechas.length === 1) {
      cerrar()
      onImportada(hechas[0])
    }
  }

  return (
    <Modal opened={abierto} onClose={cerrar} size="xl" title={<Text fw={700}>Importar facturas de PASE</Text>}>
      <Stack gap="sm">
        <Text size="xs" c="dimmed">
          Los XML de las facturas, uno o varios; no el PDF: el XML trae cada cruce con su
          tag, caseta, clase y hora en su propio campo.
        </Text>

        <FileInput
          multiple clearable label="Archivos XML" placeholder="Elige los .xml de las facturas"
          accept=".xml,application/xml,text/xml"
          leftSection={<IconFileImport size={16} />}
          onChange={(fs) => void elegir(fs ?? [])}
          disabled={trabajando}
        />

        {archivos.length > 0 && (
          <Table.ScrollContainer minWidth={720}>
            <Table withTableBorder striped>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Folio</Table.Th>
                  <Table.Th>Periodo</Table.Th>
                  <Table.Th style={{ textAlign: 'center' }}>Cruces</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Total</Table.Th>
                  <Table.Th w={200}>Estado</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {archivos.map((a) => {
                  const f = a.factura
                  return (
                    <Table.Tr key={a.nombre}>
                      <Table.Td>
                        {f ? (
                          <>
                            <Text size="sm" fw={500}>{f.serie ? `${f.serie}-` : ''}{f.folio}</Text>
                            <Text size="xs" c="dimmed">{formatFecha(f.fecha_emision)}</Text>
                          </>
                        ) : (
                          <Text size="sm" c="dimmed">{a.nombre}</Text>
                        )}
                      </Table.Td>
                      <Table.Td>
                        {f && (
                          <>
                            <Text size="sm">{f.periodo ?? 'Sin periodo'}</Text>
                            {f.periodo && !f.periodo_desde && (
                              <Text size="xs" c="orange">
                                No se entendieron las fechas: no se avisará de cruces fuera del periodo.
                              </Text>
                            )}
                          </>
                        )}
                      </Table.Td>
                      <Table.Td style={{ textAlign: 'center' }}>{f?.cruces.length ?? '—'}</Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>
                        {f && <Text size="sm" fw={600}>{formatMXN(f.total)}</Text>}
                      </Table.Td>
                      <Table.Td>
                        {a.error ? (
                          <Text size="xs" c="red">{a.error}</Text>
                        ) : a.estado === 'importada' ? (
                          <Group gap={6} wrap="nowrap">
                            <Badge size="sm" color="green" variant="light" leftSection={<IconCheck size={11} />}>
                              Importada
                            </Badge>
                            {archivos.length > 1 && a.id != null && (
                              <Button size="compact-xs" variant="subtle"
                                onClick={() => { const id = a.id!; cerrar(); onImportada(id) }}>
                                Ver
                              </Button>
                            )}
                          </Group>
                        ) : a.estado === 'duplicada' ? (
                          <Text size="xs" c="yellow.8">{a.mensaje}</Text>
                        ) : a.estado === 'rechazada' ? (
                          <Text size="xs" c="red">{a.mensaje}</Text>
                        ) : a.estado === 'importando' ? (
                          <Text size="xs" c="dimmed">Importando…</Text>
                        ) : (
                          <Tooltip label="Los cruces suman el total de la factura">
                            <Badge size="sm" color="gray" variant="light">Lista</Badge>
                          </Tooltip>
                        )}
                      </Table.Td>
                    </Table.Tr>
                  )
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}

        {nuevos.length > 0 && (
          <Text size="xs" c="dimmed">
            {nuevos.length} tag(s) nuevo(s) se darán de alta sin unidad: {nuevos.join(', ')}.
            Después se les asigna en la pestaña Tags.
          </Text>
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={cerrar} disabled={trabajando}>Cerrar</Button>
          <Button disabled={listas.length === 0} loading={trabajando} onClick={() => void importarTodas()}>
            Importar {listas.length > 0 ? listas.length : ''} factura{listas.length === 1 ? '' : 's'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}

// ── El detalle ───────────────────────────────────────────────────────────────

function folioDe(f: { serie: string | null; folio: string }): string {
  return f.serie ? `${f.serie}-${f.folio}` : f.folio
}

/**
 * El cruce repetido como viene en cada factura, en el orden en que se emitieron:
 * es lo que se le enseña a PASE al reclamar. La primera es el cobro legítimo y
 * las demás son las repetidas. Lo que no coincide con la primera se marca,
 * porque un cruce con otra clase u otro importe ya no es exactamente el mismo
 * cobro.
 */
function ComparaCobradoAntes({
  esta, otras, onAbrir,
}: { esta: CruceCaseta; otras: CruceEnOtra[]; onAbrir: (id: number) => void }) {
  type Columna = { titulo: string; sub: string | null; facturaId: number | null } &
    Pick<CruceCaseta, 'renglon' | 'fecha_hora' | 'clase' | 'total'>
  const deOtra = (o: CruceEnOtra): Columna => ({
    titulo: folioDe(o), facturaId: o.factura_id,
    sub: `${o.periodo ?? formatFecha(o.fecha_emision.slice(0, 10))}${o.revisada ? ' · revisada' : ''}`,
    renglon: o.renglon, fecha_hora: o.fecha_hora, clase: o.clase, total: o.total,
  })
  const columnas: Columna[] = [
    ...otras.filter((o) => o.anterior).map(deOtra),
    { titulo: 'Esta factura', sub: null, facturaId: null, ...esta },
    ...otras.filter((o) => !o.anterior).map(deOtra),
  ]
  const filas: [string, (c: Columna) => string, boolean][] = [
    ['Partida', (c) => String(c.renglon), false],
    ['Fecha y hora', (c) => fechaHora(c.fecha_hora), true],
    ['Clase', (c) => String(c.clase), true],
    ['Total', (c) => formatMXN(c.total), true],
  ]
  return (
    <Stack gap={6} mt={4}>
      <Table.ScrollContainer minWidth={120 + 140 * columnas.length}>
        <Table withTableBorder fz="xs" verticalSpacing={2} horizontalSpacing="xs">
          <Table.Thead>
            <Table.Tr>
              <Table.Th />
              {columnas.map((c, i) => (
                <Table.Th key={i}>
                  {c.titulo}
                  <Badge ml={4} size="xs" variant="light" color={i === 0 ? 'gray' : 'red'}>
                    {i === 0 ? 'primer cobro' : 'repetido'}
                  </Badge>
                  {c.sub && <Text size="xs" c="dimmed" fw={400}>{c.sub}</Text>}
                </Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {filas.map(([etiqueta, valor, compara]) => (
              <Table.Tr key={etiqueta}>
                <Table.Td c="dimmed">{etiqueta}</Table.Td>
                {columnas.map((c, i) => {
                  const distinto = compara && i > 0 && valor(c) !== valor(columnas[0])
                  return (
                    <Table.Td key={i} c={distinto ? 'red' : undefined} fw={distinto ? 700 : undefined}>
                      {valor(c)}
                    </Table.Td>
                  )
                })}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      <Group justify="flex-end" gap="xs">
        {otras.map((o) => (
          <Button
            key={o.factura_id}
            size="compact-xs" variant="subtle" rightSection={<IconArrowRight size={14} />}
            onClick={() => onAbrir(o.factura_id)}
          >
            Abrir {folioDe(o)}
          </Button>
        ))}
      </Group>
    </Stack>
  )
}

/** `+4 min 05 s` entre dos `fecha_hora` del mismo día o de días seguidos. */
function lapso(desde: string, hasta: string): string {
  const s = Math.round((Date.parse(`${hasta}Z`) - Date.parse(`${desde}Z`)) / 1000)
  const m = Math.floor(s / 60)
  return m === 0 ? `+${s} s` : `+${m} min ${String(s % 60).padStart(2, '0')} s`
}

/**
 * Los cruces de una ráfaga en columnas, en orden de hora y al segundo, con el
 * tiempo desde el anterior: lo que decide si es una doble lectura del carril o
 * una vuelta real. Lo que no coincide con el primero se marca. El más caro
 * sale como "se paga" porque es el que el monto del hallazgo deja fuera.
 */
function ComparaDobleCobro({ cruces }: { cruces: CruceCaseta[] }) {
  const orden = [...cruces].sort((a, b) => a.fecha_hora.localeCompare(b.fecha_hora))
  const pagado = orden.reduce((m, c) => (c.total > m.total ? c : m), orden[0])
  const filas: [string, (c: CruceCaseta, i: number) => string, boolean][] = [
    ['Partida', (c) => String(c.renglon), false],
    ['Fecha y hora', (c) => `${formatFecha(c.fecha_hora.slice(0, 10))} ${c.fecha_hora.slice(11, 19)}`, false],
    ['Desde el anterior', (c, i) => (i === 0 ? '—' : lapso(orden[i - 1].fecha_hora, c.fecha_hora)), false],
    ['Tramo', (c) => c.tramo ?? 'sin tarifa', true],
    ['Carril', (c) => c.carril ?? '—', true],
    ['Evento', (c) => c.evento ?? '—', true],
    ['Clase', (c) => String(c.clase), true],
    ['Total', (c) => formatMXN(c.total), true],
  ]
  return (
    <Table.ScrollContainer minWidth={120 + 130 * orden.length} mt={4}>
      <Table withTableBorder fz="xs" verticalSpacing={2} horizontalSpacing="xs">
        <Table.Thead>
          <Table.Tr>
            <Table.Th />
            {orden.map((c) => (
              <Table.Th key={c.renglon}>
                <Badge size="xs" variant="light" color={c === pagado ? 'gray' : 'red'}>
                  {c === pagado ? 'se paga' : 'de más'}
                </Badge>
              </Table.Th>
            ))}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {filas.map(([etiqueta, valor, compara]) => (
            <Table.Tr key={etiqueta}>
              <Table.Td c="dimmed">{etiqueta}</Table.Td>
              {orden.map((c, i) => {
                const distinto = compara && i > 0 && valor(c, i) !== valor(orden[0], 0)
                return (
                  <Table.Td key={c.renglon} c={distinto ? 'red' : undefined} fw={distinto ? 700 : undefined}>
                    {valor(c, i)}
                  </Table.Td>
                )
              })}
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  )
}

/**
 * El ajuste debajo del cruce que corrige, como una cuenta: lo que se cobró, lo
 * que se agregó y en qué quedó, contra lo que ese tag suele pagar ahí. Si
 * cuadra, la corrección es correcta y no se reclama nada.
 */
function ComparaAjuste({
  ajuste, k, onAbrir,
}: { ajuste: CruceCaseta; k: CorreccionDeClase; onAbrir: (id: number) => void }) {
  const arriba = k.esperado !== null && k.suma - k.esperado > 0.01
  return (
    <Stack gap={6} mt={4}>
      <Table withTableBorder fz="xs" verticalSpacing={2} horizontalSpacing="xs">
        <Table.Tbody>
          <Table.Tr>
            <Table.Td c="dimmed">
              Cruce original · partida {k.renglon}{k.misma_factura ? '' : ` de ${folioDe(k)}`}
            </Table.Td>
            <Table.Td>{fechaHora(k.fecha_hora)} · clase {k.clase}{k.de ? ` · ${k.de}` : ''}</Table.Td>
            <Table.Td style={{ textAlign: 'right' }}>{formatMXN(k.total)}</Table.Td>
          </Table.Tr>
          <Table.Tr>
            <Table.Td c="dimmed">Ajuste · partida {ajuste.renglon}</Table.Td>
            <Table.Td>{fechaHora(ajuste.fecha_hora)}{k.a ? ` · a ${k.a}` : ''}</Table.Td>
            <Table.Td style={{ textAlign: 'right' }}>+ {formatMXN(ajuste.total)}</Table.Td>
          </Table.Tr>
          <Table.Tr>
            <Table.Td fw={600}>Quedó pagado</Table.Td>
            <Table.Td c="dimmed">{k.a ? `tarifa de ${k.a} en ${k.tramo}` : ''}</Table.Td>
            <Table.Td fw={700} style={{ textAlign: 'right' }}>{formatMXN(k.suma)}</Table.Td>
          </Table.Tr>
          {k.esperado !== null && (
            <Table.Tr>
              <Table.Td c="dimmed">Lo que el tag suele pagar</Table.Td>
              <Table.Td c="dimmed">
                clase {k.clase_habitual} en esta caseta
                {k.segun === 'historial' && ' · lo más que ha pagado (sin tarifa cargada)'}
              </Table.Td>
              <Table.Td
                c={arriba ? 'red' : 'green'} fw={700} style={{ textAlign: 'right' }}
              >
                {formatMXN(k.esperado)}
              </Table.Td>
            </Table.Tr>
          )}
        </Table.Tbody>
      </Table>
      {!k.misma_factura && (
        <Group justify="flex-end">
          <Button
            size="compact-xs" variant="subtle" rightSection={<IconArrowRight size={14} />}
            onClick={() => onAbrir(k.factura_id)}
          >
            Abrir {folioDe(k)}
          </Button>
        </Group>
      )}
    </Stack>
  )
}

function TarjetaHallazgo({
  h, cruces, onAbrir,
}: { h: Hallazgo; cruces: CruceCaseta[]; onAbrir: (id: number) => void }) {
  return (
    <Card withBorder padding="sm" radius="md">
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Stack gap={4} style={{ minWidth: 0 }}>
          <Group gap={6}>
            <Badge size="xs" variant="light" color={COLOR_HALLAZGO[h.tipo]}>
              {TITULO_HALLAZGO[h.tipo]}
            </Badge>
            <Text size="xs" c="dimmed">
              Partida{h.renglones.length === 1 ? '' : 's'} {h.renglones.join(', ')}
            </Text>
          </Group>
          <Text size="sm" fw={600}>
            {h.vehiculo ?? 'Sin unidad'}
            <Text component="span" size="xs" c="dimmed" fw={400}> · {h.tag}</Text>
          </Text>
          {h.caseta && <Text size="xs" c="dimmed">{h.caseta}</Text>}
          <Text size="xs">{h.detalle}</Text>
          {h.otras && cruces[0] && <ComparaCobradoAntes esta={cruces[0]} otras={h.otras} onAbrir={onAbrir} />}
          {h.tipo === 'doble_cobro' && cruces.length > 1 && <ComparaDobleCobro cruces={cruces} />}
          {h.corrige && cruces[0] && <ComparaAjuste ajuste={cruces[0]} k={h.corrige} onAbrir={onAbrir} />}
          {h.ajuste_en && (
            <Group justify="flex-end">
              <Button
                size="compact-xs" variant="subtle" rightSection={<IconArrowRight size={14} />}
                onClick={() => onAbrir(h.ajuste_en!.factura_id)}
              >
                Abrir {folioDe(h.ajuste_en)}
              </Button>
            </Group>
          )}
        </Stack>
        <Tooltip label={
          h.tipo === 'cobrado_antes' && h.monto === 0
            ? 'Aquí fue el primer cobro: lo de más está en las otras facturas'
            : h.tipo === 'ajuste' && h.monto === 0
              ? 'La corrección deja la tarifa que el tag suele pagar: no hay nada que reclamar'
              : h.tipo === 'corregido'
                ? 'El ajuste se revisa en su factura'
                : h.grupo === 'cobro' ? 'Lo que pudo cobrarse de más' : 'Lo que suman esos cruces'
        }>
          <Text size="sm" fw={700} c={h.monto === 0 ? 'dimmed' : undefined} style={{ whiteSpace: 'nowrap' }}>
            {formatMXN(h.monto)}
          </Text>
        </Tooltip>
      </Group>
    </Card>
  )
}

/**
 * Lo que no se revisó contra precio: sin esto, "nada fuera de tarifa" se lee
 * como que todo cuadró, cuando una parte ni se miró.
 */
function SinTarifa({ casetas }: { casetas: CasetaSinTarifa[] }) {
  if (casetas.length === 0) return null
  const cruces = sumar(casetas, (c) => c.cruces)
  return (
    <Text size="xs" c="dimmed">
      Sin tarifa cargada, no se revisó contra precio: {cruces} cruce{cruces === 1 ? '' : 's'} por{' '}
      {formatMXN(sumar(casetas, (c) => c.total))} en{' '}
      {casetas.map((c) => `${c.descripcion.replace(/^PEAJE /i, '')} (${c.caseta})`).join(', ')}.
    </Text>
  )
}

function Hallazgos({
  hallazgos, cruces, sinTarifa, onAbrir,
}: {
  hallazgos: Hallazgo[]; cruces: CruceCaseta[]; sinTarifa: CasetaSinTarifa[]
  onAbrir: (id: number) => void
}) {
  const porRenglon = new Map(cruces.map((c) => [c.renglon, c]))
  const tarjeta = (h: Hallazgo, key: string) => (
    <TarjetaHallazgo
      key={key} h={h} onAbrir={onAbrir}
      cruces={h.renglones.flatMap((r) => porRenglon.get(r) ?? [])}
    />
  )
  const cobro = hallazgos.filter((h) => h.grupo === 'cobro')
  const uso = hallazgos.filter((h) => h.grupo === 'uso')

  if (hallazgos.length === 0) {
    return (
      <Stack gap="xs">
        <Alert color="green" variant="light" icon={<IconCheck size={16} />}>
          No hay nada fuera de lo normal en esta factura.
        </Alert>
        <SinTarifa casetas={sinTarifa} />
      </Stack>
    )
  }

  return (
    <Stack gap="md">
      <Stack gap="xs">
        <Text size="sm" fw={600}>Lo que PASE pudo cobrar de más</Text>
        {cobro.length === 0
          ? <Text size="sm" c="dimmed">Nada.</Text>
          : cobro.map((h, i) => tarjeta(h, `c${i}`))}
      </Stack>
      <Stack gap="xs">
        <Text size="sm" fw={600}>Cómo se usan las unidades</Text>
        {uso.length === 0
          ? <Text size="sm" c="dimmed">Nada.</Text>
          : uso.map((h, i) => tarjeta(h, `u${i}`))}
      </Stack>
      <SinTarifa casetas={sinTarifa} />
    </Stack>
  )
}

function PorUnidad({ detalle }: { detalle: DetalleFacturaCasetas }) {
  return (
    <Table.ScrollContainer minWidth={560}>
      <Table withTableBorder striped>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Unidad</Table.Th>
            <Table.Th>Tag</Table.Th>
            <Table.Th style={{ textAlign: 'center' }}>Cruces</Table.Th>
            <Table.Th style={{ textAlign: 'center' }}>Casetas</Table.Th>
            <Table.Th style={{ textAlign: 'right' }}>Total</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {detalle.por_unidad.map((u) => (
            <Table.Tr key={u.vehiculo_id ?? u.tags.join()}>
              <Table.Td>
                {u.vehiculo ?? <Badge size="xs" variant="light" color="grape">Sin unidad</Badge>}
              </Table.Td>
              <Table.Td><Text size="xs" ff="monospace">{u.tags.join(', ')}</Text></Table.Td>
              <Table.Td style={{ textAlign: 'center' }}>{u.cruces}</Table.Td>
              <Table.Td style={{ textAlign: 'center' }}>{u.casetas}</Table.Td>
              <Table.Td style={{ textAlign: 'right' }}>
                <Text size="sm" fw={600}>{formatMXN(u.total)}</Text>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  )
}

function Cruces({ cruces }: { cruces: CruceCaseta[] }) {
  const [tag, setTag] = useState<string | null>(null)
  const [buscar, setBuscar] = useState('')
  const [page, setPage] = useState(1)

  const opcionesTag = useMemo(() => {
    const vistos = new Map<string, string>()
    for (const c of cruces) vistos.set(c.tag, c.vehiculo ? `${c.vehiculo} · ${c.tag}` : `${c.tag} (sin unidad)`)
    return [...vistos].map(([value, label]) => ({ value, label }))
  }, [cruces])

  const q = buscar.trim().toUpperCase()
  const filtrados = cruces.filter((c) =>
    (!tag || c.tag === tag)
    && (!q || c.descripcion.toUpperCase().includes(q) || !!c.tramo?.toUpperCase().includes(q)))
  const paginas = Math.ceil(filtrados.length / CRUCES_POR_PAGINA)
  const visibles = filtrados.slice((page - 1) * CRUCES_POR_PAGINA, page * CRUCES_POR_PAGINA)

  return (
    <Stack gap="sm">
      <Group grow align="flex-start">
        <Select
          placeholder="Todas las unidades" data={opcionesTag} clearable searchable
          value={tag} onChange={(v) => { setTag(v); setPage(1) }}
        />
        <TextInput
          placeholder="Buscar caseta…" leftSection={<IconSearch size={16} />}
          value={buscar} onChange={(e) => { setBuscar(e.currentTarget.value); setPage(1) }}
        />
      </Group>
      <Text size="xs" c="dimmed">
        {filtrados.length} cruce{filtrados.length === 1 ? '' : 's'} · {formatMXN(sumar(filtrados, (c) => c.total))}
      </Text>
      <Table.ScrollContainer minWidth={640}>
        <Table withTableBorder striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={60}>Partida</Table.Th>
              <Table.Th>Fecha</Table.Th>
              <Table.Th>Unidad</Table.Th>
              <Table.Th>Caseta</Table.Th>
              <Table.Th style={{ textAlign: 'center' }}>Clase</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Total</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {visibles.map((c) => (
              <Table.Tr key={c.id}>
                <Table.Td c="dimmed">{c.renglon}</Table.Td>
                <Table.Td style={{ whiteSpace: 'nowrap' }}>{fechaHora(c.fecha_hora)}</Table.Td>
                <Table.Td>
                  <Text size="sm">{c.vehiculo ?? 'Sin unidad'}</Text>
                  <Text size="xs" c="dimmed" ff="monospace">{c.tag}</Text>
                </Table.Td>
                <Table.Td>
                  {c.descripcion}
                  {c.tramo && <Text size="xs" c="dimmed">{c.tramo}</Text>}
                </Table.Td>
                <Table.Td style={{ textAlign: 'center' }}>{c.clase}</Table.Td>
                <Table.Td style={{ textAlign: 'right' }}>{formatMXN(c.total)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      {paginas > 1 && (
        <Group justify="center">
          <Pagination value={page} onChange={setPage} total={paginas} size="sm" />
        </Group>
      )}
    </Stack>
  )
}

function DetalleModal({
  facturaId, onClose, onAbrir,
}: { facturaId: number | null; onClose: () => void; onAbrir: (id: number) => void }) {
  const { esAdmin } = usePermisos()
  const { data, isLoading, isError } = useFacturaCasetas(facturaId)
  const revisar = useRevisarFacturaCasetas()
  const reabrir = useReabrirFacturaCasetas()
  const [nota, setNota] = useState('')

  const d = data?.data
  const cobro = d ? sumar(d.hallazgos.filter((h) => h.grupo === 'cobro'), (h) => h.monto) : 0
  const uso = d ? d.hallazgos.filter((h) => h.grupo === 'uso').length : 0

  function limpiar() {
    setNota('')
    revisar.reset()
    reabrir.reset()
  }

  function cerrar() {
    limpiar()
    onClose()
  }

  // Saltar a la otra factura del cruce repetido sin cerrar el modal: la nota a
  // medio escribir era de esta.
  function abrirOtra(id: number) {
    limpiar()
    onAbrir(id)
  }

  return (
    <Modal
      opened={facturaId !== null} onClose={cerrar} size="xl"
      title={<Text fw={700}>{d ? `Factura ${d.factura.serie ? `${d.factura.serie}-` : ''}${d.factura.folio}` : 'Factura'}</Text>}
    >
      {isError ? (
        <Alert color="red" title="Error">No se pudo cargar la factura.</Alert>
      ) : isLoading || !d ? (
        <Center py="xl"><Loader /></Center>
      ) : (
        <Stack gap="md">
          <Text size="sm" c="dimmed">{d.factura.periodo ?? 'Sin periodo'}</Text>

          <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
            <Card withBorder padding="xs">
              <Text size="xs" c="dimmed">Total</Text>
              <Text size="lg" fw={700}>{formatMXN(d.factura.total)}</Text>
            </Card>
            <Card withBorder padding="xs">
              <Text size="xs" c="dimmed">Cruces</Text>
              <Text size="lg" fw={700}>{d.factura.cruces}</Text>
              <Text size="xs" c="dimmed">{d.factura.unidades} unidad(es)</Text>
            </Card>
            <Card withBorder padding="xs" bg={cobro > 0 ? 'var(--mantine-color-red-light)' : undefined}>
              <Text size="xs" c="dimmed">Pudo cobrarse de más</Text>
              <Text size="lg" fw={700}>{formatMXN(cobro)}</Text>
            </Card>
            <Card withBorder padding="xs" bg={uso > 0 ? 'var(--mantine-color-grape-light)' : undefined}>
              <Text size="xs" c="dimmed">Uso por revisar</Text>
              <Text size="lg" fw={700}>{uso}</Text>
            </Card>
          </SimpleGrid>

          <Tabs defaultValue="hallazgos" keepMounted={false}>
            <Tabs.List>
              <Tabs.Tab value="hallazgos">Hallazgos ({d.hallazgos.length})</Tabs.Tab>
              <Tabs.Tab value="unidades">Por unidad</Tabs.Tab>
              <Tabs.Tab value="cruces">Cruces</Tabs.Tab>
            </Tabs.List>
            <Tabs.Panel value="hallazgos" pt="md"><Hallazgos hallazgos={d.hallazgos} cruces={d.cruces} sinTarifa={d.sin_tarifa} onAbrir={abrirOtra} /></Tabs.Panel>
            <Tabs.Panel value="unidades" pt="md"><PorUnidad detalle={d} /></Tabs.Panel>
            <Tabs.Panel value="cruces" pt="md"><Cruces cruces={d.cruces} /></Tabs.Panel>
          </Tabs>

          {d.factura.revisada_en ? (
            <Alert color="green" variant="light" icon={<IconCheck size={16} />}>
              <Group justify="space-between" wrap="nowrap">
                <div>
                  <Text size="sm">
                    Revisada por <b>{d.factura.revisada_por}</b> el {formatFecha(d.factura.revisada_en.slice(0, 10))}.
                  </Text>
                  {d.factura.nota && <Text size="xs" c="dimmed">Nota: {d.factura.nota}</Text>}
                </div>
                {esAdmin && (
                  <Button
                    size="compact-xs" variant="subtle" color="orange"
                    leftSection={<IconLockOpen size={14} />}
                    loading={reabrir.isPending} onClick={() => reabrir.mutate(d.factura.id)}
                  >
                    Reabrir
                  </Button>
                )}
              </Group>
            </Alert>
          ) : esAdmin ? (
            <Stack gap="xs">
              <Textarea
                label="Nota (opcional)" size="xs" autosize minRows={1} maxLength={255}
                placeholder="Lo que se reclamó a PASE, lo que se aclaró con el chofer…"
                value={nota} onChange={(e) => setNota(e.currentTarget.value)}
              />
              <Group justify="flex-end">
                <Button
                  color="green" loading={revisar.isPending}
                  onClick={() => revisar.mutate({ id: d.factura.id, nota: nota.trim() || undefined })}
                >
                  Marcar como revisada
                </Button>
              </Group>
            </Stack>
          ) : null}

          {(revisar.error || reabrir.error) && (
            <Alert color="red">{((revisar.error ?? reabrir.error) as Error).message}</Alert>
          )}
        </Stack>
      )}
    </Modal>
  )
}

// ── Las facturas ─────────────────────────────────────────────────────────────

function FacturasPanel() {
  const { puedeEditar } = usePermisos()
  const [search, setSearch] = useState('')
  const [debounced] = useDebouncedValue(search, 300)
  const [porRevisar, setPorRevisar] = useState(false)
  const [page, setPage] = useState(1)
  const [importando, setImportando] = useState(false)
  const [abierta, setAbierta] = useState<number | null>(null)

  const { data, isLoading, isError } = useFacturasCasetas({
    page, pageSize: PAGE_SIZE, search: debounced || undefined, por_revisar: porRevisar || undefined,
  })
  const facturas = data?.data ?? []
  const total = data?.pagination.total ?? 0
  const paginas = Math.ceil(total / PAGE_SIZE)

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end">
        <TextInput
          placeholder="Buscar por folio o periodo…" leftSection={<IconSearch size={16} />}
          style={{ flex: 1, maxWidth: 360 }}
          value={search} onChange={(e) => { setSearch(e.currentTarget.value); setPage(1) }}
        />
        {puedeEditar && (
          <Button leftSection={<IconFileImport size={16} />} onClick={() => setImportando(true)}>
            Importar XML
          </Button>
        )}
      </Group>
      <Switch
        size="xs" label="Solo las que faltan por revisar"
        checked={porRevisar} onChange={(e) => { setPorRevisar(e.currentTarget.checked); setPage(1) }}
      />

      {isError ? (
        <Alert color="red" title="Error">No se pudieron cargar las facturas.</Alert>
      ) : isLoading ? (
        <Center py="xl"><Loader /></Center>
      ) : !facturas.length ? (
        <Center py="xl">
          <Text c="dimmed">
            {debounced || porRevisar
              ? 'Ninguna factura coincide con el filtro.'
              : 'Todavía no hay facturas de casetas. Importa el XML de la primera.'}
          </Text>
        </Center>
      ) : (
        <>
          <Text size="xs" c="dimmed">{total} factura{total === 1 ? '' : 's'}</Text>
          <Table.ScrollContainer minWidth={720}>
            <Table withTableBorder striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Folio</Table.Th>
                  <Table.Th>Periodo</Table.Th>
                  <Table.Th style={{ textAlign: 'center' }}>Cruces</Table.Th>
                  <Table.Th style={{ textAlign: 'center' }}>Unidades</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Total</Table.Th>
                  <Table.Th style={{ textAlign: 'center' }}>Estado</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {facturas.map((f) => (
                  <Table.Tr key={f.id} style={{ cursor: 'pointer' }} onClick={() => setAbierta(f.id)}>
                    <Table.Td>
                      <Text size="sm" fw={600}>{f.serie ? `${f.serie}-` : ''}{f.folio}</Text>
                      <Text size="xs" c="dimmed">{formatFecha(f.fecha_emision.slice(0, 10))}</Text>
                    </Table.Td>
                    <Table.Td><Text size="sm">{f.periodo ?? '—'}</Text></Table.Td>
                    <Table.Td style={{ textAlign: 'center' }}>{f.cruces}</Table.Td>
                    <Table.Td style={{ textAlign: 'center' }}>
                      {f.unidades}
                      {f.sin_unidad > 0 && (
                        <Tooltip label={`${f.sin_unidad} cruce(s) de tags sin unidad`}>
                          <Badge size="xs" variant="light" color="grape" ml={6}>+ sin unidad</Badge>
                        </Tooltip>
                      )}
                    </Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>
                      <Text size="sm" fw={600}>{formatMXN(f.total)}</Text>
                    </Table.Td>
                    <Table.Td style={{ textAlign: 'center' }}>
                      {f.revisada_en
                        ? <Badge size="sm" variant="light" color="green">Revisada</Badge>
                        : <Badge size="sm" variant="light" color="gray">Por revisar</Badge>}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
          {paginas > 1 && (
            <Group justify="center">
              <Pagination value={page} onChange={setPage} total={paginas} />
            </Group>
          )}
        </>
      )}

      <ImportarModal
        abierto={importando} onClose={() => setImportando(false)} onImportada={setAbierta}
      />
      <DetalleModal facturaId={abierta} onClose={() => setAbierta(null)} onAbrir={setAbierta} />
    </Stack>
  )
}

// ── Los tags ─────────────────────────────────────────────────────────────────

/** La unidad de un tag, editable en su renglón. */
function UnidadDeTag({ t }: { t: TagCaseta }) {
  const { puedeEditar } = usePermisos()
  const mut = useActualizarTagCaseta()
  const [aviso, setAviso] = useState<string | null>(null)

  if (!puedeEditar) {
    return t.vehiculo
      ? <Text size="sm">{t.vehiculo}</Text>
      : <Badge size="xs" variant="light" color="grape">Sin unidad</Badge>
  }

  return (
    <Stack gap={2}>
      <SelectVehiculo
        size="xs" value={t.vehiculo_id} etiqueta={t.vehiculo}
        onChange={(id) => {
          setAviso(null)
          mut.mutate({ id: t.id, vehiculo_id: id, nota: t.nota }, {
            onSuccess: (r) => {
              const n = r.data.cruces_ligados
              if (n > 0) setAviso(`${n} cruce(s) sin unidad quedaron a nombre de esta.`)
            },
          })
        }}
      />
      {aviso && <Text size="xs" c="green.7">{aviso}</Text>}
      {mut.error && <Text size="xs" c="red">{(mut.error as Error).message}</Text>}
    </Stack>
  )
}

function NuevoTagModal({ abierto, onClose }: { abierto: boolean; onClose: () => void }) {
  const crear = useCrearTagCaseta()
  const [tag, setTag] = useState('')
  const [vehiculo, setVehiculo] = useState<{ id: number; label: string | null } | null>(null)

  function cerrar() { setTag(''); setVehiculo(null); crear.reset(); onClose() }
  const limpio = tag.trim().replace(/\.+$/, '').toUpperCase()

  return (
    <Modal opened={abierto} onClose={cerrar} title={<Text fw={700}>Registrar tag</Text>}>
      <Stack gap="sm">
        <Text size="xs" c="dimmed">
          Los tags que llegan en una factura se dan de alta solos. Esto es para dejar
          uno listo antes de que cruce.
        </Text>
        <TextInput
          label="Tag" placeholder="IMDM27096290" required
          value={tag} onChange={(e) => setTag(e.currentTarget.value.slice(0, 32))}
        />
        <SelectVehiculo
          label="Unidad" value={vehiculo?.id ?? null} etiqueta={vehiculo?.label ?? null}
          onChange={(id, label) => setVehiculo(id ? { id, label } : null)}
        />
        {crear.error && <Alert color="red">{(crear.error as Error).message}</Alert>}
        <Group justify="flex-end">
          <Button variant="default" onClick={cerrar}>Cancelar</Button>
          <Button
            disabled={limpio.length < 4} loading={crear.isPending}
            onClick={() => crear.mutate(
              { tag: limpio, vehiculo_id: vehiculo?.id ?? null },
              { onSuccess: cerrar },
            )}
          >
            Registrar
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}

function TagsPanel() {
  const { puedeEditar } = usePermisos()
  const { data, isLoading, isError } = useTagsCasetas()
  const [nuevo, setNuevo] = useState(false)
  const tags = data?.data ?? []
  const sinUnidad = tags.filter((t) => t.vehiculo_id === null).length

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end">
        <Text size="sm" c="dimmed" maw={560}>
          De qué unidad es cada tag. Al asignarlo, sus cruces que no tenían unidad
          pasan a la nueva; los que ya tenían una se quedan con ella.
        </Text>
        {puedeEditar && (
          <Button variant="light" leftSection={<IconPlus size={16} />} onClick={() => setNuevo(true)}>
            Registrar tag
          </Button>
        )}
      </Group>

      {sinUnidad > 0 && (
        <Alert color="grape" variant="light" icon={<IconAlertTriangle size={16} />}>
          {sinUnidad} tag(s) sin unidad. Sus cruces no cuentan en el gasto de ninguna unidad.
        </Alert>
      )}

      {isError ? (
        <Alert color="red" title="Error">No se pudieron cargar los tags.</Alert>
      ) : isLoading ? (
        <Center py="xl"><Loader /></Center>
      ) : !tags.length ? (
        <Center py="xl"><Text c="dimmed">Los tags aparecen al importar la primera factura.</Text></Center>
      ) : (
        <Table.ScrollContainer minWidth={720}>
          <Table withTableBorder striped>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Tag</Table.Th>
                <Table.Th w={320}>Unidad</Table.Th>
                <Table.Th style={{ textAlign: 'center' }}>Cruces</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Total</Table.Th>
                <Table.Th>Último cruce</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {tags.map((t) => (
                <Table.Tr key={t.id}>
                  <Table.Td><Text size="sm" ff="monospace">{t.tag}</Text></Table.Td>
                  <Table.Td><UnidadDeTag t={t} /></Table.Td>
                  <Table.Td style={{ textAlign: 'center' }}>{t.cruces}</Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>{formatMXN(t.total)}</Table.Td>
                  <Table.Td c="dimmed">{t.ultimo_cruce ? fechaHora(t.ultimo_cruce) : '—'}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}

      <NuevoTagModal abierto={nuevo} onClose={() => setNuevo(false)} />
    </Stack>
  )
}

// ── La pantalla ──────────────────────────────────────────────────────────────

// ── Las tarifas ──────────────────────────────────────────────────────────────

const COLUMNAS_TARIFA: [Exclude<keyof ValoresTarifa, 'vigente_desde'>, string][] = [
  ['moto', 'Moto'], ['auto', 'Auto'], ['autobus', 'Autobús'], ['camion_2_4', '2-4 ejes'],
  ['camion_5_6', '5-6 ejes'], ['camion_7_9', '7-9 ejes'], ['eje_ligero', 'Eje ligero'],
  ['eje_pesado', 'Eje pesado'],
]

const VACIA: ValoresTarifa = {
  vigente_desde: '', moto: null, auto: null, autobus: null, camion_2_4: null,
  camion_5_6: null, camion_7_9: null, eje_ligero: null, eje_pesado: null,
}

/**
 * Lo que se edita: corregir la vigencia de un tramo, registrar un aumento del
 * mismo tramo, o agregar un tramo nuevo a una caseta.
 *
 * Corregir y aumentar no son lo mismo. Corregir cambia el precio que ya estaba
 * (la página tenía un error); aumentar agrega una vigencia con su fecha y deja
 * la anterior, para que los cruces de antes se sigan revisando contra el
 * precio de su día.
 */
type EdicionTarifa =
  | { modo: 'tramo'; caseta: TarifasDeCaseta; tramo: TarifaTramo }
  | { modo: 'nuevo'; caseta: TarifasDeCaseta }

function TarifaModal({ edicion, onClose }: { edicion: EdicionTarifa | null; onClose: () => void }) {
  const actualizar = useActualizarTarifaCaseta()
  const crear = useCrearTarifaCaseta()
  const crearTramo = useCrearTramoCaseta()
  const [accion, setAccion] = useState<'corregir' | 'aumento'>('corregir')
  const [valores, setValores] = useState<ValoresTarifa>(VACIA)
  const [autopista, setAutopista] = useState('')
  const [nombre, setNombre] = useState('')
  const [abiertaPara, setAbiertaPara] = useState<EdicionTarifa | null>(null)

  // Al abrir, se llena con lo que hay: es más fácil corregir un número que
  // volver a teclear ocho.
  if (edicion !== abiertaPara) {
    setAbiertaPara(edicion)
    setAccion('corregir')
    actualizar.reset(); crear.reset(); crearTramo.reset()
    if (edicion?.modo === 'tramo') {
      const { tramo: t } = edicion
      setValores({
        vigente_desde: t.vigente_desde, moto: t.moto, auto: t.auto, autobus: t.autobus,
        camion_2_4: t.camion_2_4, camion_5_6: t.camion_5_6, camion_7_9: t.camion_7_9,
        eje_ligero: t.eje_ligero, eje_pesado: t.eje_pesado,
      })
    } else if (edicion) {
      setValores(VACIA)
      setAutopista(edicion.caseta.tramos[0]?.autopista ?? '')
      setNombre('')
    }
  }

  if (!edicion) return null
  const tramo = edicion.modo === 'tramo' ? edicion.tramo : null
  const otras = tramo ? tramo.casetas.filter((c) => c !== edicion.caseta.caseta) : []
  const mutacion = edicion.modo === 'nuevo' ? crearTramo : accion === 'corregir' ? actualizar : crear
  const hayTarifa = COLUMNAS_TARIFA.some(([col]) => valores[col] !== null)
  const aumentoSinFechaNueva = tramo !== null && accion === 'aumento'
    && valores.vigente_desde <= tramo.vigente_desde
  const listo = !!valores.vigente_desde && hayTarifa && !aumentoSinFechaNueva
    && (edicion.modo === 'tramo' || (!!autopista.trim() && !!nombre.trim()))

  async function guardar() {
    if (!edicion) return
    if (edicion.modo === 'nuevo') {
      await crearTramo.mutateAsync({
        ...valores, autopista: autopista.trim(), nombre: nombre.trim(), casetas: [edicion.caseta.caseta],
      })
    } else if (accion === 'corregir') {
      await actualizar.mutateAsync({ ...valores, id: edicion.tramo.tarifa_id })
    } else {
      await crear.mutateAsync({ ...valores, tramo_id: edicion.tramo.tramo_id })
    }
    onClose()
  }

  const nombreCaseta = edicion.caseta.nombre?.replace(/^PEAJE /i, '') ?? `Caseta ${edicion.caseta.caseta}`
  return (
    <Modal
      opened onClose={onClose} size="lg"
      title={<Text fw={700}>{tramo ? tramo.tramo : `Nuevo tramo en ${nombreCaseta}`}</Text>}
    >
      <Stack gap="sm">
        {tramo ? (
          <>
            <SegmentedControl
              fullWidth value={accion}
              onChange={(v) => {
                const a = v as 'corregir' | 'aumento'
                setAccion(a)
                setValores((x) => ({ ...x, vigente_desde: a === 'corregir' ? tramo.vigente_desde : '' }))
              }}
              data={[
                { value: 'corregir', label: 'Corregir esta tarifa' },
                { value: 'aumento', label: 'Registrar un aumento' },
              ]}
            />
            <Text size="xs" c="dimmed">
              {accion === 'corregir'
                ? `Cambia la tarifa vigente desde el ${formatFecha(tramo.vigente_desde)}. Úsalo si el precio estaba mal: todos los cruces revisados con ella cambian.`
                : `Agrega una tarifa nueva con su fecha. La de ${formatFecha(tramo.vigente_desde)} se queda para los cruces de antes.`}
            </Text>
            {otras.length > 0 && (
              <Alert color="blue" variant="light" p="xs">
                <Text size="xs">
                  Este tramo también lo cobran las casetas {otras.join(', ')}: el cambio les aplica igual.
                </Text>
              </Alert>
            )}
          </>
        ) : (
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
            <TextInput
              label="Autopista" required maxLength={80} placeholder="Guadalajara - Tepic"
              value={autopista} onChange={(e) => setAutopista(e.currentTarget.value)}
            />
            <TextInput
              label="Tramo" required maxLength={120} placeholder="De dónde a dónde"
              value={nombre} onChange={(e) => setNombre(e.currentTarget.value)}
            />
          </SimpleGrid>
        )}

        <FechaInput
          label="Vigente desde" required
          value={valores.vigente_desde}
          onChange={(v) => setValores((x) => ({ ...x, vigente_desde: v }))}
          error={aumentoSinFechaNueva && valores.vigente_desde
            ? 'El aumento debe ser posterior a la tarifa actual' : undefined}
        />

        <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
          {COLUMNAS_TARIFA.map(([col, titulo]) => (
            <NumberInput
              key={col} label={titulo} prefix="$" min={0} max={99999} decimalScale={2}
              thousandSeparator="," hideControls placeholder="—"
              value={valores[col] ?? ''}
              onChange={(v) => setValores((x) => ({ ...x, [col]: v === '' ? null : Number(v) }))}
            />
          ))}
        </SimpleGrid>
        <Text size="xs" c="dimmed">
          Con IVA, como las publica el operador. Deja vacía la clasificación que no se publica.
        </Text>

        {mutacion.error && <Alert color="red">{(mutacion.error as Error).message}</Alert>}

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Cancelar</Button>
          <Button loading={mutacion.isPending} disabled={!listo} onClick={guardar}>
            {edicion.modo === 'nuevo' ? 'Agregar tramo' : accion === 'corregir' ? 'Guardar corrección' : 'Registrar aumento'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}

/**
 * Una caseta abierta: sus tramos con la tarifa de hoy y, debajo, lo que PASE ha
 * cobrado ahí. Las tarifas que sí se han cobrado se marcan en la tabla, para
 * ver de un vistazo por qué tramos pasa la flota.
 */
function TarifasDeUnaCaseta({
  k, onEditar,
}: { k: TarifasDeCaseta; onEditar: ((e: EdicionTarifa) => void) | null }) {
  const usadas = new Set(k.cobrados.flatMap((c) => c.tramos.map((t) => `${t}|${c.total}`)))
  return (
    <Stack gap="sm">
      <Table.ScrollContainer minWidth={760}>
        <Table withTableBorder striped fz="xs" verticalSpacing={4}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Tramo</Table.Th>
              {COLUMNAS_TARIFA.map(([, titulo]) => (
                <Table.Th key={titulo} style={{ textAlign: 'right' }}>{titulo}</Table.Th>
              ))}
              {onEditar && <Table.Th w={36} />}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {k.tramos.map((t) => (
              <Table.Tr key={t.tramo_id}>
                <Table.Td>
                  {t.tramo}
                  <Text size="xs" c="dimmed">
                    desde {formatFecha(t.vigente_desde)}
                    {t.vigencias > 1 && ` · ${t.vigencias} vigencias`}
                  </Text>
                </Table.Td>
                {COLUMNAS_TARIFA.map(([col]) => {
                  const v = t[col]
                  const usada = v !== null && usadas.has(`${t.tramo}|${v}`)
                  return (
                    <Table.Td
                      key={col} fw={usada ? 700 : undefined}
                      bg={usada ? 'var(--mantine-color-blue-light)' : undefined}
                      style={{ textAlign: 'right', whiteSpace: 'nowrap' }}
                    >
                      {v === null ? '—' : formatMXN(v)}
                    </Table.Td>
                  )
                })}
                {onEditar && (
                  <Table.Td>
                    <Tooltip label="Corregir o registrar un aumento">
                      <ActionIcon
                        variant="subtle" size="sm" aria-label={`Editar ${t.tramo}`}
                        onClick={() => onEditar({ modo: 'tramo', caseta: k, tramo: t })}
                      >
                        <IconPencil size={14} />
                      </ActionIcon>
                    </Tooltip>
                  </Table.Td>
                )}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      {onEditar && (
        <Group>
          <Button
            size="compact-xs" variant="subtle" leftSection={<IconPlus size={14} />}
            onClick={() => onEditar({ modo: 'nuevo', caseta: k })}
          >
            Agregar tramo a esta caseta
          </Button>
        </Group>
      )}

      {k.cobrados.length > 0 && (
        <Stack gap={4}>
          <Text size="xs" fw={600}>Lo que PASE ha cobrado aquí, contra la tarifa de hoy</Text>
          <Table.ScrollContainer minWidth={480}>
            <Table withTableBorder fz="xs" verticalSpacing={2}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th style={{ textAlign: 'center' }}>Clase</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Importe</Table.Th>
                  <Table.Th style={{ textAlign: 'center' }}>Cruces</Table.Th>
                  <Table.Th>Tramo</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {k.cobrados.map((c) => (
                  <Table.Tr key={`${c.clase}|${c.total}`}>
                    <Table.Td style={{ textAlign: 'center' }}>{c.clase}</Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>{formatMXN(c.total)}</Table.Td>
                    <Table.Td style={{ textAlign: 'center' }}>{c.cruces}</Table.Td>
                    <Table.Td c={c.tramos.length === 0 ? 'red' : undefined} fw={c.tramos.length === 0 ? 700 : undefined}>
                      {c.tramos.length > 0 ? c.tramos.join(' / ') : 'Fuera de tarifa'}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
          <Text size="xs" c="dimmed">
            Se compara contra la tarifa de hoy; en la factura, cada cruce se revisa contra la
            de su fecha.
          </Text>
        </Stack>
      )}
    </Stack>
  )
}

function TarifasPanel() {
  const { esAdmin } = usePermisos()
  const { data, isLoading, isError } = useTarifasCasetas()
  const [buscar, setBuscar] = useState('')
  const [edicion, setEdicion] = useState<EdicionTarifa | null>(null)
  const onEditar = esAdmin ? setEdicion : null
  const casetas = data?.data ?? []
  const q = buscar.trim().toUpperCase()
  const visibles = casetas.filter((k) => !q
    || k.caseta.includes(q)
    || (k.nombre ?? '').toUpperCase().includes(q)
    || k.tramos.some((t) => t.tramo.toUpperCase().includes(q) || t.autopista.toUpperCase().includes(q)))
  const conTarifa = visibles.filter((k) => k.tramos.length > 0)
  const sinTarifa = visibles.filter((k) => k.tramos.length === 0)

  if (isError) return <Alert color="red" title="Error">No se pudieron cargar las tarifas.</Alert>
  if (isLoading) return <Center py="xl"><Loader /></Center>

  return (
    <Stack gap="sm">
      <TextInput
        placeholder="Buscar caseta, tramo o autopista…" leftSection={<IconSearch size={16} />}
        value={buscar} onChange={(e) => setBuscar(e.currentTarget.value)}
      />
      <Text size="xs" c="dimmed">
        Clase de PASE: 1 = automóvil · 2 a 4 = autobús o camión de 2-4 ejes · 5-6 = camión
        de 5-6 ejes · 7 a 9 = camión de 7-9 ejes. Precios con IVA.
      </Text>

      {conTarifa.length === 0 ? (
        <Text size="sm" c="dimmed">
          {q ? 'Ninguna caseta con tarifa coincide.' : 'Todavía no hay tarifas cargadas.'}
        </Text>
      ) : (
        <Accordion variant="separated" multiple>
          {conTarifa.map((k) => {
            const fuera = k.cobrados.filter((c) => c.tramos.length === 0)
            return (
              <Accordion.Item key={k.caseta} value={k.caseta}>
                <Accordion.Control>
                  <Group justify="space-between" wrap="nowrap" pr="sm">
                    <div style={{ minWidth: 0 }}>
                      <Text size="sm" fw={600}>
                        {k.nombre?.replace(/^PEAJE /i, '') ?? 'Sin cruces todavía'}
                        <Text component="span" size="xs" c="dimmed" fw={400}> · caseta {k.caseta}</Text>
                      </Text>
                      <Text size="xs" c="dimmed">
                        {[...new Set(k.tramos.map((t) => t.autopista))].join(', ')} · {k.tramos.length} tramo
                        {k.tramos.length === 1 ? '' : 's'}
                      </Text>
                    </div>
                    <Group gap="xs" wrap="nowrap">
                      {fuera.length > 0 && (
                        <Badge size="sm" color="red" variant="light">
                          {sumar(fuera, (c) => c.cruces)} fuera de tarifa
                        </Badge>
                      )}
                      <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
                        {k.cruces} cruces · {formatMXN(k.total)}
                      </Text>
                    </Group>
                  </Group>
                </Accordion.Control>
                <Accordion.Panel><TarifasDeUnaCaseta k={k} onEditar={onEditar} /></Accordion.Panel>
              </Accordion.Item>
            )
          })}
        </Accordion>
      )}

      {sinTarifa.length > 0 && (
        <Stack gap={4} mt="sm">
          <Text size="sm" fw={600}>Sin tarifa cargada</Text>
          <Text size="xs" c="dimmed">
            Sus cruces no se revisan contra precio. Por lo que han costado, primero las que
            conviene cargar.
          </Text>
          <Table.ScrollContainer minWidth={420}>
            <Table withTableBorder striped fz="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Caseta</Table.Th>
                  <Table.Th style={{ textAlign: 'center' }}>Cruces</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Total</Table.Th>
                  {onEditar && <Table.Th />}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {sinTarifa.map((k) => (
                  <Table.Tr key={k.caseta}>
                    <Table.Td>
                      {k.nombre?.replace(/^PEAJE /i, '') ?? `Caseta ${k.caseta}`}
                      <Text component="span" size="xs" c="dimmed"> · {k.caseta}</Text>
                    </Table.Td>
                    <Table.Td style={{ textAlign: 'center' }}>{k.cruces}</Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>{formatMXN(k.total)}</Table.Td>
                    {onEditar && (
                      <Table.Td style={{ textAlign: 'right' }}>
                        <Button
                          size="compact-xs" variant="subtle" leftSection={<IconPlus size={14} />}
                          onClick={() => onEditar({ modo: 'nuevo', caseta: k })}
                        >
                          Agregar tarifa
                        </Button>
                      </Table.Td>
                    )}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Stack>
      )}

      <TarifaModal edicion={edicion} onClose={() => setEdicion(null)} />
    </Stack>
  )
}

export default function FacturasCasetas() {
  return (
    <Stack gap="md">
      <div>
        <Text fw={700} size="lg">Facturas de casetas</Text>
        <Text size="sm" c="dimmed">
          Lo que PASE cobra por los cruces de los tags. Se importa del XML de la
          factura, y la pantalla señala lo que hay que mirar: lo que pudo cobrarse de
          más y cómo se están usando las unidades.
        </Text>
      </div>

      <Tabs defaultValue="facturas">
        <Tabs.List>
          <Tabs.Tab value="facturas">Facturas</Tabs.Tab>
          <Tabs.Tab value="tags">Tags</Tabs.Tab>
          <Tabs.Tab value="tarifas">Tarifas</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="facturas" pt="md"><FacturasPanel /></Tabs.Panel>
        <Tabs.Panel value="tags" pt="md"><TagsPanel /></Tabs.Panel>
        <Tabs.Panel value="tarifas" pt="md"><TarifasPanel /></Tabs.Panel>
      </Tabs>
    </Stack>
  )
}
