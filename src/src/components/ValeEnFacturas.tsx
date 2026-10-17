// Lo que sale arriba de la lista de facturas de gas cuando lo buscado es el
// folio de un vale: su recarga y la factura que la cobra.
//
// El buscador de facturas ya encuentra por vale, pero solo las que tienen el
// renglón casado y guardado. En una factura abierta la propuesta del cuadre no
// se guarda hasta conciliar, así que ahí el vale no aparecía aunque su carga
// estuviera en el papel. Por eso, si nadie la ha casado, aquí salen las
// facturas abiertas que probablemente la cobran: su gasolinera, dentro del
// corte, con un renglón libre que la propuesta le daría (mismos litros, o
// mismo importe con IVA).
import { Alert, Anchor, Badge, Group, Stack, Text } from '@mantine/core'
import { IconTicket } from '@tabler/icons-react'
import { useBuscarPorVale } from '../hooks/useFacturasGasolina'
import type { FacturaDelTicket, ValeEncontrado } from '../hooks/useFacturasGasolina'
import { ESTADO_VALE } from '../hooks/useValesGasolina'
import { formatFecha, formatMXN } from '../lib/formato'

function EnlaceFactura({ f, onAbrir }: { f: FacturaDelTicket; onAbrir: (id: number) => void }) {
  return (
    <Anchor component="button" type="button" size="sm" fw={600} onClick={() => onAbrir(f.factura_id)}>
      {f.folio}
      <Text component="span" size="xs" c="dimmed" fw={400}>
        {' '}del {formatFecha(f.fecha)} · {f.conciliada ? 'conciliada' : 'abierta'}
      </Text>
    </Anchor>
  )
}

function Vale({ v, onAbrir }: { v: ValeEncontrado; onAbrir: (id: number) => void }) {
  const est = ESTADO_VALE[v.estado]
  return (
    <Stack gap={4}>
      <Group gap={6}>
        <Text size="sm" fw={600}>Vale {v.folio}</Text>
        <Badge size="xs" variant="light" color={est.color}>{est.label}</Badge>
        <Text size="xs" c="dimmed">{v.conductor} · {v.vehiculo} · entregado {formatFecha(v.fecha)}</Text>
      </Group>

      {v.recarga_id === null ? (
        <Text size="xs" c="dimmed">No se ha usado en ninguna recarga, así que ninguna factura lo cobra.</Text>
      ) : v.emergencia || !v.gasolinera ? (
        <Text size="xs" c="dimmed">Su recarga no tiene gasolinera: ninguna factura la cobra.</Text>
      ) : (
        <>
          <Text size="xs">
            Se usó en la recarga del {formatFecha(v.recarga_fecha!)} en <b>{v.gasolinera}</b>.
          </Text>
          {v.tickets.map((t) => (
            <Group key={t.ticket_id} gap={6} pl="sm" wrap="wrap">
              <Text size="xs" c="dimmed">
                {t.tickets > 1 ? `Ticket ${t.ticket_n} de ${t.tickets} · ` : ''}
                {t.litros} L · {formatMXN(t.costo)} →
              </Text>
              {t.casado_en ? (
                <EnlaceFactura f={t.casado_en} onAbrir={onAbrir} />
              ) : t.posibles.length > 0 ? (
                <>
                  <Text size="xs" c="orange.7">
                    Sin casar todavía; {t.posibles.length === 1 ? 'probablemente la cobra' : 'puede ser de'}
                  </Text>
                  {t.posibles.map((f) => <EnlaceFactura key={f.factura_id} f={f} onAbrir={onAbrir} />)}
                </>
              ) : (
                <Text size="xs" c="dimmed">Ninguna factura la cobra todavía.</Text>
              )}
            </Group>
          ))}
        </>
      )}
    </Stack>
  )
}

export default function ValeEnFacturas({
  texto, onAbrir,
}: {
  texto: string
  onAbrir: (facturaId: number) => void
}) {
  const { data } = useBuscarPorVale(texto)
  const vales = data?.data ?? []
  if (vales.length === 0) return null

  return (
    <Alert color="blue" variant="light" icon={<IconTicket size={16} />}
      title={vales.length === 1 ? 'Vale encontrado' : `${vales.length} vales con ese folio`}>
      <Stack gap="sm">
        {vales.map((v) => <Vale key={v.vale_id} v={v} onAbrir={onAbrir} />)}
      </Stack>
    </Alert>
  )
}
