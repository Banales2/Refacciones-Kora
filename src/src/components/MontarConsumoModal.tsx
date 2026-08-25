// Montar en la unidad una pieza que ya se consumió en el mantenimiento.
//
// Es la otra mitad de la regla que cierra la migración 008. El consumo del
// mantenimiento ya descontó la pieza del almacén; lo que faltaba era decir en
// qué renglón del vehículo quedó puesta. Hacerlo desde aquí evita el camino
// largo —ir al vehículo y volver a elegir el lote a mano— que es donde se
// perdía el dato o se descontaba dos veces.
//
// El montaje viaja ligado (`detalle_mtto_pieza_id`), así que NO vuelve a tocar
// el inventario: la unidad ya salió del estante cuando se capturó el consumo.
import { useMemo, useState } from 'react'
import { Modal, Stack, Select, NumberInput, Alert, Button, Group, Text, Loader } from '@mantine/core'
import { FechaInput } from './FechaInput'
import { usePiezasVehiculo, useSetPiezaVehiculo } from '../hooks/usePiezasVehiculo'
import type { DetalleMttoPieza } from '../hooks/useDetalleMtto'

const hoy = () => new Date().toISOString().slice(0, 10)

// El renglón de un vehículo es el par (tipo, etiqueta), no el tipo: una unidad
// con dos filtros de aire tiene dos renglones del mismo tipo. El valor del
// Select codifica los dos porque ninguno identifica el renglón por sí solo.
const valorRenglon = (tipoId: number, etiqueta: string) => `${tipoId}|${etiqueta}`

export default function MontarConsumoModal({
  consumo, vehiculoId, mantenimientoId, fechaMantenimiento, kmMantenimiento, onClose,
}: {
  /** El renglón de consumo que se va a montar. Null = modal cerrado. */
  consumo: DetalleMttoPieza | null
  vehiculoId: number
  mantenimientoId: number
  /** Fecha del servicio: es la instalación por defecto, no la de hoy. */
  fechaMantenimiento: string | null
  kmMantenimiento: number | null
  onClose: () => void
}) {
  const [renglon, setRenglon] = useState<string | null>(null)
  const [fecha, setFecha]     = useState(fechaMantenimiento?.slice(0, 10) ?? hoy())
  const [km, setKm]           = useState<number | ''>(kmMantenimiento ?? '')

  const { data, isLoading } = usePiezasVehiculo(consumo ? vehiculoId : undefined)
  const setMut = useSetPiezaVehiculo()

  // Solo los renglones que piden este tipo de pieza. Montar un filtro de aire
  // en el renglón de las balatas lo rechaza la API de todos modos; no ofrecerlo
  // ahorra el viaje.
  const opciones = useMemo(() => {
    if (!consumo?.tipo_pieza_id) return []
    return (data?.data ?? [])
      .filter((f) => f.tipo_pieza_id === consumo.tipo_pieza_id)
      .map((f) => ({
        value: valorRenglon(f.tipo_pieza_id, f.etiqueta),
        // Qué trae puesto va en la etiqueta, no en un `description`: el Select
        // de Mantine solo pinta `label`, y saber que ese renglón ya lleva algo
        // es justo lo que evita reemplazar la pieza equivocada.
        label: (f.etiqueta ? `${f.tipo_nombre} · ${f.etiqueta}` : f.tipo_nombre) +
               (f.numero_serie ? ` — ahora: ${f.numero_serie}` : ' — vacío'),
      }))
  }, [data, consumo])

  function confirmar() {
    if (!consumo || !renglon) return
    const [tipoId, ...resto] = renglon.split('|')
    setMut.mutate(
      {
        vehiculoId,
        tipoId:   Number(tipoId),
        etiqueta: resto.join('|'),
        piezaId:  consumo.pieza_id,
        datos: {
          // La liga: la API toma de aquí el lote y la sucursal, y no descuenta.
          detalle_mtto_pieza_id: consumo.id,
          mantenimiento_id:      mantenimientoId,
          fecha_instalacion:     fecha,
          ...(km !== '' ? { km_instalacion: Number(km) } : {}),
        },
      },
      { onSuccess: onClose },
    )
  }

  const faltan = consumo ? consumo.cantidad - consumo.montadas : 0

  return (
    <Modal
      opened={consumo !== null}
      onClose={onClose}
      title={`Montar ${consumo?.numero_serie ?? ''} en la unidad`}
      centered
      zIndex={320}
    >
      {consumo && (
        <Stack gap="sm">
          <Alert color="blue" variant="light">
            <Text size="sm">
              Esta pieza ya se descontó del almacén al capturar el consumo,
              así que montarla <strong>no vuelve a mover el inventario</strong>.
              {consumo.cantidad > 1 && ` Faltan ${faltan} de ${consumo.cantidad} por montar.`}
            </Text>
          </Alert>

          {isLoading ? (
            <Group gap="xs">
              <Loader size="xs" />
              <Text size="sm" c="dimmed">Cargando los renglones de la unidad…</Text>
            </Group>
          ) : (
            <Select
              label="¿En qué posición se montó?"
              description="Si el renglón ya trae una refacción, esta la reemplaza."
              placeholder={
                opciones.length
                  ? 'Selecciona la posición'
                  : 'Esta unidad no pide ninguna pieza de este tipo'
              }
              data={opciones}
              value={renglon}
              onChange={setRenglon}
              disabled={opciones.length === 0}
              searchable
            />
          )}

          {!isLoading && opciones.length === 0 && (
            <Text size="xs" c="dimmed">
              Agrega el tipo de pieza a la unidad (o a su modelo) para poder montarla aquí.
            </Text>
          )}

          <FechaInput
            label="Fecha de instalación"
            maxDate={hoy()}
            value={fecha}
            onChange={setFecha}
          />

          <NumberInput
            label="Kilometraje al montar"
            description="Con esto se calcula cuánto duró la pieza."
            placeholder="Km de la unidad"
            min={0}
            value={km}
            onChange={(v) => setKm(v === '' ? '' : Number(v))}
            thousandSeparator=","
          />

          {setMut.error && (
            <Alert color="red" title="Error">{(setMut.error as Error).message}</Alert>
          )}

          <Group justify="flex-end" mt="xs">
            <Button variant="default" onClick={onClose} disabled={setMut.isPending}>Cancelar</Button>
            <Button onClick={confirmar} loading={setMut.isPending} disabled={!renglon}>
              Montar
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  )
}
