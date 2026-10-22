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
//           son de ningún tramo, clase arriba de la del resto del recorrido, de
//           la habitual o de la de siempre del tag, ajustes y cruces de fuera
//           del periodo
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
  IconAlertTriangle, IconArrowRight, IconCheck, IconFileImport, IconFileTypePdf, IconLockOpen, IconPencil, IconPlus,
  IconSearch,
} from '@tabler/icons-react'
import {
  FACTURA_DUPLICADA, useActualizarTagCaseta, useCrearTagCaseta, useFacturaCasetas,
  useFacturasCasetas, useImportarFacturaCasetas, useReabrirFacturaCasetas,
  useRevisarFacturaCasetas, useTagsCasetas, useTarifasCasetas, useActualizarTarifaCaseta,
  useCrearTarifaCaseta, useCrearTramoCaseta, useIgnoraClaseCaseta, useLigarTramoCaseta,
  useTramosCasetas, useCrucesDeImporte, useHistorialEnCaseta,
} from '../hooks/useFacturasCasetas'
import type {
  CasetaSinTarifa, CorreccionDeClase, CruceCaseta, CruceEnOtra, DetalleFacturaCasetas,
  ImporteCobrado, Recorrido, TarifaCercana, TarifaTramo, TarifasDeCaseta, ValoresTarifa, Hallazgo, TagCaseta,
} from '../hooks/useFacturasCasetas'
import { fetchTodosLosVehiculos, useVehiculos } from '../hooks/useVehiculos'
import { exportTagsCasetasToPdf } from '../lib/exportTagsCasetas'
import { exportHistorialCasetaToPdf } from '../lib/exportHistorialCaseta'
import { FechaInput } from '../components/FechaInput'
import { usePermisos } from '../hooks/usePermisos'
import { ApiError } from '../lib/api'
import { formatFecha, formatMXN } from '../lib/formato'
import { leerFacturaPase, XmlPaseError } from '../lib/xmlPase'
import { COLOR_HALLAZGO, TITULO_HALLAZGO } from '../lib/hallazgosCasetas'
import type { FacturaPase } from '../lib/xmlPase'
import {
  opcionVehiculo, renderOpcionVehiculo, sinFiltroLocal,
} from '../components/OpcionVehiculo'

const PAGE_SIZE = 15
const CRUCES_POR_PAGINA = 50
const RECORRIDOS_POR_PAGINA = 25

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
  h, cruces, onAbrir, onHistorial,
}: {
  h: Hallazgo; cruces: CruceCaseta[]; onAbrir: (id: number) => void
  onHistorial: (c: CruceCaseta) => void
}) {
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
          {h.recorrido && <PasosRecorrido r={h.recorrido} onAbrir={onAbrir} />}
          {h.caseta && cruces[0] && (
            <Group justify="flex-end">
              <Button size="compact-xs" variant="subtle" onClick={() => onHistorial(cruces[0])}>
                Historial del tag en esta caseta
              </Button>
            </Group>
          )}
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
                : (h.tipo === 'clase_atipica' || h.tipo === 'clase_en_recorrido') && h.monto === 0
                  ? 'Sin tarifa de esta caseta no se puede calcular cuánto es de más'
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
  hallazgos, cruces, sinTarifa, onAbrir, onHistorial,
}: {
  hallazgos: Hallazgo[]; cruces: CruceCaseta[]; sinTarifa: CasetaSinTarifa[]
  onAbrir: (id: number) => void; onHistorial: (c: CruceCaseta) => void
}) {
  const porRenglon = new Map(cruces.map((c) => [c.renglon, c]))
  const tarjeta = (h: Hallazgo, key: string) => (
    <TarjetaHallazgo
      key={key} h={h} onAbrir={onAbrir} onHistorial={onHistorial}
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

/**
 * Un recorrido en fila, caseta por caseta, con la clase que cobró cada una. La
 * que cobró arriba de las demás se marca; las que no mandan la clase real y las
 * que vinieron en otra factura se distinguen, con un botón para abrirla.
 */
function PasosRecorrido({ r, onAbrir }: { r: Recorrido; onAbrir: (id: number) => void }) {
  return (
    <Group gap={4} mt={4} align="stretch">
      {r.pasos.map((p, i) => (
        <Group key={`${p.fecha_hora}|${p.caseta}`} gap={4} wrap="nowrap" align="center">
          {i > 0 && <IconArrowRight size={12} color="var(--mantine-color-dimmed)" />}
          <Card
            withBorder padding={4} radius="sm"
            style={{
              minWidth: 96,
              borderColor: p.arriba ? 'var(--mantine-color-red-6)' : undefined,
              borderStyle: p.otra ? 'dashed' : undefined,
            }}
          >
            <Text size="xs" c="dimmed">
              {p.fecha_hora.slice(11, 16)}{p.renglon !== null ? ` · p. ${p.renglon}` : ''}
            </Text>
            <Text size="xs" fw={600} lineClamp={1}>{p.descripcion.replace(/^PEAJE /i, '')}</Text>
            <Group gap={4} wrap="nowrap">
              <Badge
                size="xs" variant={p.arriba ? 'filled' : 'light'}
                color={p.arriba ? 'red' : p.sin_clase ? 'gray' : p.clase === r.clase ? 'teal' : 'yellow'}
              >
                {p.sin_clase ? 'sin clase' : `clase ${p.clase}`}
              </Badge>
              <Text size="xs">{formatMXN(p.total)}</Text>
            </Group>
            {p.otra && (
              <Button size="compact-xs" variant="subtle" px={0} onClick={() => onAbrir(p.otra!.factura_id)}>
                {folioDe(p.otra)}
              </Button>
            )}
          </Card>
        </Group>
      ))}
    </Group>
  )
}

/**
 * Los recorridos de cada unidad: sus cruces seguidos, con la clase que cobró
 * cada caseta lado a lado. No es para rastrear la unidad sino para comparar:
 * si en Tepic - Guadalajara todas cobraron 7 y una 9, la rara es esa, cosa que
 * mirando la caseta sola no se puede decir.
 */
function Recorridos({
  recorridos, onAbrir,
}: { recorridos: Recorrido[]; onAbrir: (id: number) => void }) {
  const [tag, setTag] = useState<string | null>(null)
  const [soloArriba, setSoloArriba] = useState(false)
  const [page, setPage] = useState(1)

  const opcionesTag = useMemo(() => {
    const vistos = new Map<string, string>()
    for (const r of recorridos) vistos.set(r.tag, r.vehiculo ? `${r.vehiculo} · ${r.tag}` : `${r.tag} (sin unidad)`)
    return [...vistos].map(([value, label]) => ({ value, label }))
  }, [recorridos])

  const conArriba = (r: Recorrido) => r.pasos.some((p) => p.arriba)
  const filtrados = recorridos.filter((r) => (!tag || r.tag === tag) && (!soloArriba || conArriba(r)))
  const paginas = Math.ceil(filtrados.length / RECORRIDOS_POR_PAGINA)
  const visibles = filtrados.slice((page - 1) * RECORRIDOS_POR_PAGINA, page * RECORRIDOS_POR_PAGINA)

  return (
    <Stack gap="sm">
      <Group grow align="center">
        <Select
          placeholder="Todas las unidades" data={opcionesTag} clearable searchable
          value={tag} onChange={(v) => { setTag(v); setPage(1) }}
        />
        <Switch
          label="Solo con una caseta arriba de las demás"
          checked={soloArriba} onChange={(e) => { setSoloArriba(e.currentTarget.checked); setPage(1) }}
        />
      </Group>
      <Text size="xs" c="dimmed">
        {filtrados.length} recorrido{filtrados.length === 1 ? '' : 's'}. Un recorrido son los cruces de
        una unidad con menos de tres horas entre uno y otro; su clase es la que cobró la mayoría de las
        casetas. Con línea punteada, los cruces que vinieron en otra factura.
      </Text>
      {visibles.map((r) => {
        const primero = r.pasos[0]
        const ultimo = r.pasos[r.pasos.length - 1]
        const mismoDia = ultimo.fecha_hora.slice(0, 10) === primero.fecha_hora.slice(0, 10)
        return (
          <Card key={`${r.tag}|${primero.fecha_hora}`} withBorder padding="sm" radius="md">
            <Group justify="space-between" align="flex-start">
              <div>
                <Text size="sm" fw={600}>
                  {r.vehiculo ?? 'Sin unidad'}
                  <Text component="span" size="xs" c="dimmed" fw={400}> · {r.tag}</Text>
                </Text>
                <Text size="xs" c="dimmed">
                  {fechaHora(primero.fecha_hora)}
                  {r.pasos.length > 1
                    ? ` – ${mismoDia ? ultimo.fecha_hora.slice(11, 16) : fechaHora(ultimo.fecha_hora)}`
                    : ''}
                </Text>
              </div>
              <Badge size="sm" variant="light" color={r.clase === null ? 'gray' : conArriba(r) ? 'red' : 'teal'}>
                {r.clase === null ? 'sin clase común' : `clase ${r.clase}`}
              </Badge>
            </Group>
            <PasosRecorrido r={r} onAbrir={onAbrir} />
          </Card>
        )
      })}
      {paginas > 1 && (
        <Group justify="center">
          <Pagination value={page} onChange={setPage} total={paginas} size="sm" />
        </Group>
      )}
    </Stack>
  )
}

/** Qué historial abrir: un tag en una caseta, y el cruce que se está revisando. */
type ConsultaHistorial = {
  tag: string
  caseta: string
  resaltar: { factura_id: number; renglon: number } | null
}

/**
 * Todo lo que un tag ha pagado en una caseta, factura por factura: la
 * evidencia para PASE. Arriba, cada importe con sus fechas y lo que pagaron
 * los demás tags ahí (si todos cambiaron desde una fecha, fue un aumento; si
 * solo este, un cobro raro). Abajo, cruce por cruce con folio y partida, y
 * cuánto cambió contra la vez anterior. Se exporta a PDF para mandarlo.
 */
function HistorialModal({
  consulta, onClose, onAbrir,
}: { consulta: ConsultaHistorial | null; onClose: () => void; onAbrir: (id: number) => void }) {
  const { data, isLoading, isError } = useHistorialEnCaseta(
    consulta && { tag: consulta.tag, caseta: consulta.caseta })
  const [exportando, setExportando] = useState(false)
  const h = data?.data
  const r = consulta?.resaltar ?? null
  const esElReclamado = (p: { factura_id: number; renglon: number }) =>
    !!r && p.factura_id === r.factura_id && p.renglon === r.renglon
  const importeReclamado = h?.pasos.find(esElReclamado)?.total
  const tarifaDe = (tramos: string[], ejes: string | null = null) =>
    tramos.length > 0
      ? <Text size="xs">{tramos.join(' / ')}{ejes ? ` · ${ejes}` : ''}</Text>
      : <Text size="xs" c={h?.con_tarifa ? 'red' : 'dimmed'} fw={h?.con_tarifa ? 700 : undefined}>
          {h?.con_tarifa ? 'Fuera de tarifa' : 'Sin tarifa cargada'}
        </Text>

  async function exportar() {
    if (!h) return
    setExportando(true)
    try { await exportHistorialCasetaToPdf(h, r) } finally { setExportando(false) }
  }

  let anterior: number | null = null
  return (
    <Modal
      opened={consulta !== null} onClose={onClose} size="xl"
      title={<Text fw={600}>
        {h ? `${h.vehiculo ?? 'Sin unidad'} en ${(h.nombre ?? h.caseta).replace(/^PEAJE /i, '')}` : 'Historial'}
      </Text>}
    >
      {isError ? <Alert color="red">No se pudo cargar el historial.</Alert>
        : isLoading || !h ? <Center py="md"><Loader size="sm" /></Center> : (
        <Stack gap="sm">
          <Group justify="space-between" align="flex-start">
            <Text size="xs" c="dimmed" style={{ flex: 1, minWidth: 220 }}>
              Tag <Text span ff="monospace" size="xs">{h.tag}</Text>, caseta {h.caseta}. Todo sale de las
              facturas de PASE: cada cruce con su folio y partida. Si los demás tags pasaron al mismo
              importe desde una fecha, fue un aumento; si solo este, hay que pedirle a PASE que lo explique.
            </Text>
            <Button
              size="compact-sm" variant="light" leftSection={<IconFileTypePdf size={14} />}
              loading={exportando} onClick={exportar}
            >
              Exportar PDF
            </Button>
          </Group>

          <Text size="sm" fw={600}>Lo que ha pagado aquí</Text>
          <Table.ScrollContainer minWidth={640}>
            <Table withTableBorder fz="xs" verticalSpacing={4}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th style={{ textAlign: 'right' }}>Importe</Table.Th>
                  <Table.Th style={{ textAlign: 'center' }}>Clase</Table.Th>
                  <Table.Th style={{ textAlign: 'center' }}>Veces</Table.Th>
                  <Table.Th>Entre</Table.Th>
                  <Table.Th>Tarifa</Table.Th>
                  <Table.Th>Otros tags con ese importe</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {h.importes.map((i) => (
                  <Table.Tr
                    key={i.total}
                    bg={importeReclamado !== undefined && Math.abs(i.total - importeReclamado) < 0.005
                      ? 'var(--mantine-color-yellow-light)' : undefined}
                  >
                    <Table.Td style={{ textAlign: 'right' }} fw={700}>{formatMXN(i.total)}</Table.Td>
                    <Table.Td style={{ textAlign: 'center' }}>{i.clases.join(', ')}</Table.Td>
                    <Table.Td style={{ textAlign: 'center' }}>{i.cruces}</Table.Td>
                    <Table.Td style={{ whiteSpace: 'nowrap' }}>
                      {i.cruces === 1
                        ? formatFecha(i.primera.slice(0, 10))
                        : `${formatFecha(i.primera.slice(0, 10))} – ${formatFecha(i.ultima.slice(0, 10))}`}
                    </Table.Td>
                    <Table.Td>{tarifaDe(i.tramos)}</Table.Td>
                    <Table.Td>
                      {i.otros
                        ? `${i.otros.cruces} cruce${i.otros.cruces === 1 ? '' : 's'} de ${i.otros.tags} tag` +
                          `${i.otros.tags === 1 ? '' : 's'}, ${formatFecha(i.otros.primera.slice(0, 10))} – ` +
                          formatFecha(i.otros.ultima.slice(0, 10))
                        : <Text size="xs" c="orange" fw={600}>Ninguno: solo este tag</Text>}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>

          <Text size="sm" fw={600}>Cruce por cruce</Text>
          <Table.ScrollContainer minWidth={640}>
            <Table withTableBorder striped fz="xs" verticalSpacing={2}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Fecha</Table.Th>
                  <Table.Th>Factura</Table.Th>
                  <Table.Th style={{ textAlign: 'center' }}>Clase</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Importe</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Contra la anterior</Table.Th>
                  <Table.Th>Tarifa</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {h.pasos.map((p) => {
                  const cambio = !p.ajuste && anterior !== null && Math.abs(p.total - anterior) > 0.005
                    ? p.total - anterior : null
                  if (!p.ajuste) anterior = p.total
                  return (
                    <Table.Tr
                      key={`${p.factura_id}|${p.renglon}`}
                      bg={esElReclamado(p) ? 'var(--mantine-color-yellow-light)' : undefined}
                    >
                      <Table.Td style={{ whiteSpace: 'nowrap' }}>{fechaHora(p.fecha_hora)}</Table.Td>
                      <Table.Td style={{ whiteSpace: 'nowrap' }}>
                        <Button size="compact-xs" variant="subtle" px={0} onClick={() => onAbrir(p.factura_id)}>
                          {folioDe(p)}
                        </Button>
                        <Text span size="xs" c="dimmed"> p. {p.renglon}</Text>
                      </Table.Td>
                      <Table.Td style={{ textAlign: 'center' }}>
                        {p.ajuste ? <Badge size="xs" color="yellow" variant="light">ajuste</Badge> : p.clase}
                      </Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>{formatMXN(p.total)}</Table.Td>
                      <Table.Td
                        style={{ textAlign: 'right' }}
                        c={cambio === null ? undefined : cambio > 0 ? 'red' : 'teal'} fw={cambio === null ? undefined : 700}
                      >
                        {cambio === null ? '' : `${cambio > 0 ? '+' : '−'}${formatMXN(Math.abs(cambio))}`}
                      </Table.Td>
                      <Table.Td>{p.ajuste ? '—' : tarifaDe(p.tramos, p.ejes)}</Table.Td>
                    </Table.Tr>
                  )
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Stack>
      )}
    </Modal>
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
  const [historial, setHistorial] = useState<ConsultaHistorial | null>(null)

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
              <Tabs.Tab value="recorridos">Recorridos</Tabs.Tab>
              <Tabs.Tab value="cruces">Cruces</Tabs.Tab>
            </Tabs.List>
            <Tabs.Panel value="hallazgos" pt="md"><Hallazgos
              hallazgos={d.hallazgos} cruces={d.cruces} sinTarifa={d.sin_tarifa} onAbrir={abrirOtra}
              onHistorial={(c) => setHistorial({
                tag: c.tag, caseta: c.caseta, resaltar: { factura_id: d.factura.id, renglon: c.renglon },
              })}
            /></Tabs.Panel>
            <Tabs.Panel value="unidades" pt="md"><PorUnidad detalle={d} /></Tabs.Panel>
            <Tabs.Panel value="recorridos" pt="md"><Recorridos recorridos={d.recorridos} onAbrir={abrirOtra} /></Tabs.Panel>
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
      <HistorialModal consulta={historial} onClose={() => setHistorial(null)} onAbrir={abrirOtra} />
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
  const [exportando, setExportando] = useState(false)
  const [errorPdf, setErrorPdf] = useState<string | null>(null)
  const tags = data?.data ?? []
  const sinUnidad = tags.filter((t) => t.vehiculo_id === null).length

  // La flota se pide al momento: es para las placas y para saber qué unidades
  // no tienen tag, y la pestaña no la necesita para nada más.
  async function exportarPdf() {
    setExportando(true)
    setErrorPdf(null)
    try {
      const vehiculos = await fetchTodosLosVehiculos()
      await exportTagsCasetasToPdf(tags, vehiculos.data)
    } catch (e) {
      setErrorPdf((e as Error).message || 'No se pudo generar el PDF.')
    } finally {
      setExportando(false)
    }
  }

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end">
        <Text size="sm" c="dimmed" maw={560}>
          De qué unidad es cada tag. Al asignarlo, sus cruces que no tenían unidad
          pasan a la nueva; los que ya tenían una se quedan con ella.
        </Text>
        <Group gap="xs">
          <Button
            variant="default" leftSection={<IconFileTypePdf size={16} />}
            loading={exportando} disabled={!tags.length} onClick={exportarPdf}
          >
            PDF
          </Button>
          {puedeEditar && (
            <Button variant="light" leftSection={<IconPlus size={16} />} onClick={() => setNuevo(true)}>
              Registrar tag
            </Button>
          )}
        </Group>
      </Group>

      {errorPdf && <Alert color="red" onClose={() => setErrorPdf(null)} withCloseButton>{errorPdf}</Alert>}

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

type ColumnaTarifa = Exclude<keyof ValoresTarifa, 'vigente_desde'>

/**
 * Las clasificaciones, una por número de ejes y agrupadas como en la tabla del
 * operador. Cada operador junta los ejes a su modo (IDEAL 2-4/5-6/7-9, Jala -
 * Compostela 2-3/4-5/6-9); por eje cabe cualquiera.
 */
const GRUPOS_TARIFA: { titulo: string; columnas: [ColumnaTarifa, string][] }[] = [
  { titulo: 'Ligeros', columnas: [['moto', 'Moto'], ['auto', 'Auto']] },
  { titulo: 'Autobús (ejes)', columnas: [['autobus_2', '2'], ['autobus_3', '3'], ['autobus_4', '4']] },
  {
    titulo: 'Camión (ejes)',
    columnas: [
      ['camion_2', '2'], ['camion_3', '3'], ['camion_4', '4'], ['camion_5', '5'],
      ['camion_6', '6'], ['camion_7', '7'], ['camion_8', '8'], ['camion_9', '9'],
    ],
  },
  { titulo: 'Eje excedente', columnas: [['eje_ligero', 'Ligero'], ['eje_pesado', 'Pesado']] },
]

const COLUMNAS_TARIFA = GRUPOS_TARIFA.flatMap((g) => g.columnas)

const VACIA = {
  vigente_desde: '',
  ...Object.fromEntries(COLUMNAS_TARIFA.map(([col]) => [col, null])),
} as ValoresTarifa

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
  const ligar = useLigarTramoCaseta()
  const [accion, setAccion] = useState<'corregir' | 'aumento'>('corregir')
  // Agregar a una caseta: un tramo nuevo, o ligar uno que ya existe (los que se
  // cargaron sin caseta, o uno que otra caseta también cobra).
  const [agregar, setAgregar] = useState<'nuevo' | 'ligar'>('nuevo')
  const [ligarId, setLigarId] = useState<string | null>(null)
  const { data: tramosData } = useTramosCasetas(edicion?.modo === 'nuevo')
  const [valores, setValores] = useState<ValoresTarifa>(VACIA)
  const [autopista, setAutopista] = useState('')
  const [nombre, setNombre] = useState('')
  const [abiertaPara, setAbiertaPara] = useState<EdicionTarifa | null>(null)

  // Al abrir, se llena con lo que hay: es más fácil corregir un número que
  // volver a teclear quince.
  if (edicion !== abiertaPara) {
    setAbiertaPara(edicion)
    setAccion('corregir')
    setAgregar('nuevo')
    setLigarId(null)
    actualizar.reset(); crear.reset(); crearTramo.reset(); ligar.reset()
    if (edicion?.modo === 'tramo') {
      const { tramo: t } = edicion
      setValores({
        vigente_desde: t.vigente_desde,
        ...Object.fromEntries(COLUMNAS_TARIFA.map(([col]) => [col, t[col]])),
      } as ValoresTarifa)
    } else if (edicion) {
      setValores(VACIA)
      setAutopista(edicion.caseta.tramos[0]?.autopista ?? '')
      setNombre('')
    }
  }

  if (!edicion) return null
  const tramo = edicion.modo === 'tramo' ? edicion.tramo : null
  const otras = tramo ? tramo.casetas.filter((c) => c !== edicion.caseta.caseta) : []
  const ligando = edicion.modo === 'nuevo' && agregar === 'ligar'
  const mutacion = ligando ? ligar
    : edicion.modo === 'nuevo' ? crearTramo : accion === 'corregir' ? actualizar : crear
  // Los que esta caseta todavía no cobra; primero los que no tiene nadie.
  const ligables = (tramosData?.data ?? [])
    .filter((t) => !t.casetas.includes(edicion.caseta.caseta))
    .sort((a, b) => Number(a.casetas.length > 0) - Number(b.casetas.length > 0))
    .map((t) => ({
      value: String(t.id),
      label: `${t.autopista} · ${t.nombre}${t.casetas.length ? ` (caseta ${t.casetas.join(', ')})` : ' (sin caseta)'}`,
    }))
  const hayTarifa = COLUMNAS_TARIFA.some(([col]) => valores[col] !== null)
  const aumentoSinFechaNueva = tramo !== null && accion === 'aumento'
    && valores.vigente_desde <= tramo.vigente_desde
  const listo = !!valores.vigente_desde && hayTarifa && !aumentoSinFechaNueva
    && (edicion.modo === 'tramo' || (!!autopista.trim() && !!nombre.trim()))

  async function guardar() {
    if (!edicion) return
    if (ligando) {
      await ligar.mutateAsync({ caseta: edicion.caseta.caseta, tramo_id: Number(ligarId) })
    } else if (edicion.modo === 'nuevo') {
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
      opened onClose={onClose} size="xl"
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
          <>
            <SegmentedControl
              fullWidth value={agregar} onChange={(v) => setAgregar(v as 'nuevo' | 'ligar')}
              data={[
                { value: 'nuevo', label: 'Tramo nuevo' },
                { value: 'ligar', label: 'Ligar uno que ya existe' },
              ]}
            />
            {ligando ? (
              <Select
                label="Tramo" searchable data={ligables} value={ligarId} onChange={setLigarId}
                placeholder="Busca por autopista o tramo"
                nothingFoundMessage="No hay tramos que esta caseta no tenga ya"
                description="Su tarifa no cambia: solo pasa a contar también para esta caseta."
                comboboxProps={{ withinPortal: true }}
              />
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
          </>
        )}

        {!ligando && (
          <>
            <FechaInput
              label="Vigente desde" required
              value={valores.vigente_desde}
              onChange={(v) => setValores((x) => ({ ...x, vigente_desde: v }))}
              error={aumentoSinFechaNueva && valores.vigente_desde
                ? 'El aumento debe ser posterior a la tarifa actual' : undefined}
            />

            {GRUPOS_TARIFA.map((g) => (
              <Stack key={g.titulo} gap={4}>
                <Group justify="space-between">
                  <Text size="xs" fw={600}>{g.titulo}</Text>
                  {g.columnas.length > 2 && (
                    <Button
                      size="compact-xs" variant="subtle"
                      onClick={() => setValores((x) => {
                        // Copia hacia la derecha el último valor hasta el siguiente
                        // capturado: los operadores cobran igual varios ejes
                        // seguidos, y así se teclea un número por grupo.
                        const r = { ...x }
                        let ultimo: number | null = null
                        for (const [col] of g.columnas) {
                          if (r[col] !== null) ultimo = r[col]
                          else r[col] = ultimo
                        }
                        return r
                      })}
                    >
                      Rellenar hacia la derecha
                    </Button>
                  )}
                </Group>
                <SimpleGrid cols={{ base: 4, sm: Math.max(g.columnas.length, 4) }} spacing="xs">
                  {g.columnas.map(([col, titulo]) => (
                    <NumberInput
                      key={col} label={titulo} size="xs" prefix="$" min={0} max={99999} decimalScale={2}
                      thousandSeparator="," hideControls placeholder="—"
                      value={valores[col] ?? ''}
                      onChange={(v) => setValores((x) => ({ ...x, [col]: v === '' ? null : Number(v) }))}
                    />
                  ))}
                </SimpleGrid>
              </Stack>
            ))}
            <Text size="xs" c="dimmed">
              Con IVA, como las publica el operador. Si la tabla agrupa ejes (“camiones 4 y 5
              ejes”), captura el primero y usa “Rellenar hacia la derecha”. Deja vacía la
              clasificación que no se publica.
            </Text>
          </>
        )}

        {mutacion.error && <Alert color="red">{(mutacion.error as Error).message}</Alert>}

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Cancelar</Button>
          <Button loading={mutacion.isPending} disabled={ligando ? !ligarId : !listo} onClick={guardar}>
            {ligando ? 'Ligar tramo'
              : edicion.modo === 'nuevo' ? 'Agregar tramo' : accion === 'corregir' ? 'Guardar corrección' : 'Registrar aumento'}
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
  k, onEditar, onRastrear,
}: {
  k: TarifasDeCaseta; onEditar: ((e: EdicionTarifa) => void) | null
  onRastrear: (c: ImporteCobrado) => void
}) {
  const usadas = new Set(k.cobrados.flatMap((c) => c.tramos.map((t) => `${t}|${c.total}`)))
  const ignora = useIgnoraClaseCaseta()
  return (
    <Stack gap="sm">
      {onEditar ? (
        <Switch
          size="xs" checked={k.ignora_clase} disabled={ignora.isPending}
          label="Esta caseta no manda la clase real (EASYTRIP manda 1 a todo): comparar el importe contra todas las clasificaciones"
          onChange={(e) => ignora.mutate({ caseta: k.caseta, ignora_clase: e.currentTarget.checked })}
        />
      ) : k.ignora_clase && (
        <Text size="xs" c="dimmed">
          Esta caseta no manda la clase real: el importe se compara contra todas las clasificaciones.
        </Text>
      )}
      {ignora.error && <Alert color="red">{(ignora.error as Error).message}</Alert>}
      <Table.ScrollContainer minWidth={1100}>
        <Table withTableBorder withColumnBorders striped fz="xs" verticalSpacing={4} horizontalSpacing={6}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th rowSpan={2}>Tramo</Table.Th>
              {GRUPOS_TARIFA.map((g) => (
                <Table.Th key={g.titulo} colSpan={g.columnas.length} style={{ textAlign: 'center' }}>
                  {g.titulo}
                </Table.Th>
              ))}
              {onEditar && <Table.Th rowSpan={2} w={36} />}
            </Table.Tr>
            <Table.Tr>
              {COLUMNAS_TARIFA.map(([col, titulo]) => (
                <Table.Th key={col} style={{ textAlign: 'right' }}>{titulo}</Table.Th>
              ))}
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
                      {v === null ? '—' : `$${Number(v).toLocaleString('es-MX')}`}
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
                  {k.ignora_clase && <Table.Th>Ejes cobrados</Table.Th>}
                  <Table.Th w={70} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {k.cobrados.map((c) => (
                  <Table.Tr key={`${c.clase}|${c.total}`}>
                    <Table.Td style={{ textAlign: 'center' }}>{c.clase}</Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>{formatMXN(c.total)}</Table.Td>
                    <Table.Td style={{ textAlign: 'center' }}>{c.cruces}</Table.Td>
                    <Table.Td>
                      {c.tramos.length > 0 ? c.tramos.join(' / ') : (
                        <>
                          <Text size="xs" c="red" fw={700}>Fuera de tarifa</Text>
                          {c.cercana && <Cercana c={c.cercana} etiqueta={`Lo más parecido en clase ${c.clase}`} />}
                          {c.cercana_otra && <Cercana c={c.cercana_otra} etiqueta="En cualquier clase" />}
                        </>
                      )}
                    </Table.Td>
                    {k.ignora_clase && <Table.Td>{c.ejes ?? '—'}</Table.Td>}
                    <Table.Td>
                      <Button
                        size="compact-xs" variant={c.tramos.length === 0 ? 'light' : 'subtle'}
                        color={c.tramos.length === 0 ? 'red' : undefined}
                        onClick={() => onRastrear(c)}
                      >
                        Rastrear
                      </Button>
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

/** Lo que hay que buscar en internet para verificar la tarifa de una caseta. */
function buscarEnInternet(k: TarifasDeCaseta): string {
  const nombre = (k.nombre ?? `caseta ${k.caseta}`).replace(/^PEAJE /i, '')
  const autopista = [...new Set(k.tramos.map((t) => t.autopista))].join(' ')
  const q = `caseta ${nombre} ${autopista} tarifas ${new Date().getFullYear()}`
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`
}

function Cercana({ c, etiqueta }: { c: TarifaCercana; etiqueta: string }) {
  return (
    <Text size="xs" c="dimmed">
      {etiqueta}: {c.clases} en {c.tramo}, {formatMXN(c.total)} (desde {formatFecha(c.vigente_desde)})
    </Text>
  )
}

type Rastreo = { k: TarifasDeCaseta; c: ImporteCobrado }

/**
 * Los cruces detrás de un importe cobrado: en qué factura y partida vino cada
 * uno, para verificarlo contra la página del operador y reclamarlo a PASE.
 * Cada cruce va contra la tarifa de SU fecha: si ahí sí cuadra, lo que cambió
 * fue la tarifa, no el cobro.
 */
function RastreoModal({
  rastreo, onClose, onAbrir,
}: { rastreo: Rastreo | null; onClose: () => void; onAbrir: (id: number) => void }) {
  const q = rastreo && { caseta: rastreo.k.caseta, clase: rastreo.c.clase, total: rastreo.c.total }
  const { data, isLoading, isError } = useCrucesDeImporte(q)
  const [historial, setHistorial] = useState<ConsultaHistorial | null>(null)
  const cruces = data?.data ?? []
  const k = rastreo?.k
  const c = rastreo?.c
  return (
    <Modal
      opened={rastreo !== null} onClose={onClose} size="xl"
      title={k && c && (
        <Text fw={600}>
          {k.nombre?.replace(/^PEAJE /i, '') ?? `Caseta ${k.caseta}`} · clase {c.clase} · {formatMXN(c.total)}
        </Text>
      )}
    >
      {k && c && (
        <Stack gap="sm">
          <Group justify="space-between" align="flex-start">
            <Stack gap={2}>
              {c.tramos.length > 0
                ? <Text size="sm">Cuadra con {c.tramos.join(' / ')}{c.ejes ? ` · ${c.ejes}` : ''}.</Text>
                : <Text size="sm" c="red" fw={600}>Ningún tramo de esta caseta cuesta eso hoy.</Text>}
              {c.cercana && <Cercana c={c.cercana} etiqueta={`Lo más parecido en clase ${c.clase}`} />}
              {c.cercana_otra && <Cercana c={c.cercana_otra} etiqueta="En cualquier clase" />}
            </Stack>
            <Button
              component="a" href={buscarEnInternet(k)} target="_blank" rel="noopener noreferrer"
              size="compact-sm" variant="light" leftSection={<IconSearch size={14} />}
            >
              Buscar tarifas en internet
            </Button>
          </Group>
          <Text size="xs" c="dimmed">
            Tramos de esta caseta: {k.tramos.map((t) => `${t.tramo} (${t.autopista})`).join(', ')}.
          </Text>

          {isError && <Alert color="red">No se pudieron cargar los cruces.</Alert>}
          {isLoading ? <Center py="md"><Loader size="sm" /></Center> : (
            <Table.ScrollContainer minWidth={720}>
              <Table withTableBorder striped fz="xs" verticalSpacing={4}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Factura</Table.Th>
                    <Table.Th>Fecha</Table.Th>
                    <Table.Th>Unidad</Table.Th>
                    <Table.Th>Carril</Table.Th>
                    <Table.Th>En su fecha</Table.Th>
                    <Table.Th />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {cruces.map((x) => (
                    <Table.Tr key={`${x.factura_id}|${x.renglon}`}>
                      <Table.Td style={{ whiteSpace: 'nowrap' }}>
                        <Button
                          size="compact-xs" variant="subtle" px={0} rightSection={<IconArrowRight size={12} />}
                          onClick={() => onAbrir(x.factura_id)}
                        >
                          {folioDe(x)}
                        </Button>
                        <Text size="xs" c="dimmed">
                          partida {x.renglon}{x.revisada ? ' · revisada' : ''}
                        </Text>
                      </Table.Td>
                      <Table.Td style={{ whiteSpace: 'nowrap' }}>{fechaHora(x.fecha_hora)}</Table.Td>
                      <Table.Td>
                        <Text size="xs">{x.vehiculo ?? 'Sin unidad'}</Text>
                        <Text size="xs" c="dimmed" ff="monospace">{x.tag}</Text>
                      </Table.Td>
                      <Table.Td>{[x.carril, x.evento].filter(Boolean).join(' · ') || '—'}</Table.Td>
                      <Table.Td>
                        {x.tramos.length > 0
                          ? <Text size="xs">{x.tramos.join(' / ')}</Text>
                          : <Badge size="xs" color="red" variant="light">Fuera de tarifa</Badge>}
                        {x.cercana && x.tramos.length === 0 && (
                          <Text size="xs" c="dimmed">
                            {x.cercana.clases}: {formatMXN(x.cercana.total)}
                            {x.cercana_otra && ` · ${x.cercana_otra.clases}: ${formatMXN(x.cercana_otra.total)}`}
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td>
                        <Button
                          size="compact-xs" variant="light"
                          onClick={() => setHistorial({
                            tag: x.tag, caseta: k.caseta, resaltar: { factura_id: x.factura_id, renglon: x.renglon },
                          })}
                        >
                          Historial
                        </Button>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )}
          <Text size="xs" c="dimmed">
            {cruces.length} cruce{cruces.length === 1 ? '' : 's'} · {formatMXN(sumar(cruces, (x) => x.total))}.
            La factura se abre encima, sin cerrar esta lista. “Historial” compara con las otras
            veces que ese mismo tag pasó por aquí.
          </Text>
        </Stack>
      )}
      <HistorialModal consulta={historial} onClose={() => setHistorial(null)} onAbrir={onAbrir} />
    </Modal>
  )
}

function TarifasPanel() {
  const { esAdmin } = usePermisos()
  const { data, isLoading, isError } = useTarifasCasetas()
  const [buscar, setBuscar] = useState('')
  const [edicion, setEdicion] = useState<EdicionTarifa | null>(null)
  const [soloFuera, setSoloFuera] = useState(false)
  const [rastreo, setRastreo] = useState<Rastreo | null>(null)
  const [abierta, setAbierta] = useState<number | null>(null)
  const onEditar = esAdmin ? setEdicion : null
  const { data: tramosData } = useTramosCasetas()
  const sinCaseta = (tramosData?.data ?? []).filter((t) => t.casetas.length === 0)
  const casetas = data?.data ?? []
  const q = buscar.trim().toUpperCase()
  const visibles = casetas.filter((k) => !q
    || k.caseta.includes(q)
    || (k.nombre ?? '').toUpperCase().includes(q)
    || k.tramos.some((t) => t.tramo.toUpperCase().includes(q) || t.autopista.toUpperCase().includes(q)))
  const fueraDe = (k: TarifasDeCaseta) => k.cobrados.filter((c) => c.tramos.length === 0)
  const conFuera = casetas.filter((k) => fueraDe(k).length > 0)
  const crucesFuera = sumar(conFuera, (k) => sumar(fueraDe(k), (c) => c.cruces))
  const conTarifa = visibles.filter((k) => k.tramos.length > 0 && (!soloFuera || fueraDe(k).length > 0))
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
        Clase de PASE = número de ejes (1 = automóvil; de 2 a 4 puede ser autobús o camión).
        Las casetas EASYTRIP mandan clase 1 a todo: para ellas cuenta solo el importe. Precios
        con IVA; marcadas, las tarifas que PASE sí ha cobrado.
      </Text>
      {conFuera.length > 0 ? (
        <Alert color="red" variant="light" p="xs" icon={<IconAlertTriangle size={16} />}>
          <Group justify="space-between" gap="xs">
            <Text size="sm">
              {crucesFuera} cruce{crucesFuera === 1 ? '' : 's'} fuera de tarifa en {conFuera.length} caseta
              {conFuera.length === 1 ? '' : 's'}. Ábrelas y usa “Rastrear” para ver en qué factura vino
              cada uno y buscar la tarifa en internet.
            </Text>
            <Switch
              size="xs" label="Solo esas casetas"
              checked={soloFuera} onChange={(e) => setSoloFuera(e.currentTarget.checked)}
            />
          </Group>
        </Alert>
      ) : casetas.some((k) => k.tramos.length > 0) && (
        <Text size="xs" c="green">Todo lo cobrado en casetas con tarifa cuadra con algún tramo.</Text>
      )}

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
                      {k.ignora_clase && (
                        <Tooltip label="No manda la clase real: se compara contra todas las clasificaciones">
                          <Badge size="sm" color="gray" variant="light">sin clase</Badge>
                        </Tooltip>
                      )}
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
                <Accordion.Panel>
                  <TarifasDeUnaCaseta k={k} onEditar={onEditar} onRastrear={(c) => setRastreo({ k, c })} />
                </Accordion.Panel>
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

      {sinCaseta.length > 0 && !q && (
        <Stack gap={4} mt="sm">
          <Text size="sm" fw={600}>Tramos cargados sin caseta</Text>
          <Text size="xs" c="dimmed">
            Tienen tarifa pero todavía no se sabe qué código de PASE los cobra. Cuando la caseta
            salga en una factura, ábrela y usa “Agregar tramo → Ligar uno que ya existe”.
          </Text>
          <Text size="sm">
            {sinCaseta.map((t) => `${t.nombre} (${t.autopista})`).join(' · ')}
          </Text>
        </Stack>
      )}

      <TarifaModal edicion={edicion} onClose={() => setEdicion(null)} />
      <RastreoModal rastreo={rastreo} onClose={() => setRastreo(null)} onAbrir={setAbierta} />
      <DetalleModal facturaId={abierta} onClose={() => setAbierta(null)} onAbrir={setAbierta} />
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
