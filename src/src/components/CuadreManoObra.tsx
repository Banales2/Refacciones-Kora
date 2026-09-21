// La mano de obra del papel, dentro del cuadre de la factura.
//
// POR QUÉ ESTO VIVE EN LA MISMA PANTALLA QUE LAS REFACCIONES. Porque es el mismo
// papel. El taller cobra las piezas y el trabajo en un solo documento, con un
// folio, un IVA y un descuento; partir eso en dos pantallas obligaría a capturar
// la cabecera dos veces y dejaría "cuánto cobra esta factura" sin una respuesta.
// Son dos transcripciones y dos listas de diferencias sobre una sola factura.
//
// LO QUE SE COMPARA ES UN IMPORTE CONTRA `mantenimiento.costo`. La mano de obra
// ya se capturaba desde siempre al registrar el servicio; lo que no había era
// nada que comprobara que ese número es el que dice el papel.
//
// NO SE PROPONE NADA. En refacciones el servidor empareja por pieza, cantidad y
// costo porque el papel solo trae una descripción y hay que inferir el renglón.
// Aquí el vínculo se elige: dos servicios del mismo taller pueden costar lo mismo
// sin ser el mismo trabajo, y casarlos por importe acertaría a veces y se
// equivocaría en silencio el resto. Lo decide una persona viendo la unidad y la
// fecha, que es lo que el papel también trae.
//
// Ver `docs/facturas-de-mantenimiento.md`.
import { useState } from 'react'
import {
  Alert, Badge, Button, Card, Group, NumberInput, Stack, Table, Text, Tooltip,
} from '@mantine/core'
import { IconAlertTriangle, IconCopy, IconPlus, IconTrash } from '@tabler/icons-react'
import {
  useCandidatosManoObra, useGuardarManoObra, MANTENIMIENTO_YA_FACTURADO,
} from '../hooks/useFacturasMantenimiento'
import type { MantenimientoCandidato, RenglonManoObraPayload } from '../hooks/useFacturasMantenimiento'
import type { Cuadre, DiferenciaManoObra } from '../hooks/useCuadreFactura'
import { SelectCatalogo } from './SelectCatalogo'
import { ApiError } from '../lib/api'
import { formatMXN, formatFecha } from '../lib/formato'
import { totalesFactura } from '../lib/totales'

/** Una fila de la transcripción mientras se está capturando. */
interface FilaManoObra {
  mantenimiento_id: number | null
  importe: number | string
}

const TITULO_TIPO: Record<DiferenciaManoObra['tipo'], string> = {
  sin_registrar: 'El papel lo cobra y nadie registró el servicio',
  valores: 'Registrado con otro costo',
}

const COLOR_TIPO: Record<DiferenciaManoObra['tipo'], string> = {
  sin_registrar: 'orange',
  valores: 'yellow',
}

/**
 * Una diferencia de mano de obra.
 *
 * No trae acción al lado, y es la diferencia con las de refacciones. Resolver un
 * `sin_registrar` es dar de alta un mantenimiento entero —vehículo, fecha,
 * kilometraje, qué incidencias cerró—, no rellenar un campo: eso se hace en el
 * expediente de la unidad, donde están los datos. Un `valores` sí se resuelve
 * aquí, al cerrar: el importe del papel pisa al capturado.
 */
function TarjetaDiferencia({ d }: { d: DiferenciaManoObra }) {
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

          <Text size="sm" fw={600} mt={4}>
            {d.vehiculo ?? 'Servicio sin registrar'}
          </Text>
          <Text size="xs" c="dimmed">
            {[d.fecha ? formatFecha(d.fecha) : null, d.tipo_servicio]
              .filter(Boolean).join(' · ') || 'El papel no dice a qué unidad'}
          </Text>

          <Group gap="lg" mt={6}>
            <Text size="xs">Papel: <b>{formatMXN(d.papel)}</b></Text>
            <Text size="xs">
              Sistema:{' '}
              {d.sistema !== null
                ? <b>{formatMXN(d.sistema)}</b>
                : <Text component="span" c="dimmed">sin registrar</Text>}
            </Text>
          </Group>

          {d.tipo === 'sin_registrar' && (
            <Text size="xs" c="dimmed" mt={6}>
              Regístralo en el expediente de la unidad, o cierra la factura dejándolo
              señalado si el papel es el que está mal.
            </Text>
          )}
        </div>

        <Tooltip
          label={d.delta_dinero > 0
            ? 'El papel cobra más de lo que está registrado'
            : 'Lo registrado es más de lo que cobra el papel'}
        >
          <Text
            size="sm" fw={700} style={{ whiteSpace: 'nowrap' }}
            c={d.delta_dinero > 0 ? 'orange.7' : 'blue.7'}
          >
            {d.delta_dinero > 0 ? '+' : '−'}{formatMXN(Math.abs(d.delta_dinero))}
          </Text>
        </Tooltip>
      </Group>
    </Card>
  )
}

/** Cómo se lee un candidato en el selector: lo que el papel también trae. */
function etiqueta(m: MantenimientoCandidato): string {
  const partes = [
    m.fecha ? formatFecha(m.fecha) : 'sin fecha',
    m.vehiculo,
    m.tipo ?? null,
    formatMXN(m.costo),
  ].filter(Boolean)
  return partes.join(' · ')
}

export function TranscripcionManoObra({ cuadre }: { cuadre: Cuadre }) {
  const candidatos = useCandidatosManoObra(cuadre.factura.id)
  const guardar = useGuardarManoObra()

  const [filas, setFilas] = useState<FilaManoObra[]>(
    () => cuadre.renglones_mano_obra.map((r) => ({
      mantenimiento_id: r.mantenimiento_id,
      importe: r.importe,
    })),
  )

  const lista = candidatos.data?.data ?? []
  const porId = new Map(lista.map((m) => [m.id, m]))

  // Los ya elegidos en otra fila no se vuelven a ofrecer: dos renglones del mismo
  // papel cobrando el mismo servicio es un error de captura, y la API lo rechaza.
  const opciones = (i: number) => {
    const tomados = new Set(
      filas.map((f, j) => (j === i ? null : f.mantenimiento_id)).filter((x): x is number => x !== null),
    )
    return lista
      .filter((m) => !tomados.has(m.id))
      .map((m) => ({ value: String(m.id), label: etiqueta(m) }))
  }

  const subtotal = filas.reduce((s, f) => s + (Number(f.importe) || 0), 0)
  const total = totalesFactura(
    subtotal, cuadre.factura.descuento_pct, cuadre.factura.tasa_iva,
  ).total

  // El importe en blanco no se puede guardar; el servicio sin elegir sí — que el
  // papel cobre un trabajo que nadie registró es justo el hallazgo.
  const incompleta = filas.some((f) => f.importe === '' || Number(f.importe) < 0)

  const yaFacturado =
    guardar.error instanceof ApiError && guardar.error.code === MANTENIMIENTO_YA_FACTURADO

  function copiarRegistrado() {
    setFilas(lista.map((m) => ({ mantenimiento_id: m.id, importe: m.costo })))
  }

  function enviar() {
    const renglones: RenglonManoObraPayload[] = filas.map((f) => ({
      mantenimiento_id: f.mantenimiento_id,
      importe: Number(f.importe),
    }))
    guardar.mutate({ factura_id: cuadre.factura.id, renglones })
  }

  return (
    <Stack gap="sm">
      <Group justify="space-between" align="center">
        <div>
          <Text size="sm" fw={600}>La mano de obra que cobra el papel</Text>
          <Text size="xs" c="dimmed">
            Un importe por servicio. Si el papel lo desglosa en varias líneas, captura la suma.
          </Text>
        </div>
        <Group gap="xs">
          <Tooltip label="Parte de los servicios registrados de este taller y corrige lo que no coincida">
            <Button
              size="xs" variant="subtle" leftSection={<IconCopy size={14} />}
              disabled={lista.length === 0}
              onClick={copiarRegistrado}
            >
              Copiar lo registrado
            </Button>
          </Tooltip>
          <Button
            size="xs" variant="light" leftSection={<IconPlus size={14} />}
            onClick={() => setFilas((p) => [...p, { mantenimiento_id: null, importe: '' }])}
          >
            Agregar renglón
          </Button>
        </Group>
      </Group>

      {candidatos.data && lista.length === 0 && filas.length === 0 && (
        <Alert color="gray" variant="light">
          Este taller no tiene servicios registrados sin facturar con fecha anterior a
          la factura. Si el papel cobra mano de obra, agrega el renglón sin elegir
          servicio: va a salir señalado como no registrado, que es la verdad.
        </Alert>
      )}

      {filas.length > 0 && (
        <Table withTableBorder striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Servicio</Table.Th>
              <Table.Th w={150} style={{ textAlign: 'right' }}>Importe del papel</Table.Th>
              <Table.Th w={140} style={{ textAlign: 'right' }}>Registrado</Table.Th>
              <Table.Th w={40} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {filas.map((f, i) => {
              const m = f.mantenimiento_id !== null ? porId.get(f.mantenimiento_id) : undefined
              return (
                <Table.Tr key={i}>
                  <Table.Td>
                    <SelectCatalogo
                      size="xs" nombre="mantenimientos" estado={candidatos}
                      placeholder="Busca por unidad o fecha…"
                      data={opciones(i)}
                      value={f.mantenimiento_id !== null ? String(f.mantenimiento_id) : null}
                      onChange={(v) => setFilas((p) => p.map((x, j) =>
                        j === i ? { ...x, mantenimiento_id: v ? Number(v) : null } : x))}
                    />
                  </Table.Td>
                  <Table.Td>
                    <NumberInput
                      size="xs" min={0} decimalScale={2} prefix="$" thousandSeparator=","
                      placeholder="0.00"
                      styles={{ input: { textAlign: 'right' } }}
                      value={f.importe}
                      onChange={(v) => setFilas((p) => p.map((x, j) =>
                        j === i ? { ...x, importe: v } : x))}
                    />
                  </Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>
                    <Text size="sm" c={m ? undefined : 'dimmed'}>
                      {m ? formatMXN(m.costo) : 'sin registrar'}
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
              )
            })}
          </Table.Tbody>
        </Table>
      )}

      <Group justify="space-between" align="flex-end">
        <Text size="sm">
          Mano de obra del papel <b>{formatMXN(subtotal)}</b>
          {(cuadre.factura.tasa_iva != null || cuadre.factura.descuento_pct != null) && (
            <Text component="span" size="xs" c="dimmed">
              {' '}· con IVA y descuento {formatMXN(total)}
            </Text>
          )}
        </Text>
        <Button
          size="xs"
          disabled={incompleta}
          loading={guardar.isPending}
          onClick={enviar}
        >
          Comparar con lo registrado
        </Button>
      </Group>

      {guardar.error && (
        <Alert color={yaFacturado ? 'orange' : 'red'} title="No se pudo guardar">
          {(guardar.error as Error).message}
        </Alert>
      )}
    </Stack>
  )
}

/**
 * Las diferencias de mano de obra, para el bloque de diferencias del cuadre.
 *
 * EL COBRO SIN SERVICIO REGISTRADO SE ANUNCIA APARTE, y no es decoración. Las
 * otras diferencias son un número mal tecleado; esta son dos cosas distintas y
 * las dos caras:
 *
 *   - el trabajo se hizo y nadie lo capturó -> hay gasto fuera de los libros, y
 *     además el expediente del camión no dice que estuvo en el taller.
 *   - el trabajo no se hizo -> el taller está cobrando algo que no debe.
 *
 * El sistema no puede saber cuál de las dos es; la única que puede es la persona
 * con el papel en la mano. Por eso se le dice con todas sus letras en vez de
 * dejarlo como una etiqueta más entre las tarjetas, que es donde se pasa por
 * alto justo lo que más caro sale pasar por alto.
 */
export function DiferenciasManoObra({ diferencias }: { diferencias: DiferenciaManoObra[] }) {
  const sinRegistrar = diferencias.filter((d) => d.tipo === 'sin_registrar')
  const importe = sinRegistrar.reduce((s, d) => s + d.delta_dinero, 0)

  return (
    <Stack gap="xs">
      {sinRegistrar.length > 0 && (
        <Alert
          color="orange"
          variant="light"
          icon={<IconAlertTriangle size={16} />}
          title={
            sinRegistrar.length === 1
              ? 'El papel cobra un trabajo que nadie registró'
              : `El papel cobra ${sinRegistrar.length} trabajos que nadie registró`
          }
        >
          <Stack gap={6}>
            <Text size="sm">
              Son <b>{formatMXN(Math.abs(importe))}</b> que esta factura cobra y que
              ningún servicio capturado explica. O el trabajo se hizo y nadie lo
              registró —y entonces hay gasto fuera de los libros y el expediente de
              la unidad no dice que estuvo en el taller—, o el taller está cobrando
              algo que no hizo. Eso solo lo sabe quien tiene el papel.
            </Text>
            <Text size="xs" c="dimmed">
              Si el trabajo sí se hizo, regístralo en el expediente de la unidad y
              vuelve a comparar. Si no, quita el renglón o cierra la factura
              dejándolo señalado: queda guardado como hallazgo y no se pierde.
            </Text>
          </Stack>
        </Alert>
      )}

      {diferencias.map((d) => (
        <TarjetaDiferencia key={`mo:${d.renglon_id}`} d={d} />
      ))}
    </Stack>
  )
}
