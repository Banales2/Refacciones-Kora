// Leer el reporte que el chofer dio en el chequeo y decidir qué se hace con él.
//
// Es la mitad del valor del chequeo diario: una declaración que nadie revisa
// deja constancia de que alguien avisó y nadie hizo nada, que es peor que no
// haber preguntado. Las dos salidas dejan rastro —quién la leyó y cuándo—, y
// solo una abre incidencia: no todo lo que reporta un chofer es un pendiente.
//
// Vive aparte porque lo usan dos pantallas: la ficha de la unidad, donde se lee
// el historial de una sola, y los reportes del día en el chequeo de flotilla,
// donde se vacía la bandeja de todas.
import { useState } from 'react'
import {
  Stack, Button, Text, Alert, Textarea, SegmentedControl, Divider,
  SimpleGrid,
} from '@mantine/core'
import { IconAlertTriangle } from '@tabler/icons-react'
import type { Severidad } from '../lib/chequeoItems'
import { useRevisarChequeo, type Chequeo } from '../hooks/useChequeos'
import { limpiarTextoLibre } from '../lib/validaciones'

export default function RevisarReporteChequeo({
  chequeo, vehiculoId, onListo,
}: {
  chequeo:    Chequeo
  vehiculoId: number
  onListo:    () => void
}) {
  const revisar = useRevisarChequeo(vehiculoId)
  const [nota, setNota] = useState('')
  const [severidad, setSeveridad] = useState<Severidad>('moderada')
  const [error, setError] = useState<string | null>(null)

  const enviar = async (abrir: boolean) => {
    setError(null)
    try {
      await revisar.mutateAsync({
        id: chequeo.id,
        payload: {
          nota: nota.trim() || null,
          abrir_incidencia: abrir,
          ...(abrir ? { severidad } : {}),
        },
      })
      onListo()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar la revisión')
    }
  }

  return (
    <Stack gap="sm">
      <Alert color="orange" variant="light" icon={<IconAlertTriangle size={16} />}>
        <Text size="sm" fw={500}>{chequeo.declarado_por} reportó:</Text>
        <Text size="sm" mt={4}>{chequeo.declaracion}</Text>
      </Alert>

      <Textarea
        label="Qué se hizo con esto"
        placeholder="Se revisó con el mecánico: era la banda, ya se ajustó."
        autosize
        minRows={2}
        maxLength={255}
        value={nota}
        onChange={(e) => setNota(limpiarTextoLibre(e.currentTarget.value, 255))}
      />

      <Divider label="Si hay que atenderlo" labelPosition="center" />
      <SegmentedControl
        fullWidth
        size="xs"
        data={[
          { label: 'Superficial', value: 'superficial' },
          { label: 'Moderada',    value: 'moderada'    },
          { label: 'Grave',       value: 'grave'       },
        ]}
        value={severidad}
        onChange={(v) => setSeveridad(v as Severidad)}
      />

      {error && <Alert color="red">{error}</Alert>}

      {/* Uno por renglón en el teléfono: "Solo marcar revisado" no cabe en
          media pantalla y salía recortado, justo en el botón donde importa
          entender qué se va a hacer. */}
      <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="xs">
        <Button
          variant="default"
          onClick={() => enviar(false)}
          loading={revisar.isPending}
        >
          Solo marcar revisado
        </Button>
        <Button
          color="orange"
          onClick={() => enviar(true)}
          loading={revisar.isPending}
        >
          Abrir incidencia
        </Button>
      </SimpleGrid>
    </Stack>
  )
}
