// Página de un proveedor, en dos pestañas que responden dos preguntas
// distintas:
//
//   - PRECIOS: lo que pide por cada refacción, se le compre o no, comparado
//     contra el mejor precio que haya registrado cualquier otro proveedor. Sin
//     esto, del proveedor al que todavía no se le compra no se sabría nada.
//   - GASTOS: lo que de verdad se le ha comprado. Sale de los lotes, no de la
//     lista de precios: un precio cotizado nunca salió de la caja, y sumarlo
//     como gasto sería inventar un número.
//
// En la de precios cada refacción es un grupo: arriba el precio vigente (el más
// reciente) con su comparación, y adentro el historial, que es lo que enseña si
// un proveedor va subiendo.
import { useMemo, useState } from 'react'
import {
  Stack, Group, Text, Table, Loader, Center, Alert, Button, ActionIcon,
  Modal, Badge, Accordion, Paper, Tooltip, Anchor, Tabs, TextInput,
} from '@mantine/core'
import {
  IconPencil, IconTrash, IconPlus, IconArrowLeft, IconPhone, IconUser,
  IconTag, IconReceipt, IconSearch, IconFileTypePdf, IconFileSpreadsheet,
  IconFileImport,
} from '@tabler/icons-react'
import SelectorPeriodoReporte from '../components/SelectorPeriodoReporte'
import {
  type Periodo, PERIODO_DEFAULT, dentroDelPeriodo, periodoValido,
} from '../lib/reportes/periodo'
import {
  exportGastosProveedorPdf, exportGastosProveedorExcel,
} from '../lib/reportes/gastosProveedor'
import {
  usePreciosProveedor, useCreatePrecioProveedor,
  useUpdatePrecioProveedor, useDeletePrecioProveedor,
} from '../hooks/usePreciosProveedor'
import type { PrecioProveedor } from '../hooks/usePreciosProveedor'
import { useGastosProveedor } from '../hooks/useProveedores'
import type { Proveedor, GastoProveedor } from '../hooks/useProveedores'
import PrecioProveedorForm from '../components/PrecioProveedorForm'
import ImportarHistoricoModal from '../components/ImportarHistoricoModal'

function formatMXN(n: number) {
  return Number(n).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })
}

function formatFecha(iso: string) {
  return new Date(`${iso.split('T')[0]}T12:00:00`).toLocaleDateString('es-MX', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

// ── Agrupado por refacción ────────────────────────────────────────────────────

type GrupoPieza = {
  piezaId:  number
  label:    string
  tipo:     string | null
  /** Del más reciente al más viejo; el primero es el precio vigente. */
  historial: PrecioProveedor[]
}

/** Cuántos de los registros de una refacción salieron de una compra real. */
function compras(g: GrupoPieza): number {
  return g.historial.filter((p) => p.origen === 'pagado').length
}

// La API ya devuelve los registros ordenados por refacción y, dentro de cada
// una, del más reciente al más viejo: basta con agrupar respetando ese orden.
function agrupar(items: PrecioProveedor[]): GrupoPieza[] {
  const grupos = new Map<number, GrupoPieza>()
  for (const p of items) {
    const grupo = grupos.get(p.pieza_id)
    if (grupo) grupo.historial.push(p)
    else grupos.set(p.pieza_id, {
      piezaId:   p.pieza_id,
      label:     `${p.pieza_serie} — ${p.pieza}`,
      tipo:      p.tipo_pieza,
      historial: [p],
    })
  }
  return [...grupos.values()]
}

// ── Comparación contra los demás proveedores ──────────────────────────────────

// Qué tan lejos está este proveedor del mejor precio que hoy se consigue para
// esa refacción. El mejor incluye el propio, así que empatar con él es ser el
// más barato.
//
// No se comparan los números de los papeles: se compara lo que cada refacción
// costaría de verdad. Esta cotización va con el descuento de referencia
// aplicado (`precio_comparable`), y el mejor puede venir de otra cotización o
// de lo que ya se le paga a un proveedor al que se le compra — comparar una
// lista contra una compra ya descontada le daba la razón al que nunca cotiza.
function ComparativaBadge({ vigente }: { vigente: PrecioProveedor }) {
  const mejor = vigente.mejor_precio != null ? Number(vigente.mejor_precio) : null
  const precio = Number(vigente.precio_comparable)
  // Una compra ya trae su descuento aplicado —o ya venía descontada y sin
  // desglosar—; una cotización se estima con el de referencia. Decirlo aquí
  // evita que el badge afirme un descuento que nadie pactó.
  const base = vigente.origen === 'pagado'
    ? (vigente.descuento_pct
        ? `Comparado sobre lo pagado: ${formatMXN(vigente.precio)} de lista − ${vigente.descuento_pct}% = ${formatMXN(precio)}`
        : `Comparado sobre lo que se pagó: ${formatMXN(precio)}`)
    : `Comparado sobre el precio con descuento: ` +
      `${formatMXN(vigente.precio)} de lista − ${vigente.descuento_referencia}% = ${formatMXN(precio)}`

  if (mejor == null || vigente.proveedores_con_precio <= 1) {
    return (
      <Tooltip label="Ningún otro proveedor cotiza esta refacción ni se le ha comprado a nadie más">
        <Badge variant="light" color="gray">Sin comparación</Badge>
      </Tooltip>
    )
  }
  if (precio <= mejor) {
    return (
      <Tooltip label={`El más barato de ${vigente.proveedores_con_precio} proveedores con precio. ${base}`}>
        <Badge variant="light" color="green">Más barato</Badge>
      </Tooltip>
    )
  }

  const diferencia = precio - mejor
  const porcentaje = (diferencia / mejor) * 100
  const comoEsElMejor = vigente.mejor_origen === 'pagado'
    ? 'lo que ya se le paga'
    : 'su cotización con descuento'
  return (
    <Tooltip
      label={`${formatMXN(mejor)} con ${vigente.mejor_proveedor} (${comoEsElMejor}) · ` +
             `${formatMXN(diferencia)} de diferencia. ${base}`}
    >
      <Badge variant="light" color="orange">
        +{porcentaje.toFixed(1)}% vs {vigente.mejor_proveedor}
      </Badge>
    </Tooltip>
  )
}

// ── Historial de una refacción ────────────────────────────────────────────────

// Cuánto cambió cada precio respecto al anterior en el tiempo. El historial
// viene del más reciente al más viejo, así que el "anterior" es el siguiente
// renglón de la lista.
function VariacionCelda({ actual, anterior }: { actual: number; anterior?: number }) {
  if (anterior === undefined) return <Text size="sm" c="dimmed">—</Text>
  const delta = Number(actual) - Number(anterior)
  if (delta === 0) return <Text size="sm" c="dimmed">Sin cambio</Text>
  const pct = (delta / Number(anterior)) * 100
  return (
    <Text size="sm" c={delta > 0 ? 'red' : 'green'}>
      {delta > 0 ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}%
    </Text>
  )
}

function HistorialTabla({
  historial, onEdit, onDelete,
}: {
  historial: PrecioProveedor[]
  onEdit: (p: PrecioProveedor) => void
  onDelete: (p: PrecioProveedor) => void
}) {
  return (
    <Table highlightOnHover verticalSpacing="xs">
      <Table.Thead>
        <Table.Tr>
          <Table.Th style={{ width: 130 }}>Fecha</Table.Th>
          <Table.Th style={{ width: 105 }}>Origen</Table.Th>
          <Table.Th style={{ width: 120, textAlign: 'right' }}>Precio</Table.Th>
          <Table.Th style={{ width: 110 }}>Cambio</Table.Th>
          <Table.Th style={{ width: 130 }}>Factura</Table.Th>
          <Table.Th style={{ width: 70, textAlign: 'center' }}>Piezas</Table.Th>
          <Table.Th>Observaciones</Table.Th>
          <Table.Th style={{ width: 160 }}>Registró</Table.Th>
          <Table.Th style={{ width: 80 }} />
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {historial.map((p, i) => (
          <Table.Tr key={p.clave}>
            <Table.Td>
              <Group gap={6} wrap="nowrap">
                {formatFecha(p.fecha)}
                {i === 0 && <Badge size="xs" variant="light">Vigente</Badge>}
              </Group>
            </Table.Td>
            <Table.Td>
              <Badge size="xs" variant="light" color={p.origen === 'pagado' ? 'blue' : 'grape'}>
                {p.origen === 'pagado' ? 'Pagado' : 'Cotizado'}
              </Badge>
            </Table.Td>
            <Table.Td style={{ textAlign: 'right' }} fw={i === 0 ? 600 : 400}>
              {formatMXN(p.precio)}
            </Table.Td>
            <Table.Td>
              <VariacionCelda actual={p.precio} anterior={historial[i + 1]?.precio} />
            </Table.Td>
            <Table.Td c={p.folio ? undefined : 'dimmed'}>
              <Text size="sm">{p.folio ?? '—'}</Text>
            </Table.Td>
            <Table.Td style={{ textAlign: 'center' }} c={p.cantidad == null ? 'dimmed' : undefined}>
              <Text size="sm">{p.cantidad ?? '—'}</Text>
            </Table.Td>
            <Table.Td c={p.observaciones ? undefined : 'dimmed'}>
              <Text size="sm">{p.observaciones ?? '—'}</Text>
            </Table.Td>
            <Table.Td><Text size="xs" c="dimmed">{p.registrado_por}</Text></Table.Td>
            <Table.Td>
              {/* Una compra no se corrige desde aquí: el número es de su
                  factura, y editarlo en el catálogo de precios dejaría el
                  gasto diciendo una cosa y el precio otra. */}
              {p.origen === 'cotizado' ? (
                <Group gap={4} justify="flex-end" wrap="nowrap">
                  <ActionIcon variant="subtle" color="blue" size="sm"
                    aria-label="Editar" onClick={() => onEdit(p)}>
                    <IconPencil size={14} />
                  </ActionIcon>
                  <ActionIcon variant="subtle" color="red" size="sm"
                    aria-label="Eliminar" onClick={() => onDelete(p)}>
                    <IconTrash size={14} />
                  </ActionIcon>
                </Group>
              ) : (
                <Tooltip label="Viene de una factura: se corrige en la compra, no aquí">
                  <Text size="xs" c="dimmed" ta="right">de compra</Text>
                </Tooltip>
              )}
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  )
}

// ── Página ────────────────────────────────────────────────────────────────────

// ── Gastos ────────────────────────────────────────────────────────────────────

// Las compras agrupadas por año. Es la lectura que sirve para negociar: no
// interesa tanto una compra suelta como cuánto se le va a este proveedor al año
// y si va subiendo.
type AnioDeGastos = { anio: string; total: number; compras: GastoProveedor[] }

function agruparPorAnio(gastos: GastoProveedor[]): AnioDeGastos[] {
  const map = new Map<string, AnioDeGastos>()
  for (const g of gastos) {
    const anio = g.fecha_compra.slice(0, 4)
    const entry = map.get(anio) ?? { anio, total: 0, compras: [] }
    entry.total += g.total
    entry.compras.push(g)
    map.set(anio, entry)
  }
  // Los gastos ya vienen del más reciente al más viejo, así que los años salen
  // en ese orden y las compras de cada uno conservan el suyo.
  return [...map.values()]
}

// Dentro de cada año las compras se seccionan por factura. Un lote suelto no es
// la unidad con la que se revisa el gasto contra contabilidad ni con la que se
// reclama al proveedor; el documento sí, y una factura casi siempre trae varias
// refacciones. Las compras sin factura registrada no son un documento, así que
// se juntan en un bloque aparte al final en vez de fingir que lo son.
type FacturaDeGastos = {
  /** null = compras sin factura registrada. */
  folio:   string | null
  total:   number
  /**
   * Se cargó de un histórico: el gasto es real, pero sus piezas ya estaban
   * usadas cuando entraron y no sumaron nada al almacén. Se marca para que un
   * renglón con existencia cero no se lea como un descuadre.
   */
  historica: boolean
  compras: GastoProveedor[]
}

function agruparPorFactura(compras: GastoProveedor[]): FacturaDeGastos[] {
  const map = new Map<string, FacturaDeGastos>()
  for (const c of compras) {
    const folio = c.num_factura ?? null
    // El prefijo evita que un folio llamado "sin-factura" caiga en el bloque
    // de las compras que no la tienen.
    const clave = folio === null ? 'sin-factura' : `f:${folio}`
    const entry = map.get(clave) ?? { folio, total: 0, historica: c.historica, compras: [] }
    entry.total += c.total
    entry.compras.push(c)
    map.set(clave, entry)
  }
  const facturas = [...map.values()]
  // Las compras vienen de la más reciente a la más vieja, así que las facturas
  // salen en ese mismo orden; el bloque sin factura se va hasta el final.
  return [
    ...facturas.filter((x) => x.folio !== null),
    ...facturas.filter((x) => x.folio === null),
  ]
}

// La columna de factura ya no va en la tabla: es el encabezado del bloque.
function GastosTabla({ compras }: { compras: GastoProveedor[] }) {
  return (
    <Table.ScrollContainer minWidth={620}>
      <Table striped withTableBorder verticalSpacing={4}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th style={{ width: 110 }}>Fecha</Table.Th>
            <Table.Th>Refacción</Table.Th>
            <Table.Th style={{ width: 80, textAlign: 'right' }}>Cant.</Table.Th>
            <Table.Th style={{ width: 110, textAlign: 'right' }}>Unitario</Table.Th>
            <Table.Th style={{ width: 120, textAlign: 'right' }}>Total</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {compras.map((c) => (
            <Table.Tr key={c.lote_id}>
              <Table.Td><Text size="sm">{formatFecha(c.fecha_compra)}</Text></Table.Td>
              <Table.Td>
                <Text size="sm">{c.pieza}</Text>
                <Text size="xs" c="dimmed">
                  {c.pieza_serie}
                  {c.tipo_pieza && ` · ${c.tipo_pieza}`}
                  {c.sucursal && ` · ${c.sucursal}`}
                </Text>
              </Table.Td>
              <Table.Td style={{ textAlign: 'right' }}><Text size="sm">{c.cantidad}</Text></Table.Td>
              <Table.Td style={{ textAlign: 'right' }}>
                <Text size="sm">{formatMXN(c.costo_unitario)}</Text>
              </Table.Td>
              <Table.Td style={{ textAlign: 'right' }}>
                <Text size="sm" fw={600}>{formatMXN(c.total)}</Text>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  )
}

function FacturaBloque({ factura }: { factura: FacturaDeGastos }) {
  // La compra más reciente del bloque ubica la factura en el tiempo; con una
  // sola fecha basta, porque los renglones de una factura son del mismo día.
  const fecha = factura.compras[0]?.fecha_compra
  return (
    <Paper withBorder radius="sm" p="xs">
      <Group justify="space-between" wrap="wrap" gap="xs" mb="xs">
        <Group gap="xs" wrap="nowrap">
          <IconReceipt size={14} />
          {factura.folio ? (
            <Text size="sm" fw={600}>Factura {factura.folio}</Text>
          ) : (
            <Text size="sm" fw={600} c="dimmed">Sin factura</Text>
          )}
          {fecha && <Text size="xs" c="dimmed">{formatFecha(fecha)}</Text>}
          {factura.historica && (
            <Tooltip label="Cargada de un histórico: las piezas ya se habían usado, así que entraron con existencia cero">
              <Badge size="xs" variant="light" color="gray">Histórica</Badge>
            </Tooltip>
          )}
        </Group>
        <Group gap="sm" wrap="nowrap">
          <Text size="xs" c="dimmed">
            {factura.compras.length} renglón{factura.compras.length !== 1 ? 'es' : ''}
          </Text>
          <Text size="sm" fw={600}>{formatMXN(factura.total)}</Text>
        </Group>
      </Group>
      <GastosTabla compras={factura.compras} />
    </Paper>
  )
}

function GastosPanel({ proveedor }: { proveedor: Proveedor }) {
  const { data, isLoading, isError } = useGastosProveedor(proveedor.id)
  const [periodo, setPeriodo]   = useState<Periodo>(PERIODO_DEFAULT)
  const [busqueda, setBusqueda] = useState('')
  const [exportando, setExportando] = useState<'pdf' | 'excel' | null>(null)
  const [importarOpen, setImportarOpen] = useState(false)

  const todos = useMemo(() => data?.data ?? [], [data])

  // El corte se aplica en memoria: las compras de un proveedor caben de sobra en
  // una consulta, y así el filtro responde sin ir al servidor en cada tecla.
  const gastos = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return todos.filter((g) => {
      if (!dentroDelPeriodo(g.fecha_compra, periodo)) return false
      if (!q) return true
      return [g.pieza, g.pieza_serie, g.tipo_pieza, g.num_factura, g.sucursal]
        .some((c) => c?.toLowerCase().includes(q))
    })
  }, [todos, periodo, busqueda])

  const anios = useMemo(() => agruparPorAnio(gastos), [gastos])
  const total = gastos.reduce((s, g) => s + g.total, 0)
  const listo = periodoValido(periodo)

  async function exportar(formato: 'pdf' | 'excel') {
    setExportando(formato)
    try {
      const datos = { proveedor, gastos, periodo, busqueda }
      await (formato === 'pdf' ? exportGastosProveedorPdf : exportGastosProveedorExcel)(datos)
    } finally {
      setExportando(null)
    }
  }

  // El botón aparece en los dos estados —con compras y sin ellas—: el caso
  // típico de una importación es justamente el proveedor al que todavía no se
  // le ha capturado nada en el sistema.
  const botonImportar = (
    <Tooltip label="Cargar facturas viejas desde un CSV. Cuentan como gasto pero no entran al almacén: sus piezas ya se usaron.">
      <Button
        variant="default"
        leftSection={<IconFileImport size={16} />}
        onClick={() => setImportarOpen(true)}
      >
        Importar histórico
      </Button>
    </Tooltip>
  )
  const modalImportar = (
    <ImportarHistoricoModal
      opened={importarOpen}
      onClose={() => setImportarOpen(false)}
      proveedor={proveedor}
    />
  )

  if (isLoading) return <Center py="xl"><Loader /></Center>
  if (isError) {
    return (
      <Alert color="red" title="Error al cargar">
        No se pudieron obtener las compras de este proveedor. Verifica la conexión.
      </Alert>
    )
  }
  if (todos.length === 0) {
    return (
      <>
        <Center py="xl">
          <Stack align="center" gap="xs">
            <Text c="dimmed">A este proveedor todavía no se le ha comprado nada.</Text>
            <Text size="sm" c="dimmed">
              Las compras aparecen aquí en cuanto se registra un lote a su nombre.
            </Text>
            {botonImportar}
          </Stack>
        </Center>
        {modalImportar}
      </>
    )
  }

  return (
    <Stack gap="md">
      {/* El filtro y la exportación juntos: lo que se exporta es exactamente lo
          que quedó en pantalla, así que el corte se elige una sola vez. */}
      <Paper withBorder p="md" radius="md">
        <Group align="flex-end" gap="sm" wrap="wrap">
          <div style={{ flex: '1 1 220px' }}>
            <SelectorPeriodoReporte
              value={periodo}
              onChange={setPeriodo}
              etiquetaDefault="Todo el historial"
              disabled={exportando !== null}
            />
          </div>
          <TextInput
            style={{ flex: '1 1 220px' }}
            label="Buscar"
            placeholder="Refacción, serie, factura o sucursal…"
            leftSection={<IconSearch size={14} />}
            value={busqueda}
            onChange={(e) => setBusqueda(e.currentTarget.value)}
          />
          <Group gap="xs">
            {botonImportar}
            <Button
              variant="light" leftSection={<IconFileTypePdf size={16} />}
              loading={exportando === 'pdf'} disabled={!listo || exportando !== null}
              onClick={() => exportar('pdf')}
            >
              PDF
            </Button>
            <Button
              variant="light" color="green" leftSection={<IconFileSpreadsheet size={16} />}
              loading={exportando === 'excel'} disabled={!listo || exportando !== null}
              onClick={() => exportar('excel')}
            >
              Excel
            </Button>
          </Group>
        </Group>
      </Paper>

      {gastos.length === 0 ? (
        <Center py="xl">
          <Stack align="center" gap="xs">
            <Text c="dimmed">Ninguna compra cae en este corte.</Text>
            <Text size="sm" c="dimmed">Amplía el periodo o limpia la búsqueda.</Text>
          </Stack>
        </Center>
      ) : (
        <>
      <Paper withBorder p="md" radius="md">
        <Group justify="space-between" wrap="wrap" gap="sm">
          <div>
            <Text size="xs" c="dimmed" fw={600} tt="uppercase">Total comprado</Text>
            <Text size="xl" fw={700}>{formatMXN(total)}</Text>
          </div>
          <Text size="sm" c="dimmed">
            {gastos.length} compra{gastos.length !== 1 ? 's' : ''} ·
            {' '}desde {formatFecha(gastos[gastos.length - 1].fecha_compra)}
          </Text>
        </Group>
      </Paper>

      {/* Un año por bloque, el más reciente abierto: es donde se mira primero. */}
      <Accordion variant="separated" multiple defaultValue={[anios[0].anio]}>
        {anios.map((a) => {
          const facturas = agruparPorFactura(a.compras)
          // El bloque sin factura no es un documento: no se cuenta como factura.
          const conFolio = facturas.filter((x) => x.folio !== null).length
          return (
            <Accordion.Item key={a.anio} value={a.anio}>
              <Accordion.Control>
                <Group justify="space-between" wrap="nowrap" pr="sm">
                  <Text size="sm" fw={500}>{a.anio}</Text>
                  <Group gap="sm" wrap="nowrap">
                    <Text size="xs" c="dimmed">
                      {conFolio > 0 && `${conFolio} factura${conFolio !== 1 ? 's' : ''} · `}
                      {a.compras.length} compra{a.compras.length !== 1 ? 's' : ''}
                    </Text>
                    <Text size="sm" fw={600}>{formatMXN(a.total)}</Text>
                  </Group>
                </Group>
              </Accordion.Control>
              <Accordion.Panel>
                <Stack gap="sm">
                  {facturas.map((x) => (
                    <FacturaBloque key={x.folio ?? 'sin-factura'} factura={x} />
                  ))}
                </Stack>
              </Accordion.Panel>
            </Accordion.Item>
          )
        })}
      </Accordion>
        </>
      )}
      {modalImportar}
    </Stack>
  )
}

export default function ProveedorDetalle({
  proveedor, onBack,
}: {
  proveedor: Proveedor
  onBack: () => void
}) {
  const [createOpen, setCreateOpen]   = useState(false)
  // Refacción ya decidida al registrar otro precio desde su propio grupo.
  const [piezaFija, setPiezaFija]     = useState<{ id: number; label: string } | null>(null)
  const [editPrecio, setEditPrecio]   = useState<PrecioProveedor | null>(null)
  const [deletePrecio, setDeletePrecio] = useState<PrecioProveedor | null>(null)
  const [abierta, setAbierta]         = useState<string | null>(null)

  const { data, isLoading, isError } = usePreciosProveedor(proveedor.id)
  const createMut = useCreatePrecioProveedor(proveedor.id)
  const updateMut = useUpdatePrecioProveedor()
  const deleteMut = useDeletePrecioProveedor()

  const precios = useMemo(() => data?.data ?? [], [data])
  const grupos  = useMemo(() => agrupar(precios), [precios])

  // En cuántas refacciones este proveedor es el más barato de los que tienen
  // precio registrado. Es el número que dice si conviene pedirle cotización.
  const masBaratas = grupos.filter((g) => {
    const v = g.historial[0]
    return v.mejor_proveedor_id === proveedor.id && v.proveedores_con_precio > 1
  }).length

  function abrirAlta(pieza?: { id: number; label: string }) {
    setPiezaFija(pieza ?? null)
    createMut.reset()
    setCreateOpen(true)
  }

  return (
    <>
      <Stack gap="md">
        <div>
          <Anchor component="button" type="button" size="sm" onClick={onBack}>
            <Group gap={4} wrap="nowrap">
              <IconArrowLeft size={14} />
              Proveedores
            </Group>
          </Anchor>
        </div>

        <Paper withBorder p="md" radius="md">
          <Group justify="space-between" align="flex-start" wrap="wrap">
            <div>
              <Text size="xl" fw={600}>{proveedor.nombre}</Text>
              <Group gap="md" mt={4}>
                <Group gap={4}>
                  <IconUser size={14} opacity={0.6} />
                  <Text size="sm" c={proveedor.contacto ? undefined : 'dimmed'}>
                    {proveedor.contacto ?? 'Sin contacto'}
                  </Text>
                </Group>
                <Group gap={4}>
                  <IconPhone size={14} opacity={0.6} />
                  <Text size="sm" c={proveedor.telefono ? undefined : 'dimmed'}>
                    {proveedor.telefono ?? 'Sin teléfono'}
                  </Text>
                </Group>
              </Group>
            </div>
            <Group gap="sm" align="center">
              <Badge variant="light" color="gray" size="lg">
                {grupos.length} refacción{grupos.length !== 1 ? 'es' : ''} con precio
              </Badge>
              {masBaratas > 0 && (
                <Tooltip label="Refacciones en las que es el proveedor más barato de los registrados">
                  <Badge variant="light" color="green" size="lg">
                    {masBaratas} al mejor precio
                  </Badge>
                </Tooltip>
              )}
              <Button leftSection={<IconPlus size={16} />} onClick={() => abrirAlta()}>
                Registrar precio
              </Button>
            </Group>
          </Group>
        </Paper>

        {/* Dos preguntas distintas, dos pestañas: lo que pide y lo que se le ha
            comprado. Juntarlas en una sola vista invitaba a sumar precios
            cotizados como si fueran gasto. */}
        <Tabs defaultValue="precios">
          <Tabs.List>
            <Tabs.Tab value="precios" leftSection={<IconTag size={14} />}>
              Comparación de precios
            </Tabs.Tab>
            <Tabs.Tab value="gastos" leftSection={<IconReceipt size={14} />}>
              Gastos
            </Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="precios" pt="md">
            <Stack gap="md">
              {isLoading ? (
                <Center py="xl"><Loader /></Center>
              ) : isError ? (
                <Alert color="red" title="Error al cargar">
                  No se pudieron obtener los precios de este proveedor. Verifica la conexión.
                </Alert>
              ) : grupos.length === 0 ? (
                <Center py="xl">
                  <Stack align="center" gap="xs">
                    <Text c="dimmed">
                      A este proveedor no se le ha comprado nada ni tiene precios registrados.
                    </Text>
                    <Text size="sm" c="dimmed">
                      Cada compra suya entra aquí sola. Si te cotizó algo que todavía no le
                      compras, regístralo para poder compararlo con los demás.
                    </Text>
                    <Button size="xs" variant="light" leftSection={<IconPlus size={14} />}
                      onClick={() => abrirAlta()}>
                      Registrar precio
                    </Button>
                  </Stack>
                </Center>
              ) : (
                <Accordion variant="separated" value={abierta} onChange={setAbierta}>
                  {grupos.map((g) => {
                    const vigente = g.historial[0]
                    return (
                      <Accordion.Item key={g.piezaId} value={String(g.piezaId)}>
                        <Accordion.Control>
                          <Group justify="space-between" wrap="nowrap" pr="sm">
                            <div style={{ minWidth: 0 }}>
                              <Text size="sm" fw={500} truncate>{g.label}</Text>
                              <Text size="xs" c="dimmed">
                                {g.tipo ?? 'Sin tipo'} · {g.historial.length} registro
                                {g.historial.length !== 1 ? 's' : ''}
                                {compras(g) > 0 && ` (${compras(g)} compra${compras(g) !== 1 ? 's' : ''})`}
                                {' · último '}{formatFecha(vigente.fecha)}
                              </Text>
                            </div>
                            <Group gap="sm" wrap="nowrap">
                              <ComparativaBadge vigente={vigente} />
                              <Text size="sm" fw={600}>{formatMXN(vigente.precio)}</Text>
                            </Group>
                          </Group>
                        </Accordion.Control>
                        <Accordion.Panel>
                          <Stack gap="xs">
                            <HistorialTabla
                              historial={g.historial}
                              onEdit={(p) => { updateMut.reset(); setEditPrecio(p) }}
                              onDelete={setDeletePrecio}
                            />
                            <Group justify="flex-end">
                              <Button
                                size="xs" variant="light" leftSection={<IconPlus size={14} />}
                                onClick={() => abrirAlta({ id: g.piezaId, label: g.label })}
                              >
                                Registrar precio nuevo
                              </Button>
                            </Group>
                          </Stack>
                        </Accordion.Panel>
                      </Accordion.Item>
                    )
                  })}
                </Accordion>
              )}
            </Stack>
          </Tabs.Panel>

          <Tabs.Panel value="gastos" pt="md">
            <GastosPanel proveedor={proveedor} />
          </Tabs.Panel>
        </Tabs>
      </Stack>

      {/* Modal: nuevo precio */}
      <Modal
        opened={createOpen}
        onClose={() => setCreateOpen(false)}
        title={`Registrar precio — ${proveedor.nombre}`}
        centered
        size="md"
      >
        <PrecioProveedorForm
          piezaFija={piezaFija ?? undefined}
          isPending={createMut.isPending}
          error={createMut.error ? (createMut.error as Error).message : null}
          onSubmit={(payload) =>
            createMut.mutate(payload, { onSuccess: () => setCreateOpen(false) })
          }
          onCancel={() => setCreateOpen(false)}
        />
      </Modal>

      {/* Modal: editar precio */}
      <Modal
        opened={editPrecio !== null}
        onClose={() => setEditPrecio(null)}
        title="Editar precio"
        centered
        size="md"
      >
        {editPrecio && (
          <PrecioProveedorForm
            initial={{
              pieza_id:      String(editPrecio.pieza_id),
              precio:        Number(editPrecio.precio),
              fecha:         editPrecio.fecha.split('T')[0],
              observaciones: editPrecio.observaciones ?? '',
            }}
            piezaFija={{
              id: editPrecio.pieza_id,
              label: `${editPrecio.pieza_serie} — ${editPrecio.pieza}`,
            }}
            isPending={updateMut.isPending}
            error={updateMut.error ? (updateMut.error as Error).message : null}
            onSubmit={({ precio, fecha, observaciones }) =>
              updateMut.mutate(
                { id: editPrecio.id!, payload: { precio, fecha, observaciones } },
                { onSuccess: () => setEditPrecio(null) }
              )
            }
            onCancel={() => setEditPrecio(null)}
          />
        )}
      </Modal>

      {/* Modal: confirmar eliminación */}
      <Modal
        opened={deletePrecio !== null}
        onClose={() => setDeletePrecio(null)}
        title="Eliminar precio"
        centered
        size="sm"
      >
        <Stack gap="md">
          <Text>
            ¿Eliminar el precio de{' '}
            <strong>{deletePrecio ? formatMXN(deletePrecio.precio) : ''}</strong> del{' '}
            <strong>{deletePrecio ? formatFecha(deletePrecio.fecha) : ''}</strong> para{' '}
            <strong>{deletePrecio?.pieza}</strong>? Esta acción no se puede deshacer.
          </Text>
          {deleteMut.error && (
            <Alert color="red" title="Error">{(deleteMut.error as Error).message}</Alert>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDeletePrecio(null)}
              disabled={deleteMut.isPending}>
              Cancelar
            </Button>
            <Button color="red" loading={deleteMut.isPending}
              onClick={() =>
                // Solo las cotizaciones traen id, y solo ellas ofrecen el botón.
                deleteMut.mutate(deletePrecio!.id!, { onSuccess: () => setDeletePrecio(null) })
              }>
              Eliminar
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  )
}
