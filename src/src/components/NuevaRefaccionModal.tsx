// Alta encadenada de refacción usada al registrar un mantenimiento: primero la
// refacción del catálogo y enseguida su primer lote de compra (el mantenimiento
// consume de un lote, así que una refacción sin lote no serviría). El
// formulario del lote permite a su vez dar de alta un proveedor.
import { useState } from 'react'
import { Modal, Stack, Alert, Text } from '@mantine/core'
import { useCreateRefaccion } from '../hooks/useRefacciones'
import type { Pieza } from '../hooks/useRefacciones'
import { useCreateLote } from '../hooks/useLotes'
import type { LoteDisponible } from '../hooks/useLotesDisponibles'
import PiezaForm from './PiezaForm'
import type { PiezaFormValues } from './PiezaForm'
import LoteForm from './LoteForm'
import type { LoteFormValues } from './LoteForm'

export default function NuevaRefaccionModal({
  opened, onClose, onCreated,
}: {
  opened:  boolean
  onClose: () => void
  /** El lote recién creado, ya con forma de opción del selector de refacciones. */
  onCreated: (lote: LoteDisponible) => void
}) {
  // Mientras es null se captura la refacción; en cuanto existe se pasa al lote.
  const [pieza, setPieza] = useState<Pieza | null>(null)

  const crearPiezaMut = useCreateRefaccion()
  const crearLoteMut  = useCreateLote()

  function cerrar() {
    setPieza(null)
    crearPiezaMut.reset()
    crearLoteMut.reset()
    onClose()
  }

  function handlePieza(v: PiezaFormValues) {
    crearPiezaMut.mutate(
      { ...v, tipo_pieza_id: Number(v.tipo_pieza_id) },
      { onSuccess: ({ data }) => setPieza(data) },
    )
  }

  function handleLote(v: LoteFormValues) {
    if (!pieza) return
    crearLoteMut.mutate(
      {
        piezaId:          pieza.id,
        proveedor_id:     Number(v.proveedor_id),
        fecha_compra:     v.fecha_compra,
        costo_unitario:   Number(v.costo_unitario),
        cantidad_inicial: Number(v.cantidad_inicial),
        num_factura:      v.num_factura.trim(),
        comprado_por:     v.comprado_por.trim(),
      },
      {
        onSuccess: ({ data: lote }) => {
          // Se entrega armado para el selector: la lista de lotes disponibles se
          // acaba de invalidar y aún no trae el nuevo lote.
          onCreated({
            id:                  lote.id,
            pieza_id:            pieza.id,
            numero_serie:        pieza.numero_serie,
            descripcion:         pieza.descripcion,
            costo_unitario:      lote.costo_unitario,
            cantidad_disponible: lote.cantidad_disponible,
            fecha_compra:        lote.fecha_compra,
          })
          cerrar()
        },
      },
    )
  }

  return (
    <Modal
      opened={opened}
      onClose={cerrar}
      title={pieza ? 'Nueva refacción — lote de compra' : 'Nueva refacción'}
      centered
      closeOnClickOutside={false}
      zIndex={300}
    >
      {!pieza ? (
        <PiezaForm
          isPending={crearPiezaMut.isPending}
          error={crearPiezaMut.error ? (crearPiezaMut.error as Error).message : null}
          onSubmit={handlePieza}
          onCancel={cerrar}
        />
      ) : (
        <Stack gap="sm">
          <Alert color="teal" variant="light" title={`${pieza.numero_serie} creada`}>
            <Text size="sm">
              Registra el lote con el que entró al inventario. Sin lote la refacción
              queda sin existencias y no puede usarse en este mantenimiento.
            </Text>
          </Alert>
          <LoteForm
            isPending={crearLoteMut.isPending}
            error={crearLoteMut.error ? (crearLoteMut.error as Error).message : null}
            onSubmit={handleLote}
            onCancel={cerrar}
          />
        </Stack>
      )}
    </Modal>
  )
}
