// Alta de un chofer sin salir del formulario del vale de gasolina: al guardarlo
// se devuelve ya creado para dejarlo seleccionado. Mismo patrón que
// NuevoTecnicoModal en el registro de mantenimientos.
import { Modal } from '@mantine/core'
import { useCreateConductor } from '../hooks/useConductores'
import type { Conductor } from '../hooks/useConductores'
import ConductorForm from './ConductorForm'

export default function NuevoConductorModal({
  opened, onClose, onCreated,
}: {
  opened:  boolean
  onClose: () => void
  /** El chofer recién creado, para seleccionarlo en el formulario que lo abrió. */
  onCreated: (conductor: Conductor) => void
}) {
  const crearMut = useCreateConductor()

  function cerrar() {
    crearMut.reset()
    onClose()
  }

  return (
    <Modal
      opened={opened}
      onClose={cerrar}
      title="Nuevo chofer"
      centered
      size="md"
      closeOnClickOutside={false}
      // Por encima del modal del vale, que es desde donde se abre.
      zIndex={300}
    >
      <ConductorForm
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
