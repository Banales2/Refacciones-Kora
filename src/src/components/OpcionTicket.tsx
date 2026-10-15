// Opciones de ticket para el Select de cada renglón de una factura de
// gasolinera. Mismo formato que las de vale (ver OpcionVale): en una sola línea
// —fecha, litros, costo, chofer, unidad, vale— el renglón se cortaba y había
// que adivinar cuál era cuál. La lista lo reparte en dos y el campo ya elegido
// muestra la forma corta.
//
// Lo que sí es propio de aquí: cada opción dice si COINCIDE con el renglón
// (mismos litros, o el mismo importe con IVA), y las que coinciden van arriba.
// Con 40 tickets de la misma gasolinera, encontrar el bueno era leerlos todos.
import { Badge, Group, Stack, Text } from '@mantine/core'
import type { ComboboxParsedItem, SelectProps } from '@mantine/core'
import type { RenglonFactura, TicketCandidato } from '../hooks/useFacturasGasolina'
import { formatFecha, formatMXN } from '../lib/formato'
import { normalizar } from './OpcionVale'

export type OpcionTicket = {
  value:     string
  label:     string
  fecha:     string
  litros:    number
  costo:     string
  chofer:    string
  unidad:    string
  vale:      string | null
  /** "ticket 2 de 3" cuando la recarga trae varios tanques. */
  numero:    string | null
  /** Días que se registró después de la factura; 0 si antes o el mismo día. */
  despues:   number
  coincide:  'litros' | 'importe' | null
  /** Todo lo que se puede teclear para encontrarlo, en minúsculas y sin acentos. */
  busqueda:  string
}

function numeroTicket(t: Pick<TicketCandidato, 'ticket_n' | 'tickets'>): string | null {
  return t.tickets > 1 ? `ticket ${t.ticket_n} de ${t.tickets}` : null
}

/** Lo que queda escrito en el campo al elegir. */
export function ticketLabelCorto(t: TicketCandidato): string {
  return `${formatFecha(t.fecha)} · ${t.litros} L · ${formatMXN(t.costo)} · ${t.conductor}`
}

/**
 * Mismo criterio que la propuesta del servidor: litros a tres decimales, o el
 * importe con IVA al centavo con litros casi iguales —solo si el IVA del
 * renglón no es estimado, que no cuadra al centavo—.
 */
function coincidencia(
  t: TicketCandidato,
  r: Pick<RenglonFactura, 'cantidad' | 'importe_con_iva' | 'iva_estimado'>,
): OpcionTicket['coincide'] {
  if (Math.round(t.litros * 1000) === Math.round(r.cantidad * 1000)) return 'litros'
  if (!r.iva_estimado
    && Math.round(t.costo * 100) === Math.round(r.importe_con_iva * 100)
    && Math.abs(t.litros - r.cantidad) <= 0.1) return 'importe'
  return null
}

export function opcionTicket(
  t: TicketCandidato,
  r: Pick<RenglonFactura, 'cantidad' | 'importe_con_iva' | 'iva_estimado'>,
): OpcionTicket {
  const fecha = formatFecha(t.fecha)
  return {
    value:    String(t.id),
    label:    ticketLabelCorto(t),
    fecha,
    litros:   t.litros,
    costo:    formatMXN(t.costo),
    chofer:   t.conductor,
    unidad:   t.vehiculo,
    vale:     t.vale_folio,
    numero:   numeroTicket(t),
    despues:  t.dias_despues,
    coincide: coincidencia(t, r),
    // El costo va en las dos formas —"9990" y "$9,990.00"— porque se teclea
    // como se lee en el ticket o como sale en la factura.
    busqueda: normalizar([
      fecha, String(t.litros), String(t.costo), formatMXN(t.costo),
      t.conductor, t.vehiculo, t.vale_folio ? `vale ${t.vale_folio}` : 'sin vale',
    ].join(' ')),
  }
}

/** Las que coinciden con el renglón arriba; dentro de cada grupo, el orden que traían. */
export function ordenarTickets(opciones: OpcionTicket[]): OpcionTicket[] {
  const peso = (o: OpcionTicket) => (o.coincide === 'litros' ? 0 : o.coincide === 'importe' ? 1 : 2)
  return opciones
    .map((o, i) => ({ o, i }))
    .sort((a, b) => peso(a.o) - peso(b.o) || a.i - b.i)
    .map(({ o }) => o)
}

export const renderOpcionTicket: SelectProps['renderOption'] = ({ option }) => {
  const o = option as unknown as OpcionTicket
  if (!o.chofer) return <Text size="sm">{o.label}</Text>
  return (
    <Group justify="space-between" wrap="nowrap" gap="sm" w="100%">
      <div style={{ minWidth: 0, flex: 1 }}>
        <Group gap={6} wrap="nowrap">
          <Text size="sm" fw={500} style={{ flexShrink: 0 }}>{o.litros} L · {o.costo}</Text>
          <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>{o.fecha}</Text>
        </Group>
        <Text size="xs" c="dimmed" truncate>
          {o.chofer} · {o.unidad}
          {o.vale ? ` · vale ${o.vale}` : ' · sin vale'}
          {o.numero ? ` · ${o.numero}` : ''}
        </Text>
      </div>
      <Stack gap={2} align="flex-end" style={{ flexShrink: 0 }}>
        {o.coincide === 'litros' && (
          <Badge variant="light" color="green" radius="sm">Mismos litros</Badge>
        )}
        {o.coincide === 'importe' && (
          <Badge variant="light" color="blue" radius="sm">Mismo importe</Badge>
        )}
        {/* La del sábado registrada el lunes, o una carga de después que no le
            toca a esta factura: quien concilia es quien lo sabe. */}
        {o.despues > 0 && (
          <Badge variant="light" color="orange" radius="sm">
            +{o.despues} día{o.despues === 1 ? '' : 's'}
          </Badge>
        )}
      </Stack>
    </Group>
  )
}

// Mantine filtra por la etiqueta; con esto se busca por palabras, en el orden
// que sea, en todo lo que la opción enseña.
export const filtrarTickets = ({ options, search }: { options: ComboboxParsedItem[]; search: string }) => {
  const palabras = normalizar(search).split(/\s+/).filter(Boolean)
  if (palabras.length === 0) return options
  return options.filter((o) => {
    const texto = (o as unknown as OpcionTicket).busqueda ?? normalizar((o as { label?: string }).label ?? '')
    return palabras.every((p) => texto.includes(p))
  })
}
