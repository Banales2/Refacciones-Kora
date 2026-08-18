// Captura de la trazabilidad al montar o quitar una pieza de un vehículo.
//
// Antes la asignación era un Select que guardaba de inmediato. Sigue siendo un
// Select, pero ahora abre esto: sin el lote de compra no hay forma de llegar de
// una pieza que falló a su factura y su proveedor, y ese dato solo lo tiene
// quien está haciendo el cambio en ese momento.
//
// El mismo modal cubre los tres casos, que se distinguen por lo que se pide:
//   - montaje  : no había pieza. Solo datos de la que entra.
//   - reemplazo: había otra. Datos de la que entra y de la que sale.
//   - retiro   : se quita sin poner nada. Solo datos de la que sale.
import { useMemo, useState } from 'react'
import { Modal, Stack, Select, NumberInput, Alert, Button, Group, Text, Divider } from '@mantine/core'
import { FechaInput } from './FechaInput'
import { useLotes } from '../hooks/useLotes'
import type { DatosMontaje, DatosRetiro, MotivoRetiro, DestinoPieza } from '../hooks/usePiezasVehiculo'

export type ModoMontaje = 'montaje' | 'reemplazo' | 'retiro'

const MOTIVOS: { value: MotivoRetiro; label: string }[] = [
  { value: 'desgaste',   label: 'Desgaste normal' },
  { value: 'falla',      label: 'Falla' },
  { value: 'garantia',   label: 'Garantía' },
  { value: 'preventivo', label: 'Cambio preventivo' },
  { value: 'siniestro',  label: 'Siniestro' },
  { value: 'robo',       label: 'Robo' },
]

const DESTINOS: { value: DestinoPieza; label: string }[] = [
  { value: 'desecho',              label: 'Desecho' },
  { value: 'reacondicionar',       label: 'A reacondicionar' },
  { value: 'devolucion_proveedor', label: 'Devolución al proveedor' },
  { value: 'venta',                label: 'Venta' },
  { value: 'stock',                label: 'Regresa a almacén' },
]

const hoy = () => new Date().toISOString().slice(0, 10)

export default function MontajePiezaModal({
  opened, modo, tipoNombre, piezaEntranteId, piezaSalienteNombre, kmVehiculo,
  isPending, error, onConfirm, onClose,
}: {
  opened: boolean
  modo: ModoMontaje
  tipoNombre: string
  /** La refacción que entra. Null en un retiro. */
  piezaEntranteId: number | null
  /** Cómo se llama la que sale, para nombrarla en pantalla. */
  piezaSalienteNombre?: string | null
  /** Kilometraje actual de la unidad: precarga los campos de km. */
  kmVehiculo?: number | null
  isPending: boolean
  error: string | null
  onConfirm: (datos: DatosMontaje & DatosRetiro) => void
  onClose: () => void
}) {
  // El padre monta este componente de cero en cada cambio (con `key`), así que
  // el estado nace limpio sin efectos de por medio. Arrastrar el motivo del
  // cambio anterior llenaría el historial de motivos que nadie eligió.
  const [loteId, setLoteId]   = useState<string | null>(null)
  const [fecha, setFecha]     = useState(hoy())
  const [km, setKm]           = useState<number | ''>(kmVehiculo ?? '')
  const [motivo, setMotivo]   = useState<MotivoRetiro | null>(null)
  const [destino, setDestino] = useState<DestinoPieza | null>(null)

  const entra = modo !== 'retiro'
  const sale  = modo !== 'montaje'

  // Todos los lotes de la refacción, no solo los que tienen existencias: una
  // pieza que ya está puesta pudo salir de un lote agotado, y capturarla
  // después es justo el caso que hay que poder registrar.
  const { data: lotesData, isLoading: cargandoLotes } = useLotes(entra ? piezaEntranteId : null)

  const opcionesLote = useMemo(
    () => (lotesData?.lotes ?? []).map((l) => ({
      value: String(l.id),
      label: `${l.fecha_compra?.slice(0, 10) ?? 's/f'} · ${l.proveedor}` +
             `${l.num_factura ? ` · Fact. ${l.num_factura}` : ''}` +
             ` · $${Number(l.costo_unitario).toLocaleString('es-MX')}`,
    })),
    [lotesData],
  )

  function confirmar() {
    const datos: DatosMontaje & DatosRetiro = {}
    if (entra) {
      if (loteId) datos.lote_id = Number(loteId)
      datos.fecha_instalacion = fecha
      if (km !== '') datos.km_instalacion = Number(km)
    }
    if (sale) {
      if (!entra) datos.fecha_retiro = fecha
      if (km !== '') datos.km_retiro = Number(km)
      if (motivo)  datos.motivo_retiro = motivo
      if (destino) datos.destino = destino
    }
    onConfirm(datos)
  }

  const titulo =
    modo === 'montaje'   ? `Montar ${tipoNombre}` :
    modo === 'reemplazo' ? `Reemplazar ${tipoNombre}` :
                           `Quitar ${tipoNombre}`

  return (
    <Modal opened={opened} onClose={onClose} title={titulo} size="md">
      <Stack gap="sm">
        {entra && (
          <>
            <Select
              label="Lote de compra"
              description="De qué compra salió esta pieza. Es lo que permite reclamar la garantía al proveedor."
              placeholder={
                cargandoLotes ? 'Cargando lotes…' :
                opcionesLote.length ? 'Selecciona el lote' :
                'Esta refacción no tiene lotes registrados'
              }
              data={opcionesLote}
              value={loteId}
              onChange={setLoteId}
              disabled={cargandoLotes || opcionesLote.length === 0}
              searchable
              clearable
            />
            {!cargandoLotes && opcionesLote.length === 0 && (
              <Text size="xs" c="dimmed">
                Puedes continuar sin lote, pero el historial quedará sin rastro de la compra.
              </Text>
            )}
          </>
        )}

        <FechaInput
          label={entra ? 'Fecha de instalación' : 'Fecha del retiro'}
          maxDate={hoy()}
          value={fecha}
          onChange={setFecha}
        />

        {sale && (
          <>
            {modo === 'reemplazo' && (
              <Divider
                label={<Text size="xs" c="dimmed">Pieza que sale{piezaSalienteNombre ? `: ${piezaSalienteNombre}` : ''}</Text>}
                labelPosition="left"
              />
            )}
            <Select
              label="Motivo del retiro"
              placeholder="Por qué se quita"
              data={MOTIVOS}
              value={motivo}
              onChange={(v) => setMotivo(v as MotivoRetiro | null)}
              clearable
            />
            <Select
              label="Destino"
              placeholder="Qué se hace con la pieza que sale"
              data={DESTINOS}
              value={destino}
              onChange={(v) => setDestino(v as DestinoPieza | null)}
              clearable
            />
          </>
        )}

        <NumberInput
          label={entra ? 'Kilometraje al montar' : 'Kilometraje al quitar'}
          description="Con esto se calcula cuánto duró la pieza."
          placeholder="Km de la unidad"
          min={0}
          value={km}
          onChange={(v) => setKm(v === '' ? '' : Number(v))}
          thousandSeparator=","
        />

        {error && <Alert color="red" title="Error">{error}</Alert>}

        <Group justify="flex-end" mt="xs">
          <Button variant="default" onClick={onClose} disabled={isPending}>Cancelar</Button>
          <Button onClick={confirmar} loading={isPending}>Confirmar</Button>
        </Group>
      </Stack>
    </Modal>
  )
}
