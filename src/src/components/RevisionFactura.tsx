// El estado de la revisión de una factura, en pantalla.
//
// Quien captura no es quien verifica. La verificación misma —teclear lo que dice
// el papel y compararlo contra lo guardado— vive en `CuadreFactura`; aquí solo
// están las piezas que enseñan en qué va: la insignia del listado y el sello.
//
// Ver `db/migrations/040_revision_de_facturas.sql`.
import {
  Alert, Badge, Button, Group, Text, Tooltip,
} from '@mantine/core'
import { IconCheck, IconLock, IconLockOpen } from '@tabler/icons-react'
import type { Factura } from '../hooks/useFacturas'
import { useReabrirFactura } from '../hooks/useRevision'
import { formatFecha } from '../lib/formato'

/** El estado de la factura de un vistazo, para la cabecera del acordeón. */
export function EstadoRevision({ factura }: { factura: Factura }) {
  if (factura.cerrada) {
    return (
      <Tooltip label={`Revisada por ${factura.cabecera_revisada_por ?? '—'}`}>
        <Badge size="xs" variant="light" color="green" leftSection={<IconCheck size={11} />}>
          Revisada
        </Badge>
      </Tooltip>
    )
  }

  // Las dos mitades del papel cuentan igual: los renglones de refacción y los
  // servicios de taller que cobra. Una factura de puro taller tiene cero
  // renglones, y medir el avance solo con esos diría "0/0 revisados" de algo que
  // sí tiene trabajo pendiente. Ver `docs/facturas-de-mantenimiento.md`.
  const total = factura.renglones + factura.mano_obra
  const revisados = factura.renglones_revisados + factura.mano_obra_revisada
  const faltan = total - revisados
  const empezada = factura.cabecera_revisada_en !== null || revisados > 0

  return (
    <Tooltip
      label={
        factura.cabecera_revisada_en === null && faltan === total
          ? 'Nadie la ha cuadrado todavía contra el papel'
          : `Faltan ${faltan} renglón(es)${factura.cabecera_revisada_en === null ? ' y los datos de la factura' : ''}`
      }
    >
      <Badge size="xs" variant="light" color={empezada ? 'yellow' : 'gray'}>
        {empezada ? `${revisados}/${total} revisados` : 'Por revisar'}
      </Badge>
    </Tooltip>
  )
}

/**
 * El sello de la factura, debajo de sus renglones.
 *
 * Sellada, dice quién y cuándo, y le da al admin el botón para reabrirla. Sin
 * sellar no ofrece nada que hacer: la factura se revisa en el cuadre, que
 * compara el papel completo —cabecera incluida— y lo sella todo de una vez.
 * Hubo aquí un formulario para revisar la cabecera por su lado, y se quitó:
 * sellaba la cabecera sola y la factura ya no se podía cuadrar.
 */
export function SelloFactura({
  factura, esAdmin,
}: {
  factura: Factura
  esAdmin: boolean
}) {
  const reabrir = useReabrirFactura()

  if (factura.cabecera_revisada_en !== null) {
    return (
      <Alert color="green" variant="light" icon={<IconLock size={16} />}>
        <Group justify="space-between" wrap="nowrap">
          <div>
            <Text size="sm">
              Cuadrada por <b>{factura.cabecera_revisada_por}</b> el{' '}
              {formatFecha(factura.cabecera_revisada_en.slice(0, 10))}.
              {factura.renglones_revisados < factura.renglones && (
                <> Faltan {factura.renglones - factura.renglones_revisados} renglón(es).</>
              )}
            </Text>
            {factura.revision_nota && (
              <Text size="xs" c="dimmed" mt={4}>Nota: {factura.revision_nota}</Text>
            )}
          </div>
          {esAdmin && (
            // Sin esto una factura sellada no la puede corregir nadie, ni un
            // admin: un error descubierto después quedaría congelado para
            // siempre. Las correcciones ya registradas no se borran al reabrir.
            <Tooltip label="Quita los sellos para poder corregirla" position="left">
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
        {reabrir.error && (
          <Text size="xs" c="red" mt={6}>{(reabrir.error as Error).message}</Text>
        )}
      </Alert>
    )
  }

  if (esAdmin) return null

  return (
    <Alert color="gray" variant="light">
      <Text size="sm">Esta factura todavía no se ha cuadrado contra el papel.</Text>
    </Alert>
  )
}
