// El cuadre de una factura de refacciones: el papel contra lo capturado.
//
// CÓMO FUNCIONA, que es lo que hay que entender antes de tocar esto. Se
// transcribe lo que dice la factura —renglón por renglón, eligiendo la refacción
// del catálogo— y el sistema lo compara contra los lotes registrados. Con las
// dos listas, las tres preguntas se contestan solas:
//
//   renglón del papel sin lote      → nadie capturó esa compra
//   lote sin renglón del papel      → se capturó algo que el papel no trae
//   los dos, con valores distintos  → error de captura, y se sabe de cuánto
//
// POR QUÉ LA TRANSCRIPCIÓN ARRANCA COPIANDO LO CAPTURADO. Porque el caso normal
// es que la factura esté bien: copiar y corregir las dos líneas que fallan es
// mucho menos trabajo que teclear quince renglones desde cero, y el trabajo es
// justo lo que hace que nadie revise. La concesión es real —se puede dar por
// bueno sin leer el papel— pero la alternativa acaba en que no se revisa nada.
//
// LA REFACCIÓN SE ELIGE DEL CATÁLOGO, no se teclea. En las facturas de gasolina
// los renglones se casan por litros porque ese número identifica la carga; aquí
// no hay uno así, y casar por parecido entre descripciones se equivoca en
// silencio. Si el papel trae una pieza que no existe, se da de alta aquí mismo.
//
// Ver `docs/revision-de-facturas.md`.
import { useState } from 'react'
import {
  Alert, Badge, Button, Card, Center, Divider, Group, Loader, Modal, NumberInput,
  Stack, Table, Text, Textarea, Tooltip,
} from '@mantine/core'
import {
  IconAlertTriangle, IconCheck, IconCopy, IconPlus, IconTrash,
} from '@tabler/icons-react'
import {
  useCuadrar, useCuadre, useGuardarRenglonesPapel, useRegistrarRenglon,
  CUADRE_INCOMPLETO,
} from '../hooks/useCuadreFactura'
import type { Cuadre, Diferencia, RenglonPapelPayload } from '../hooks/useCuadreFactura'
import { useTodasLasPiezas } from '../hooks/useRefacciones'
import { useSucursales } from '../hooks/useSucursales'
import { useQuitarRenglon } from '../hooks/useRevision'
import { SelectCatalogo } from './SelectCatalogo'
import { ApiError } from '../lib/api'
import { formatMXN } from '../lib/formato'
import { totalesFactura } from '../lib/totales'

/** Una fila de la transcripción mientras se está capturando. */
interface FilaPapel {
  pieza_id: number | null
  cantidad: number | string
  costo_unitario: number | string
  lote_id: number | null
}

const COLOR_TIPO: Record<Diferencia['tipo'], string> = {
  falta_capturar: 'orange',
  sobra_capturado: 'red',
  valores: 'yellow',
}

const TITULO_TIPO: Record<Diferencia['tipo'], string> = {
  falta_capturar: 'El papel la cobra y nadie la capturó',
  sobra_capturado: 'Está capturada y el papel no la trae',
  valores: 'Capturada con otros valores',
}

// ── Resolver una diferencia ──────────────────────────────────────────────────

/** Registra la compra que falta. Lo único que el papel no dice es la sucursal. */
function RegistrarFaltante({ diferencia }: { diferencia: Diferencia }) {
  const sucursales = useSucursales()
  const [sucursal, setSucursal] = useState<string | null>(null)
  const mut = useRegistrarRenglon()

  return (
    <Group gap="xs" align="flex-end" wrap="nowrap">
      <SelectCatalogo
        size="xs" w={170} label="Entró en" nombre="sucursales" estado={sucursales}
        data={(sucursales.data?.data ?? []).map((s) => ({
          value: String(s.id), label: s.nombre,
        }))}
        value={sucursal} onChange={setSucursal}
      />
      <Button
        size="xs" color="orange"
        disabled={!sucursal || diferencia.renglon_id === null}
        loading={mut.isPending}
        onClick={() => mut.mutate({
          renglon_id: diferencia.renglon_id!,
          sucursal_id: Number(sucursal),
        })}
      >
        Registrar la compra
      </Button>
      {mut.error && (
        <Text size="xs" c="red">{(mut.error as Error).message}</Text>
      )}
    </Group>
  )
}

/** Quita el lote que el papel no trae. La API comprueba que nunca se haya movido. */
function QuitarSobrante({ diferencia }: { diferencia: Diferencia }) {
  const mut = useQuitarRenglon()
  return (
    <Stack gap={4}>
      <Group gap="xs">
        <Button
          size="xs" color="red" variant="light"
          leftSection={<IconTrash size={13} />}
          loading={mut.isPending}
          disabled={diferencia.lote_id === null}
          onClick={() => mut.mutate(diferencia.lote_id!)}
        >
          Quitar lo capturado
        </Button>
        <Text size="xs" c="dimmed">
          Si sí se compró pero es de otra factura, cámbiale el folio en vez de quitarlo.
        </Text>
      </Group>
      {mut.error && <Text size="xs" c="red">{(mut.error as Error).message}</Text>}
    </Stack>
  )
}

function TarjetaDiferencia({ d }: { d: Diferencia }) {
  return (
    <Card withBorder padding="sm" radius="md">
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <div>
          <Group gap={6}>
            <Badge size="xs" variant="light" color={COLOR_TIPO[d.tipo]}>
              {TITULO_TIPO[d.tipo]}
            </Badge>
            {d.capturado_por && (
              <Text size="xs" c="dimmed">capturó {d.capturado_por}</Text>
            )}
          </Group>
          <Text size="sm" fw={600} mt={4}>{d.numero_serie}</Text>
          <Text size="xs" c="dimmed">{d.descripcion}</Text>

          <Group gap="lg" mt={6}>
            <Text size="xs">
              Papel:{' '}
              {d.papel
                ? <b>{d.papel.cantidad} × {formatMXN(d.papel.costo_unitario)} = {formatMXN(d.papel.importe)}</b>
                : <Text component="span" c="dimmed">no lo trae</Text>}
            </Text>
            <Text size="xs">
              Sistema:{' '}
              {d.sistema
                ? <b>{d.sistema.cantidad} × {formatMXN(d.sistema.costo_unitario)} = {formatMXN(d.sistema.importe)}</b>
                : <Text component="span" c="dimmed">sin capturar</Text>}
            </Text>
          </Group>
        </div>

        <Tooltip
          label={d.delta_dinero > 0
            ? 'El papel cobra más de lo que está capturado'
            : 'Lo capturado es más de lo que cobra el papel'}
        >
          <Text
            size="sm" fw={700} style={{ whiteSpace: 'nowrap' }}
            c={d.delta_dinero > 0 ? 'orange.7' : 'blue.7'}
          >
            {d.delta_dinero > 0 ? '+' : '−'}{formatMXN(Math.abs(d.delta_dinero))}
          </Text>
        </Tooltip>
      </Group>

      {d.tipo !== 'valores' && (
        <>
          <Divider my="xs" />
          {d.tipo === 'falta_capturar'
            ? <RegistrarFaltante diferencia={d} />
            : <QuitarSobrante diferencia={d} />}
        </>
      )}
    </Card>
  )
}

// ── La transcripción del papel ───────────────────────────────────────────────

function Transcripcion({ cuadre }: { cuadre: Cuadre }) {
  const piezas = useTodasLasPiezas()
  const guardar = useGuardarRenglonesPapel()

  // Arranca con lo que ya se transcribió; si no hay nada, vacío — el botón de
  // copiar lo capturado es lo que lo llena, y que sea un acto explícito importa:
  // dejarlo prellenado solo sería dar por bueno lo capturado sin mirar el papel.
  const [filas, setFilas] = useState<FilaPapel[]>(
    () => cuadre.renglones.map((r) => ({
      pieza_id: r.pieza_id,
      cantidad: r.cantidad,
      costo_unitario: r.costo_unitario,
      lote_id: r.lote_id,
    })),
  )

  const opciones = (piezas.data?.data ?? []).map((p) => ({
    value: String(p.id),
    label: `${p.numero_serie} — ${p.descripcion}`,
  }))

  const subtotal = filas.reduce(
    (s, f) => s + (Number(f.cantidad) || 0) * (Number(f.costo_unitario) || 0), 0,
  )
  const total = totalesFactura(
    subtotal, cuadre.factura.descuento_pct, cuadre.factura.tasa_iva,
  ).total

  const incompleta = filas.some(
    (f) => f.pieza_id === null || !(Number(f.cantidad) > 0) || !(Number(f.costo_unitario) > 0),
  )

  function copiarCapturado() {
    setFilas(cuadre.lotes.map((l) => ({
      pieza_id: l.pieza_id,
      cantidad: l.cantidad_inicial,
      costo_unitario: l.costo_unitario,
      lote_id: l.lote_id,
    })))
  }

  function enviar() {
    const renglones: RenglonPapelPayload[] = filas.map((f) => ({
      pieza_id: f.pieza_id!,
      cantidad: Number(f.cantidad),
      costo_unitario: Number(f.costo_unitario),
      lote_id: f.lote_id,
    }))
    guardar.mutate({ factura_id: cuadre.factura.id, renglones })
  }

  return (
    <Stack gap="sm">
      <Group justify="space-between" align="center">
        <div>
          <Text size="sm" fw={600}>Lo que dice el papel</Text>
          <Text size="xs" c="dimmed">
            Transcribe la factura original, renglón por renglón.
          </Text>
        </div>
        <Group gap="xs">
          <Tooltip label="Parte de lo que está capturado y corrige lo que no coincida">
            <Button
              size="xs" variant="subtle" leftSection={<IconCopy size={14} />}
              onClick={copiarCapturado}
            >
              Copiar lo capturado
            </Button>
          </Tooltip>
          <Button
            size="xs" variant="light" leftSection={<IconPlus size={14} />}
            onClick={() => setFilas((p) => [
              ...p, { pieza_id: null, cantidad: '', costo_unitario: '', lote_id: null },
            ])}
          >
            Agregar renglón
          </Button>
        </Group>
      </Group>

      {filas.length > 0 && (
        <Table withTableBorder striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Refacción</Table.Th>
              <Table.Th w={110} style={{ textAlign: 'right' }}>Cantidad</Table.Th>
              <Table.Th w={140} style={{ textAlign: 'right' }}>Costo unit.</Table.Th>
              <Table.Th w={120} style={{ textAlign: 'right' }}>Importe</Table.Th>
              <Table.Th w={40} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {filas.map((f, i) => (
              <Table.Tr key={i}>
                <Table.Td>
                  <SelectCatalogo
                    size="xs" nombre="refacciones" estado={piezas}
                    placeholder="Busca por número de serie…"
                    data={opciones}
                    value={f.pieza_id !== null ? String(f.pieza_id) : null}
                    onChange={(v) => setFilas((p) => p.map((x, j) =>
                      // Cambiar la refacción invalida el emparejado anterior: el
                      // lote que tenía era de otra pieza.
                      j === i ? { ...x, pieza_id: v ? Number(v) : null, lote_id: null } : x))}
                  />
                </Table.Td>
                <Table.Td>
                  <NumberInput
                    size="xs" min={1} max={999} allowDecimal={false} placeholder="0"
                    styles={{ input: { textAlign: 'right' } }}
                    value={f.cantidad}
                    onChange={(v) => setFilas((p) => p.map((x, j) =>
                      j === i ? { ...x, cantidad: v } : x))}
                  />
                </Table.Td>
                <Table.Td>
                  <NumberInput
                    size="xs" min={0} decimalScale={2} prefix="$" thousandSeparator=","
                    placeholder="0.00"
                    styles={{ input: { textAlign: 'right' } }}
                    value={f.costo_unitario}
                    onChange={(v) => setFilas((p) => p.map((x, j) =>
                      j === i ? { ...x, costo_unitario: v } : x))}
                  />
                </Table.Td>
                <Table.Td style={{ textAlign: 'right' }}>
                  <Text size="sm">
                    {formatMXN((Number(f.cantidad) || 0) * (Number(f.costo_unitario) || 0))}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Button
                    size="compact-xs" variant="subtle" color="red"
                    onClick={() => setFilas((p) => p.filter((_, j) => j !== i))}
                  >
                    <IconTrash size={13} />
                  </Button>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      <Group justify="space-between" align="flex-end">
        <Text size="sm">
          Subtotal del papel <b>{formatMXN(subtotal)}</b>
          {(cuadre.factura.tasa_iva != null || cuadre.factura.descuento_pct != null) && (
            <Text component="span" size="xs" c="dimmed">
              {' '}· total {formatMXN(total)}
            </Text>
          )}
        </Text>
        <Button
          size="xs"
          disabled={incompleta || filas.length === 0}
          loading={guardar.isPending}
          onClick={enviar}
        >
          Comparar con lo capturado
        </Button>
      </Group>

      {guardar.error && (
        <Alert color="red" title="No se pudo guardar">
          {(guardar.error as Error).message}
        </Alert>
      )}
    </Stack>
  )
}

// ── La pantalla ──────────────────────────────────────────────────────────────

export default function CuadreFacturaModal({
  facturaId, folio, onClose,
}: {
  facturaId: number | null
  folio:     string
  onClose:   () => void
}) {
  const { data, isLoading, isError } = useCuadre(facturaId)
  const cuadrar = useCuadrar()
  const [nota, setNota] = useState('')

  const cuadre = data?.data
  const cerrada = cuadre?.factura.cabecera_revisada_en != null
  const diferencias = cuadre?.diferencias ?? []
  const pendientes = diferencias.filter((d) => d.tipo !== 'valores')

  const incompletoPendiente =
    cuadrar.error instanceof ApiError && cuadrar.error.code === CUADRE_INCOMPLETO
      ? cuadrar.error.message
      : null

  function sellar(confirmar = false) {
    if (!facturaId) return
    cuadrar.mutate(
      {
        factura_id: facturaId,
        nota: nota.trim() || undefined,
        confirmar_sin_resolver: confirmar,
      },
      { onSuccess: () => { if (confirmar || pendientes.length === 0) onClose() } },
    )
  }

  return (
    <Modal
      opened={facturaId !== null}
      onClose={onClose}
      size="xl"
      title={<Text fw={700}>Cuadrar {folio} contra el papel</Text>}
    >
      {isError ? (
        <Alert color="red" title="Error">No se pudo cargar el cuadre.</Alert>
      ) : isLoading || !cuadre ? (
        <Center py="xl"><Loader /></Center>
      ) : (
        <Stack gap="md">
          {cerrada ? (
            <Alert color="green" variant="light" icon={<IconCheck size={16} />}>
              Esta factura ya fue cuadrada. Reábrela desde la pantalla de facturas
              para volver a compararla.
            </Alert>
          ) : (
            <Transcripcion
              // Se remonta cuando cambian los renglones guardados: así la tabla
              // refleja lo que la base tiene después de registrar una compra que
              // faltaba, en vez de quedarse con lo que había al abrir.
              key={`${cuadre.factura.id}:${cuadre.renglones.map((r) => r.id).join(',')}`}
              cuadre={cuadre}
            />
          )}

          {!cuadre.sin_capturar_papel && (
            <>
              <Divider label="Diferencias" labelPosition="center" />

              {diferencias.length === 0 ? (
                <Alert color="green" variant="light" icon={<IconCheck size={16} />}>
                  El papel y lo capturado coinciden renglón por renglón.
                </Alert>
              ) : (
                <>
                  <Group gap="sm">
                    <Card withBorder padding="xs" style={{ flex: 1, minWidth: 130 }}>
                      <Text size="xs" c="dimmed">Diferencias</Text>
                      <Text size="lg" fw={700}>{diferencias.length}</Text>
                    </Card>
                    <Card
                      withBorder padding="xs" style={{ flex: 1, minWidth: 150 }}
                      bg="var(--mantine-color-orange-light)"
                    >
                      <Text size="xs" c="dimmed">Lo que vale el desajuste</Text>
                      <Text size="lg" fw={700}>
                        {formatMXN(Math.abs(cuadre.delta_total))}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {cuadre.delta_total > 0
                          ? 'el papel cobra de más'
                          : 'lo capturado es de más'}
                      </Text>
                    </Card>
                  </Group>

                  <Stack gap="xs">
                    {diferencias.map((d) => (
                      <TarjetaDiferencia key={`${d.tipo}:${d.renglon_id}:${d.lote_id}`} d={d} />
                    ))}
                  </Stack>
                </>
              )}

              {!cerrada && (
                <>
                  <Textarea
                    label="Nota (opcional)" size="xs" autosize minRows={1} maxLength={255}
                    placeholder="Lo que quede pendiente de aclarar con el proveedor…"
                    value={nota} onChange={(e) => setNota(e.currentTarget.value)}
                  />

                  {incompletoPendiente && (
                    <Alert color="orange" variant="light" icon={<IconAlertTriangle size={16} />}>
                      <Stack gap="xs">
                        <Text size="sm">
                          {incompletoPendiente} Lo que quede sin resolver se guarda
                          igual, así que no se pierde.
                        </Text>
                        <Group gap="xs">
                          <Button
                            size="xs" color="orange" loading={cuadrar.isPending}
                            onClick={() => sellar(true)}
                          >
                            Cerrar dejándolo señalado
                          </Button>
                          <Button size="xs" variant="default" onClick={() => cuadrar.reset()}>
                            Seguir resolviendo
                          </Button>
                        </Group>
                      </Stack>
                    </Alert>
                  )}

                  {cuadrar.error && !incompletoPendiente && (
                    <Alert color="red" title="No se pudo cuadrar">
                      {(cuadrar.error as Error).message}
                    </Alert>
                  )}

                  <Group justify="flex-end">
                    <Button variant="default" onClick={onClose}>Cerrar</Button>
                    <Button
                      color={diferencias.length === 0 ? 'green' : 'yellow'}
                      loading={cuadrar.isPending}
                      onClick={() => sellar()}
                    >
                      {diferencias.length === 0
                        ? 'Todo coincide, cerrar la factura'
                        : 'Aplicar el papel y cerrar'}
                    </Button>
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
