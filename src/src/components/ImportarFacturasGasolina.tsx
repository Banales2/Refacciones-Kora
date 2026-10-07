// Importar facturas de gasolinera de sus XML, varias a la vez.
//
// Cada XML se lee en el navegador (`lib/xmlGasolina.ts`) y se enseña antes de
// guardar: de qué gasolinera es, folio, renglones y si las sumas cuadran. La
// API vuelve a comprobarlo todo.
//
// LA GASOLINERA SE RECONOCE POR EL PERMISO de la estación (migración 066). La
// primera vez que llega una de una estación nueva, aquí se elige de cuál
// gasolinera del catálogo es, y el permiso se le queda: la próxima ya no
// pregunta. No se adivina por el nombre: "GASOLINERA DAKOTA DE OCCIDENTE" en el
// CFDI puede estar dada de alta como "Dakota Periférico".
import { useState } from 'react'
import {
  Alert, Badge, Button, FileInput, Group, Modal, Select, Stack, Table, Text, Tooltip,
} from '@mantine/core'
import { IconCheck, IconFileImport } from '@tabler/icons-react'
import { useImportarFacturaGasolina } from '../hooks/useFacturasGasolina'
import { useGasolineras } from '../hooks/useGasolineras'
import { formatFecha, formatMXN } from '../lib/formato'
import { leerFacturaGasolina, XmlGasolinaError } from '../lib/xmlGasolina'
import type { FacturaGasolinaXml } from '../lib/xmlGasolina'

interface Archivo {
  nombre: string
  factura: FacturaGasolinaXml | null
  /** Por qué no se puede importar: no se leyó, o no cuadra. */
  error: string | null
  estado: 'pendiente' | 'importando' | 'importada' | 'rechazada'
  mensaje: string | null
}

/** Que los renglones sumen lo impreso, al centavo. La API lo vuelve a revisar. */
function descuadre(f: FacturaGasolinaXml): string | null {
  const c = (n: number) => Math.round(n * 100) / 100
  const imp = c(f.renglones.reduce((s, r) => s + r.importe, 0))
  const iva = c(f.renglones.reduce((s, r) => s + r.iva, 0))
  if (Math.abs(imp - f.subtotal) > 0.01) return `Los renglones suman ${formatMXN(imp)} y el subtotal dice ${formatMXN(f.subtotal)}.`
  if (Math.abs(iva - f.iva) > 0.01) return `El IVA de los renglones suma ${formatMXN(iva)} y la factura dice ${formatMXN(f.iva)}.`
  if (Math.abs(c(f.subtotal + f.iva) - f.total) > 0.01) return 'Subtotal más IVA no da el total.'
  return null
}

export default function ImportarFacturasGasolina({
  abierto, onClose,
}: {
  abierto: boolean
  onClose: () => void
}) {
  const { data: gasData } = useGasolineras()
  const importar = useImportarFacturaGasolina()
  const [archivos, setArchivos] = useState<Archivo[]>([])
  // permiso → gasolinera elegida. Por permiso y no por archivo: dos facturas de
  // la misma estación nueva se resuelven con una sola elección.
  const [eleccion, setEleccion] = useState<Record<string, string | null>>({})
  const [trabajando, setTrabajando] = useState(false)

  const gasolineras = gasData?.data ?? []
  const porPermiso = new Map(
    gasolineras.filter((g) => g.permiso_cre).map((g) => [g.permiso_cre!, g]),
  )
  // Solo se ofrecen las que no tienen permiso: una que ya tiene es otra estación.
  const libres = gasolineras
    .filter((g) => !g.permiso_cre)
    .map((g) => ({ value: String(g.id), label: g.nombre }))

  async function elegir(files: File[]) {
    const leidos = await Promise.all(files.map(async (f): Promise<Archivo> => {
      try {
        const factura = leerFacturaGasolina(await f.text())
        return { nombre: f.name, factura, error: descuadre(factura), estado: 'pendiente', mensaje: null }
      } catch (e) {
        const error = e instanceof XmlGasolinaError ? e.message : 'No se pudo leer el archivo.'
        return { nombre: f.name, factura: null, error, estado: 'pendiente', mensaje: null }
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
    setEleccion({})
    importar.reset()
    onClose()
  }

  const gasolineraDe = (f: FacturaGasolinaXml) => porPermiso.get(f.permiso_cre) ?? null
  const lista = (a: Archivo) => a.factura !== null && a.error === null && a.estado !== 'importada'
    && (gasolineraDe(a.factura) !== null || !!eleccion[a.factura.permiso_cre])
  const listas = archivos.filter(lista)
  const sinGasolinera = archivos.filter(
    (a) => a.factura && !a.error && !gasolineraDe(a.factura) && !eleccion[a.factura.permiso_cre],
  ).length

  async function importarTodas() {
    setTrabajando(true)
    // Una por una: la primera de una estación nueva le liga el permiso a su
    // gasolinera, y la siguiente de esa estación ya se reconoce sola.
    for (const a of listas) {
      const f = a.factura!
      setArchivos((p) => p.map((x) => x.nombre === a.nombre ? { ...x, estado: 'importando' } : x))
      try {
        const conocida = gasolineraDe(f)
        const r = await importar.mutateAsync({
          factura: f,
          gasolinera_id: conocida ? undefined : Number(eleccion[f.permiso_cre]),
        })
        setArchivos((p) => p.map((x) => x.nombre === a.nombre
          ? { ...x, estado: 'importada', mensaje: `Importada a ${r.data.gasolinera}` }
          : x))
      } catch (e) {
        setArchivos((p) => p.map((x) => x.nombre === a.nombre
          ? { ...x, estado: 'rechazada', mensaje: (e as Error).message }
          : x))
      }
    }
    setTrabajando(false)
  }

  return (
    <Modal
      opened={abierto} onClose={cerrar} size="xl"
      title={<Text fw={700}>Importar facturas de gasolinera</Text>}
    >
      <Stack gap="sm">
        <Text size="xs" c="dimmed">
          Los XML de las facturas, uno o varios. Cada uno se lee y se enseña antes de
          guardar; después se concilian igual que las capturadas a mano.
        </Text>

        <FileInput
          multiple clearable label="Archivos XML" placeholder="Elige los .xml"
          accept=".xml,application/xml,text/xml"
          leftSection={<IconFileImport size={16} />}
          onChange={(fs) => void elegir(fs ?? [])}
          disabled={trabajando}
        />

        {archivos.length > 0 && (
          <Table.ScrollContainer minWidth={760}>
            <Table withTableBorder striped>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Gasolinera</Table.Th>
                  <Table.Th>Folio</Table.Th>
                  <Table.Th style={{ textAlign: 'center' }}>Renglones</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Total</Table.Th>
                  <Table.Th w={180}>Estado</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {archivos.map((a) => {
                  const f = a.factura
                  const conocida = f ? gasolineraDe(f) : null
                  return (
                    <Table.Tr key={a.nombre}>
                      <Table.Td>
                        {!f ? (
                          <Text size="sm" c="dimmed">{a.nombre}</Text>
                        ) : conocida ? (
                          <>
                            <Text size="sm" fw={500}>{conocida.nombre}</Text>
                            <Text size="xs" c="dimmed">{f.emisor_nombre}</Text>
                          </>
                        ) : (
                          <Stack gap={2}>
                            <Text size="xs" c="dimmed">
                              {f.emisor_nombre} · <Text component="span" ff="monospace" size="xs">{f.permiso_cre}</Text>
                            </Text>
                            <Select
                              size="xs" placeholder="¿De cuál gasolinera es?"
                              data={libres} searchable
                              disabled={trabajando || a.estado === 'importada'}
                              value={eleccion[f.permiso_cre] ?? null}
                              onChange={(v) => setEleccion((p) => ({ ...p, [f.permiso_cre]: v }))}
                              nothingFoundMessage="Todas tienen permiso: da de alta la gasolinera en Catálogos"
                            />
                          </Stack>
                        )}
                      </Table.Td>
                      <Table.Td>
                        {f && (
                          <>
                            <Text size="sm">{f.serie ? `${f.serie}-` : ''}{f.folio}</Text>
                            <Text size="xs" c="dimmed">{formatFecha(f.fecha)}</Text>
                          </>
                        )}
                      </Table.Td>
                      <Table.Td style={{ textAlign: 'center' }}>{f?.renglones.length ?? '—'}</Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>
                        {f && (
                          <>
                            <Text size="sm" fw={600}>{formatMXN(f.total)}</Text>
                            <Text size="xs" c="dimmed">IVA {formatMXN(f.iva)}</Text>
                          </>
                        )}
                      </Table.Td>
                      <Table.Td>
                        {a.error ? (
                          <Text size="xs" c="red">{a.error}</Text>
                        ) : a.estado === 'importada' ? (
                          <Badge size="sm" color="green" variant="light" leftSection={<IconCheck size={11} />}>
                            {a.mensaje}
                          </Badge>
                        ) : a.estado === 'rechazada' ? (
                          <Text size="xs" c="red">{a.mensaje}</Text>
                        ) : a.estado === 'importando' ? (
                          <Text size="xs" c="dimmed">Importando…</Text>
                        ) : (
                          <Tooltip label="Los renglones suman lo que dice la factura">
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

        {sinGasolinera > 0 && (
          <Alert color="blue" variant="light">
            {sinGasolinera} factura(s) son de una estación que todavía no está ligada a
            ninguna gasolinera. Elige de cuál es: se le queda, y las siguientes ya se
            reconocen solas.
          </Alert>
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
