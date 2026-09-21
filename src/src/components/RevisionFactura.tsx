// La revisión de una factura contra su papel, en pantalla.
//
// Quien captura no es quien verifica. Estas piezas son lo que usa el
// verificador: teclea LO QUE DICE LA FACTURA ORIGINAL y el sistema lo compara
// con lo guardado. Lo que coincide se sella sin más; lo que no, se corrige, se
// le pone precio y se le carga a quien lo tecleó.
//
// POR QUÉ NO HAY BOTÓN CUANDO NADA CAMBIA. Los campos vienen prellenados con lo
// guardado para no obligar a teclear a ciegas, pero con el prellenado un solo
// clic sellaba la cabecera sin haber leído el papel. Por eso el botón de sellar
// sólo aparece cuando el verificador modificó algún dato: la verificación se
// hace a mano, nunca de corrido.
//
// Ver `db/migrations/040_revision_de_facturas.sql`.
import { useState } from 'react'
import {
  Alert, Badge, Button, Group, NumberInput, Stack, Switch,
  Text, Textarea, TextInput, Tooltip,
} from '@mantine/core'
import {
  IconAlertTriangle, IconCheck, IconLock, IconLockOpen,
} from '@tabler/icons-react'
import type { Factura } from '../hooks/useFacturas'
import { useReabrirFactura, useRevisarCabecera } from '../hooks/useRevision'
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
        {cambia ? (
          <Button
            size="xs"
            color="yellow"
            disabled={invalido}
            loading={revisar.isPending}
            onClick={() => sellar()}
          >
            Corregir y sellar
          </Button>
        ) : (
          <Text size="xs" c="dimmed" maw={280} ta="right">
            Lo tecleado es igual a lo capturado. Sella hasta que hayas corregido
            contra el papel lo que no coincida.
          </Text>
        )}
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
