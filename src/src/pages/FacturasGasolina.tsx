// Facturas de gasolinera: comprobar que el gasto en combustible está capturado.
//
// ESTO NO GUARDA LA FACTURA. El documento se archiva por otro lado; aquí solo se
// captura lo necesario para cuadrarlo — descripción, cantidad e importe por
// renglón, y el IVA en la cabecera, como lo imprime el papel.
//
// EL TOTAL ES SUBTOTAL + IVA, NO SUBTOTAL * 1.16. En combustible el precio
// incluye IEPS y el IVA no se cobra sobre él, así que el IVA del papel es menos
// del 16% del subtotal. Por eso se captura el importe del IVA y no la tasa
// (migración 065); las facturas capturadas antes con tasa enseñan su total como
// estimado y piden el IVA del papel.
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
  Pagination, Select, Stack, Switch, Table, Tabs, Text, Textarea, TextInput,
  Tooltip,
} from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import {
  IconAlertTriangle, IconCheck, IconFileImport, IconLockOpen, IconPlus, IconSearch, IconTrash,
} from '@tabler/icons-react'
import {
  useCandidatas, useConciliar, useCorregirIvaFactura, useCrearFacturaGasolina,
  useFacturasGasolina,
  useReabrirFacturaGasolina, useRecargasSinFacturar, PRODUCTOS, RENGLONES_SIN_CASAR,
} from '../hooks/useFacturasGasolina'
import type {
  Candidatas, FacturaGasolina, Producto, RenglonNuevo, TicketCandidato,
} from '../hooks/useFacturasGasolina'
import { useGasolineras } from '../hooks/useGasolineras'
import ImportarFacturasGasolina from '../components/ImportarFacturasGasolina'
import { SelectCatalogo } from '../components/SelectCatalogo'
import { FechaInput } from '../components/FechaInput'
import { ApiError } from '../lib/api'
import { formatMXN, formatFecha } from '../lib/formato'
import { usePermisos } from '../hooks/usePermisos'

const PAGE_SIZE = 15
// Más alto que el de facturas: esta lista se recorre buscando lo viejo, no se
// abre renglón por renglón.
const SIN_FACTURAR_PAGE_SIZE = 50

/**
 * A partir de cuántos días una recarga sin facturar deja de ser normal.
 *
 * No es una regla del negocio, es una señal: por debajo de esto la factura
 * simplemente viene en camino, y por encima es algo que preguntar.
 */
const DIAS_PARA_PREOCUPARSE = 30

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
  const [iva, setIva] = useState<number | string>('')
  // Los renglones se capturan EN la tabla, no en un formulario aparte que luego
  // los agrega. Cada valor tiene su campo con su nombre — antes esto era un
  // cuadro de texto que leía la línea entera adivinando cuál número era cuál por
  // su posición, y adivinar con dinero se equivoca en silencio.
  const [renglones, setRenglones] = useState<RenglonNuevo[]>([])
  const mut = useCrearFacturaGasolina()

  // El subtotal no se teclea: sale de los renglones. El IVA sí, porque no se
  // puede calcular: depende del IEPS de cada litro, que el papel no desglosa.
  const subtotal = renglones.reduce((s, r) => s + r.importe, 0)
  const total = subtotal + (Number(iva) || 0)

  function agregarRecarga() {
    // Hereda el producto del renglón anterior: en una factura de gasolinera casi
    // todos dicen lo mismo, y volver a elegir "Diesel" quince veces es justo el
    // tipo de trabajo que hace que la gente capture mal.
    const anterior = renglones[renglones.length - 1]
    setRenglones((p) => [
      ...p,
      { descripcion: anterior?.descripcion ?? PRODUCTOS[0], cantidad: 0, importe: 0 },
    ])
  }

  // Una fila a medias no se puede guardar. Se comprueba aquí y no al agregarla
  // porque la fila nace vacía a propósito: se llena en la tabla.
  const renglonIncompleto = renglones.some((r) => !(r.cantidad > 0) || !(r.importe >= 0))

  const invalido = !gasolineraId || folio.trim() === '' || !fecha
    || renglones.length === 0 || renglonIncompleto
    || iva === '' || !(Number(iva) >= 0)

  function guardar() {
    mut.mutate(
      {
        gasolinera_id: Number(gasolineraId),
        folio: folio.trim(),
        fecha,
        iva: Number(iva),
        renglones,
      },
      {
        onSuccess: () => {
          setGasolineraId(null); setFolio(''); setFecha('')
          setRenglones([]); setIva('')
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

        <NumberInput
          label="IVA de la factura" w={220} required
          description="El importe que imprime el papel. No lo calcules: en combustible el IVA no se cobra sobre el IEPS, así que no es el 16% del subtotal."
          min={0} decimalScale={2} prefix="$" thousandSeparator=","
          value={iva} onChange={setIva}
        />

        <Group justify="space-between" align="center">
          <Text size="sm" fw={500}>
            Recargas de la factura
            {renglones.length > 0 && (
              <Text component="span" size="xs" c="dimmed"> · {renglones.length}</Text>
            )}
          </Text>
          <Button
            size="xs" variant="light" leftSection={<IconPlus size={14} />}
            onClick={agregarRecarga}
          >
            Agregar recarga
          </Button>
        </Group>

        {renglones.length > 0 && (
          <>
            <Table withTableBorder striped>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Descripción</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Litros</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Importe</Table.Th>
                  <Table.Th w={36} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {renglones.map((r, i) => (
                  <Table.Tr key={i}>
                    <Table.Td>
                      {/* Lista cerrada: son tres y no cambian. Texto libre solo
                          produciría "DIESEL", "diesel" y "Diésel" como si
                          fueran cosas distintas. */}
                      <Select
                        size="xs" allowDeselect={false}
                        data={PRODUCTOS as unknown as string[]}
                        value={r.descripcion}
                        onChange={(v) => setRenglones((p) => p.map((x, j) =>
                          j === i ? { ...x, descripcion: (v as Producto) ?? x.descripcion } : x))}
                      />
                    </Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>
                      <NumberInput
                        size="xs" decimalScale={3} min={0} placeholder="0.000"
                        styles={{ input: { textAlign: 'right' } }}
                        value={r.cantidad || ''}
                        onChange={(v) => setRenglones((p) => p.map((x, j) =>
                          j === i ? { ...x, cantidad: Number(v) || 0 } : x))}
                      />
                    </Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>
                      <NumberInput
                        size="xs" decimalScale={2} min={0} placeholder="0.00"
                        prefix="$" thousandSeparator=","
                        styles={{ input: { textAlign: 'right' } }}
                        value={r.importe || ''}
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

/**
 * Pide el IVA del papel a una factura capturada con tasa, cuyo total es una
 * estimación que da de más. Con el IVA, el total pasa a ser subtotal + IVA.
 */
function IvaDelPapel({ facturaId, subtotal }: { facturaId: number; subtotal: number }) {
  const [iva, setIva] = useState<number | string>('')
  const mut = useCorregirIvaFactura()
  const valido = iva !== '' && Number(iva) >= 0

  return (
    <Alert color="orange" variant="light" icon={<IconAlertTriangle size={16} />}>
      <Stack gap="xs">
        <Text size="sm">
          Esta factura se capturó con la tasa de IVA, y su total sale de más: en
          combustible el IVA no se cobra sobre el IEPS. Captura el IVA que imprime
          el papel.
        </Text>
        <Group gap="xs" align="flex-end">
          <NumberInput
            size="xs" w={160} label="IVA del papel"
            min={0} decimalScale={2} prefix="$" thousandSeparator=","
            value={iva} onChange={setIva}
          />
          <Button
            size="xs" disabled={!valido} loading={mut.isPending}
            onClick={() => mut.mutate({ id: facturaId, iva: Number(iva) })}
          >
            Guardar
          </Button>
          {valido && (
            <Text size="xs" c="dimmed">Total: {formatMXN(subtotal + Number(iva))}</Text>
          )}
        </Group>
        {mut.error && <Text size="xs" c="red">{(mut.error as Error).message}</Text>}
      </Stack>
    </Alert>
  )
}

/** "ticket 2/3" cuando la recarga trae varios; nada cuando es uno solo. */
function numeroTicket(t: { ticket_n: number; tickets: number }): string {
  return t.tickets > 1 ? `ticket ${t.ticket_n}/${t.tickets}` : ''
}

/**
 * Cómo se describe un ticket en el desplegable de cada renglón. La registrada
 * después de la factura se dice: es la del sábado capturada el lunes, o una carga
 * de después que no le toca a esta factura, y quien concilia es quien lo sabe.
 */
function etiquetaTicket(t: TicketCandidato): string {
  const n = numeroTicket(t)
  const despues = t.dias_despues > 0
    ? ` · registrada ${t.dias_despues} día${t.dias_despues === 1 ? '' : 's'} después de la factura`
    : ''
  return `${formatFecha(t.fecha)} · ${t.litros} L · ${formatMXN(t.costo)} · ${t.vehiculo}` +
    (n ? ` · ${n}` : '') + despues
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
  const { puedeEditar } = usePermisos()

  const { factura, renglones, tickets } = datos
  const cerrada = factura.conciliada_en != null

  // renglón → ticket elegido. Arranca con lo ya casado, o con lo propuesto.
  const [eleccion, setEleccion] = useState<Record<number, number | null>>(
    () => Object.fromEntries(
      renglones.map((r) => [r.id, r.ticket_id ?? r.sugerido_ticket_id ?? null]),
    ),
  )
  const [nota, setNota] = useState(factura.nota ?? '')

  const porId = new Map(tickets.map((t) => [t.id, t]))
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
          ticket_id:  eleccion[r.id] ?? null,
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
          {(factura.iva != null || factura.tasa_iva != null) && (
            <> Ojo: los importes del papel son <b>sin IVA</b> y el costo de la
            recarga es lo que se pagó en la bomba, <b>con IVA</b>; por eso el
            cuadre va por litros y no por importe.</>
          )}
        </Text>
      )}

      <Group gap="sm" wrap="wrap">
        <Card withBorder padding="xs" style={{ flex: 1, minWidth: 120 }}>
          <Text size="xs" c="dimmed">Total del papel</Text>
          <Text size="lg" fw={700}>{formatMXN(factura.total)}</Text>
          {factura.total_estimado ? (
            <Tooltip label="Calculado con la tasa: da de más, porque el IVA no se cobra sobre el IEPS. Captura el IVA del papel.">
              <Text size="xs" c="orange.7">Estimado · {formatMXN(factura.subtotal)} + {factura.tasa_iva}%</Text>
            </Tooltip>
          ) : factura.iva != null ? (
            <Text size="xs" c="dimmed">
              {formatMXN(factura.subtotal)} + IVA {formatMXN(factura.iva)}
            </Text>
          ) : null}
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

      {!cerrada && factura.total_estimado && puedeEditar && (
        <IvaDelPapel facturaId={factura.id} subtotal={factura.subtotal} />
      )}

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
              <Table.Th style={{ textAlign: 'right' }}>Litros</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Importe</Table.Th>
              <Table.Th>Recarga del sistema</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {renglones.map((r) => {
              const elegida = eleccion[r.id] ?? null
              // Se ofrecen las libres más la ya elegida por este renglón: sin
              // eso, la propia elección desaparecería de su desplegable.
              const opciones = tickets
                .filter((c) => !usadas.has(c.id) || c.id === elegida)
                .map((c) => ({ value: String(c.id), label: etiquetaTicket(c) }))

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

// ── Recargas que nadie ha facturado ──────────────────────────────────────────

/**
 * El reverso de la conciliación.
 *
 * La pestaña de facturas enseña lo que la gasolinera cobra y no está capturado.
 * Esta enseña lo contrario: lo que está capturado y la gasolinera todavía no ha
 * cobrado. Casi nunca es un problema —la factura llega después de la carga— pero
 * una recarga de hace tres meses sin facturar sí lo es, y de ahí la columna de
 * días: es lo único que distingue "normal" de "a alguien se le perdió un papel".
 *
 * Estas mismas recargas son las candidatas de la próxima factura de su
 * gasolinera, así que esta lista se vacía sola conforme se concilia.
 */
function SinFacturarPanel() {
  const [search, setSearch] = useState('')
  const [debounced] = useDebouncedValue(search, 300)
  const [page, setPage] = useState(1)

  const { data, isLoading, isError } = useRecargasSinFacturar({
    page, pageSize: SIN_FACTURAR_PAGE_SIZE,
    search: debounced || undefined,
  })

  const recargas = data?.data ?? []
  const total = data?.pagination.total ?? 0
  const costoTotal = data?.costo_total ?? 0
  const paginas = Math.ceil(total / SIN_FACTURAR_PAGE_SIZE)

  return (
    <Stack gap="md">
      <Text size="sm" c="dimmed">
        Cargas registradas que ninguna factura ha cobrado todavía. Son las
        candidatas de la próxima factura de su gasolinera, así que la lista se
        vacía sola conforme se concilia.
      </Text>

      <TextInput
        placeholder="Buscar por gasolinera, unidad, chofer o vale…"
        leftSection={<IconSearch size={16} />}
        value={search}
        onChange={(e) => { setSearch(e.currentTarget.value); setPage(1) }}
      />

      {isError ? (
        <Alert color="red" title="Error">No se pudieron cargar las recargas.</Alert>
      ) : isLoading ? (
        <Center py="xl"><Loader /></Center>
      ) : !recargas.length ? (
        <Center py="xl">
          <Text c="dimmed">
            {debounced
              ? 'Ninguna recarga coincide con el filtro.'
              : 'Todas las recargas están facturadas.'}
          </Text>
        </Center>
      ) : (
        <>
          <Group gap="sm">
            <Card withBorder padding="xs" style={{ flex: 1, minWidth: 130 }}>
              <Text size="xs" c="dimmed">Recargas sin facturar</Text>
              <Text size="lg" fw={700}>{total}</Text>
            </Card>
            <Card withBorder padding="xs" style={{ flex: 1, minWidth: 130 }}>
              <Text size="xs" c="dimmed">Lo que suman</Text>
              <Text size="lg" fw={700}>{formatMXN(costoTotal)}</Text>
            </Card>
          </Group>

          <Table withTableBorder striped>
            <Table.Thead>
              <Table.Tr>
                <Table.Th style={{ width: 110 }}>Fecha</Table.Th>
                <Table.Th>Gasolinera</Table.Th>
                <Table.Th>Unidad</Table.Th>
                <Table.Th style={{ width: 100, textAlign: 'right' }}>Litros</Table.Th>
                <Table.Th style={{ width: 110, textAlign: 'right' }}>Costo</Table.Th>
                <Table.Th style={{ width: 100 }}>Vale</Table.Th>
                <Table.Th style={{ width: 90, textAlign: 'right' }}>Espera</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {recargas.map((r) => (
                <Table.Tr key={r.id}>
                  <Table.Td><Text size="sm">{formatFecha(r.fecha)}</Text></Table.Td>
                  <Table.Td><Text size="sm">{r.gasolinera}</Text></Table.Td>
                  <Table.Td>
                    <Text size="sm">{r.vehiculo}</Text>
                    <Text size="xs" c="dimmed">{r.conductor}</Text>
                  </Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>
                    <Text size="sm">{r.litros}</Text>
                    {r.tickets > 1 && (
                      <Text size="xs" c="dimmed">{numeroTicket(r)}</Text>
                    )}
                  </Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>
                    <Text size="sm" fw={600}>{formatMXN(r.costo)}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" c={r.vale_folio ? undefined : 'dimmed'}>
                      {r.vale_folio ?? 'Sin vale'}
                    </Text>
                  </Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>
                    <Text
                      size="xs"
                      c={r.dias > DIAS_PARA_PREOCUPARSE ? 'orange.7' : 'dimmed'}
                      fw={r.dias > DIAS_PARA_PREOCUPARSE ? 600 : undefined}
                    >
                      {r.dias} día{r.dias === 1 ? '' : 's'}
                    </Text>
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
    </Stack>
  )
}

export default function FacturasGasolina() {
  const [search, setSearch] = useState('')
  const [debounced] = useDebouncedValue(search, 300)
  const [porConciliar, setPorConciliar] = useState(false)
  const [page, setPage] = useState(1)
  const [nueva, setNueva] = useState(false)
  const [importando, setImportando] = useState(false)
  const [conciliando, setConciliando] = useState<number | null>(null)

  const { esAdmin, puedeEditar } = usePermisos()

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
        {/* Dar de alta es de admin y editor (la API responde 403 a los demás).
            El XML es el camino normal; a mano queda para la que no lo trae. */}
        {puedeEditar && (
          <Group gap="xs" wrap="nowrap">
            <Button leftSection={<IconFileImport size={16} />} onClick={() => setImportando(true)}>
              Importar XML
            </Button>
            <Button variant="default" leftSection={<IconPlus size={16} />} onClick={() => setNueva(true)}>
              A mano
            </Button>
          </Group>
        )}
      </Group>

      <Tabs defaultValue="facturas">
        <Tabs.List>
          <Tabs.Tab value="facturas">Facturas</Tabs.Tab>
          <Tabs.Tab value="sin-facturar">Recargas sin factura</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="facturas" pt="md">
          <Stack gap="md">
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
                    <Text size="sm" fw={500}>{formatMXN(f.total)}</Text>
                    {f.total_estimado && (
                      <Tooltip label="Calculado con la tasa: falta el IVA del papel">
                        <Text size="xs" c="orange.7">estimado</Text>
                      </Tooltip>
                    )}
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

          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="sin-facturar" pt="md">
          <SinFacturarPanel />
        </Tabs.Panel>
      </Tabs>

      <NuevaFacturaModal abierto={nueva} onClose={() => setNueva(false)} />
      <ImportarFacturasGasolina abierto={importando} onClose={() => setImportando(false)} />
      <ConciliarModal
        facturaId={conciliando}
        onClose={() => setConciliando(null)}
        esAdmin={esAdmin}
      />
    </Stack>
  )
}
