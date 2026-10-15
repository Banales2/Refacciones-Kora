// Importar facturas de refacciones de sus XML: se arrastra la carpeta que se
// descargó del SAT (o se eligen los archivos) y el sistema hace el resto.
//
// Cada XML se lee en el navegador (`lib/xmlRefacciones.ts`). Se dejan fuera,
// diciendo por qué, las notas de crédito, los pagos, lo que no viene a nombre
// de la empresa y lo que no se puede leer. Lo demás se enseña antes de guardar.
//
// LO QUE EL XML NO DICE se pide aquí:
//
//   - la sucursal que recibe y quién compró, una vez para toda la importación;
//   - de qué proveedor es, solo la primera vez de cada RFC (se le queda);
//   - qué es cada concepto —qué refacción, mano de obra u otro cargo—, solo la
//     primera vez de cada número de parte del proveedor (se aprende).
//
// La segunda factura de Ecocamiones ya llega con todo puesto. Ver la migración
// 070 y docs/importar-facturas-de-refacciones.md.
import { useMemo, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import {
  Accordion, Alert, Badge, Button, Group, Modal, NumberInput, Paper, SegmentedControl,
  Select, Stack, Table, Text, TextInput, Textarea,
} from '@mantine/core'
import { useQueries, useQueryClient } from '@tanstack/react-query'
import { IconCheck, IconFileImport, IconFolderOpen } from '@tabler/icons-react'
import {
  fetchConceptosAprendidos, useImportarCfdi,
} from '../hooks/useImportarCfdi'
import type {
  AsignacionPayload, ConceptoAprendido, ImportarCfdiPayload, TipoConcepto,
} from '../hooks/useImportarCfdi'
import { useProveedores } from '../hooks/useProveedores'
import { useSucursales } from '../hooks/useSucursales'
import { useTodasLasPiezas } from '../hooks/useRefacciones'
import SelectCatalogo from './SelectCatalogo'
import TipoPiezaSelect from './TipoPiezaSelect'
import {
  descuadreXml, leerFacturaRefacciones, pareceServicio, pideContenido, serieSugerida,
  XmlRefaccionesError,
} from '../lib/xmlRefacciones'
import type { ConceptoXml, FacturaRefaccionesXml } from '../lib/xmlRefacciones'
import { RFC_EMPRESA } from '../lib/empresa'
import { formatFecha, formatMXN } from '../lib/formato'
import { limpiarTextoLibre, limpiarTextoSimple, TEXTO_LIBRE, TEXTO_SIMPLE } from '../lib/validaciones'

const NUEVO = '__nuevo__'
const MARCA_FALTANTE = 'Marca Faltante'

interface Archivo {
  nombre: string
  factura: FacturaRefaccionesXml | null
  /** Por qué no entra: no se pudo leer, no cuadra, o no es una compra. */
  motivo: string | null
  /** Se deja fuera sin que sea un error: nota de crédito, pago, otro receptor. */
  ignorado: boolean
  estado: 'pendiente' | 'importando' | 'importada' | 'rechazada'
  mensaje: string | null
}

/** Lo que se va decidiendo de un concepto. */
interface Asignacion {
  tipo: TipoConcepto
  modo: 'catalogo' | 'nueva'
  pieza_id: string | null
  numero_serie: string
  descripcion: string
  marca: string
  tipo_pieza_id: string
  contenido: number | string
}

/**
 * La llave de un concepto. Por número de parte del proveedor: dos facturas de
 * Ecocamiones con la misma pieza se resuelven con una sola decisión. Sin número
 * de parte no hay qué aprender y la decisión es de ese renglón.
 */
function clave(f: FacturaRefaccionesXml, c: ConceptoXml, i: number): string {
  return c.no_identificacion ? `${f.emisor_rfc}|${c.no_identificacion}` : `${f.uuid}|${i}`
}

/** El espejo de `descuentoDeLaFactura` de la API: solo para enseñar el costo. */
function descuentoParejo(f: FacturaRefaccionesXml): boolean {
  const pcts = f.conceptos.map((c) => (c.importe > 0 ? c.descuento / c.importe : 0))
  return pcts.every((p) => Math.abs(p - pcts[0]) < 0.0001)
}

/** Las piezas de un concepto de refacción, o null si no salen enteras. */
function piezasDe(c: ConceptoXml, contenido: number | string): number | null {
  const n = Number(contenido)
  if (!(n > 0)) return null
  const exacto = c.cantidad / n
  const piezas = Math.round(exacto)
  return Math.abs(exacto - piezas) < 1e-6 && piezas >= 1 && piezas <= 999 ? piezas : null
}

function asignacionValida(c: ConceptoXml, a: Asignacion): string | null {
  if (a.tipo !== 'refaccion') return null
  if (piezasDe(c, a.contenido) === null) return 'Las piezas no salen enteras'
  if (a.modo === 'catalogo') return a.pieza_id ? null : 'Elige la refacción'
  if (!/^[A-Z0-9-]{1,20}$/.test(a.numero_serie)) return 'Número de serie inválido'
  if (a.descripcion.trim().length < 3 || !TEXTO_LIBRE.test(a.descripcion)) return 'Descripción inválida'
  if (!a.marca.trim() || !TEXTO_SIMPLE.test(a.marca)) return 'Marca requerida'
  if (!a.tipo_pieza_id) return 'Tipo de pieza requerido'
  return null
}

/** Lee lo que se soltó en la zona, bajando a las carpetas. */
async function archivosDelDrop(dt: DataTransfer): Promise<File[]> {
  // Las entradas se piden YA: el navegador vacía `items` en cuanto el manejador
  // del drop suelta el control con el primer await.
  const entradas = Array.from(dt.items)
    .map((i) => i.webkitGetAsEntry?.() ?? null)
    .filter((e): e is FileSystemEntry => e !== null)
  if (entradas.length === 0) return Array.from(dt.files)

  const archivos: File[] = []
  async function recorrer(e: FileSystemEntry): Promise<void> {
    if (e.isFile) {
      archivos.push(await new Promise<File>((res, rej) => (e as FileSystemFileEntry).file(res, rej)))
    } else if (e.isDirectory) {
      const lector = (e as FileSystemDirectoryEntry).createReader()
      // `readEntries` entrega por tandas: hay que pedir hasta que venga vacía.
      for (;;) {
        const tanda = await new Promise<FileSystemEntry[]>((res, rej) => lector.readEntries(res, rej))
        if (tanda.length === 0) break
        for (const x of tanda) await recorrer(x)
      }
    }
  }
  for (const e of entradas) await recorrer(e)
  return archivos
}

export default function ImportarFacturasRefacciones({
  abierto, onClose,
}: {
  abierto: boolean
  onClose: () => void
}) {
  const qc = useQueryClient()
  const importar = useImportarCfdi()
  const provQuery = useProveedores()
  const sucQuery = useSucursales()
  const piezasQuery = useTodasLasPiezas(abierto)

  const [archivos, setArchivos] = useState<Archivo[]>([])
  const [sucursalId, setSucursalId] = useState<string | null>(null)
  const [compradoPor, setCompradoPor] = useState('')
  // RFC → proveedor elegido (id, o NUEVO para darlo de alta).
  const [eleccionProv, setEleccionProv] = useState<Record<string, string | null>>({})
  const [asignaciones, setAsignaciones] = useState<Record<string, Asignacion>>({})
  // Los RFC que quedaron ligados en esta misma importación, mientras la lista
  // de proveedores se vuelve a pedir.
  const [ligados, setLigados] = useState<Record<string, { id: number; nombre: string }>>({})
  const [trabajando, setTrabajando] = useState(false)
  const [arrastrando, setArrastrando] = useState(false)
  const inputCarpeta = useRef<HTMLInputElement | null>(null)
  const inputArchivos = useRef<HTMLInputElement | null>(null)

  const proveedores = provQuery.data?.data ?? []
  const porRfc = new Map(proveedores.filter((p) => p.rfc).map((p) => [p.rfc!, { id: p.id, nombre: p.nombre }]))
  const proveedorDe = (rfc: string) => ligados[rfc] ?? porRfc.get(rfc) ?? null
  const proveedorElegido = (rfc: string): number | null => {
    const conocido = proveedorDe(rfc)
    if (conocido) return conocido.id
    const e = eleccionProv[rfc]
    return e && e !== NUEVO ? Number(e) : null
  }

  // Lo aprendido de cada proveedor que aparece en la importación.
  const idsProveedor = [...new Set(
    archivos.map((a) => a.factura ? proveedorElegido(a.factura.emisor_rfc) : null)
      .filter((x): x is number => x !== null),
  )]
  const aprendidosQ = useQueries({
    queries: idsProveedor.map((id) => ({
      queryKey: ['proveedor-conceptos', id],
      queryFn: () => fetchConceptosAprendidos(id),
    })),
  })
  const aprendidos = new Map<number, Map<string, ConceptoAprendido>>(
    idsProveedor.map((id, i) => [
      id, new Map((aprendidosQ[i]?.data?.data ?? []).map((c) => [c.no_identificacion, c])),
    ]),
  )

  const piezaOptions = useMemo(
    () => (piezasQuery.data?.data ?? [])
      .map((p) => ({ value: String(p.id), label: `${p.numero_serie} — ${p.descripcion}` })),
    [piezasQuery.data],
  )

  function porOmision(f: FacturaRefaccionesXml, c: ConceptoXml): Asignacion {
    const pid = proveedorElegido(f.emisor_rfc)
    const sabido = pid !== null && c.no_identificacion
      ? aprendidos.get(pid)?.get(c.no_identificacion)
      : undefined
    return {
      tipo: sabido?.tipo ?? (pareceServicio(c) ? 'mano_obra' : 'refaccion'),
      modo: 'catalogo',
      pieza_id: sabido?.pieza_id != null ? String(sabido.pieza_id) : null,
      numero_serie: serieSugerida(c),
      descripcion: limpiarTextoLibre(c.descripcion, 255),
      marca: MARCA_FALTANTE,
      tipo_pieza_id: '',
      contenido: sabido?.contenido ?? 1,
    }
  }
  const asignacionDe = (f: FacturaRefaccionesXml, c: ConceptoXml, i: number) =>
    asignaciones[clave(f, c, i)] ?? porOmision(f, c)

  function cambiar(f: FacturaRefaccionesXml, c: ConceptoXml, i: number, cambio: Partial<Asignacion>) {
    const k = clave(f, c, i)
    setAsignaciones((p) => ({ ...p, [k]: { ...(p[k] ?? porOmision(f, c)), ...cambio } }))
  }

  async function leer(files: File[]) {
    const xmls = files.filter((f) => f.name.toLowerCase().endsWith('.xml'))
    const leidos = await Promise.all(xmls.map(async (file): Promise<Archivo> => {
      const base = { nombre: file.webkitRelativePath || file.name, estado: 'pendiente' as const, mensaje: null }
      try {
        const r = leerFacturaRefacciones(await file.text(), RFC_EMPRESA)
        if (r.tipo === 'ignorado') return { ...base, factura: null, motivo: r.motivo, ignorado: true }
        return { ...base, factura: r.factura, motivo: descuadreXml(r.factura), ignorado: false }
      } catch (e) {
        const motivo = e instanceof XmlRefaccionesError ? e.message : 'No se pudo leer el archivo.'
        return { ...base, factura: null, motivo, ignorado: false }
      }
    }))
    // Lo que ya estaba en la lista se queda; el mismo XML dos veces es una factura.
    setArchivos((previos) => {
      const vistos = new Set(previos.map((a) => a.factura?.uuid).filter(Boolean))
      const nuevos = leidos.filter((a) => {
        if (!a.factura) return true
        if (vistos.has(a.factura.uuid)) return false
        vistos.add(a.factura.uuid)
        return true
      })
      return [...previos, ...nuevos]
    })
  }

  function soltar(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setArrastrando(false)
    if (trabajando) return
    void archivosDelDrop(e.dataTransfer).then(leer)
  }

  function cerrar() {
    setArchivos([])
    setEleccionProv({})
    setAsignaciones({})
    setLigados({})
    importar.reset()
    onClose()
  }

  const datosGenerales = !!sucursalId && compradoPor.trim().length > 0 && TEXTO_SIMPLE.test(compradoPor)

  function pendientesDe(f: FacturaRefaccionesXml): string[] {
    const p: string[] = []
    if (!proveedorDe(f.emisor_rfc) && !eleccionProv[f.emisor_rfc]) p.push('Elige el proveedor')
    f.conceptos.forEach((c, i) => {
      const err = asignacionValida(c, asignacionDe(f, c, i))
      if (err) p.push(`Concepto ${i + 1}: ${err}`)
    })
    return p
  }

  const facturas = archivos.filter((a) => a.factura && !a.motivo)
  const listas = facturas.filter((a) => a.estado !== 'importada' && pendientesDe(a.factura!).length === 0)
  const fuera = archivos.filter((a) => !a.factura || a.motivo)

  function payloadDe(f: FacturaRefaccionesXml, asigs: Record<string, Asignacion>): ImportarCfdiPayload {
    const conocido = proveedorDe(f.emisor_rfc)
    const eleccion = eleccionProv[f.emisor_rfc]
    return {
      ...f,
      ...(conocido ? {} : eleccion === NUEVO ? { proveedor_nuevo: true } : { proveedor_id: Number(eleccion) }),
      sucursal_id: Number(sucursalId),
      comprado_por: compradoPor.trim(),
      conceptos: f.conceptos.map((concepto, i) => {
        const { unidad: _u, ...c } = concepto
        const a = asigs[clave(f, concepto, i)] ?? porOmision(f, concepto)
        let asignacion: AsignacionPayload
        if (a.tipo === 'refaccion') {
          asignacion = {
            tipo: 'refaccion',
            contenido: Number(a.contenido),
            ...(a.modo === 'catalogo'
              ? { pieza_id: Number(a.pieza_id) }
              : {
                  pieza_nueva: {
                    numero_serie: a.numero_serie,
                    descripcion: a.descripcion.trim(),
                    marca: a.marca.trim(),
                    tipo_pieza_id: Number(a.tipo_pieza_id),
                  },
                }),
          }
        } else {
          asignacion = { tipo: a.tipo }
        }
        return { ...c, asignacion }
      }),
    }
  }

  async function importarTodas() {
    setTrabajando(true)
    // Una por una: la primera de un proveedor nuevo le liga el RFC y le enseña
    // sus números de parte, y la siguiente ya se reconoce sola.
    let asigs = { ...asignaciones }
    for (const a of listas) {
      const f = a.factura!
      setArchivos((p) => p.map((x) => x.nombre === a.nombre ? { ...x, estado: 'importando' } : x))
      try {
        const r = await importar.mutateAsync(payloadDe(f, asigs))
        setLigados((p) => ({ ...p, [f.emisor_rfc]: { id: r.data.proveedor_id, nombre: r.data.proveedor } }))
        // Las refacciones que nacieron aquí ya existen: la siguiente factura con
        // ese número de parte tiene que elegirlas, no volver a darlas de alta.
        const sabidos = await qc.fetchQuery({
          queryKey: ['proveedor-conceptos', r.data.proveedor_id],
          queryFn: () => fetchConceptosAprendidos(r.data.proveedor_id),
        })
        const porNoId = new Map(sabidos.data.map((c) => [c.no_identificacion, c]))
        const siguiente = { ...asigs }
        f.conceptos.forEach((c, i) => {
          const k = clave(f, c, i)
          const s = c.no_identificacion ? porNoId.get(c.no_identificacion) : undefined
          if (siguiente[k]?.modo === 'nueva' && s?.pieza_id != null) {
            siguiente[k] = { ...siguiente[k], modo: 'catalogo', pieza_id: String(s.pieza_id) }
          }
        })
        asigs = siguiente
        setAsignaciones(siguiente)
        setArchivos((p) => p.map((x) => x.nombre === a.nombre
          ? { ...x, estado: 'importada', mensaje: `Importada: ${r.data.proveedor} ${r.data.folio}` }
          : x))
      } catch (e) {
        setArchivos((p) => p.map((x) => x.nombre === a.nombre
          ? { ...x, estado: 'rechazada', mensaje: (e as Error).message }
          : x))
      }
    }
    setTrabajando(false)
  }

  const sinProveedor = [...new Set(facturas
    .filter((a) => !proveedorDe(a.factura!.emisor_rfc))
    .map((a) => a.factura!.emisor_rfc))]
  const libres = proveedores.filter((p) => !p.rfc).map((p) => ({ value: String(p.id), label: p.nombre }))

  return (
    <Modal
      opened={abierto} onClose={cerrar} size="xl"
      title={<Text fw={700}>Importar facturas de refacciones (XML)</Text>}
    >
      <Stack gap="sm">
        {/* Se arrastra la carpeta tal como se descargó: el sistema baja a sus
            subcarpetas y descarta lo que no es una compra. */}
        <Paper
          withBorder p="lg" radius="md"
          style={{
            borderStyle: 'dashed', textAlign: 'center', cursor: trabajando ? 'default' : 'pointer',
            background: arrastrando ? 'var(--mantine-color-blue-light)' : undefined,
          }}
          onDragOver={(e) => { e.preventDefault(); setArrastrando(true) }}
          onDragLeave={() => setArrastrando(false)}
          onDrop={soltar}
        >
          <Stack gap={6} align="center">
            <IconFolderOpen size={28} />
            <Text size="sm" fw={500}>Arrastra aquí la carpeta de los XML descargados</Text>
            <Text size="xs" c="dimmed">
              Con sus subcarpetas. Las notas de crédito, los pagos y lo que no venga a nombre
              de la empresa se dejan fuera solos.
            </Text>
            <Group gap="xs">
              <Button size="xs" variant="light" leftSection={<IconFolderOpen size={14} />}
                disabled={trabajando} onClick={() => inputCarpeta.current?.click()}>
                Elegir carpeta
              </Button>
              <Button size="xs" variant="default" leftSection={<IconFileImport size={14} />}
                disabled={trabajando} onClick={() => inputArchivos.current?.click()}>
                Elegir archivos
              </Button>
            </Group>
          </Stack>
          <input
            type="file" hidden multiple
            ref={(el) => {
              inputCarpeta.current = el
              // React no conoce el atributo: se pone a mano.
              el?.setAttribute('webkitdirectory', '')
            }}
            onChange={(e) => { void leer(Array.from(e.currentTarget.files ?? [])); e.currentTarget.value = '' }}
          />
          <input
            type="file" hidden multiple accept=".xml,application/xml,text/xml"
            ref={inputArchivos}
            onChange={(e) => { void leer(Array.from(e.currentTarget.files ?? [])); e.currentTarget.value = '' }}
          />
        </Paper>

        {facturas.length > 0 && (
          <Group grow align="flex-start">
            <SelectCatalogo
              estado={sucQuery} nombre="sucursales" size="xs"
              label="Sucursal que recibe" required
              description="Para todas las facturas de esta importación"
              data={(sucQuery.data?.data ?? []).map((s) => ({ value: String(s.id), label: s.nombre }))}
              value={sucursalId} onChange={setSucursalId}
              disabled={trabajando}
            />
            <TextInput
              size="xs" label="Comprado por" required
              description="Quién hizo las compras"
              value={compradoPor}
              onChange={(e) => setCompradoPor(limpiarTextoSimple(e.currentTarget.value, 120))}
              disabled={trabajando}
            />
          </Group>
        )}

        {sinProveedor.length > 0 && (
          <Alert color="blue" variant="light" title="Proveedores que no se conocen todavía">
            <Stack gap="xs">
              <Text size="xs">
                Se reconocen por su RFC. Elige cuál es en el catálogo, o dalo de alta con el
                nombre del XML: se le queda, y las siguientes facturas ya no preguntan.
              </Text>
              {sinProveedor.map((rfc) => {
                const f = facturas.find((a) => a.factura!.emisor_rfc === rfc)!.factura!
                return (
                  <Select
                    key={rfc} size="xs" searchable
                    label={<>{f.emisor_nombre} · <Text component="span" ff="monospace" size="xs">{rfc}</Text></>}
                    placeholder="¿Cuál proveedor es?"
                    data={[{ value: NUEVO, label: `Dar de alta: ${f.emisor_nombre}` }, ...libres]}
                    value={eleccionProv[rfc] ?? null}
                    onChange={(v) => setEleccionProv((p) => ({ ...p, [rfc]: v }))}
                    disabled={trabajando}
                  />
                )
              })}
            </Stack>
          </Alert>
        )}

        {facturas.length > 0 && (
          <Accordion variant="separated" multiple>
            {facturas.map((a) => {
              const f = a.factura!
              const pendientes = pendientesDe(f)
              const prov = proveedorDe(f.emisor_rfc)
              const lista = descuentoParejo(f)
              return (
                <Accordion.Item key={a.nombre} value={a.nombre}>
                  <Accordion.Control>
                    <Group justify="space-between" wrap="nowrap" pr="sm">
                      <div>
                        <Text size="sm" fw={600}>
                          {prov?.nombre ?? f.emisor_nombre} · {f.serie ? `${f.serie}-` : ''}{f.folio}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {formatFecha(f.fecha)} · {f.conceptos.length} concepto{f.conceptos.length === 1 ? '' : 's'}
                          {' · '}{formatMXN(f.total)}
                        </Text>
                      </div>
                      {a.estado === 'importada' ? (
                        <Badge color="green" variant="light" leftSection={<IconCheck size={11} />}>Importada</Badge>
                      ) : a.estado === 'rechazada' ? (
                        <Badge color="red" variant="light">No se importó</Badge>
                      ) : a.estado === 'importando' ? (
                        <Badge color="gray" variant="light">Importando…</Badge>
                      ) : pendientes.length > 0 ? (
                        <Badge color="orange" variant="light">Falta decidir {pendientes.length}</Badge>
                      ) : (
                        <Badge color="blue" variant="light">Lista</Badge>
                      )}
                    </Group>
                  </Accordion.Control>
                  <Accordion.Panel>
                    <Stack gap="xs">
                      {a.mensaje && (
                        <Text size="xs" c={a.estado === 'rechazada' ? 'red' : 'green'}>{a.mensaje}</Text>
                      )}
                      {f.conceptos.map((c, i) => (
                        <Concepto
                          key={i} c={c} indice={i} lista={lista}
                          a={asignacionDe(f, c, i)}
                          piezaOptions={piezaOptions}
                          piezasQuery={piezasQuery}
                          bloqueado={trabajando || a.estado === 'importada'}
                          onChange={(cambio) => cambiar(f, c, i, cambio)}
                        />
                      ))}
                    </Stack>
                  </Accordion.Panel>
                </Accordion.Item>
              )
            })}
          </Accordion>
        )}

        {fuera.length > 0 && (
          <Table withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Fuera de la importación ({fuera.length})</Table.Th>
                <Table.Th>Por qué</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {fuera.map((a) => (
                <Table.Tr key={a.nombre}>
                  <Table.Td><Text size="xs" ff="monospace">{a.nombre}</Text></Table.Td>
                  <Table.Td><Text size="xs" c={a.ignorado ? 'dimmed' : 'red'}>{a.motivo}</Text></Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}

        <Text size="xs" c="dimmed">
          Se importan con el papel ya transcrito para el cuadre, sin sellar: el admin las revisa y
          las sella en Facturas de compra. La mano de obra queda por ligar a su mantenimiento.
        </Text>

        <Group justify="flex-end">
          <Button variant="default" onClick={cerrar} disabled={trabajando}>Cerrar</Button>
          <Button
            disabled={listas.length === 0 || !datosGenerales}
            loading={trabajando}
            onClick={() => void importarTodas()}
          >
            Importar {listas.length > 0 ? listas.length : ''} factura{listas.length === 1 ? '' : 's'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}

function Concepto({
  c, indice, lista, a, piezaOptions, piezasQuery, bloqueado, onChange,
}: {
  c: ConceptoXml
  indice: number
  /** Si la factura se guarda a precio de lista (descuento parejo) o neto. */
  lista: boolean
  a: Asignacion
  piezaOptions: { value: string; label: string }[]
  piezasQuery: { isLoading: boolean; isError: boolean; refetch: () => unknown }
  bloqueado: boolean
  onChange: (cambio: Partial<Asignacion>) => void
}) {
  const neto = lista ? c.importe : c.importe - c.descuento
  const pct = c.importe > 0 ? Math.round((c.descuento / c.importe) * 10000) / 100 : 0
  const piezas = piezasDe(c, a.contenido)
  const unidad = c.unidad ?? c.clave_unidad

  return (
    <Paper withBorder p="xs" radius="sm">
      <Stack gap={6}>
        <Group justify="space-between" wrap="nowrap" align="flex-start">
          <div>
            <Text size="sm" fw={500}>{indice + 1}. {c.descripcion}</Text>
            <Text size="xs" c="dimmed">
              {c.no_identificacion && <Text component="span" ff="monospace" size="xs">{c.no_identificacion} · </Text>}
              {c.cantidad} {unidad} · {formatMXN(c.importe)}
              {pct > 0 ? ` · −${pct}%` : ''}
            </Text>
          </div>
          <SegmentedControl
            size="xs" disabled={bloqueado}
            value={a.tipo}
            onChange={(v) => onChange({ tipo: v as TipoConcepto })}
            data={[
              { value: 'refaccion', label: 'Refacción' },
              { value: 'mano_obra', label: 'Mano de obra' },
              { value: 'cargo', label: 'Otro cargo' },
            ]}
          />
        </Group>

        {a.tipo === 'refaccion' && (
          <>
            <Group gap="xs" align="flex-end" wrap="nowrap">
              {a.modo === 'catalogo' ? (
                <SelectCatalogo
                  estado={piezasQuery} nombre="refacciones" size="xs" style={{ flex: 1 }}
                  placeholder="¿Cuál refacción del catálogo es?"
                  data={piezaOptions} value={a.pieza_id}
                  onChange={(v) => onChange({ pieza_id: v })}
                  nothingFoundMessage='Sin coincidencias: usa "Nueva"'
                  disabled={bloqueado}
                />
              ) : (
                <Text size="xs" c="dimmed" style={{ flex: 1 }}>Se da de alta con esta compra:</Text>
              )}
              <Button
                size="compact-xs" variant="subtle" disabled={bloqueado}
                onClick={() => onChange({ modo: a.modo === 'catalogo' ? 'nueva' : 'catalogo' })}
              >
                {a.modo === 'catalogo' ? 'Nueva' : 'Elegir del catálogo'}
              </Button>
            </Group>
            {a.modo === 'nueva' && (
              <Group grow align="flex-start" gap="xs">
                <TextInput
                  size="xs" label="No. serie" required maxLength={20} disabled={bloqueado}
                  value={a.numero_serie}
                  onChange={(e) => onChange({
                    numero_serie: e.currentTarget.value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 20),
                  })}
                />
                <Textarea
                  size="xs" label="Descripción" required autosize minRows={1} maxRows={3} disabled={bloqueado}
                  value={a.descripcion}
                  onChange={(e) => onChange({ descripcion: limpiarTextoLibre(e.currentTarget.value, 255) })}
                />
                <TextInput
                  size="xs" label="Marca" required disabled={bloqueado}
                  value={a.marca}
                  onChange={(e) => onChange({ marca: limpiarTextoSimple(e.currentTarget.value, 80) })}
                />
                <TipoPiezaSelect
                  size="xs" value={a.tipo_pieza_id}
                  onChange={(v) => onChange({ tipo_pieza_id: v })}
                />
              </Group>
            )}
            {pideContenido(c) && (
              <NumberInput
                size="xs" w={280} disabled={bloqueado}
                label={`¿Cuántos ${unidad} trae cada pieza?`}
                description="El aceite viene en litros y se guarda por bote: 0.6 para uno de 600 ml"
                min={0.001} decimalScale={3} step={0.5}
                value={a.contenido}
                onChange={(v) => onChange({ contenido: v })}
                error={piezas === null ? 'Las piezas no salen enteras' : undefined}
              />
            )}
            {piezas !== null && (
              <Text size="xs" c="dimmed">
                Entran {piezas} pieza{piezas === 1 ? '' : 's'} a {formatMXN(Math.round((neto / piezas) * 100) / 100)}
                {lista ? ' de lista' : ' (ya descontado)'} cada una.
              </Text>
            )}
          </>
        )}
        {a.tipo === 'mano_obra' && (
          <Text size="xs" c="dimmed">
            Va a la mano de obra de la factura, por ligar a su mantenimiento en el cuadre.
          </Text>
        )}
        {a.tipo === 'cargo' && (
          <Text size="xs" c="dimmed">
            Gasto sin lote (un casco, un flete): cuenta en el total de la factura, no entra al almacén.
          </Text>
        )}
      </Stack>
    </Paper>
  )
}
