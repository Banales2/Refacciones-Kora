// Alta de un lote de compra para una refacción que ya está en el catálogo.
// Complementa a NuevaRefaccionModal: aquella da de alta la refacción y su primer
// lote, esta resuelve el caso de la refacción que existe pero se quedó sin
// existencias, para no tener que salir del mantenimiento a surtirla.
import { useState, useMemo } from 'react'
import { Modal, Stack, Select, Text, Alert } from '@mantine/core'
import { useTodasLasPiezas } from '../hooks/useRefacciones'
import { useCreateLote } from '../hooks/useLotes'
import type { LoteDisponible } from '../hooks/useLotesDisponibles'
import LoteForm from './LoteForm'
import type { LoteFormValues } from './LoteForm'

export default function NuevoLoteModal({
  opened, onClose, onCreated,
}: {
  opened:  boolean
  onClose: () => void
  /** El lote recién creado, ya con forma de opción del selector de refacciones. */
  onCreated: (lote: LoteDisponible) => void
}) {
  const [piezaId, setPiezaId] = useState<string | null>(null)

  const { data: piezasData, isLoading } = useTodasLasPiezas(opened)
  const crearLoteMut = useCreateLote()

  const piezas = useMemo(() => piezasData?.data ?? [], [piezasData])
  const opciones = useMemo(
    () => piezas.map((p) => ({ value: String(p.id), label: `${p.numero_serie} — ${p.descripcion}` })),
    [piezas],
  )
  const pieza = piezas.find((p) => String(p.id) === piezaId)

  function cerrar() {
    setPiezaId(null)
    crearLoteMut.reset()
    onClose()
  }

  function handleLote(v: LoteFormValues) {
    if (!pieza) return
    crearLoteMut.mutate(
      {
        piezaId:          pieza.id,
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
            // El lote acaba de entrar completo en la sucursal que se eligió, así
            // que esa es la única existencia que tiene.
            sucursal_id:         Number(v.sucursal_id),
            sucursal:            lote.sucursal ?? '',
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
      title="Registrar compra de una refacción"
      centered
      closeOnClickOutside={false}
      zIndex={300}
    >
      <Stack gap="sm">
        <Select
          label="Refacción" required
          placeholder={isLoading ? 'Cargando refacciones…' : 'Busca la refacción por serie o descripción'}
          data={opciones}
          searchable
          nothingFoundMessage='Sin coincidencias: dala de alta con "Dar de alta refacción"'
          value={piezaId}
          onChange={setPiezaId}
          disabled={crearLoteMut.isPending}
        />
        {pieza ? (
          <>
            <Alert color="blue" variant="light">
              <Text size="sm">
                Registra la compra con la que <strong>{pieza.numero_serie}</strong> vuelve a tener
                existencias. El lote queda disponible para usarlo en este mantenimiento.
              </Text>
            </Alert>
            <LoteForm
              isPending={crearLoteMut.isPending}
              error={crearLoteMut.error ? (crearLoteMut.error as Error).message : null}
              onSubmit={handleLote}
              onCancel={cerrar}
            />
          </>
        ) : (
          <Text c="dimmed" size="sm">Elige primero la refacción que se compró.</Text>
        )}
      </Stack>
    </Modal>
  )
}
