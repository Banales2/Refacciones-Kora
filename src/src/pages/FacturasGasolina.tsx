// Facturas de gasolinera: comprobar que el gasto en combustible está capturado.
//
// ESTO NO GUARDA LA FACTURA. El documento se archiva por otro lado; aquí solo se
// captura lo necesario para cuadrarlo — descripción, cantidad e importe por
// renglón, y la tasa de IVA en la cabecera. El subtotal y el total se calculan,
// igual que en las facturas de refacciones.
//
// POR QUÉ NO SE PARECE A LA PANTALLA DE REFACCIONES. Allá cada renglón del papel
// apunta a un lote concreto y se verifican uno a uno. Aquí el renglón trae
// cantidad e importe pero NO dice a qué vehículo fue, qué chofer la hizo ni
// contra qué vale: eso solo lo sabe el sistema. Conciliar no es verificar, es
// EMPAREJAR.
//
// SE EMPAREJA POR CANTIDAD, NO POR IMPORTE. El importe del renglón suele venir
// sin IVA y el costo de la recarga es lo que se pagó en la bomba, que sí lo
// incluye. Compararlos da 16% de diferencia siempre. Los litros son el mismo
// número de los dos lados y con tres decimales prácticamente no se repiten.
//
// LO QUE LA PANTALLA EXISTE PARA ENCONTRAR: el renglón del papel que no casa con
// ninguna recarga. Eso es una carga que la gasolinera está cobrando y que nadie
// capturó.
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
  Candidatas, FacturaGasolina, RecargaCandidata, RenglonNuevo,
} from '../hooks/useFacturasGasolina'
import { useGasolineras } from '../hooks/useGasolineras'
import { useAuth } from '../hooks/useAuth'
import { SelectCatalogo } from '../components/SelectCatalogo'
import { FechaInput } from '../components/FechaInput'
import { ApiError } from '../lib/api'
import { formatMXN, formatFecha } from '../lib/formato'
import { IVA_DEFAULT, conIva } from '../lib/totales'

const PAGE_SIZE = 15

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
    <Tooltip label="Renglones que la gasolinera cobra y que nadie capturó">
      <Badge size="xs" variant="light" color="orange">{faltan} sin capturar</Badge>
    </Tooltip>
  )
}

// ── Alta de la factura ───────────────────────────────────────────────────────

function NuevaFacturaModal({ abierto, onClose }: { abierto: boolean; onClose: () => void }) {
  const gasolineras = useGasolineras()
  const [gasolineraId, setGasolineraId] = useState<string | null>(null)
  const [folio, setFolio] = useState('')
  const [fecha, setFecha] = useState('')
  const [conIvaAparte, setConIvaAparte] = useState(true)
  const [tasa, setTasa] = useState<number | string>(IVA_DEFAULT)
  const [renglones, setRenglones] = useState<RenglonNuevo[]>([])
  // El renglón que se está capturando. Cada valor tiene su campo con su nombre:
  // antes esto era un cuadro de texto que leía la línea entera adivinando cuál
  // número era cuál por su posición, y adivinar con dinero se equivoca en
  // silencio. Pegar sigue funcionando — campo por campo, que es donde se ve lo
  // que se pegó.
  const [desc, setDesc] = useState('')
  const [cantidad, setCantidad] = useState<number | string>('')
  const [importe, setImporte] = useState<number | string>('')
  const mut = useCrearFacturaGasolina()

  // Ni el subtotal ni el total se teclean: salen de los renglones y la tasa.
  // Pedirlos aparte solo crea la oportunidad de que discrepen de lo capturado.
  const subtotal = renglones.reduce((s, r) => s + r.importe, 0)
  const tasaNueva = conIvaAparte ? Number(tasa) : null
  const total = conIva(subtotal, tasaNueva)

  const nuevoValido = Number(cantidad) > 0 && Number(importe) >= 0 && importe !== ''

  function agregarRenglon() {
    if (!nuevoValido) return
    setRenglones((p) => [
      ...p,
      { descripcion: desc.trim() || null, cantidad: Number(cantidad), importe: Number(importe) },
    ])
    // La descripción se queda: en una factura de gasolinera casi todos los
    // renglones dicen lo mismo, y volver a teclear "DIESEL" quince veces es
    // justo el tipo de trabajo que hace que la gente capture mal.
    setCantidad(''); setImporte('')
  }

  const invalido = !gasolineraId || folio.trim() === '' || !fecha
    || renglones.length === 0
    || (conIvaAparte && !(Number(tasa) > 0 && Number(tasa) <= 100))

  function guardar() {
    mut.mutate(
      {
        gasolinera_id: Number(gasolineraId),
        folio: folio.trim(),
        fecha,
        tasa_iva: tasaNueva,
        renglones,
      },
      {
        onSuccess: () => {
          setGasolineraId(null); setFolio(''); setFecha('')
          setDesc(''); setCantidad(''); setImporte('')
          setRenglones([]); setConIvaAparte(true); setTasa(IVA_DEFAULT)
          onClose()
        },
      },
    )
  }

  return (
    <Modal opened={abierto} onClose={onClose} size="lg" title="Nueva factura de gasolinera">
      <Stack gap="sm">
        <Text size="xs" c="dimmed">
          Solo lo necesario para cuadrar el gasto. La factura en sí se archiva
          por otro lado.
        </Text>

        <Group grow align="flex-start">
          <SelectCatalogo
            label="Gasolinera" nombre="gasolineras" estado={gasolineras}
            data={(gasolineras.data?.data ?? []).map((g) => ({
              value: String(g.id), label: g.nombre,
            }))}
            value={gasolineraId} onChange={setGasolineraId}
          />
          <TextInput
            label="Folio" maxLength={30}
            value={folio} onChange={(e) => setFolio(e.currentTarget.value)}
          />
          {/* La fecha es el corte: solo se ofrecen recargas de ese día hacia
              atrás, así que equivocarse aquí esconde cargas que sí entraban. */}
          <FechaInput
            label="Fecha" description="Es el corte del cuadre"
            value={fecha} onChange={setFecha}
          />
        </Group>

        <Group align="flex-end" gap="sm">
          <Switch
            size="xs" label="Los importes vienen sin IVA"
            checked={conIvaAparte}
            onChange={(e) => setConIvaAparte(e.currentTarget.checked)}
          />
          {conIvaAparte && (
            <NumberInput
              size="xs" w={110} min={0.01} max={100} decimalScale={2} suffix="%"
              value={tasa} onChange={setTasa}
            />
          )}
        </Group>

        {/* Un campo por valor, con su nombre. Enter agrega el renglón sin tener
            que soltar el teclado, que es como se captura una factura de quince
            partidas sin perder la cuenta. */}
        <Group align="flex-end" gap="xs">
          <TextInput
            label="Descripción" placeholder="DIESEL" maxLength={100}
            style={{ flex: 2 }}
            value={desc} onChange={(e) => setDesc(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') agregarRenglon() }}
          />
          <NumberInput
            label="Cantidad" placeholder="0.000" decimalScale={3} min={0}
            style={{ flex: 1 }}
            value={cantidad} onChange={setCantidad}
            onKeyDown={(e) => { if (e.key === 'Enter') agregarRenglon() }}
          />
          <NumberInput
            label="Importe" placeholder="0.00" decimalScale={2} min={0}
            prefix="$" thousandSeparator="," style={{ flex: 1 }}
            value={importe} onChange={setImporte}
            onKeyDown={(e) => { if (e.key === 'Enter') agregarRenglon() }}
          />
          <Button variant="light" disabled={!nuevoValido} onClick={agregarRenglon}>
            Agregar
          </Button>
        </Group>

        {renglones.length > 0 && (
          <>
            <Table withTableBorder striped>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Descripción</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Cantidad</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Importe</Table.Th>
                  <Table.Th w={36} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {renglones.map((r, i) => (
                  <Table.Tr key={i}>
                    <Table.Td>
                      <TextInput
                        size="xs" variant="unstyled" placeholder="DIESEL" maxLength={100}
                        value={r.descripcion ?? ''}
                        onChange={(e) => setRenglones((p) => p.map((x, j) =>
                          j === i ? { ...x, descripcion: e.currentTarget.value || null } : x))}
                      />
                    </Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>
                      <NumberInput
                        size="xs" variant="unstyled" decimalScale={3} min={0}
                        styles={{ input: { textAlign: 'right' } }}
                        value={r.cantidad}
                        onChange={(v) => setRenglones((p) => p.map((x, j) =>
                          j === i ? { ...x, cantidad: Number(v) || 0 } : x))}
                      />
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
              <Text size="sm" c="dimmed">
                Subtotal {formatMXN(subtotal)}
              </Text>
              <Text size="sm">
                Total <Text component="span" fw={700}>{formatMXN(total)}</Text>
              </Text>
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

  const pendienteConfirmar =
    conciliar.error instanceof ApiError && conciliar.error.code === RENGLONES_SIN_CASAR
      ? conciliar.error.message
      : null

  function guardar(confirmar = false) {
    conciliar.mutate(
      {
        factura_id: facturaId,
        casados: renglones.map((r) => ({
          renglon_id: r.id,
          recarga_id: eleccion[r.id] ?? null,
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
                {factura.casados} de {factura.renglones} renglón(es) casaron.
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
          El sistema ya emparejó los renglones que pudo, por cantidad exacta. Los
          demás se eligen a mano.
          {factura.tasa_iva != null && (
            <> Ojo: los importes del papel son <b>sin IVA</b> y el costo de la
            recarga es lo que se pagó en la bomba, <b>con IVA</b>; por eso el
            cuadre va por litros y no por importe.</>
          )}
        </Text>
      )}

      <Group gap="sm" wrap="wrap">
        <Card withBorder padding="xs" style={{ flex: 1, minWidth: 120 }}>
          <Text size="xs" c="dimmed">Total del papel</Text>
          <Text size="lg" fw={700}>
            {formatMXN(conIva(factura.subtotal, factura.tasa_iva))}
          </Text>
          {factura.tasa_iva != null && (
            <Text size="xs" c="dimmed">
              {formatMXN(factura.subtotal)} + {factura.tasa_iva}%
            </Text>
          )}
        </Card>
        <Card withBorder padding="xs" style={{ flex: 1, minWidth: 120 }}>
          <Text size="xs" c="dimmed">Renglones casados</Text>
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
        </Card>
      </Group>

      {!cerrada && sinCasar.length > 0 && (
        <Alert color="orange" variant="light" icon={<IconAlertTriangle size={16} />}>
          <Text size="sm">
            {sinCasar.length} renglón(es) del papel no corresponden a ninguna
            recarga capturada. Si no es que falta elegirles la recarga, son cargas
            que ocurrieron y que nadie registró.
          </Text>
        </Alert>
      )}

      <Table.ScrollContainer minWidth={700} mah={340}>
        <Table withTableBorder striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Descripción</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Cantidad</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Importe</Table.Th>
              <Table.Th>Recarga del sistema</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {renglones.map((r) => {
              const elegida = eleccion[r.id] ?? null
              // Se ofrecen las libres más la ya elegida por este renglón: sin
              // eso, la propia elección desaparecería de su desplegable.
              const opciones = recargas
                .filter((c) => !usadas.has(c.id) || c.id === elegida)
                .map((c) => ({ value: String(c.id), label: etiquetaRecarga(c) }))

              return (
                <Table.Tr key={r.id}>
                  <Table.Td>
                    <Text size="sm">{r.descripcion ?? '—'}</Text>
                  </Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>
                    <Text size="sm" fw={500}>{r.cantidad}</Text>
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
            placeholder="De qué son los renglones que faltan, si ya se sabe…"
            value={nota} onChange={(e) => setNota(e.currentTarget.value)}
          />

          {pendienteConfirmar ? (
            <Alert color="orange" variant="light" icon={<IconAlertTriangle size={16} />}>
              <Stack gap="xs">
                <Text size="sm">
                  {pendienteConfirmar} Puedes cerrarla así: quedan señalados hasta
                  que alguien capture la recarga y la reabras.
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
      size="xl"
      title={factura
        ? <Text fw={700}>{factura.folio} · {factura.gasolinera}</Text>
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
            Se captura lo justo para cuadrar el gasto: cada renglón del papel se
            empareja con su recarga. El que no casa con ninguna es una carga que
            se cobró y que nadie registró.
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
                <Table.Th style={{ textAlign: 'center' }}>Renglones</Table.Th>
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
                  <Table.Td><Text size="sm" fw={600}>{f.folio}</Text></Table.Td>
                  <Table.Td><Text size="sm">{f.gasolinera}</Text></Table.Td>
                  <Table.Td>{formatFecha(f.fecha)}</Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>
                    <Text size="sm" fw={500}>
                      {formatMXN(conIva(f.subtotal, f.tasa_iva))}
                    </Text>
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
