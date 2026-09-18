// La revisión de una factura contra su papel, en pantalla.
//
// Quien captura no es quien verifica. Estas piezas son lo que usa el
// verificador: teclea LO QUE DICE LA FACTURA ORIGINAL y el sistema lo compara
// con lo guardado. Lo que coincide se sella sin más; lo que no, se corrige, se
// le pone precio y se le carga a quien lo tecleó.
//
// POR QUÉ LOS CAMPOS VIENEN PRELLENADOS CON LO GUARDADO. Es una concesión
// deliberada y conviene saberla: prellenarlos hace que "todo cuadra" —el caso
// común— sea un solo clic, pero también permite sellar sin leer el papel. La
// alternativa, campos en blanco que hay que teclear a ciegas, convierte cada
// factura correcta en quince tecleos y acaba en que nadie revisa. Se eligió que
// revisar sea barato; que se haga de verdad es cosa de quien lo hace.
//
// Ver `db/migrations/040_revision_de_facturas.sql`.
import { useState } from 'react'
import {
  ActionIcon, Alert, Badge, Button, Group, NumberInput, Popover, Stack, Switch,
  Text, Textarea, TextInput, Tooltip,
} from '@mantine/core'
import {
  IconAlertTriangle, IconCheck, IconLock, IconLockOpen, IconTrash,
} from '@tabler/icons-react'
import type { Factura, FacturaRenglon } from '../hooks/useFacturas'
import {
  useQuitarRenglon, useReabrirFactura, useRevisarCabecera, useRevisarRenglon,
} from '../hooks/useRevision'
import { FOLIO_EXISTENTE } from '../hooks/useFacturas'
import { ApiError } from '../lib/api'
import { FechaInput } from './FechaInput'
import { formatMXN, formatFecha } from '../lib/formato'
import { IVA_DEFAULT, DESCUENTO_DEFAULT, totalesFactura } from '../lib/totales'
import { limpiarFolio, normalizarFolio } from '../lib/validaciones'

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

  const faltan = factura.renglones - factura.renglones_revisados
  const empezada = factura.cabecera_revisada_en !== null || factura.renglones_revisados > 0

  return (
    <Tooltip
      label={
        factura.cabecera_revisada_en === null && faltan === factura.renglones
          ? 'Nadie la ha cuadrado todavía contra el papel'
          : `Faltan ${faltan} renglón(es)${factura.cabecera_revisada_en === null ? ' y los datos de la factura' : ''}`
      }
    >
      <Badge size="xs" variant="light" color={empezada ? 'yellow' : 'gray'}>
        {empezada
          ? `${factura.renglones_revisados}/${factura.renglones} revisados`
          : 'Por revisar'}
      </Badge>
    </Tooltip>
  )
}

/**
 * Cuadra un renglón contra el papel.
 *
 * El botón dice qué va a pasar antes de que pase: "Cuadra" cuando lo tecleado es
 * idéntico a lo guardado, "Corregir y sellar" cuando no. Ver la diferencia antes
 * de pulsar es lo que evita sellar una corrección que no se pretendía hacer.
 */
export function RevisionRenglon({
  renglon, factura, esAdmin,
}: {
  renglon:  FacturaRenglon
  factura:  Factura
  esAdmin:  boolean
}) {
  const [abierto, setAbierto] = useState(false)
  const [cantidad, setCantidad] = useState<number | string>(renglon.cantidad_inicial)
  const [costo, setCosto] = useState<number | string>(renglon.costo_unitario)
  const revisar = useRevisarRenglon()
  const quitar = useQuitarRenglon()

  if (renglon.revisado_en !== null) {
    return (
      <Tooltip label={`${renglon.revisado_por ?? '—'} · ${formatFecha(renglon.revisado_en.slice(0, 10))}`}>
        <Badge size="xs" variant="light" color="green" leftSection={<IconCheck size={11} />}>
          Revisado
        </Badge>
      </Tooltip>
    )
  }

  if (!esAdmin) {
    return <Badge size="xs" variant="light" color="gray">Por revisar</Badge>
  }

  const cant = Number(cantidad)
  const cost = Number(costo)
  const invalido = !Number.isInteger(cant) || cant < 1 || !(cost > 0)
  const cambia = cant !== renglon.cantidad_inicial
    || Math.round(cost * 100) !== Math.round(renglon.costo_unitario * 100)

  // Lo que la corrección le haría al total de la factura. Es el mismo número que
  // la API va a guardar como `delta_dinero`, calculado con la misma cadena: el
  // descuento y el IVA de la cabecera cambian lo que un error de costo cuesta
  // de verdad, así que la resta cruda de los importes no sirve.
  const antes = totalesFactura(
    renglon.costo_unitario * renglon.cantidad_inicial, factura.descuento_pct, factura.tasa_iva,
  ).total
  const despues = totalesFactura(cost * cant, factura.descuento_pct, factura.tasa_iva).total
  const delta = despues - antes

  return (
    <Popover opened={abierto} onChange={setAbierto} width={320} position="left" withArrow>
      <Popover.Target>
        <Button size="compact-xs" variant="light" onClick={() => setAbierto((v) => !v)}>
          Revisar
        </Button>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="xs">
          <Text size="xs" c="dimmed">
            Teclea lo que dice la factura original para <b>{renglon.numero_serie}</b>.
          </Text>

          <Group grow>
            <NumberInput
              label="Cantidad" size="xs" min={1} max={999} allowDecimal={false}
              value={cantidad} onChange={setCantidad}
            />
            <NumberInput
              label="Costo unitario" size="xs" min={0} decimalScale={2} prefix="$"
              thousandSeparator="," value={costo} onChange={setCosto}
            />
          </Group>

          {cambia && !invalido && (
            <Alert color="yellow" variant="light" p="xs">
              <Text size="xs">
                No coincide con lo capturado ({renglon.cantidad_inicial} ×{' '}
                {formatMXN(renglon.costo_unitario)}). Se va a corregir y queda
                registrado como error de{' '}
                <b>{renglon.capturado_por ?? 'quien lo capturó'}</b>, por{' '}
                <b>{formatMXN(Math.abs(delta))}</b> {delta > 0 ? 'de menos' : 'de más'}.
              </Text>
            </Alert>
          )}

          {revisar.error && (
            <Alert color="red" p="xs">
              <Text size="xs">{(revisar.error as Error).message}</Text>
            </Alert>
          )}
          {quitar.error && (
            <Alert color="red" p="xs">
              <Text size="xs">{(quitar.error as Error).message}</Text>
            </Alert>
          )}

          <Group justify="space-between">
            {/* El renglón que no aparece en el papel. Se borra de verdad porque
                nunca existió — pero solo si nunca llegó a moverse, y de eso se
                encarga la API. Si la compra sí existió y es de otra factura, lo
                que hay que hacer es cambiarle el folio, no quitarlo. */}
            <Tooltip label="No aparece en la factura original" position="bottom">
              <ActionIcon
                variant="subtle" color="red" size="sm"
                loading={quitar.isPending}
                onClick={() => quitar.mutate(renglon.lote_id)}
              >
                <IconTrash size={14} />
              </ActionIcon>
            </Tooltip>

            <Button
              size="xs"
              color={cambia ? 'yellow' : 'green'}
              disabled={invalido}
              loading={revisar.isPending}
              onClick={() =>
                revisar.mutate(
                  { lote_id: renglon.lote_id, cantidad_inicial: cant, costo_unitario: cost },
                  { onSuccess: () => setAbierto(false) },
                )
              }
            >
              {cambia ? 'Corregir y sellar' : 'Cuadra, sellar'}
            </Button>
          </Group>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  )
}

/**
 * Cuadra la cabecera —folio, fecha, IVA y descuento— y la sella.
 *
 * Es la otra mitad del trabajo: esos cuatro datos no viven en ningún renglón, y
 * el IVA y el descuento mueven el total de la compra entera. Por eso su error se
 * mide contra el total y no contra un importe suelto.
 */
export function RevisionCabecera({
  factura, esAdmin,
}: {
  factura: Factura
  esAdmin: boolean
}) {
  const [folio, setFolio] = useState(factura.num_factura)
  const [fecha, setFecha] = useState(factura.fecha_compra)
  const [conIva, setConIva] = useState(factura.tasa_iva != null)
  const [tasa, setTasa] = useState<number | string>(factura.tasa_iva ?? IVA_DEFAULT)
  const [conDesc, setConDesc] = useState(factura.descuento_pct != null)
  const [desc, setDesc] = useState<number | string>(factura.descuento_pct ?? DESCUENTO_DEFAULT)
  const [nota, setNota] = useState(factura.revision_nota ?? '')

  const revisar = useRevisarCabecera()
  const reabrir = useReabrirFactura()

  if (factura.cabecera_revisada_en !== null) {
    return (
      <Alert color="green" variant="light" icon={<IconLock size={16} />}>
        <Group justify="space-between" wrap="nowrap">
          <div>
            <Text size="sm">
              Datos revisados por <b>{factura.cabecera_revisada_por}</b> el{' '}
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

  if (!esAdmin) {
    return (
      <Alert color="gray" variant="light">
        <Text size="sm">Los datos de esta factura todavía no se han cuadrado contra el papel.</Text>
      </Alert>
    )
  }

  const folioNuevo = normalizarFolio(folio)
  const tasaNueva = conIva ? Number(tasa) : null
  const descNueva = conDesc ? Number(desc) : null

  const invalido = folioNuevo === ''
    || (conIva && !(Number(tasa) > 0 && Number(tasa) <= 100))
    || (conDesc && !(Number(desc) > 0 && Number(desc) < 100))

  const cambia = folioNuevo !== factura.num_factura
    || fecha !== factura.fecha_compra
    || tasaNueva !== factura.tasa_iva
    || descNueva !== factura.descuento_pct

  const totalAntes = totalesFactura(factura.subtotal, factura.descuento_pct, factura.tasa_iva).total
  const totalDespues = totalesFactura(factura.subtotal, descNueva, tasaNueva).total
  const delta = totalDespues - totalAntes

  // El 409 del folio que ya existe se lee del error del intento anterior, igual
  // que en `FolioDeFactura`: así la pregunta se cae sola al volver a teclear.
  const fusionPendiente =
    revisar.error instanceof ApiError && revisar.error.code === FOLIO_EXISTENTE
      ? revisar.error.message
      : null

  function sellar(confirmarFusion = false) {
    revisar.mutate({
      factura_id:       factura.id,
      num_factura:      folioNuevo,
      fecha_compra:     fecha,
      tasa_iva:         tasaNueva,
      descuento_pct:    descNueva,
      nota:             nota.trim() || undefined,
      confirmar_fusion: confirmarFusion,
    })
  }

  return (
    <Stack gap="xs">
      <Text size="sm" fw={600}>Revisar los datos de la factura</Text>
      <Text size="xs" c="dimmed">
        Teclea lo que dice el papel. Lo que no coincida se corrige y queda
        registrado a nombre de quien capturó la compra.
      </Text>

      <Group grow align="flex-start">
        <TextInput
          label="Folio" size="xs" value={folio}
          error={folioNuevo === '' ? 'Requerido' : undefined}
          onChange={(e) => {
            setFolio(limpiarFolio(e.currentTarget.value, 30))
            if (revisar.error) revisar.reset()
          }}
        />
        <FechaInput label="Fecha de la factura" value={fecha} onChange={setFecha} />
      </Group>

      <Group grow align="flex-start">
        <Stack gap={4}>
          <Switch
            size="xs" label="Trae descuento" checked={conDesc}
            onChange={(e) => setConDesc(e.currentTarget.checked)}
          />
          {conDesc && (
            <NumberInput
              size="xs" min={0.01} max={99.99} decimalScale={2} suffix="%"
              value={desc} onChange={setDesc}
            />
          )}
        </Stack>
        <Stack gap={4}>
          <Switch
            size="xs" label="Hay que sumarle IVA" checked={conIva}
            onChange={(e) => setConIva(e.currentTarget.checked)}
          />
          {conIva && (
            <NumberInput
              size="xs" min={0.01} max={100} decimalScale={2} suffix="%"
              value={tasa} onChange={setTasa}
            />
          )}
        </Stack>
      </Group>

      <Textarea
        label="Nota (opcional)" size="xs" autosize minRows={1} maxLength={255}
        placeholder="El papel viene roto, el proveedor la reexpidió…"
        value={nota} onChange={(e) => setNota(e.currentTarget.value)}
      />

      <Group justify="space-between" align="flex-end">
        <Text size="sm">
          Total según lo tecleado <Text component="span" fw={700}>{formatMXN(totalDespues)}</Text>
          {Math.abs(delta) >= 0.01 && (
            <Text component="span" size="xs" c="yellow.7">
              {' '}({delta > 0 ? '+' : '−'}{formatMXN(Math.abs(delta))} contra lo capturado)
            </Text>
          )}
        </Text>
        <Button
          size="xs"
          color={cambia ? 'yellow' : 'green'}
          disabled={invalido}
          loading={revisar.isPending}
          onClick={() => sellar()}
        >
          {cambia ? 'Corregir y sellar' : 'Cuadra, sellar'}
        </Button>
      </Group>

      {fusionPendiente ? (
        <Alert color="yellow" variant="light" icon={<IconAlertTriangle size={16} />}>
          <Stack gap="xs">
            <Text size="sm">
              {fusionPendiente} Si es la misma factura capturada en dos partes, adelante.
              La revisión sigue en la factura que quede.
            </Text>
            <Group gap="xs">
              <Button size="xs" color="yellow" loading={revisar.isPending} onClick={() => sellar(true)}>
                Sí, juntarlas en una factura
              </Button>
              <Button size="xs" variant="default" onClick={() => revisar.reset()}>
                Cancelar
              </Button>
            </Group>
          </Stack>
        </Alert>
      ) : revisar.error ? (
        <Alert color="red" title="No se pudo revisar">
          {(revisar.error as Error).message}
        </Alert>
      ) : null}
    </Stack>
  )
}
