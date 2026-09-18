// Facturas de gasolinera: casar cada ticket del papel con su recarga.
//
// POR QUÉ NO SE PARECE A LA PANTALLA DE FACTURAS DE REFACCIONES. Allá cada
// renglón del papel apunta a un lote concreto y se verifican uno a uno. Aquí la
// factura trae un renglón por ticket —litros, precio, importe— pero NO dice a
// qué vehículo fue, qué chofer la hizo ni contra qué vale: eso solo lo sabe el
// sistema. Conciliar no es verificar, es EMPAREJAR.
//
// SE EMPAREJA POR LITROS, NO POR IMPORTE. El importe del renglón viene sin IVA
// (los renglones suman el subtotal, no el total) y el costo de la recarga es lo
// que se pagó en la bomba, que sí lo incluye. Compararlos da 16% de diferencia
// siempre. Los litros son el mismo número de los dos lados, y con tres decimales
// prácticamente no se repiten.
//
// LO QUE LA PANTALLA EXISTE PARA ENCONTRAR: el ticket del papel que no casa con
// ninguna recarga. Eso es una carga que la gasolinera está cobrando y que nadie
// capturó — y a diferencia de un descuadre de dinero, se puede ir a preguntar
// por ella: "el ticket 8368392, de 57.91 litros".
//
// Ver `docs/facturas-de-gasolina.md`.
import { useState } from 'react'
import {
  Alert, Badge, Button, Card, Center, Group, Loader, Modal, NumberInput,
  Pagination, Select, Stack, Switch, Table, Text, Textarea, TextInput, Tooltip,
} from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import {
  IconAlertTriangle, IconCheck, IconLockOpen, IconPlus, IconSearch, IconTrash,
} from '@tabler/icons-react'
import {
  useCandidatas, useConciliar, useCrearFacturaGasolina, useFacturasGasolina,
  useReabrirFacturaGasolina, RENGLONES_SIN_CASAR,
} from '../hooks/useFacturasGasolina'
import type {
  Candidatas, FacturaGasolina, MetodoCasado, RecargaCandidata,
} from '../hooks/useFacturasGasolina'
import { useGasolineras } from '../hooks/useGasolineras'
import { useAuth } from '../hooks/useAuth'
import { SelectCatalogo } from '../components/SelectCatalogo'
import { FechaInput } from '../components/FechaInput'
import { ApiError } from '../lib/api'
import { formatMXN, formatFecha } from '../lib/formato'
import { leerRenglonesPegados } from '../lib/ticketsFactura'
import type { RenglonPegado } from '../lib/ticketsFactura'

const PAGE_SIZE = 15

/** Los importes se comparan en centavos; los litros, en milésimas. */
const EPSILON = 0.01

function EstadoFactura({ f }: { f: FacturaGasolina }) {
  if (f.conciliada_en === null) {
    return <Badge size="xs" variant="light" color="gray">Por conciliar</Badge>
  }
  const faltan = f.renglones - f.casados
  if (faltan === 0) {
    return (
      <Badge size="xs" variant="light" color="green" leftSection={<IconCheck size={11} />}>
        Cuadrada
      </Badge>
    )
  }
  return (
    <Tooltip label="Tickets que la gasolinera cobra y que nadie capturó">
      <Badge size="xs" variant="light" color="orange">
        {faltan} sin capturar
      </Badge>
    </Tooltip>
  )
}

const COLOR_METODO: Record<MetodoCasado, string> = {
  ticket: 'green',
  litros: 'blue',
  manual: 'grape',
}

const AYUDA_METODO: Record<MetodoCasado, string> = {
  ticket: 'Casó por número de ticket: es el mismo papel, no hay nada que inferir',
  litros: 'Casó por litros exactos, a la milésima',
  manual: 'Lo emparejó una persona',
}

// ── Alta de la factura ───────────────────────────────────────────────────────

function NuevaFacturaModal({ abierto, onClose }: { abierto: boolean; onClose: () => void }) {
  const gasolineras = useGasolineras()
  const [gasolineraId, setGasolineraId] = useState<string | null>(null)
  const [serie, setSerie] = useState('')
  const [folio, setFolio] = useState('')
  const [fecha, setFecha] = useState('')
  const [iva, setIva] = useState<number | string>('')
  const [total, setTotal] = useState<number | string>('')
  const [uuid, setUuid] = useState('')
  const [pegado, setPegado] = useState('')
  const [renglones, setRenglones] = useState<RenglonPegado[]>([])
  const [erroresPegado, setErroresPegado] = useState<{ linea: number; texto: string }[]>([])
  const mut = useCrearFacturaGasolina()

  // El subtotal NO se teclea: es la suma de los renglones. Pedirlo aparte solo
  // crea la oportunidad de que discrepe de lo capturado, y el servidor rechaza
  // justamente esa discrepancia.
  const subtotal = renglones.reduce((s, r) => s + r.importe, 0)

  function pegar() {
    const { renglones: leidos, errores } = leerRenglonesPegados(pegado)
    setRenglones((prev) => [...prev, ...leidos])
    setErroresPegado(errores)
    if (errores.length === 0) setPegado('')
  }

  const invalido = !gasolineraId || folio.trim() === '' || !fecha
    || renglones.length === 0 || !(Number(total) > 0)

  function guardar() {
    mut.mutate(
      {
        gasolinera_id: Number(gasolineraId),
        serie: serie.trim() || null,
        folio: folio.trim(),
        fecha,
        subtotal: Math.round(subtotal * 100) / 100,
        iva: Number(iva) || 0,
        total: Number(total),
        uuid: uuid.trim() || null,
        renglones,
      },
      {
        onSuccess: () => {
          setGasolineraId(null); setSerie(''); setFolio(''); setFecha('')
          setIva(''); setTotal(''); setUuid(''); setPegado('')
          setRenglones([]); setErroresPegado([])
          onClose()
        },
      },
    )
  }

  return (
    <Modal opened={abierto} onClose={onClose} size="xl" title="Nueva factura de gasolinera">
      <Stack gap="sm">
        <Group grow align="flex-start">
          <SelectCatalogo
            label="Gasolinera" nombre="gasolineras" estado={gasolineras}
            data={(gasolineras.data?.data ?? []).map((g) => ({
              value: String(g.id), label: g.nombre,
            }))}
            value={gasolineraId} onChange={setGasolineraId}
          />
          <TextInput
            label="Serie" placeholder="G" maxLength={10}
            value={serie} onChange={(e) => setSerie(e.currentTarget.value)}
          />
          <TextInput
            label="Folio" placeholder="44272" maxLength={30}
            value={folio} onChange={(e) => setFolio(e.currentTarget.value)}
          />
        </Group>

        <Group grow align="flex-start">
          {/* La fecha es el corte: solo se ofrecen recargas de ese día hacia
              atrás, así que equivocarse aquí esconde cargas que sí entraban. */}
          <FechaInput
            label="Fecha de la factura"
            description="Es el corte del cuadre"
            value={fecha} onChange={setFecha}
          />
          <NumberInput
            label="IVA" min={0} decimalScale={2} prefix="$" thousandSeparator=","
            value={iva} onChange={setIva}
          />
          <NumberInput
            label="Total" min={0} decimalScale={2} prefix="$" thousandSeparator=","
            value={total} onChange={setTotal}
          />
        </Group>

        <TextInput
          label="UUID del CFDI (opcional)"
          description="Es lo que detecta la misma factura capturada dos veces"
          maxLength={36}
          value={uuid} onChange={(e) => setUuid(e.currentTarget.value)}
        />

        <Textarea
          label="Pegar los tickets"
          description="Un renglón por ticket. Se leen los números por posición: litros, precio y importe."
          autosize minRows={3} maxRows={8}
          placeholder={'PL/6809/EXP/ES/2015-8367437  DIESEL  LTR  219.37  23.33  5119.10'}
          value={pegado} onChange={(e) => setPegado(e.currentTarget.value)}
        />
        <Group>
          <Button size="xs" variant="light" disabled={!pegado.trim()} onClick={pegar}>
            Leer renglones
          </Button>
          <Button
            size="xs" variant="subtle"
            onClick={() => setRenglones((p) => [
              ...p, { ticket: null, producto: null, litros: 0, precio_unitario: null, importe: 0 },
            ])}
          >
            Agregar uno a mano
          </Button>
        </Group>

        {erroresPegado.length > 0 && (
          <Alert color="yellow" variant="light" icon={<IconAlertTriangle size={16} />}>
            <Text size="sm">
              No se pudieron leer {erroresPegado.length} línea(s); el resto sí entró.
              Agrégalas a mano:
            </Text>
            {erroresPegado.slice(0, 5).map((e) => (
              <Text key={e.linea} size="xs" c="dimmed">línea {e.linea}: {e.texto}</Text>
            ))}
          </Alert>
        )}

        {renglones.length > 0 && (
          <>
            <Table withTableBorder striped>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Ticket</Table.Th>
                  <Table.Th>Producto</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Litros</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>P. unit.</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Importe</Table.Th>
                  <Table.Th w={36} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {renglones.map((r, i) => (
                  <Table.Tr key={i}>
                    <Table.Td>
                      <TextInput
                        size="xs" variant="unstyled" value={r.ticket ?? ''}
                        onChange={(e) => setRenglones((p) => p.map((x, j) =>
                          j === i ? { ...x, ticket: e.currentTarget.value || null } : x))}
                      />
                    </Table.Td>
                    <Table.Td><Text size="xs" c="dimmed">{r.producto ?? '—'}</Text></Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>
                      <NumberInput
                        size="xs" variant="unstyled" decimalScale={3} min={0}
                        styles={{ input: { textAlign: 'right' } }}
                        value={r.litros}
                        onChange={(v) => setRenglones((p) => p.map((x, j) =>
                          j === i ? { ...x, litros: Number(v) || 0 } : x))}
                      />
                    </Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>
                      <Text size="xs" c="dimmed">{r.precio_unitario ?? '—'}</Text>
                    </Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>
                      <NumberInput
                        size="xs" variant="unstyled" decimalScale={2} min={0}
                        styles={{ input: { textAlign: 'right' } }}
                        value={r.importe}
                        onChange={(v) => setRenglones((p) => p.map((x, j) =>
                          j === i ? { ...x, importe: Number(v) || 0 } : x))}
                      />
                    </Table.Td>
                    <Table.Td>
                      <Button
                        size="compact-xs" variant="subtle" color="red"
                        onClick={() => setRenglones((p) => p.filter((_, j) => j !== i))}
                      >
                        <IconTrash size={13} />
                      </Button>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>

            <Group justify="flex-end" gap="lg">
              <Text size="sm">
                Subtotal de los {renglones.length} ticket(s):{' '}
                <Text component="span" fw={700}>{formatMXN(subtotal)}</Text>
              </Text>
              {Number(total) > 0 && (
                <Text
                  size="sm"
                  c={Math.abs(subtotal + Number(iva || 0) - Number(total)) < EPSILON
                    ? 'green.7' : 'orange.7'}
                >
                  + IVA = {formatMXN(subtotal + Number(iva || 0))}
                  {Math.abs(subtotal + Number(iva || 0) - Number(total)) >= EPSILON &&
                    ' (no da el total)'}
                </Text>
              )}
            </Group>
          </>
        )}

        {mut.error && (
          <Alert color="red" title="No se pudo guardar">{(mut.error as Error).message}</Alert>
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Cancelar</Button>
          <Button disabled={invalido} loading={mut.isPending} onClick={guardar}>
            Guardar
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}

// ── Conciliación ─────────────────────────────────────────────────────────────

/** Cómo se describe una recarga en el desplegable de cada renglón. */
function etiquetaRecarga(r: RecargaCandidata): string {
  return `${formatFecha(r.fecha)} · ${r.litros} L · ${formatMXN(r.costo)} · ${r.vehiculo}`
}

/**
 * El cuadre, ya con los renglones y las candidatas en la mano.
 *
 * Vive aparte del modal porque la propuesta del servidor es estado INICIAL, no
 * algo que haya que sincronizar con un efecto: montando este componente solo
 * cuando los datos llegaron, el `useState` la toma de una vez, y el `key` de
 * arriba lo remonta si la factura cambia o se reabre.
 */
function CuadreFactura({
  facturaId, datos, onClose, esAdmin,
}: {
  facturaId: number
  datos:     Candidatas
  onClose:   () => void
  esAdmin:   boolean
}) {
  const conciliar = useConciliar()
  const reabrir = useReabrirFacturaGasolina()

  const { factura, renglones, recargas } = datos
  const cerrada = factura.conciliada_en != null

  // renglón → recarga elegida. Arranca con lo ya casado, o con lo propuesto.
  const [eleccion, setEleccion] = useState<Record<number, number | null>>(
    () => Object.fromEntries(
      renglones.map((r) => [r.id, r.recarga_id ?? r.sugerida_recarga_id ?? null]),
    ),
  )
  const [nota, setNota] = useState(factura.nota ?? '')

  const porId = new Map(recargas.map((r) => [r.id, r]))
  const usadas = new Set(Object.values(eleccion).filter((v): v is number => v !== null))

  const sinCasar = renglones.filter((r) => eleccion[r.id] == null)
  const importeSinCasar = sinCasar.reduce((s, r) => s + r.importe, 0)
  const litrosSinCasar = sinCasar.reduce((s, r) => s + r.litros, 0)

  const pendienteConfirmar =
    conciliar.error instanceof ApiError && conciliar.error.code === RENGLONES_SIN_CASAR
      ? conciliar.error.message
      : null

  function metodoDe(renglonId: number): MetodoCasado | undefined {
    const r = renglones.find((x) => x.id === renglonId)
    if (!r) return undefined
    const elegida = eleccion[renglonId]
    if (elegida == null) return undefined
    // Si no se movió de lo que el sistema propuso, se conserva cómo lo dedujo;
    // en cuanto una persona lo cambia, pasa a ser criterio suyo y así se guarda.
    if (elegida === r.recarga_id && r.metodo) return r.metodo
    if (elegida === r.sugerida_recarga_id && r.sugerido_metodo) return r.sugerido_metodo
    return 'manual'
  }

  function guardar(confirmar = false) {
    conciliar.mutate(
      {
        factura_id: facturaId,
        casados: renglones.map((r) => ({
          renglon_id: r.id,
          recarga_id: eleccion[r.id] ?? null,
          metodo: metodoDe(r.id),
        })),
        nota: nota.trim() || undefined,
        confirmar_sin_casar: confirmar,
      },
      { onSuccess: () => { if (confirmar || sinCasar.length === 0) onClose() } },
    )
  }

  return (
    <Stack gap="sm">
      {cerrada ? (
        <Alert color={factura.casados === factura.renglones ? 'green' : 'orange'} variant="light">
          <Group justify="space-between" wrap="nowrap">
            <div>
              <Text size="sm">
                Conciliada por <b>{factura.conciliada_por}</b> el{' '}
                {formatFecha(factura.conciliada_en!.slice(0, 10))}:{' '}
                {factura.casados} de {factura.renglones} ticket(s) casaron.
              </Text>
              {factura.casados < factura.renglones && (
                <Text size="sm" mt={4}>
                  Los otros {factura.renglones - factura.casados} son cargas que la
                  gasolinera cobra y que nadie capturó.
                </Text>
              )}
              {factura.nota && <Text size="xs" c="dimmed" mt={4}>Nota: {factura.nota}</Text>}
            </div>
            {esAdmin && (
              <Tooltip label="Suelta el sello para volver a cuadrar" position="left">
                <Button
                  size="compact-xs" variant="subtle" color="orange"
                  leftSection={<IconLockOpen size={14} />}
                  loading={reabrir.isPending}
                  onClick={() => reabrir.mutate(factura.id)}
                >
                  Reabrir
                </Button>
              </Tooltip>
            )}
          </Group>
        </Alert>
      ) : (
        <Text size="xs" c="dimmed">
          Cada renglón del papel es un ticket. El sistema ya emparejó los que pudo
          —por número de ticket, o por litros exactos— y los demás se eligen a
          mano. Los importes de la factura son <b>sin IVA</b>; el costo de la
          recarga es lo que se pagó en la bomba, <b>con IVA</b>: no son
          comparables, por eso el cuadre va por litros.
        </Text>
      )}

      <Group gap="sm" wrap="wrap">
        <Card withBorder padding="xs" style={{ flex: 1, minWidth: 120 }}>
          <Text size="xs" c="dimmed">Total del papel</Text>
          <Text size="lg" fw={700}>{formatMXN(factura.total)}</Text>
        </Card>
        <Card withBorder padding="xs" style={{ flex: 1, minWidth: 120 }}>
          <Text size="xs" c="dimmed">Tickets casados</Text>
          <Text size="lg" fw={700}>
            {renglones.length - sinCasar.length} / {renglones.length}
          </Text>
        </Card>
        <Card
          withBorder padding="xs" style={{ flex: 1, minWidth: 140 }}
          bg={sinCasar.length === 0
            ? 'var(--mantine-color-green-light)'
            : 'var(--mantine-color-orange-light)'}
        >
          <Text size="xs" c="dimmed">Sin capturar</Text>
          <Text size="lg" fw={700}>
            {sinCasar.length === 0 ? '—' : formatMXN(importeSinCasar)}
          </Text>
          {sinCasar.length > 0 && (
            <Text size="xs" c="dimmed">{litrosSinCasar.toFixed(3)} L · sin IVA</Text>
          )}
        </Card>
      </Group>

      {!cerrada && sinCasar.length > 0 && (
        <Alert color="orange" variant="light" icon={<IconAlertTriangle size={16} />}>
          <Text size="sm">
            {sinCasar.length} ticket(s) del papel no corresponden a ninguna recarga
            capturada: {sinCasar.map((r) => r.ticket ?? `${r.litros} L`).join(', ')}.
            Si no es que falta elegirles la recarga, son cargas que ocurrieron y
            que nadie registró.
          </Text>
        </Alert>
      )}

      <Table.ScrollContainer minWidth={760} mah={340}>
        <Table withTableBorder striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Ticket</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Litros</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Importe s/IVA</Table.Th>
              <Table.Th>Recarga del sistema</Table.Th>
              <Table.Th>Cómo</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {renglones.map((r) => {
              const elegida = eleccion[r.id] ?? null
              const metodo = metodoDe(r.id)
              // Se ofrecen las libres más la ya elegida por este renglón: sin
              // eso, la propia elección desaparecería de su desplegable.
              const opciones = recargas
                .filter((c) => !usadas.has(c.id) || c.id === elegida)
                .map((c) => ({ value: String(c.id), label: etiquetaRecarga(c) }))

              return (
                <Table.Tr key={r.id}>
                  <Table.Td>
                    <Text size="sm" fw={500}>{r.ticket ?? '—'}</Text>
                    {r.producto && <Text size="xs" c="dimmed">{r.producto}</Text>}
                  </Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>
                    <Text size="sm">{r.litros}</Text>
                  </Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>
                    <Text size="sm">{formatMXN(r.importe)}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Select
                      size="xs" searchable clearable
                      placeholder="Sin capturar"
                      disabled={cerrada || !esAdmin}
                      data={opciones}
                      value={elegida !== null ? String(elegida) : null}
                      onChange={(v) => {
                        setEleccion((p) => ({ ...p, [r.id]: v ? Number(v) : null }))
                        if (conciliar.error) conciliar.reset()
                      }}
                    />
                    {elegida !== null && porId.get(elegida) && (
                      <Text size="xs" c="dimmed" mt={2}>
                        {porId.get(elegida)!.conductor}
                        {porId.get(elegida)!.vale_folio
                          ? ` · vale ${porId.get(elegida)!.vale_folio}` : ''}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    {metodo ? (
                      <Tooltip label={AYUDA_METODO[metodo]}>
                        <Badge size="xs" variant="light" color={COLOR_METODO[metodo]}>
                          {metodo}
                        </Badge>
                      </Tooltip>
                    ) : (
                      <Badge size="xs" variant="light" color="orange">sin capturar</Badge>
                    )}
                  </Table.Td>
                </Table.Tr>
              )
            })}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>

      {!cerrada && esAdmin && (
        <>
          <Textarea
            label="Nota (opcional)" size="xs" autosize minRows={1} maxLength={255}
            placeholder="De qué son los tickets que faltan, si ya se sabe…"
            value={nota} onChange={(e) => setNota(e.currentTarget.value)}
          />

          {pendienteConfirmar ? (
            <Alert color="orange" variant="light" icon={<IconAlertTriangle size={16} />}>
              <Stack gap="xs">
                <Text size="sm">
                  {pendienteConfirmar} Puedes cerrarla así: los tickets sin casar
                  quedan señalados hasta que alguien capture la recarga y la reabras.
                </Text>
                <Group gap="xs">
                  <Button
                    size="xs" color="orange" loading={conciliar.isPending}
                    onClick={() => guardar(true)}
                  >
                    Cerrar señalando lo que falta
                  </Button>
                  <Button size="xs" variant="default" onClick={() => conciliar.reset()}>
                    Seguir cuadrando
                  </Button>
                </Group>
              </Stack>
            </Alert>
          ) : conciliar.error ? (
            <Alert color="red" title="No se pudo conciliar">
              {(conciliar.error as Error).message}
            </Alert>
          ) : null}

          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>Cerrar</Button>
            <Button
              color={sinCasar.length === 0 ? 'green' : 'orange'}
              loading={conciliar.isPending}
              onClick={() => guardar()}
            >
              {sinCasar.length === 0 ? 'Todo casa, conciliar' : 'Conciliar'}
            </Button>
          </Group>
        </>
      )}
    </Stack>
  )
}

function ConciliarModal({
  facturaId, onClose, esAdmin,
}: {
  facturaId: number | null
  onClose:   () => void
  esAdmin:   boolean
}) {
  const { data, isLoading, isError } = useCandidatas(facturaId)
  const factura = data?.data.factura

  return (
    <Modal
      opened={facturaId !== null}
      onClose={onClose}
      size="90%"
      title={factura
        ? <Text fw={700}>
            {factura.serie ? `${factura.serie}-` : ''}{factura.folio} · {factura.gasolinera}
          </Text>
        : 'Conciliar factura'}
    >
      {isError ? (
        <Alert color="red" title="Error">No se pudo cargar la factura.</Alert>
      ) : isLoading || !data || facturaId === null ? (
        <Center py="xl"><Loader /></Center>
      ) : (
        <CuadreFactura
          key={`${facturaId}:${data.data.factura.conciliada_en ?? 'abierta'}`}
          facturaId={facturaId}
          datos={data.data}
          onClose={onClose}
          esAdmin={esAdmin}
        />
      )}
    </Modal>
  )
}

// ── Pantalla ─────────────────────────────────────────────────────────────────

export default function FacturasGasolina() {
  const [search, setSearch] = useState('')
  const [debounced] = useDebouncedValue(search, 300)
  const [porConciliar, setPorConciliar] = useState(false)
  const [page, setPage] = useState(1)
  const [nueva, setNueva] = useState(false)
  const [conciliando, setConciliando] = useState<number | null>(null)

  const { user } = useAuth()
  const esAdmin = user?.userRoles.includes('admin') ?? false

  const { data, isLoading, isError } = useFacturasGasolina({
    page, pageSize: PAGE_SIZE,
    search: debounced || undefined,
    por_conciliar: porConciliar || undefined,
  })

  const facturas = data?.data ?? []
  const total = data?.pagination.total ?? 0
  const paginas = Math.ceil(total / PAGE_SIZE)

  function filtrar(fn: () => void) { fn(); setPage(1) }

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-start">
        <div>
          <Text fw={700} size="lg">Facturas de gasolinera</Text>
          <Text size="sm" c="dimmed">
            La factura trae un renglón por ticket, pero no dice a qué vehículo fue.
            Aquí se empareja cada ticket con su recarga; el que no casa con
            ninguna es una carga que se cobró y que nadie capturó.
          </Text>
        </div>
        <Button leftSection={<IconPlus size={16} />} onClick={() => setNueva(true)}>
          Nueva factura
        </Button>
      </Group>

      <TextInput
        placeholder="Buscar por folio o gasolinera…"
        leftSection={<IconSearch size={16} />}
        value={search}
        onChange={(e) => filtrar(() => setSearch(e.currentTarget.value))}
      />
      <Switch
        size="xs"
        label="Solo las que faltan por conciliar"
        checked={porConciliar}
        onChange={(e) => filtrar(() => setPorConciliar(e.currentTarget.checked))}
      />

      {isError ? (
        <Alert color="red" title="Error">No se pudieron cargar las facturas.</Alert>
      ) : isLoading ? (
        <Center py="xl"><Loader /></Center>
      ) : !facturas.length ? (
        <Center py="xl">
          <Text c="dimmed">
            {debounced || porConciliar
              ? 'Ninguna factura coincide con el filtro.'
              : 'Todavía no hay facturas de gasolinera registradas.'}
          </Text>
        </Center>
      ) : (
        <>
          <Text size="xs" c="dimmed">{total} factura{total === 1 ? '' : 's'}</Text>
          <Table withTableBorder striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Folio</Table.Th>
                <Table.Th>Gasolinera</Table.Th>
                <Table.Th>Fecha</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Total</Table.Th>
                <Table.Th style={{ textAlign: 'center' }}>Tickets</Table.Th>
                <Table.Th style={{ textAlign: 'center' }}>Estado</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {facturas.map((f) => (
                <Table.Tr
                  key={f.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => setConciliando(f.id)}
                >
                  <Table.Td>
                    <Text size="sm" fw={600}>
                      {f.serie ? `${f.serie}-` : ''}{f.folio}
                    </Text>
                  </Table.Td>
                  <Table.Td><Text size="sm">{f.gasolinera}</Text></Table.Td>
                  <Table.Td>{formatFecha(f.fecha)}</Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>
                    <Text size="sm" fw={500}>{formatMXN(f.total)}</Text>
                  </Table.Td>
                  <Table.Td style={{ textAlign: 'center' }}>
                    <Text size="sm">{f.casados}/{f.renglones}</Text>
                  </Table.Td>
                  <Table.Td style={{ textAlign: 'center' }}>
                    <EstadoFactura f={f} />
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          {paginas > 1 && (
            <Group justify="center">
              <Pagination value={page} onChange={setPage} total={paginas} />
            </Group>
          )}
        </>
      )}

      <NuevaFacturaModal abierto={nueva} onClose={() => setNueva(false)} />
      <ConciliarModal
        facturaId={conciliando}
        onClose={() => setConciliando(null)}
        esAdmin={esAdmin}
      />
    </Stack>
  )
}
