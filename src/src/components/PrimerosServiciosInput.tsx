// Captura de los primeros servicios de un preventivo que no siguen el intervalo
// de ciclo. Vive aparte porque el mismo control se usa en la plantilla del
// modelo y en el requerimiento del vehículo, que es su copia.
//
// Lo que se captura son distancias ENTRE servicios -igual que el intervalo de
// ciclo-, no marcas de odómetro; como eso se presta a confusión, debajo se
// muestra a qué kilometraje cae cada uno.
import type { ReactNode } from 'react'
import { Stack, Group, Text, Button, NumberInput, ActionIcon, Switch, Alert } from '@mantine/core'
import { IconPlus, IconTrash } from '@tabler/icons-react'
import { KM_MAX } from '../lib/validaciones'
import { MAX_INTERVALOS_INICIALES, resumenPrimerosServicios } from '../lib/intervalos'

export default function PrimerosServiciosInput({
  value, onChange, intervaloKm, error,
}: {
  /** Vacío = sin excepciones: todos los servicios al intervalo de ciclo. */
  value:       number[]
  onChange:    (v: number[]) => void
  /** El intervalo de ciclo, solo para explicar qué pasa después del último. */
  intervaloKm: number | null
  error?:      ReactNode
}) {
  const activo  = value.length > 0
  const resumen = resumenPrimerosServicios(value, intervaloKm)

  function set(i: number, km: number | null) {
    onChange(value.map((v, j) => (j === i ? (km ?? 0) : v)))
  }

  return (
    <Stack gap="xs">
      <Switch
        label="Los primeros servicios llevan otro intervalo"
        description="Para modelos que piden un asentamiento antes de entrar a su ciclo normal."
        checked={activo}
        // Al prender se arranca con un escalón; al apagar se descartan todos y
        // el requerimiento vuelve a ser "cada N km" a secas.
        onChange={(e) => onChange(e.currentTarget.checked ? [intervaloKm ?? 5000] : [])}
      />

      {activo && (
        <Stack gap="xs">
          {value.map((km, i) => (
            <Group key={i} gap="xs" align="flex-end" wrap="nowrap">
              <NumberInput
                flex={1}
                label={`Servicio ${i + 1}`}
                description={i === 0 ? 'Desde el arranque' : 'Desde el servicio anterior'}
                min={1} max={KM_MAX}
                suffix=" km" thousandSeparator=","
                allowDecimal={false} allowNegative={false} clampBehavior="strict"
                value={km}
                onChange={(v) => set(i, typeof v === 'number' ? v : parseInt(String(v), 10) || null)}
              />
              <ActionIcon
                variant="subtle" color="red" size="lg" mb={4}
                aria-label={`Quitar servicio ${i + 1}`}
                onClick={() => onChange(value.filter((_, j) => j !== i))}
              >
                <IconTrash size={16} />
              </ActionIcon>
            </Group>
          ))}

          {value.length < MAX_INTERVALOS_INICIALES && (
            <Button
              variant="light" size="xs" leftSection={<IconPlus size={14} />}
              onClick={() => onChange([...value, intervaloKm ?? 5000])}
              style={{ alignSelf: 'flex-start' }}
            >
              Agregar servicio
            </Button>
          )}

          {error && <Text size="xs" c="red">{error}</Text>}

          {resumen && (
            <Alert variant="light" color="blue" p="xs">
              <Text size="xs">{resumen}</Text>
            </Alert>
          )}
        </Stack>
      )}
    </Stack>
  )
}
