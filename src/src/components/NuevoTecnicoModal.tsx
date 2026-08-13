// Alta de un técnico sin salir del formulario de mantenimiento (registro o
// agendado): al guardarlo se devuelve ya creado para dejarlo seleccionado.
import { Modal } from '@mantine/core'
import { useCreateTecnico } from '../hooks/useTecnicos'
import type { Tecnico } from '../hooks/useTecnicos'
import TecnicoForm from './TecnicoForm'

export default function NuevoTecnicoModal({
  opened, onClose, onCreated,
}: {
  opened:  boolean
  onClose: () => void
  /** El técnico recién creado, para seleccionarlo en el formulario que lo abrió. */
  onCreated: (tecnico: Tecnico) => void
}) {
  const crearMut = useCreateTecnico()

  function cerrar() {
    crearMut.reset()
    onClose()
  }

  return (
    <Modal
      opened={opened}
      onClose={cerrar}
      title="Nuevo técnico"
      centered
      closeOnClickOutside={false}
      zIndex={300}
    >
      <TecnicoForm
        isPending={crearMut.isPending}
        error={crearMut.error ? (crearMut.error as Error).message : null}
        onSubmit={(payload) => crearMut.mutate(payload, {
          onSuccess: ({ data }) => { onCreated(data); cerrar() },
        })}
        onCancel={cerrar}
      />
    </Modal>
  )
}
