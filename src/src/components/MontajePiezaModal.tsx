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
//
// DE DÓNDE SALE LA PIEZA (migración 008). Montar una pieza la saca del almacén,
// y el almacén tiene que enterarse exactamente una vez. Hay tres orígenes y el
// usuario elige cuál, porque desde aquí no hay forma de adivinarlo:
//
//   consumo       - ya se descontó al capturar el mantenimiento. Este montaje
//                   se cuelga de ese renglón y NO vuelve a descontar.
//   almacen       - la pieza sale del estante aquí y ahora: se descuenta 1 de
//                   la existencia (lote, sucursal) que se elija.
//   sin_descontar - captura retroactiva, o pieza que nunca pasó por el almacén
//                   (compra directa en carretera). No mueve inventario.
import { useMemo, useState } from 'react'
import {
  Modal, Stack, Select, NumberInput, Alert, Button, Group, Text, Divider,
  Radio, Loader,
} from '@mantine/core'
import { IconPlus } from '@tabler/icons-react'
import { FechaInput } from './FechaInput'
import { useLotes, useCreateLote } from '../hooks/useLotes'
import type { Lote } from '../hooks/useLotes'
import { useLotesDisponibles } from '../hooks/useLotesDisponibles'
import { useConsumosSinMontar } from '../hooks/usePiezasVehiculo'
import LoteForm from './LoteForm'
import type { LoteFormValues } from './LoteForm'
import type { DatosMontaje, DatosRetiro, MotivoRetiro, DestinoPieza } from '../hooks/usePiezasVehiculo'

export type ModoMontaje = 'montaje' | 'reemplazo' | 'retiro'

type Origen = 'consumo' | 'almacen' | 'sin_descontar'

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

const dinero = (n: number) => `$${Number(n).toLocaleString('es-MX')}`
const soloFecha = (f: string | null) => f?.slice(0, 10) ?? 's/f'

// Cómo se nombra un lote de compra: la factura de la que salió la pieza.
const etiquetaLote = (l: Pick<Lote, 'fecha_compra' | 'proveedor' | 'num_factura' | 'costo_unitario'>) =>
  `${soloFecha(l.fecha_compra)} · ${l.proveedor}` +
  `${l.num_factura ? ` · Fact. ${l.num_factura}` : ''}` +
  ` · ${dinero(l.costo_unitario)}`

// La existencia de "almacén" es la pareja (lote, sucursal): el mismo lote puede
// estar repartido y hay que decir de qué estante sale. El valor del Select
// codifica las dos, porque ninguna identifica el renglón por sí sola.
const valorExistencia = (loteId: number, sucursalId: number) => `${loteId}|${sucursalId}`

export default function MontajePiezaModal({
  opened, modo, vehiculoId, tipoNombre, piezaEntranteId, piezaSalienteNombre, kmVehiculo,
  isPending, error, onConfirm, onClose,
}: {
  opened: boolean
  modo: ModoMontaje
  /** La unidad en la que se monta. Acota los consumos que se pueden ligar. */
  vehiculoId: number
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
  const [origenElegido, setOrigenElegido] = useState<Origen | null>(null)
  const [consumoId, setConsumoId]     = useState<string | null>(null)
  const [existencia, setExistencia]   = useState<string | null>(null)
  const [loteId, setLoteId]           = useState<string | null>(null)
  const [fecha, setFecha]             = useState(hoy())
  const [km, setKm]                   = useState<number | ''>(kmVehiculo ?? '')
  const [motivo, setMotivo]           = useState<MotivoRetiro | null>(null)
  const [destino, setDestino]         = useState<DestinoPieza | null>(null)

  const entra = modo !== 'retiro'
  const sale  = modo !== 'montaje'

  // Alta de lote encadenada. El recién creado se guarda aparte porque el
  // refetch de las listas no ha llegado cuando ya hay que dejarlo seleccionado:
  // sin esto el Select se quedaría con un value que no está en `data`.
  const [nuevoLoteOpen, setNuevoLoteOpen] = useState(false)
  const [loteNuevo, setLoteNuevo]         = useState<(Lote & { sucursal_id: number }) | null>(null)
  const crearLoteMut = useCreateLote()

  // Todos los lotes de la refacción, no solo los que tienen existencias: una
  // pieza que ya está puesta pudo salir de un lote agotado, y capturarla
  // después es justo el caso que hay que poder registrar.
  const { data: lotesData, isLoading: cargandoLotes } = useLotes(entra ? piezaEntranteId : null)

  // Lo que de verdad hay en estantes, por (lote, sucursal). De aquí sale lo que
  // se puede descontar.
  const { data: dispData, isLoading: cargandoDisp } = useLotesDisponibles(entra)

  // Piezas de esta refacción ya descontadas en un mantenimiento de esta unidad
  // que siguen sin montarse.
  const { data: consumosData, isLoading: cargandoConsumos } =
    useConsumosSinMontar(entra ? vehiculoId : null, entra ? piezaEntranteId : null)

  const consumos = useMemo(() => consumosData?.data ?? [], [consumosData])

  const disponibles = useMemo(() => {
    const base = (dispData?.data ?? []).filter((d) => d.pieza_id === piezaEntranteId)
    // El lote recién registrado se antepone mientras el refetch no lo trae ya.
    if (loteNuevo && !base.some((d) => d.id === loteNuevo.id && d.sucursal_id === loteNuevo.sucursal_id)) {
      return [{
        id:                  loteNuevo.id,
        pieza_id:            loteNuevo.pieza_id,
        numero_serie:        lotesData?.pieza.numero_serie ?? '',
        descripcion:         lotesData?.pieza.descripcion ?? '',
        costo_unitario:      loteNuevo.costo_unitario,
        cantidad_disponible: loteNuevo.cantidad_disponible,
        fecha_compra:        loteNuevo.fecha_compra,
        sucursal_id:         loteNuevo.sucursal_id,
        sucursal:            loteNuevo.sucursal ?? '',
      }, ...base]
    }
    return base
  }, [dispData, piezaEntranteId, loteNuevo, lotesData])

  const cargando = cargandoLotes || cargandoDisp || cargandoConsumos

  // Se sugiere el origen más probable en vez de obligar a elegirlo a ciegas: si
  // hay un consumo esperando, montar sin ligarlo es casi siempre el error.
  const sugerido: Origen =
    consumos.length    ? 'consumo' :
    disponibles.length ? 'almacen' :
                         'sin_descontar'
  const origen = origenElegido ?? sugerido

  const opcionesConsumo = useMemo(
    () => consumos.map((c) => ({
      value: String(c.id),
      label: `Mtto. ${soloFecha(c.fecha_mantenimiento)}` +
             `${c.tipo_mantenimiento ? ` · ${c.tipo_mantenimiento}` : ''}` +
             `${c.sucursal ? ` · ${c.sucursal}` : ''}` +
             ` · ${dinero(c.costo_unitario)}` +
             `${c.cantidad > 1 ? ` · quedan ${c.sin_montar} de ${c.cantidad}` : ''}`,
    })),
    [consumos],
  )

  const opcionesExistencia = useMemo(
    () => disponibles.map((d) => ({
      value: valorExistencia(d.id, d.sucursal_id),
      label: `${d.sucursal} · ${soloFecha(d.fecha_compra)} · ${dinero(d.costo_unitario)}` +
             ` · quedan ${d.cantidad_disponible}`,
    })),
    [disponibles],
  )

  const opcionesLote = useMemo(
    () => (lotesData?.lotes ?? []).map((l) => ({ value: String(l.id), label: etiquetaLote(l) })),
    [lotesData],
  )

  function registrarLote(v: LoteFormValues) {
    if (piezaEntranteId == null) return
    crearLoteMut.mutate(
      {
        piezaId:          piezaEntranteId,
        proveedor_id:     Number(v.proveedor_id),
        sucursal_id:      Number(v.sucursal_id),
        fecha_compra:     v.fecha_compra,
        costo_unitario:   Number(v.costo_unitario),
        cantidad_inicial: Number(v.cantidad_inicial),
        num_factura:      v.num_factura.trim(),
        comprado_por:     v.comprado_por.trim(),
      },
      {
        onSuccess: ({ data: lote }) => {
          const sucursalId = Number(v.sucursal_id)
          setLoteNuevo({ ...lote, sucursal_id: sucursalId })
          // La compra acaba de entrar al almacén, así que la pieza sale de ahí.
          setOrigenElegido('almacen')
          setExistencia(valorExistencia(lote.id, sucursalId))
          setNuevoLoteOpen(false)
        },
      },
    )
  }

  function confirmar() {
    const datos: DatosMontaje & DatosRetiro = {}
    if (entra) {
      // Cada origen manda un juego distinto de campos, y es esa forma la que le
      // dice a la API si debe mover inventario. Ver el comentario de arriba.
      if (origen === 'consumo' && consumoId) {
        datos.detalle_mtto_pieza_id = Number(consumoId)
      } else if (origen === 'almacen' && existencia) {
        const [lote, sucursal] = existencia.split('|')
        datos.lote_id     = Number(lote)
        datos.sucursal_id = Number(sucursal)
      } else if (origen === 'sin_descontar' && loteId) {
        datos.lote_id = Number(loteId)
      }
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

  // Elegir un origen y no decir cuál: se bloquea porque el descuento depende de
  // ese dato y confirmar así dejaría el inventario mintiendo en silencio.
  const faltaOrigen =
    entra && (
      (origen === 'consumo' && !consumoId) ||
      (origen === 'almacen' && !existencia)
    )

  const titulo =
    modo === 'montaje'   ? `Montar ${tipoNombre}` :
    modo === 'reemplazo' ? `Reemplazar ${tipoNombre}` :
                           `Quitar ${tipoNombre}`

  return (
    <Modal opened={opened} onClose={onClose} title={titulo} size="md">
      <Stack gap="sm">
        {entra && (cargando ? (
          <Group gap="xs">
            <Loader size="xs" />
            <Text size="sm" c="dimmed">Buscando de dónde sale esta pieza…</Text>
          </Group>
        ) : (
          <>
            <Radio.Group
              label="¿De dónde sale esta pieza?"
              description="Es lo que decide si el almacén se descuenta. Una unidad no puede estar en el estante y en el carro a la vez."
              value={origen}
              onChange={(v) => setOrigenElegido(v as Origen)}
            >
              <Stack gap={6} mt={6}>
                <Radio
                  value="consumo"
                  disabled={consumos.length === 0}
                  label="Ya se descontó en un mantenimiento"
                  description={
                    consumos.length
                      ? 'Se liga a ese consumo. No se vuelve a descontar.'
                      : 'Ningún mantenimiento de esta unidad tiene esta refacción pendiente de montar.'
                  }
                />
                <Radio
                  value="almacen"
                  label="Sale del almacén ahora"
                  description="Descuenta 1 pieza de la existencia que elijas."
                />
                <Radio
                  value="sin_descontar"
                  label="No descontar del almacén"
                  description="Para capturar una pieza que ya estaba puesta, o que nunca pasó por el almacén."
                />
              </Stack>
            </Radio.Group>

            {origen === 'consumo' && (
              <Select
                label="Consumo del mantenimiento"
                description="La compra ya salió del almacén en este servicio."
                placeholder="Selecciona el consumo"
                data={opcionesConsumo}
                value={consumoId}
                onChange={setConsumoId}
                searchable
              />
            )}

            {origen === 'almacen' && (
              <>
                <Select
                  label="Existencia de la que sale"
                  description="Sucursal y compra concretas: de ahí se descuenta la pieza."
                  placeholder={
                    opcionesExistencia.length
                      ? 'Selecciona la existencia'
                      : 'Esta refacción no tiene existencias en ninguna sucursal'
                  }
                  data={opcionesExistencia}
                  value={existencia}
                  onChange={setExistencia}
                  disabled={opcionesExistencia.length === 0}
                  searchable
                  clearable
                />
                {opcionesExistencia.length === 0 && (
                  <Text size="xs" c="dimmed">
                    Registra la compra con la que llegó esta pieza, o móntala sin descontar.
                  </Text>
                )}
              </>
            )}

            {origen === 'sin_descontar' && (
              <>
                <Select
                  label="Lote de compra"
                  description="Solo para la trazabilidad: es lo que permite reclamar la garantía al proveedor."
                  placeholder={
                    opcionesLote.length
                      ? 'Selecciona el lote'
                      : 'Esta refacción no tiene lotes registrados'
                  }
                  data={opcionesLote}
                  value={loteId}
                  onChange={setLoteId}
                  disabled={opcionesLote.length === 0}
                  searchable
                  clearable
                />
                <Text size="xs" c="dimmed">
                  Puedes continuar sin lote, pero el historial quedará sin rastro de la compra.
                </Text>
              </>
            )}

            <Group justify="flex-start">
              <Button
                variant="subtle" size="compact-xs" leftSection={<IconPlus size={12} />}
                disabled={piezaEntranteId == null || isPending}
                onClick={() => { crearLoteMut.reset(); setNuevoLoteOpen(true) }}
              >
                Registrar compra
              </Button>
            </Group>
          </>
        ))}

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
              description={
                destino === 'stock'
                  ? 'La pieza vuelve a contarse en el almacén, en el lote y la sucursal de los que salió.'
                  : 'Qué se hace con la pieza que sale. Solo "Regresa a almacén" la devuelve al inventario.'
              }
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
          <Button onClick={confirmar} loading={isPending} disabled={faltaOrigen}>Confirmar</Button>
        </Group>
      </Stack>

      {/* Modal encadenado: la compra de la que sale esta pieza. Al guardarla el
          lote entra al almacén y queda elegido como origen del montaje. */}
      <Modal
        opened={nuevoLoteOpen}
        onClose={() => setNuevoLoteOpen(false)}
        title={`Registrar compra · ${lotesData?.pieza.numero_serie ?? tipoNombre}`}
        centered
        closeOnClickOutside={false}
        zIndex={300}
      >
        <Stack gap="sm">
          {lotesData?.pieza && (
            <Alert color="blue" variant="light">
              <Text size="sm">
                Compra de <strong>{lotesData.pieza.numero_serie}</strong> — {lotesData.pieza.descripcion}.
                El lote entra al inventario de la sucursal que elijas y esta pieza se descuenta de ahí.
              </Text>
            </Alert>
          )}
          <LoteForm
            isPending={crearLoteMut.isPending}
            error={crearLoteMut.error ? (crearLoteMut.error as Error).message : null}
            onSubmit={registrarLote}
            onCancel={() => setNuevoLoteOpen(false)}
          />
        </Stack>
      </Modal>
    </Modal>
  )
}
