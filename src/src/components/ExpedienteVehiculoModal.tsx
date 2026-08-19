// Modal del expediente de una unidad.
//
// Antes eran dos renglones de menú —PDF y Excel— que sacaban siempre todo el
// historial. Sigue siendo lo que se quiere la mayoría de las veces, pero no
// cuando el expediente se pide para justificar el gasto de un ejercicio o para
// cerrar un contrato de arrendamiento: ahí lo que se necesita es un año, y todo
// lo anterior estorba. Un menú no da lugar a dos campos de fecha, así que la
// elección se mudó aquí.
import { useState } from 'react'
import { Alert, Button, Group, Modal, Stack, Text } from '@mantine/core'
import { IconAlertTriangle, IconFileSpreadsheet, IconFileTypePdf } from '@tabler/icons-react'
import SelectorPeriodoReporte from './SelectorPeriodoReporte'
import { type Periodo, PERIODO_DEFAULT, periodoValido } from '../lib/reportes/periodo'

export default function ExpedienteVehiculoModal({
  opened, onClose, etiqueta, onGenerar,
}: {
  opened:   boolean
  onClose:  () => void
  /** Marca, modelo y serie: el expediente es de una unidad concreta. */
  etiqueta: string
  onGenerar: (formato: 'pdf' | 'excel', periodo: Periodo) => Promise<void>
}) {
  const [periodo, setPeriodo] = useState<Periodo>(PERIODO_DEFAULT)
  const [ocupado, setOcupado] = useState<'pdf' | 'excel' | null>(null)
  const [error, setError]     = useState<string | null>(null)

  async function generar(formato: 'pdf' | 'excel') {
    setOcupado(formato)
    setError(null)
    try {
      await onGenerar(formato, periodo)
      onClose()
    } catch (e) {
      setError((e as Error).message || 'No se pudo generar el expediente.')
    } finally {
      setOcupado(null)
    }
  }

  const listo = periodoValido(periodo)

  return (
    <Modal opened={opened} onClose={onClose} title="Expediente de la unidad" centered>
      <Stack gap="md">
        {error && (
          <Alert color="red" icon={<IconAlertTriangle size={16} />} title="No se pudo generar">
            {error}
          </Alert>
        )}

        <div>
          <Text fw={600}>{etiqueta}</Text>
          <Text size="xs" c="dimmed">
            Datos de la unidad, documentos, requerimientos, mantenimientos, incidencias, refacciones
            montadas y consumo de combustible.
          </Text>
        </div>

        <SelectorPeriodoReporte
          value={periodo}
          onChange={setPeriodo}
          etiquetaDefault="Todo el historial"
          disabled={ocupado !== null}
        />

        {periodo.modo !== 'default' && (
          <Alert color="gray" variant="light" p="xs">
            <Text size="xs">
              El periodo acota lo que <strong>ocurrió</strong>: mantenimientos, incidencias y cargas
              de combustible. Los datos de la unidad, sus documentos, sus requerimientos y las
              refacciones montadas salen como están hoy — son un estado, no un movimiento con fecha.
            </Text>
          </Alert>
        )}

        <Group gap="xs">
          <Button
            variant="light" leftSection={<IconFileTypePdf size={16} />}
            loading={ocupado === 'pdf'} disabled={!listo || ocupado !== null}
            onClick={() => generar('pdf')}
          >
            PDF
          </Button>
          <Button
            variant="light" color="green" leftSection={<IconFileSpreadsheet size={16} />}
            loading={ocupado === 'excel'} disabled={!listo || ocupado !== null}
            onClick={() => generar('excel')}
          >
            Excel
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
