// Alta de una refacción del catálogo, sin compra.
//
// Se abre desde el registro de un precio de proveedor: cotizar no es comprar,
// así que aquí la refacción se da de alta sola, sin lote. Es la diferencia con
// NuevaRefaccionModal, que encadena la primera compra porque un mantenimiento
// consume de un lote.
import { Modal } from '@mantine/core'
import { useCreateRefaccion } from '../hooks/useRefacciones'
import type { Pieza } from '../hooks/useRefacciones'
import PiezaForm from './PiezaForm'
import type { PiezaFormValues } from './PiezaForm'

export default function NuevaPiezaModal({
  opened, onClose, onCreated,
}: {
  opened:  boolean
  onClose: () => void
  /** La refacción recién creada, para dejarla seleccionada donde se pidió. */
  onCreated: (pieza: Pieza) => void
}) {
  const crearMut = useCreateRefaccion()

  function cerrar() {
    crearMut.reset()
    onClose()
  }

  function handleSubmit(v: PiezaFormValues) {
    crearMut.mutate(
      { ...v, tipo_pieza_id: Number(v.tipo_pieza_id) },
      {
        onSuccess: ({ data }) => {
          onCreated(data)
          cerrar()
        },
      },
    )
  }

  return (
    <Modal
      opened={opened}
      onClose={cerrar}
      title="Dar de alta una refacción"
      centered
      closeOnClickOutside={false}
      // Se abre encima del modal del precio, que usa el z-index por defecto.
      zIndex={300}
    >
      <PiezaForm
        isPending={crearMut.isPending}
        error={crearMut.error ? (crearMut.error as Error).message : null}
        onSubmit={handleSubmit}
        onCancel={cerrar}
      />
    </Modal>
  )
}
