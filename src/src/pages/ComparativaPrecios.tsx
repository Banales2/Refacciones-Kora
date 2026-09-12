// La comparativa de precios, en pantalla.
//
// Hasta ahora solo existía como documento: se generaba un PDF o un Excel y la
// respuesta se leía fuera de la app. Eso servía para la junta de compras, pero
// no para la pregunta de todos los días —"¿a quién le compro esto?"—, y desde
// que la comparación incluye lo que ya se paga (ver
// `docs/comparacion-de-precios.md`) hay refacciones que solo existen ahí: las
// que nadie cotiza pero que sí se compran no aparecían en ninguna pantalla.
//
// Se exporta EXACTAMENTE lo que quedó en pantalla, igual que en los gastos del
// proveedor: el corte se elige una sola vez y el papel no puede discrepar de lo
// que se acaba de mirar.
import { useMemo, useState } from 'react'
import {
  Stack, Group, Text, Table, Loader, Center, Alert, Button, Paper, Badge,
  Tooltip, TextInput, NumberInput, Select, Modal, Anchor, Divider,
} from '@mantine/core'
import {
  IconArrowLeft, IconSearch, IconFileTypePdf, IconFileSpreadsheet,
  IconAlertTriangle,
} from '@tabler/icons-react'
import { formatMXN, formatFecha, formatFechaCorta } from '../lib/formato'
import { textoEntrega } from '../lib/reportes/comparativaPieza'
import {
  exportComparativaPreciosPdf, exportComparativaPreciosExcel,
} from '../lib/reportes/comparativaPrecios'
import { useComparativaPrecios } from '../hooks/usePreciosProveedor'
import type {
  ComparativaPrecios as Comparativa, FilaComparativa, PrecioDeProveedor,
} from '../hooks/usePreciosProveedor'

// ── Cómo se lee un precio ─────────────────────────────────────────────────────

// Espeja los textos del reporte (`lib/reportes/comparativaPrecios.ts`): una
// compra sin descuento declarado no es una compra sin descuento —hoy los
// precios se capturan ya descontados y sin desglosar—, así que decir "−0%"
// afirmaría algo que no se sabe.
function textoOrigen(p: PrecioDeProveedor): string {
  if (p.origen === 'cotizado') return `cotizado −${p.descuento_pct ?? 0}% est.`
  return p.descuento_pct ? `pagado −${p.descuento_pct}%` : 'pagado, sin desglose'
}

/**
 * Cómo se enseña que un precio se movió.
 *
 * Es lo que se lee cuando hay un solo proveedor: sin segunda columna no hay
 * comparación posible entre proveedores, y la única pregunta que queda —la que
 * de verdad se hace al abrir esto— es si a esa refacción le subieron el precio.
 * Subir va en rojo y bajar en verde: aquí se paga, no se cobra.
 */
function textoCambio(p: PrecioDeProveedor): string | null {
  if (p.cambio_pct == null) return null
  const signo = p.cambio_pct > 0 ? '+' : ''
  const desde = p.fecha_anterior ? ` vs. ${formatFechaCorta(p.fecha_anterior)}` : ''
  return `${signo}${p.cambio_pct.toFixed(1)}%${desde}`
}

function colorCambio(pct: number): string | undefined {
  if (pct > 0) return 'red'
  if (pct < 0) return 'teal'
  // Cero es información: se le compró otra vez y no se movió.
  return 'dimmed'
}

function OrigenBadge({ p }: { p: PrecioDeProveedor }) {
  return (
    <Badge size="xs" variant="light" color={p.origen === 'pagado' ? 'blue' : 'grape'}>
      {p.origen === 'pagado' ? 'Pagado' : 'Cotizado'}
    </Badge>
  )
}

/** Lo que hay detrás de un precio, para el tooltip de su celda. */
function detalleDelPrecio(p: PrecioDeProveedor): string {
  const partes = [textoOrigen(p), formatFecha(p.fecha)]
  if (p.descuento_pct) partes.push(`lista ${formatMXN(p.precio_lista)}`)
  // El historial de ese proveedor con esa refacción: cuántas veces, contra
  // cuánto estaba antes y de dónde viene. Es el contenido de la celda cuando
  // no hay con quién comparar.
  if (p.registros > 1) {
    const veces = p.origen === 'pagado'
      ? `${p.registros} compras`
      : `${p.registros} cotizaciones`
    partes.push(veces)
    if (p.precio_anterior != null) {
      partes.push(
        `antes ${formatMXN(p.precio_anterior)}` +
        (p.fecha_anterior ? ` (${formatFecha(p.fecha_anterior)})` : ''),
      )
    }
    if (p.cambio_total_pct != null) {
      partes.push(
        `${p.cambio_total_pct > 0 ? '+' : ''}${p.cambio_total_pct.toFixed(1)}% ` +
        `desde ${formatMXN(p.precio_primero)} (${formatFecha(p.fecha_primera)})`,
      )
    }
  }
  if (p.tiempo_entrega_dias != null) partes.push(`entrega ${textoEntrega(p.tiempo_entrega_dias)}`)
  if (p.otro) {
    partes.push(
      `también ${p.otro.origen} a ${formatMXN(p.otro.precio)} (${formatFecha(p.otro.fecha)})`,
    )
  }
  return partes.join(' · ')
}

// ── Detalle de una refacción ──────────────────────────────────────────────────

function DetalleModal({
  fila, descuentoRef, onClose,
}: {
  fila: FilaComparativa | null
  descuentoRef: number
  onClose: () => void
}) {
  return (
    <Modal
      opened={fila !== null}
      onClose={onClose}
      size="lg"
      centered
      title={fila ? `${fila.numero_serie} — ${fila.descripcion}` : ''}
    >
      {fila && (
        <Stack gap="md">
          <Group gap="xs">
            <Badge variant="light" color="gray">{fila.tipo_pieza ?? 'Sin tipo'}</Badge>
            <Badge variant="light">
              {fila.precios.length} proveedor{fila.precios.length !== 1 ? 'es' : ''} con precio
            </Badge>
          </Group>

          {fila.ahorro_unitario != null && (
            <Alert color="orange" icon={<IconAlertTriangle size={16} />}
              title={`${formatMXN(fila.ahorro_unitario)} de más por unidad`}>
              La última compra fue a {fila.ultimo_proveedor} por{' '}
              {formatMXN(fila.ultimo_pagado!)}
              {fila.ultima_compra && ` el ${formatFecha(fila.ultima_compra)}`}, y hoy
              se consigue en {formatMXN(fila.mejor_precio)} con {fila.mejor_proveedor}.
            </Alert>
          )}

          <Table verticalSpacing="xs" fz="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Proveedor</Table.Th>
                <Table.Th style={{ width: 120, textAlign: 'right' }}>Precio</Table.Th>
                <Table.Th style={{ width: 110 }}>Origen</Table.Th>
                <Table.Th style={{ width: 110, textAlign: 'right' }}>Lista</Table.Th>
                <Table.Th style={{ width: 100 }}>Entrega</Table.Th>
                <Table.Th style={{ width: 110 }}>Fecha</Table.Th>
                <Table.Th style={{ width: 150 }}>Cómo cambió</Table.Th>
                <Table.Th style={{ width: 90, textAlign: 'right' }}>vs mejor</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {fila.precios.map((p, i) => (
                <Table.Tr key={`${p.proveedor_id}-${p.origen}`}>
                  <Table.Td>
                    <Text size="sm" fw={i === 0 ? 600 : 400}>{p.proveedor}</Text>
                    {p.otro && (
                      <Text size="xs" c="dimmed">
                        también {p.otro.origen} a {formatMXN(p.otro.precio)}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>
                    <Text size="sm" fw={600} c={i === 0 ? 'green' : undefined}>
                      {formatMXN(p.precio)}
                    </Text>
                  </Table.Td>
                  <Table.Td><OrigenBadge p={p} /></Table.Td>
                  {/* Sin desglose no hay precio de lista que enseñar: el número
                      capturado ya venía descontado. */}
                  <Table.Td style={{ textAlign: 'right' }} c={p.descuento_pct ? undefined : 'dimmed'}>
                    <Text size="sm">{p.descuento_pct ? formatMXN(p.precio_lista) : '—'}</Text>
                  </Table.Td>
                  <Table.Td c={p.tiempo_entrega_dias == null ? 'dimmed' : undefined}>
                    <Text size="sm">{textoEntrega(p.tiempo_entrega_dias)}</Text>
                  </Table.Td>
                  <Table.Td><Text size="sm">{formatFecha(p.fecha)}</Text></Table.Td>
                  <Table.Td>
                    {p.cambio_pct == null ? (
                      <Text size="xs" c="dimmed">
                        {p.origen === 'pagado' ? 'Primera compra' : 'Primera cotización'}
                      </Text>
                    ) : (
                      <>
                        <Text size="sm" fw={500} c={colorCambio(p.cambio_pct)}>
                          {textoCambio(p)}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {p.registros} {p.origen === 'pagado' ? 'compras' : 'cotizaciones'}
                          {p.cambio_total_pct != null &&
                            ` · ${p.cambio_total_pct > 0 ? '+' : ''}${p.cambio_total_pct.toFixed(1)}% desde ${formatFechaCorta(p.fecha_primera)}`}
                        </Text>
                      </>
                    )}
                  </Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>
                    <Text size="sm" c={i === 0 ? 'green' : p.sobre_mejor >= 25 ? 'red' : undefined}>
                      {i === 0 ? 'el más barato' : `+${p.sobre_mejor.toFixed(1)}%`}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>

          <Text size="xs" c="dimmed">
            Todos los precios van con descuento aplicado: el de su factura cuando
            salen de una compra, y el estimado de {descuentoRef}% cuando salen de
            una cotización, que es como las mandan los proveedores.
          </Text>
        </Stack>
      )}
    </Modal>
  )
}

// ── La tabla ──────────────────────────────────────────────────────────────────

function TablaPivote({
  c, onAbrir,
}: {
  c: Comparativa
  onAbrir: (fila: FilaComparativa) => void
}) {
  return (
    <Table.ScrollContainer minWidth={480 + c.proveedores.length * 150}>
      <Table striped highlightOnHover withTableBorder stickyHeader verticalSpacing="xs">
        <Table.Thead>
          <Table.Tr>
            <Table.Th style={{ width: 300 }}>Refacción</Table.Th>
            {c.proveedores.map((pv) => (
              <Table.Th key={pv.id} style={{ width: 150, textAlign: 'right' }}>{pv.nombre}</Table.Th>
            ))}
            <Table.Th style={{ width: 120, textAlign: 'right' }}>Diferencia</Table.Th>
            <Table.Th style={{ width: 120, textAlign: 'right' }}>Ahorro/unidad</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {c.piezas.map((p) => (
            <Table.Tr key={p.pieza_id} style={{ cursor: 'pointer' }} onClick={() => onAbrir(p)}>
              <Table.Td>
                <Text size="sm" fw={500}>{p.descripcion}</Text>
                <Text size="xs" c="dimmed">
                  {p.numero_serie}{p.tipo_pieza && ` · ${p.tipo_pieza}`}
                </Text>
              </Table.Td>
              {c.proveedores.map((pv) => {
                const precio = p.precios.find((x) => x.proveedor_id === pv.id)
                if (!precio) {
                  return (
                    <Table.Td key={pv.id} style={{ textAlign: 'right' }}>
                      <Text size="sm" c="dimmed">—</Text>
                    </Table.Td>
                  )
                }
                const esMejor = precio.sobre_mejor === 0
                return (
                  <Table.Td key={pv.id} style={{ textAlign: 'right' }}>
                    <Tooltip label={detalleDelPrecio(precio)} multiline w={280}>
                      <div>
                        <Text size="sm" fw={esMejor ? 700 : 400} c={esMejor ? 'green' : undefined}>
                          {formatMXN(precio.precio)}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {precio.origen === 'pagado' ? 'pagado' : 'cotizado'}
                          {!esMejor && ` · +${precio.sobre_mejor.toFixed(0)}%`}
                        </Text>
                        {/* Cómo se movió contra la vez anterior. Solo aparece
                            si hay una vez anterior: inventar un 0% donde solo
                            hay un registro diría que el precio se sostuvo. */}
                        {precio.cambio_pct != null && (
                          <Text size="xs" fw={500} c={colorCambio(precio.cambio_pct)}>
                            {precio.cambio_pct > 0 ? '▲' : precio.cambio_pct < 0 ? '▼' : '='}{' '}
                            {textoCambio(precio)}
                          </Text>
                        )}
                      </div>
                    </Tooltip>
                  </Table.Td>
                )
              })}
              <Table.Td style={{ textAlign: 'right' }}>
                {p.precios.length > 1 ? (
                  <>
                    <Text size="sm" fw={500} c={p.diferencia_pct >= 25 ? 'red' : undefined}>
                      {formatMXN(p.diferencia)}
                    </Text>
                    <Text size="xs" c="dimmed">{p.diferencia_pct.toFixed(1)}%</Text>
                  </>
                ) : (
                  <Tooltip label="Solo un proveedor tiene precio: no hay con qué compararlo">
                    <Text size="sm" c="dimmed">—</Text>
                  </Tooltip>
                )}
              </Table.Td>
              <Table.Td style={{ textAlign: 'right' }}>
                {p.ahorro_unitario != null ? (
                  <Text size="sm" fw={600} c="orange">{formatMXN(p.ahorro_unitario)}</Text>
                ) : (
                  <Text size="sm" c="dimmed">—</Text>
                )}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  )
}

// ── Página ────────────────────────────────────────────────────────────────────

export default function ComparativaPrecios({ onBack }: { onBack: () => void }) {
  // El descuento que se supone sobre una cotización para compararla contra
  // compras que ya vienen descontadas. Por volumen casi siempre nos hacen ~10%;
  // se mueve para las excepciones y no se guarda en ningún lado.
  const [descuentoRef, setDescuentoRef] = useState<number | string>(10)
  const [busqueda, setBusqueda] = useState('')
  const [tipo, setTipo] = useState<string | null>(null)
  const [detalle, setDetalle] = useState<FilaComparativa | null>(null)
  const [exportando, setExportando] = useState<'pdf' | 'excel' | null>(null)

  const descRef = typeof descuentoRef === 'number' ? descuentoRef : 10
  const { data, isLoading, isError } = useComparativaPrecios(descRef)
  const todo = data?.data

  const tipos = useMemo(
    () => [...new Set((todo?.piezas ?? []).map((p) => p.tipo_pieza).filter((t): t is string => !!t))]
      .sort((a, b) => a.localeCompare(b, 'es-MX')),
    [todo],
  )

  // El corte se aplica en memoria: la comparativa cabe de sobra en una consulta
  // y así el filtro responde sin ir al servidor en cada tecla. Los totales se
  // recalculan sobre lo filtrado —son derivados— para que el resumen y el
  // documento digan lo mismo que la tabla.
  const vista = useMemo<Comparativa | null>(() => {
    if (!todo) return null
    const q = busqueda.trim().toLowerCase()
    const piezas = todo.piezas.filter((p) => {
      if (tipo && p.tipo_pieza !== tipo) return false
      if (!q) return true
      return [p.numero_serie, p.descripcion, p.tipo_pieza]
        .some((x) => x?.toLowerCase().includes(q)) ||
        p.precios.some((x) => x.proveedor.toLowerCase().includes(q))
    })
    // Solo las columnas de proveedores que siguen apareciendo: con el filtro
    // puesto, una columna entera vacía es ruido.
    const vivos = new Set(piezas.flatMap((p) => p.precios.map((x) => x.proveedor_id)))
    return {
      ...todo,
      piezas,
      proveedores: todo.proveedores.filter((pv) => vivos.has(pv.id)),
      totales: {
        refacciones: piezas.length,
        comparables: piezas.filter((p) => p.precios.length > 1).length,
        con_alza:    piezas.filter((p) => p.alza_pct != null).length,
        ahorro_unitario_total: Math.round(
          piezas.reduce((s, p) => s + (p.ahorro_unitario ?? 0), 0) * 100) / 100,
      },
    }
  }, [todo, busqueda, tipo])

  async function exportar(formato: 'pdf' | 'excel') {
    if (!vista) return
    setExportando(formato)
    try {
      await (formato === 'pdf' ? exportComparativaPreciosPdf : exportComparativaPreciosExcel)(vista)
    } catch (e) {
      alert((e as Error).message)
    } finally {
      setExportando(null)
    }
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

        <div>
          <Text size="xl" fw={600}>Comparativa de precios</Text>
          <Text size="sm" c="dimmed">
            Lo que cuesta cada refacción con cada proveedor, siempre con descuento
            aplicado. Entra tanto lo que cotizan como lo que ya se les paga.
          </Text>
        </div>

        <Paper withBorder p="md" radius="md">
          <Group align="flex-end" gap="sm" wrap="wrap">
            <TextInput
              style={{ flex: '1 1 240px' }}
              label="Buscar"
              placeholder="Refacción, número de parte o proveedor…"
              leftSection={<IconSearch size={14} />}
              value={busqueda}
              onChange={(e) => setBusqueda(e.currentTarget.value)}
            />
            <Select
              style={{ flex: '0 1 220px' }}
              label="Tipo de pieza"
              placeholder="Todos"
              data={tipos}
              value={tipo}
              onChange={setTipo}
              clearable
              searchable
            />
            {/* Las cotizaciones vienen a precio de lista y las compras ya con el
                descuento de su factura. Sin traerlas a la misma base, el
                proveedor que cotiza sale caro siempre. */}
            <NumberInput
              style={{ flex: '0 1 200px' }}
              label="Descuento que nos hacen"
              description="Se aplica a las cotizaciones"
              suffix="%"
              min={0}
              max={99}
              decimalScale={2}
              value={descuentoRef}
              onChange={setDescuentoRef}
            />
            <Group gap="xs">
              <Button
                variant="light" leftSection={<IconFileTypePdf size={16} />}
                loading={exportando === 'pdf'}
                disabled={!vista || vista.piezas.length === 0 || exportando !== null}
                onClick={() => exportar('pdf')}
              >
                PDF
              </Button>
              <Button
                variant="light" color="green" leftSection={<IconFileSpreadsheet size={16} />}
                loading={exportando === 'excel'}
                disabled={!vista || vista.piezas.length === 0 || exportando !== null}
                onClick={() => exportar('excel')}
              >
                Excel
              </Button>
            </Group>
          </Group>
        </Paper>

        {isLoading ? (
          <Center py="xl"><Loader /></Center>
        ) : isError || !vista ? (
          <Alert color="red" title="Error al cargar">
            No se pudo obtener la comparativa. Verifica la conexión.
          </Alert>
        ) : todo!.piezas.length === 0 ? (
          <Center py="xl">
            <Stack align="center" gap="xs">
              <Text c="dimmed">Todavía no hay nada que comparar.</Text>
              <Text size="sm" c="dimmed">
                Una refacción entra aquí en cuanto alguien la cotiza o en cuanto
                se registra una compra suya.
              </Text>
            </Stack>
          </Center>
        ) : (
          <>
            <Paper withBorder p="md" radius="md">
              <Group justify="space-between" wrap="wrap" gap="md">
                <Group gap="xl" wrap="wrap">
                  <div>
                    <Text size="xs" c="dimmed" fw={600} tt="uppercase">Refacciones</Text>
                    <Text size="xl" fw={700}>{vista.totales.refacciones}</Text>
                  </div>
                  <div>
                    <Tooltip label="Las que tienen precio de dos o más proveedores: las únicas que se pueden comparar">
                      <Text size="xs" c="dimmed" fw={600} tt="uppercase">Comparables</Text>
                    </Tooltip>
                    <Text size="xl" fw={700}>{vista.totales.comparables}</Text>
                  </div>
                  <div>
                    <Tooltip label="Refacciones cuyo precio subió respecto del registro anterior de ese mismo proveedor. No necesitan un segundo proveedor para verse.">
                      <Text size="xs" c="dimmed" fw={600} tt="uppercase">Subieron de precio</Text>
                    </Tooltip>
                    <Text size="xl" fw={700} c={vista.totales.con_alza > 0 ? 'red' : undefined}>
                      {vista.totales.con_alza}
                    </Text>
                  </div>
                  <div>
                    <Tooltip label="Suma del sobreprecio por unidad de lo que hoy se compra más caro de lo necesario. Multiplícalo por el volumen que se compre.">
                      <Text size="xs" c="dimmed" fw={600} tt="uppercase">Ahorro por unidad</Text>
                    </Tooltip>
                    <Text size="xl" fw={700} c={vista.totales.ahorro_unitario_total > 0 ? 'orange' : undefined}>
                      {formatMXN(vista.totales.ahorro_unitario_total)}
                    </Text>
                  </div>
                </Group>
                <Text size="xs" c="dimmed" maw={280}>
                  Las cotizaciones se estiman con {descRef}% de descuento; las
                  compras llevan el de su factura.
                </Text>
              </Group>
            </Paper>

            {vista.piezas.length === 0 ? (
              <Center py="xl">
                <Stack align="center" gap="xs">
                  <Text c="dimmed">Ninguna refacción coincide con el filtro.</Text>
                  <Text size="sm" c="dimmed">Limpia la búsqueda o cambia el tipo.</Text>
                </Stack>
              </Center>
            ) : (
              <>
                <Divider />
                <Text size="xs" c="dimmed">
                  Abre una refacción para ver de dónde sale cada precio. Ordenadas
                  por dónde hay más margen para negociar.
                </Text>
                <TablaPivote c={vista} onAbrir={setDetalle} />
              </>
            )}
          </>
        )}
      </Stack>

      <DetalleModal
        fila={detalle}
        descuentoRef={descRef}
        onClose={() => setDetalle(null)}
      />
    </>
  )
}
