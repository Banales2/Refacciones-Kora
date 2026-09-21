// Facturas de taller: comprobar que la mano de obra está bien capturada.
//
// ESTO SOLO RASTREA MANO DE OBRA. Si el taller también cobra refacciones, esas
// van por la factura de refacciones —lotes, existencias, sucursal— porque son
// mercancía que entra al almacén y la mano de obra no es nada de eso.
//
// PERO ES EL MISMO PAPEL, y de ahí sale todo el diseño de esta pantalla. El
// taller cobra las dos cosas en un documento con un folio, un IVA y un
// descuento. Si la mano de obra tuviera su propia cabecera, el mismo folio
// quedaría partido en dos filas con la tasa capturada dos veces y "cuánto cobra
// este papel" dejaría de tener una respuesta — es la enfermedad que curó la
// migración 026. Así que no hay una tabla de facturas de mantenimiento: hay una
// factura con dos clases de renglón, y esta pantalla es la vista de las que
// cobran trabajo. Una factura mixta sale aquí y en Refacciones, porque es un solo
// documento que cobra las dos cosas.
//
// POR QUÉ SE PARECE A GASOLINA Y NO A REFACCIONES. Un mantenimiento existe
// independientemente de que el taller haya emitido su papel: se captura cuando el
// camión vuelve del taller, igual que una recarga existe sin factura. De ahí las
// dos cosas que esta pantalla puede tener y la de refacciones no:
//
//   - La pestaña de servicios SIN FACTURAR. Se detecta sola. Allá la factura
//     entera que nadie capturó es invisible y hubo que inventarle un botón.
//   - El renglón se cuelga de un servicio concreto que una persona elige, no de
//     una descripción que haya que adivinar.
//
// LO QUE LA PANTALLA EXISTE PARA ENCONTRAR: el cobro de mano de obra que no casa
// con ningún servicio registrado —trabajo que el taller cobra y nadie capturó, o
// que no hizo— y el servicio capturado con un costo distinto del que cobra el
// papel.
//
// Ver `docs/facturas-de-mantenimiento.md`.
import { useState } from 'react'
import {
  Alert, Badge, Button, Card, Center, Group, Loader, Modal, NumberInput,
  Pagination, Stack, Switch, Table, Tabs, Text, TextInput, Tooltip,
} from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import {
  IconAlertTriangle, IconPlus, IconScale, IconSearch,
} from '@tabler/icons-react'
import {
  useCrearFacturaTaller, useMantenimientosSinFacturar,
} from '../hooks/useFacturasMantenimiento'
import { useFacturas } from '../hooks/useFacturas'
import type { Factura } from '../hooks/useFacturas'
import { useTecnicos } from '../hooks/useTecnicos'
import { useAuth } from '../hooks/useAuth'
import { useUsuarioActual } from '../hooks/useUsuarioActual'
import CuadreFacturaModal from '../components/CuadreFactura'
import { EstadoRevision } from '../components/RevisionFactura'
import { SelectCatalogo } from '../components/SelectCatalogo'
import { FechaInput } from '../components/FechaInput'
import { formatMXN, formatFecha } from '../lib/formato'
import { IVA_DEFAULT, DESCUENTO_DEFAULT, totalesFactura } from '../lib/totales'
import { limpiarFolio, normalizarFolio } from '../lib/validaciones'
import { hoyIso } from '../lib/fechas'

const PAGE_SIZE = 15
// Más alto que el de facturas: esta lista se recorre buscando lo viejo, no se
// abre renglón por renglón.
const SIN_FACTURAR_PAGE_SIZE = 50

/**
 * A partir de cuántos días un servicio sin facturar deja de ser normal.
 *
 * No es una regla del negocio, es una señal: por debajo de esto el papel
 * simplemente viene en camino, y por encima es algo que preguntar. El mismo
 * criterio y el mismo número que en gasolina.
 */
const DIAS_PARA_PREOCUPARSE = 30

// ── El alta ──────────────────────────────────────────────────────────────────

/**
 * Dar de alta la factura de un taller.
 *
 * SE PIDE EL TALLER, NO EL PROVEEDOR. Que por debajo la factura cuelgue de un
 * proveedor es una consecuencia del modelo —su llave es (proveedor, folio), y
 * tiene que serlo porque el mismo papel puede cobrar refacciones— y no algo que
 * quien captura tenga que aprender. El proveedor del taller se resuelve en el
 * servidor y se crea la primera vez que ese taller factura.
 *
 * Si el taller ya tiene ese folio, la API devuelve la factura que existía en vez
 * de fallar y aquí se abre su cuadre. Es el caso normal del papel mixto: sus
 * refacciones ya se capturaron como compra, y lo que falta es la mano de obra.
 */
function NuevaFacturaModal({
  abierto, onClose, onLista,
}: {
  abierto: boolean
  onClose: () => void
  onLista: (id: number, folio: string) => void
}) {
  const talleres = useTecnicos()
  const { data: usuario } = useUsuarioActual()
  const crear = useCrearFacturaTaller()

  const [tecnico, setTecnico] = useState<string | null>(null)
  const [folio, setFolio] = useState('')
  const [fecha, setFecha] = useState(hoyIso())
  const [sumarIva, setSumarIva] = useState(true)
  const [tasa, setTasa] = useState<number | string>(IVA_DEFAULT)
  const [conDescuento, setConDescuento] = useState(false)
  const [descuento, setDescuento] = useState<number | string>(DESCUENTO_DEFAULT)
  const [autorizo, setAutorizo] = useState('')

  const folioLimpio = normalizarFolio(folio)
  const quienAutorizo = autorizo.trim() || usuario?.data.nombre || ''
  const listo = tecnico !== null && folioLimpio !== '' && fecha !== '' && quienAutorizo !== ''

  function guardar() {
    if (!listo) return
    crear.mutate(
      {
        tecnico_id: Number(tecnico),
        num_factura: folioLimpio,
        fecha_compra: fecha,
        tasa_iva: sumarIva ? Number(tasa) : null,
        descuento_pct: conDescuento ? Number(descuento) : null,
        comprado_por: quienAutorizo,
      },
      {
        onSuccess: (r) => {
          onClose()
          onLista(r.data.id, folioLimpio)
        },
      },
    )
  }

  return (
    <Modal
      opened={abierto}
      onClose={onClose}
      title={<Text fw={700}>Factura de taller</Text>}
      size="lg"
    >
      <Stack gap="sm">
        <Text size="xs" c="dimmed">
          Solo la cabecera. Los servicios que cobra se le cuelgan al cuadrarla contra
          el papel, y si también trae refacciones esas entran por el alta de compra
          con el mismo folio — van a caer en esta misma factura.
        </Text>

        <SelectCatalogo
          label="Taller" nombre="talleres" estado={talleres}
          placeholder="Quién hizo el trabajo…"
          data={(talleres.data?.data ?? []).map((t) => ({
            value: String(t.id), label: t.nombre,
          }))}
          value={tecnico} onChange={setTecnico}
        />

        <Group grow align="flex-start">
          <TextInput
            label="Folio de la factura" required
            placeholder="A-1234"
            value={folio}
            onChange={(e) => setFolio(limpiarFolio(e.currentTarget.value, 30))}
          />
          <FechaInput label="Fecha de la factura" value={fecha} onChange={setFecha} />
        </Group>

        <TextInput
          label="Quién autorizó el trabajo"
          description="Según el papel. Por omisión, quien está capturando."
          placeholder={usuario?.data.nombre ?? ''}
          value={autorizo}
          onChange={(e) => setAutorizo(e.currentTarget.value.slice(0, 120))}
        />

        <Group gap="md" align="flex-start" wrap="nowrap">
          <Switch
            label="Sumar IVA al total"
            description="Actívalo si los importes del papel son subtotal. Apagado, se toman como precio final."
            checked={sumarIva}
            onChange={(e) => setSumarIva(e.currentTarget.checked)}
          />
          {sumarIva && (
            <NumberInput
              label="Tasa" size="xs" w={110}
              min={0.01} max={100} clampBehavior="strict" decimalScale={2} suffix="%"
              value={tasa} onChange={setTasa}
            />
          )}
        </Group>

        <Group gap="md" align="flex-start" wrap="nowrap">
          <Switch
            label="Descuento del taller"
            description="Se resta del subtotal antes del IVA."
            checked={conDescuento}
            onChange={(e) => setConDescuento(e.currentTarget.checked)}
          />
          {conDescuento && (
            <NumberInput
              label="Descuento" size="xs" w={110}
              min={0.01} max={99.99} clampBehavior="strict" decimalScale={2} suffix="%"
              value={descuento} onChange={setDescuento}
            />
          )}
        </Group>

        {crear.error && (
          <Alert color="red" title="No se pudo dar de alta">
            {(crear.error as Error).message}
          </Alert>
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Cancelar</Button>
          <Button disabled={!listo} loading={crear.isPending} onClick={guardar}>
            Dar de alta y cuadrar
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}

// ── Las facturas ─────────────────────────────────────────────────────────────

function FacturasPanel({ esAdmin }: { esAdmin: boolean }) {
  const [search, setSearch] = useState('')
  const [debounced] = useDebouncedValue(search, 300)
  const [porRevisar, setPorRevisar] = useState(false)
  const [page, setPage] = useState(1)
  const [nueva, setNueva] = useState(false)
  const [cuadrando, setCuadrando] = useState<{ id: number; folio: string } | null>(null)

  const { data, isLoading, isError } = useFacturas({
    page, pageSize: PAGE_SIZE,
    search: debounced || undefined,
    por_revisar: porRevisar || undefined,
    con_mano_obra: true,
  })

  const facturas = data?.data ?? []
  const total = data?.pagination.total ?? 0
  const paginas = Math.ceil(total / PAGE_SIZE)

  function filtrar(fn: () => void) { fn(); setPage(1) }

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end">
        <TextInput
          placeholder="Buscar por folio o taller…"
          leftSection={<IconSearch size={16} />}
          style={{ flex: 1, maxWidth: 360 }}
          value={search}
          onChange={(e) => filtrar(() => setSearch(e.currentTarget.value))}
        />
        {esAdmin && (
          <Button leftSection={<IconPlus size={16} />} onClick={() => setNueva(true)}>
            Factura de taller
          </Button>
        )}
      </Group>

      <Switch
        size="xs"
        label="Solo las que faltan por cuadrar"
        checked={porRevisar}
        onChange={(e) => filtrar(() => setPorRevisar(e.currentTarget.checked))}
      />

      {isError ? (
        <Alert color="red" title="Error">No se pudieron cargar las facturas.</Alert>
      ) : isLoading ? (
        <Center py="xl"><Loader /></Center>
      ) : !facturas.length ? (
        <Center py="xl">
          <Stack gap={4} align="center">
            <Text c="dimmed">
              {debounced || porRevisar
                ? 'Ninguna factura de taller coincide con el filtro.'
                : 'Todavía no hay facturas de taller.'}
            </Text>
            {!debounced && !porRevisar && (
              <Text size="xs" c="dimmed" maw={420} ta="center">
                Una factura aparece aquí en cuanto se le captura mano de obra. Si el
                taller ya te facturó refacciones, su factura existe: ábrela desde
                Refacciones y cuádrale el trabajo.
              </Text>
            )}
          </Stack>
        </Center>
      ) : (
        <>
          <Text size="xs" c="dimmed">{total} factura{total === 1 ? '' : 's'}</Text>
          <Table.ScrollContainer minWidth={720}>
            <Table withTableBorder striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Folio</Table.Th>
                  <Table.Th>Taller</Table.Th>
                  <Table.Th>Fecha</Table.Th>
                  <Table.Th style={{ textAlign: 'center' }}>Servicios</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Mano de obra</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Total del papel</Table.Th>
                  <Table.Th w={130} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {facturas.map((f: Factura) => (
                  <Table.Tr key={f.id}>
                    <Table.Td>
                      <Group gap={6} wrap="nowrap">
                        <Text size="sm" fw={600}>{f.num_factura}</Text>
                        <EstadoRevision factura={f} />
                      </Group>
                    </Table.Td>
                    <Table.Td>{f.proveedor}</Table.Td>
                    <Table.Td c="dimmed">{formatFecha(f.fecha_compra)}</Table.Td>
                    <Table.Td style={{ textAlign: 'center' }}>{f.mano_obra}</Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>
                      {formatMXN(f.subtotal_mano_obra)}
                    </Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>
                      <Text size="sm" fw={600}>
                        {formatMXN(totalesFactura(f.subtotal, f.descuento_pct, f.tasa_iva).total)}
                      </Text>
                      {/* El papel mixto cobra las dos cosas, así que su total no
                          es solo la mano de obra. Decirlo evita leer el número
                          como si lo fuera. */}
                      {f.renglones > 0 && (
                        <Tooltip label={`También cobra ${f.renglones} renglón${f.renglones === 1 ? '' : 'es'} de refacciones`}>
                          <Text size="xs" c="dimmed">+ refacciones</Text>
                        </Tooltip>
                      )}
                    </Table.Td>
                    <Table.Td>
                      {esAdmin && (
                        <Button
                          size="compact-xs" variant="light"
                          leftSection={<IconScale size={13} />}
                          onClick={() => setCuadrando({ id: f.id, folio: f.num_factura })}
                        >
                          {f.cerrada ? 'Ver el cuadre' : 'Cuadrar'}
                        </Button>
                      )}
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

      <NuevaFacturaModal
        abierto={nueva}
        onClose={() => setNueva(false)}
        onLista={(id, folio) => setCuadrando({ id, folio })}
      />

      <CuadreFacturaModal
        facturaId={cuadrando?.id ?? null}
        folio={cuadrando?.folio ?? ''}
        onClose={() => setCuadrando(null)}
      />
    </Stack>
  )
}

// ── Los servicios sin facturar ───────────────────────────────────────────────

/**
 * El reverso del cuadre: lo que está capturado y el taller no ha cobrado.
 *
 * Existe porque aquí sí se puede. Un servicio se registra cuando el camión vuelve
 * del taller, exista o no el papel, así que la ausencia de factura se detecta
 * sola — en refacciones un lote no existe hasta que alguien captura la compra, y
 * por eso allá hizo falta un botón para la factura que nadie había visto.
 */
function SinFacturarPanel() {
  const [search, setSearch] = useState('')
  const [debounced] = useDebouncedValue(search, 300)
  const [tecnico, setTecnico] = useState<string | null>(null)
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [page, setPage] = useState(1)

  const talleres = useTecnicos()
  const { data, isLoading, isError } = useMantenimientosSinFacturar({
    page, pageSize: SIN_FACTURAR_PAGE_SIZE,
    search: debounced || undefined,
    tecnico_id: tecnico ? Number(tecnico) : undefined,
    desde: desde || undefined,
    hasta: hasta || undefined,
  })

  const filas = data?.data ?? []
  const total = data?.pagination.total ?? 0
  const paginas = Math.ceil(total / SIN_FACTURAR_PAGE_SIZE)
  const viejos = filas.filter((m) => (m.dias ?? 0) > DIAS_PARA_PREOCUPARSE).length

  function filtrar(fn: () => void) { fn(); setPage(1) }

  return (
    <Stack gap="md">
      <Text size="sm" c="dimmed">
        Servicios con costo de mano de obra que ninguna factura cobra todavía. Que el
        papel llegue después del trabajo es normal; que lleve meses sin llegar, no.
      </Text>

      <Group grow align="flex-start">
        <TextInput
          placeholder="Buscar por unidad, taller o tipo…"
          leftSection={<IconSearch size={16} />}
          value={search}
          onChange={(e) => filtrar(() => setSearch(e.currentTarget.value))}
        />
        <SelectCatalogo
          nombre="talleres" estado={talleres} placeholder="Todos los talleres"
          clearable
          data={(talleres.data?.data ?? []).map((t) => ({
            value: String(t.id), label: t.nombre,
          }))}
          value={tecnico}
          onChange={(v) => filtrar(() => setTecnico(v))}
        />
      </Group>
      <Group grow>
        <FechaInput label="Desde" clearable value={desde}
          onChange={(d) => filtrar(() => setDesde(d))} />
        <FechaInput label="Hasta" clearable value={hasta}
          onChange={(d) => filtrar(() => setHasta(d))} />
      </Group>

      {isError ? (
        <Alert color="red" title="Error">No se pudo cargar la lista.</Alert>
      ) : isLoading ? (
        <Center py="xl"><Loader /></Center>
      ) : (
        <>
          <Group gap="sm">
            <Card withBorder padding="xs" style={{ flex: 1, minWidth: 140 }}>
              <Text size="xs" c="dimmed">Servicios sin factura</Text>
              <Text size="lg" fw={700}>{total}</Text>
            </Card>
            <Card withBorder padding="xs" style={{ flex: 1, minWidth: 160 }}>
              <Text size="xs" c="dimmed">Mano de obra sin facturar</Text>
              <Text size="lg" fw={700}>{formatMXN(data?.costo_total ?? 0)}</Text>
            </Card>
            {viejos > 0 && (
              <Card
                withBorder padding="xs" style={{ flex: 1, minWidth: 160 }}
                bg="var(--mantine-color-orange-light)"
              >
                <Text size="xs" c="dimmed">
                  Con más de {DIAS_PARA_PREOCUPARSE} días
                </Text>
                <Text size="lg" fw={700}>{viejos}</Text>
                <Text size="xs" c="dimmed">en esta página</Text>
              </Card>
            )}
          </Group>

          {!filas.length ? (
            <Center py="xl">
              <Text c="dimmed">
                {debounced || tecnico || desde || hasta
                  ? 'Nada coincide con el filtro.'
                  : 'Todos los servicios con costo están facturados.'}
              </Text>
            </Center>
          ) : (
            <Table.ScrollContainer minWidth={640}>
              <Table withTableBorder striped>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Unidad</Table.Th>
                    <Table.Th>Taller</Table.Th>
                    <Table.Th>Fecha</Table.Th>
                    <Table.Th>Tipo</Table.Th>
                    <Table.Th style={{ textAlign: 'right' }}>Mano de obra</Table.Th>
                    <Table.Th style={{ textAlign: 'right' }}>Espera</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {filas.map((m) => {
                    const viejo = (m.dias ?? 0) > DIAS_PARA_PREOCUPARSE
                    return (
                      <Table.Tr key={m.id}>
                        <Table.Td><Text size="sm">{m.vehiculo}</Text></Table.Td>
                        <Table.Td c="dimmed">{m.taller ?? '—'}</Table.Td>
                        <Table.Td c="dimmed">
                          {m.fecha ? formatFecha(m.fecha) : '—'}
                        </Table.Td>
                        <Table.Td c="dimmed">{m.tipo ?? '—'}</Table.Td>
                        <Table.Td style={{ textAlign: 'right' }}>
                          {formatMXN(m.costo)}
                        </Table.Td>
                        <Table.Td style={{ textAlign: 'right' }}>
                          {m.dias === null ? (
                            <Text size="xs" c="dimmed">—</Text>
                          ) : viejo ? (
                            <Tooltip label="Lleva demasiado tiempo esperando su factura">
                              <Badge
                                size="sm" variant="light" color="orange"
                                leftSection={<IconAlertTriangle size={11} />}
                              >
                                {m.dias} días
                              </Badge>
                            </Tooltip>
                          ) : (
                            <Text size="xs" c="dimmed">{m.dias} días</Text>
                          )}
                        </Table.Td>
                      </Table.Tr>
                    )
                  })}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )}

          {paginas > 1 && (
            <Group justify="center">
              <Pagination value={page} onChange={setPage} total={paginas} />
            </Group>
          )}
        </>
      )}
    </Stack>
  )
}

// ── La pantalla ──────────────────────────────────────────────────────────────

export default function FacturasMantenimientos() {
  // Cuadrar es cosa de admin: es el segundo par de ojos, y que lo haga cualquiera
  // con permiso de captura lo vacía de sentido. La API lo impone igual con
  // `requireRole(req, 'admin')`; esto solo evita enseñar botones que dan 403.
  const { user } = useAuth()
  const esAdmin = user?.userRoles.includes('admin') ?? false

  return (
    <Stack gap="md">
      <div>
        <Text fw={700} size="lg">Facturas de taller</Text>
        <Text size="sm" c="dimmed">
          Aquí se rastrea la mano de obra. Si el taller también cobra refacciones,
          esas entran por la factura de refacciones —son mercancía que va al
          almacén— pero el papel es el mismo: una sola factura con las dos cosas,
          un folio y un IVA.
        </Text>
      </div>

      <Tabs defaultValue="facturas">
        <Tabs.List>
          <Tabs.Tab value="facturas">Facturas</Tabs.Tab>
          <Tabs.Tab value="sin-facturar">Servicios sin factura</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="facturas" pt="md">
          <FacturasPanel esAdmin={esAdmin} />
        </Tabs.Panel>

        <Tabs.Panel value="sin-facturar" pt="md">
          <SinFacturarPanel />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  )
}
