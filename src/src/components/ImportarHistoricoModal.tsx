// Importar el histórico de compras de un proveedor desde un CSV.
//
// El caso: hay años de facturas anteriores al sistema. Las piezas se
// compraron, se montaron y se gastaron, y de dónde acabó cada una no queda
// registro — solo el papel del proveedor. Ese papel sí vale: es el historial de
// precios, es el gasto del año, y es la única forma de que el catálogo de
// refacciones incluya lo que de verdad se compra.
//
// LO QUE ESTA PANTALLA TIENE QUE DEJAR CLARÍSIMO, porque es lo que la separa de
// una compra normal: nada de esto entra al almacén. Cada renglón se guarda con
// la cantidad que dice la factura —que es la que cuenta para el gasto— y con
// existencia CERO, porque en el estante no hay ninguna. Si alguien cree que
// está cargando inventario, el inventario deja de servir el mismo día.
//
// Ver `docs/importacion-historica.md`.
import { useMemo, useState } from 'react'
import {
  Modal, Stack, Group, Grid, Text, Alert, Button, TextInput, NumberInput,
  Switch, FileInput, Table, Paper, Loader, Center, Select, Collapse,
  Anchor, ScrollArea, Divider,
} from '@mantine/core'
import {
  IconFileTypeCsv, IconAlertTriangle, IconCheck, IconChevronDown, IconChevronRight,
} from '@tabler/icons-react'
import SelectCatalogo from './SelectCatalogo'
import TipoPiezaSelect from './TipoPiezaSelect'
import { formatMXN } from '../lib/formato'
import { IVA_DEFAULT, totalesFactura } from '../lib/totales'
import { limpiarTextoSimple } from '../lib/validaciones'
import { leerTexto } from '../lib/csv'
import {
  ArchivoInvalidoError, leerArchivoHistorico,
} from '../lib/historicoCsv'
import type { ArchivoHistorico, ArticuloHistorico, FormatoFecha } from '../lib/historicoCsv'
import { useSucursales } from '../hooks/useSucursales'
import { useTodasLasPiezas } from '../hooks/useRefacciones'
import { useTiposPieza, useCreateTipoPieza } from '../hooks/useTiposPieza'
import { useUsuarioActual } from '../hooks/useUsuarioActual'
import { useImportarHistorico } from '../hooks/useImportarHistorico'
import type { ImportacionResultado } from '../hooks/useImportarHistorico'
import type { Proveedor } from '../hooks/useProveedores'

/**
 * Para casar el nombre de un tipo escrito en el archivo con uno del catálogo.
 * "Filtro de aire", "FILTRO DE AIRE" y "Filtro de Aire" son el mismo tipo, y
 * crear un duplicado por una mayúscula es peor que no leer la columna.
 */
function claveDeTipo(nombre: string): string {
  return nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ')
}

function formatFecha(iso: string) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('es-MX', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

// ── Lo que trae el archivo ────────────────────────────────────────────────────

function ResumenArchivo({
  archivo, nuevas, enCatalogo, formato, onFormato,
}: {
  archivo:    ArchivoHistorico
  nuevas:     number
  enCatalogo: number
  formato:    FormatoFecha
  onFormato:  (f: FormatoFecha) => void
}) {
  const fechas = archivo.facturas.map((f) => f.fecha_compra).sort()
  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" align="flex-start" wrap="wrap" gap="md">
        <Group gap="lg" wrap="wrap">
          <div>
            <Text size="xs" c="dimmed" fw={600} tt="uppercase">Facturas</Text>
            <Text size="xl" fw={700}>{archivo.facturas.length}</Text>
          </div>
          <div>
            <Text size="xs" c="dimmed" fw={600} tt="uppercase">Renglones</Text>
            <Text size="xl" fw={700}>{archivo.renglones}</Text>
          </div>
          <div>
            <Text size="xs" c="dimmed" fw={600} tt="uppercase">Refacciones</Text>
            <Group gap={6} align="baseline">
              <Text size="xl" fw={700}>{archivo.articulos.length}</Text>
              <Text size="xs" c="dimmed">
                {enCatalogo} ya en catálogo · {nuevas} nuevas
              </Text>
            </Group>
          </div>
        </Group>
        {/* El formato de fecha se detecta, pero se deja cambiar: "1/5/2026" es
            válido de las dos formas y quien subió el archivo lo tiene abierto. */}
        <Select
          label="Fechas del archivo"
          description={fechas.length
            ? `De ${formatFecha(fechas[0])} a ${formatFecha(fechas[fechas.length - 1])}`
            : undefined}
          w={210}
          data={[
            { value: 'MDA', label: 'Mes/Día/Año  (7/14/2026)' },
            { value: 'DMA', label: 'Día/Mes/Año  (14/7/2026)' },
          ]}
          value={formato}
          onChange={(v) => v && onFormato(v as FormatoFecha)}
          allowDeselect={false}
        />
      </Group>
    </Paper>
  )
}

function Rechazos({ archivo }: { archivo: ArchivoHistorico }) {
  const [abierto, setAbierto] = useState(false)
  if (archivo.rechazos.length === 0) return null
  return (
    <Alert color="yellow" icon={<IconAlertTriangle size={16} />}
      title={`${archivo.rechazos.length} renglón${archivo.rechazos.length !== 1 ? 'es' : ''} no se pudo leer`}>
      <Stack gap="xs">
        <Text size="sm">
          No entran en la importación. El resto del archivo sí: revísalos en el
          original y, si hacen falta, súbelos aparte una vez corregidos.
        </Text>
        <Anchor component="button" type="button" size="sm" onClick={() => setAbierto((v) => !v)}>
          <Group gap={4} wrap="nowrap">
            {abierto ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
            {abierto ? 'Ocultar' : 'Ver cuáles'}
          </Group>
        </Anchor>
        <Collapse expanded={abierto}>
          <ScrollArea.Autosize mah={180}>
            <Table verticalSpacing={2} fz="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th style={{ width: 70 }}>Línea</Table.Th>
                  <Table.Th style={{ width: 200 }}>Motivo</Table.Th>
                  <Table.Th>Renglón</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {archivo.rechazos.map((r) => (
                  <Table.Tr key={r.linea}>
                    <Table.Td>{r.linea}</Table.Td>
                    <Table.Td>{r.motivo}</Table.Td>
                    <Table.Td c="dimmed">{r.texto}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea.Autosize>
        </Collapse>
      </Stack>
    </Alert>
  )
}

// ── Los tipos de las refacciones que se van a dar de alta ─────────────────────

// Solo se pide el tipo de las que NO están en el catálogo: a las que ya existen
// no se les toca nada. El tipo es obligatorio en una refacción —es su única
// clasificación— y hay tres formas de ponerlo, en este orden:
//
//   1. el que se eligió a mano para ese artículo,
//   2. el que traía el archivo en su columna `Tipo`, si casa con uno del
//      catálogo (los nombres que no casen se pueden crear de un botón),
//   3. el de "Tipo para todas".
//
// La columna del archivo existe porque clasificar noventa refacciones en una
// hoja de cálculo son diez minutos, y hacerlo en noventa desplegables es
// trabajo que nadie termina.
function TiposDeLasNuevas({
  nuevas, porDefecto, onPorDefecto, onOverride, tipos,
  conTipos, tipoDe, faltantes, onCrearFaltantes, creando,
}: {
  nuevas:       ArticuloHistorico[]
  porDefecto:   string
  onPorDefecto: (v: string) => void
  /** Fija el tipo de un artículo a mano; gana sobre el del archivo y el general. */
  onOverride:   (serie: string, v: string) => void
  tipos:        { value: string; label: string }[]
  /** El archivo traía columna de tipo. */
  conTipos:     boolean
  /** El tipo que le toca a un artículo con las tres reglas de arriba; '' si ninguna aplica. */
  tipoDe:       (serie: string) => string
  /** Nombres de tipo del archivo que no existen en el catálogo. */
  faltantes:    string[]
  onCrearFaltantes: () => void
  creando:      boolean
}) {
  const [abierto, setAbierto] = useState(false)
  if (nuevas.length === 0) return null

  const clasificadas = nuevas.filter((a) => tipoDe(a.numero_serie) !== '').length

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="sm">
        <div>
          <Text fw={600} size="sm">
            {nuevas.length} refacción{nuevas.length !== 1 ? 'es' : ''} nueva{nuevas.length !== 1 ? 's' : ''}
          </Text>
          <Text size="xs" c="dimmed">
            No están en el catálogo y se darán de alta con la descripción del
            archivo. Falta decir de qué tipo es cada una.
          </Text>
        </div>

        {conTipos && (
          <Text size="sm">
            El archivo trae columna <b>Tipo</b>:{' '}
            {clasificadas === nuevas.length
              ? 'las clasifica todas.'
              : `${clasificadas} de ${nuevas.length} quedaron clasificadas.`}
          </Text>
        )}

        {faltantes.length > 0 && (
          <Alert color="yellow" icon={<IconAlertTriangle size={16} />}
            title={`${faltantes.length} tipo${faltantes.length !== 1 ? 's' : ''} del archivo no existe${faltantes.length !== 1 ? 'n' : ''} en el catálogo`}>
            <Stack gap="xs">
              <Text size="sm">{faltantes.join(' · ')}</Text>
              <Group>
                <Button size="xs" variant="light" loading={creando} onClick={onCrearFaltantes}>
                  Crear {faltantes.length === 1 ? 'el tipo' : `los ${faltantes.length} tipos`}
                </Button>
                <Text size="xs" c="dimmed">
                  O corrige los nombres en el archivo y vuelve a subirlo.
                </Text>
              </Group>
            </Stack>
          </Alert>
        )}

        <TipoPiezaSelect
          value={porDefecto}
          onChange={onPorDefecto}
          label={conTipos ? 'Tipo para las que queden sin clasificar' : 'Tipo para todas'}
          description="Se puede cambiar artículo por artículo abajo"
        />

        <Anchor component="button" type="button" size="sm" onClick={() => setAbierto((v) => !v)}>
          <Group gap={4} wrap="nowrap">
            {abierto ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
            {abierto ? 'Ocultar la lista' : 'Ver y ajustar una por una'}
          </Group>
        </Anchor>

        <Collapse expanded={abierto}>
          <ScrollArea.Autosize mah={300}>
            <Table verticalSpacing={4} fz="sm" stickyHeader>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th style={{ width: 120 }}>Artículo</Table.Th>
                  <Table.Th>Descripción</Table.Th>
                  <Table.Th style={{ width: 200 }}>Tipo</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {nuevas.map((a) => (
                  <Table.Tr key={a.numero_serie}>
                    <Table.Td><Text size="xs" ff="monospace">{a.numero_serie}</Text></Table.Td>
                    <Table.Td>{a.descripcion}</Table.Td>
                    <Table.Td>
                      <Select
                        size="xs"
                        searchable
                        data={tipos}
                        placeholder="Sin clasificar"
                        value={tipoDe(a.numero_serie) || null}
                        onChange={(v) => onOverride(a.numero_serie, v ?? '')}
                        comboboxProps={{ withinPortal: true }}
                      />
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea.Autosize>
        </Collapse>
      </Stack>
    </Paper>
  )
}

// ── Lo que quedó después de importar ──────────────────────────────────────────

function Resultado({
  resultado, onCerrar,
}: {
  resultado: ImportacionResultado
  onCerrar:  () => void
}) {
  return (
    <Stack gap="md">
      <Alert color="green" icon={<IconCheck size={16} />} title="Histórico cargado">
        <Stack gap={4}>
          <Text size="sm">
            {resultado.facturas_creadas} factura{resultado.facturas_creadas !== 1 ? 's' : ''} con{' '}
            {resultado.renglones_creados} renglón{resultado.renglones_creados !== 1 ? 'es' : ''}.
          </Text>
          <Text size="sm">
            {resultado.piezas_nuevas.length} refacción{resultado.piezas_nuevas.length !== 1 ? 'es' : ''}{' '}
            nueva{resultado.piezas_nuevas.length !== 1 ? 's' : ''} en el catálogo, todas con
            existencia cero: el gasto quedó registrado, el almacén no cambió.
          </Text>
        </Stack>
      </Alert>

      {resultado.folios_omitidos.length > 0 && (
        <Alert color="blue" title={`${resultado.folios_omitidos.length} folios ya estaban registrados`}>
          <Text size="sm" mb="xs">
            Se dejaron como estaban; no se duplicó ningún renglón.
          </Text>
          <ScrollArea.Autosize mah={120}>
            <Text size="xs" c="dimmed">{resultado.folios_omitidos.join(' · ')}</Text>
          </ScrollArea.Autosize>
        </Alert>
      )}

      <Group justify="flex-end">
        <Button onClick={onCerrar}>Listo</Button>
      </Group>
    </Stack>
  )
}

// ── El modal ──────────────────────────────────────────────────────────────────

export default function ImportarHistoricoModal({
  opened, onClose, proveedor,
}: {
  opened:    boolean
  onClose:   () => void
  proveedor: Proveedor
}) {
  const [archivoCsv, setArchivoCsv] = useState<File | null>(null)
  const [texto, setTexto]           = useState<string | null>(null)
  const [formato, setFormato]       = useState<FormatoFecha | null>(null)
  // Solo el de abrir el archivo. El de interpretarlo sale de `lectura`.
  const [errorArchivo, setErrorArchivo] = useState<string | null>(null)
  const [leyendo, setLeyendo]       = useState(false)

  const [sucursalId, setSucursalId] = useState('')
  const [compradoPor, setCompradoPor] = useState('')
  const [sumarIva, setSumarIva]     = useState(false)
  const [tasaIva, setTasaIva]       = useState<number | string>(IVA_DEFAULT)
  const [tipoPorDefecto, setTipoPorDefecto] = useState('')
  const [tipoPorArticulo, setTipoPorArticulo] = useState<Record<string, string>>({})
  const [intentado, setIntentado]   = useState(false)

  const sucQuery = useSucursales()
  const piezasQuery = useTodasLasPiezas(opened)
  const { data: tiposData } = useTiposPieza()
  const { data: usuario } = useUsuarioActual()
  const importarMut = useImportarHistorico()
  const crearTipoMut = useCreateTipoPieza()

  const sucursales = (sucQuery.data?.data ?? []).map((s) => ({ value: String(s.id), label: s.nombre }))
  const piezas = useMemo(() => piezasQuery.data?.data ?? [], [piezasQuery.data])
  const tiposDisponibles = useMemo(
    () => (tiposData?.data ?? []).map((t) => ({ value: String(t.id), label: t.nombre })),
    [tiposData],
  )
  // Por nombre normalizado, que es como viene escrito en el archivo.
  const tipoPorNombre = useMemo(
    () => new Map((tiposData?.data ?? []).map((t) => [claveDeTipo(t.nombre), String(t.id)])),
    [tiposData],
  )

  // El archivo se relee cuando cambia el formato de fecha elegido: es lo único
  // que puede cambiar sin volver a subirlo. El error sale del mismo cálculo y
  // no de un `setState` dentro del render, que es como se hacen los bucles.
  const lectura = useMemo<{ archivo: ArchivoHistorico | null; error: string | null }>(() => {
    if (texto === null) return { archivo: null, error: null }
    try {
      return { archivo: leerArchivoHistorico(texto, formato ?? undefined), error: null }
    } catch (e) {
      return {
        archivo: null,
        error: e instanceof ArchivoInvalidoError
          ? e.message
          : 'No se pudo leer el archivo. ¿Es un CSV?',
      }
    }
  }, [texto, formato])
  const archivo = lectura.archivo
  // El de abrir el archivo (no se pudo leer del disco) y el de interpretarlo.
  const problema = errorArchivo ?? lectura.error

  // Qué series ya están en el catálogo. La comparación es la misma que hace la
  // API —por número de parte—, así que lo que se ve aquí es lo que va a pasar.
  const seriesExistentes = useMemo(
    () => new Set(piezas.map((p) => p.numero_serie)),
    [piezas],
  )
  const nuevas = useMemo(
    () => (archivo?.articulos ?? []).filter((a) => !seriesExistentes.has(a.numero_serie)),
    [archivo, seriesExistentes],
  )
  const enCatalogo = (archivo?.articulos.length ?? 0) - nuevas.length

  // El tipo que le toca a cada artículo nuevo: lo elegido a mano, lo que dijo
  // el archivo si casa con un tipo del catálogo, o el de "para todas".
  const tipoDelArchivo = useMemo(() => {
    const m = new Map<string, string>()
    for (const a of archivo?.articulos ?? []) {
      const id = a.tipo ? tipoPorNombre.get(claveDeTipo(a.tipo)) : undefined
      if (id) m.set(a.numero_serie, id)
    }
    return m
  }, [archivo, tipoPorNombre])

  function tipoDe(serie: string): string {
    return tipoPorArticulo[serie] || tipoDelArchivo.get(serie) || tipoPorDefecto || ''
  }

  // Nombres que el archivo trae y el catálogo no tiene. Solo de las refacciones
  // nuevas: el tipo de las que ya existen no se toca, así que un nombre que
  // solo aparezca en ellas no hay por qué crearlo.
  const tiposFaltantes = useMemo(
    () => [...new Set(
      nuevas
        .map((a) => a.tipo)
        .filter((t): t is string => !!t && !tipoPorNombre.has(claveDeTipo(t))),
    )].sort(),
    [nuevas, tipoPorNombre],
  )

  async function crearTiposFaltantes() {
    // De uno en uno: el alta de un tipo es un POST por nombre y no hay endpoint
    // que reciba varios. Son un puñado, y si uno falla los anteriores quedan
    // creados —que es lo correcto: no hay nada que deshacer en un catálogo.
    for (const nombre of tiposFaltantes) {
      await crearTipoMut.mutateAsync(nombre)
    }
  }

  const subtotal = useMemo(
    () => (archivo?.facturas ?? []).reduce(
      (s, f) => s + f.renglones.reduce((t, r) => t + r.cantidad * r.costo_unitario, 0), 0,
    ),
    [archivo],
  )
  const totales = totalesFactura(subtotal, null, sumarIva ? Number(tasaIva) : null)

  function elegirArchivo(f: File | null) {
    setArchivoCsv(f)
    setFormato(null)
    setTipoPorArticulo({})
    setIntentado(false)
    importarMut.reset()
    if (!f) { setTexto(null); setErrorArchivo(null); return }
    setLeyendo(true)
    leerTexto(f)
      .then(setTexto)
      .catch(() => setErrorArchivo('No se pudo abrir el archivo.'))
      .finally(() => setLeyendo(false))
  }

  function cerrar() {
    setArchivoCsv(null)
    setTexto(null)
    setFormato(null)
    setErrorArchivo(null)
    setIntentado(false)
    setTipoPorArticulo({})
    importarMut.reset()
    onClose()
  }

  const nombreDefault = usuario?.data.nombre ?? ''
  const comprador = compradoPor || nombreDefault
  const faltaTipo = nuevas.some((a) => tipoDe(a.numero_serie) === '')
  const listo = archivo !== null && archivo.facturas.length > 0 &&
    sucursalId !== '' && comprador.trim() !== '' && !faltaTipo

  function importar() {
    setIntentado(true)
    if (!listo || !archivo) return
    importarMut.mutate({
      proveedor_id: proveedor.id,
      sucursal_id:  Number(sucursalId),
      tasa_iva:     sumarIva ? Number(tasaIva) : null,
      comprado_por: comprador.trim(),
      facturas: archivo.facturas.map((f) => ({
        num_factura:  f.num_factura,
        fecha_compra: f.fecha_compra,
        renglones: f.renglones.map((r) => ({
          numero_serie: r.numero_serie,
          descripcion:  r.descripcion,
          // El tipo va solo en las que no están en el catálogo. A las que ya
          // existen no se les manda: proponerles un tipo sería proponer
          // cambiarles el suyo, y esta pantalla no viene a corregir el catálogo.
          ...(seriesExistentes.has(r.numero_serie) ? {} : {
            tipo_pieza_id: Number(tipoDe(r.numero_serie)),
          }),
          cantidad_inicial: r.cantidad,
          costo_unitario:   r.costo_unitario,
        })),
      })),
    })
  }

  return (
    <Modal
      opened={opened}
      onClose={cerrar}
      title={`Importar histórico — ${proveedor.nombre}`}
      size="xl"
      centered
    >
      {importarMut.data ? (
        <Resultado resultado={importarMut.data.data} onCerrar={cerrar} />
      ) : (
        <Stack gap="md">
          <Alert color="blue" variant="light">
            <Text size="sm">
              Para facturas viejas cuyas piezas <b>ya se usaron</b>. Entran como
              compra real —cuentan en el gasto y en el historial de precios del
              proveedor— pero con <b>existencia cero</b>: no suman nada al
              almacén. Para lo que sí está en el estante, usa Registrar compra.
            </Text>
          </Alert>

          <FileInput
            label="Archivo CSV"
            description="Columnas: Movimiento, Fecha, Artículo, Descripción, Cantidad y Precio unitario"
            placeholder="Selecciona el archivo…"
            accept=".csv,text/csv"
            leftSection={<IconFileTypeCsv size={16} />}
            value={archivoCsv}
            onChange={elegirArchivo}
            clearable
          />

          {/* También mientras carga el catálogo: sin él, "ya en catálogo" y
              "nueva" se calculan contra una lista vacía y el resumen mentiría. */}
          {(leyendo || piezasQuery.isLoading) && <Center py="md"><Loader size="sm" /></Center>}

          {problema && (
            <Alert color="red" title="No se pudo leer el archivo">{problema}</Alert>
          )}

          {archivo && !piezasQuery.isLoading && (
            <>
              <ResumenArchivo
                archivo={archivo}
                nuevas={nuevas.length}
                enCatalogo={enCatalogo}
                formato={archivo.formato}
                onFormato={setFormato}
              />

              <Rechazos archivo={archivo} />

              {archivo.facturas.length === 0 ? (
                <Alert color="red" title="No quedó nada que importar">
                  Ningún renglón del archivo se pudo leer.
                </Alert>
              ) : (
                <>
                  <Grid gap="sm">
                    <Grid.Col span={{ base: 12, sm: 6 }}>
                      <SelectCatalogo
                        estado={sucQuery}
                        nombre="sucursales"
                        label="Sucursal que las recibió"
                        description="Dónde entraron cuando llegaron; su existencia ahí queda en cero"
                        placeholder="Selecciona una sucursal"
                        data={sucursales}
                        value={sucursalId || null}
                        onChange={(v) => setSucursalId(v ?? '')}
                        error={intentado && !sucursalId ? 'Sucursal requerida' : null}
                        required
                      />
                    </Grid.Col>
                    <Grid.Col span={{ base: 12, sm: 6 }}>
                      <TextInput
                        label="Comprado por"
                        description="Quién hizo estas compras"
                        placeholder={nombreDefault}
                        value={compradoPor}
                        onChange={(e) => setCompradoPor(limpiarTextoSimple(e.currentTarget.value, 120))}
                        error={intentado && !comprador.trim() ? 'Requerido' : null}
                        required
                      />
                    </Grid.Col>
                  </Grid>

                  <Paper withBorder p="md" radius="md">
                    <Group justify="space-between" align="flex-end" wrap="wrap" gap="md">
                      <Group gap="md" align="flex-end">
                        <Switch
                          label="Sumar IVA"
                          description="Apagado: los precios del archivo ya lo incluyen"
                          checked={sumarIva}
                          onChange={(e) => setSumarIva(e.currentTarget.checked)}
                        />
                        {sumarIva && (
                          <NumberInput
                            label="Tasa"
                            w={110}
                            suffix="%"
                            min={0.01}
                            max={100}
                            decimalScale={2}
                            value={tasaIva}
                            onChange={setTasaIva}
                          />
                        )}
                      </Group>
                      <div style={{ textAlign: 'right' }}>
                        <Text size="xs" c="dimmed" fw={600} tt="uppercase">
                          Total del archivo
                        </Text>
                        <Text size="xl" fw={700}>{formatMXN(totales.total)}</Text>
                        {sumarIva && (
                          <Text size="xs" c="dimmed">
                            {formatMXN(totales.subtotal)} + {formatMXN(totales.iva)} de IVA
                          </Text>
                        )}
                      </div>
                    </Group>
                  </Paper>

                  <TiposDeLasNuevas
                    nuevas={nuevas}
                    porDefecto={tipoPorDefecto}
                    onPorDefecto={setTipoPorDefecto}
                    onOverride={(serie, v) =>
                      setTipoPorArticulo((prev) => ({ ...prev, [serie]: v }))}
                    tipos={tiposDisponibles}
                    conTipos={archivo.conTipos}
                    tipoDe={tipoDe}
                    faltantes={tiposFaltantes}
                    onCrearFaltantes={() => { void crearTiposFaltantes() }}
                    creando={crearTipoMut.isPending}
                  />

                  {crearTipoMut.error && (
                    <Alert color="red" title="No se pudieron crear los tipos">
                      {(crearTipoMut.error as Error).message}
                    </Alert>
                  )}

                  {intentado && faltaTipo && (
                    <Alert color="red" title="Falta el tipo de pieza">
                      Elige un tipo para las refacciones nuevas: es su única
                      clasificación y sin él no se pueden dar de alta.
                    </Alert>
                  )}

                  {importarMut.error && (
                    <Alert color="red" title="No se pudo importar">
                      {(importarMut.error as Error).message}
                    </Alert>
                  )}

                  <Divider />

                  <Group justify="space-between" wrap="wrap" gap="sm">
                    <Text size="xs" c="dimmed">
                      Si alguno de estos folios ya estaba registrado, se omite:
                      volver a subir el mismo archivo no duplica nada.
                    </Text>
                    <Group gap="sm">
                      <Button variant="default" onClick={cerrar} disabled={importarMut.isPending}>
                        Cancelar
                      </Button>
                      <Button onClick={importar} loading={importarMut.isPending}>
                        Importar {archivo.facturas.length} factura
                        {archivo.facturas.length !== 1 ? 's' : ''}
                      </Button>
                    </Group>
                  </Group>
                </>
              )}
            </>
          )}
        </Stack>
      )}
    </Modal>
  )
}
