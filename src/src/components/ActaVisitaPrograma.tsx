// El acta de la visita: renglón por renglón de la columna, qué se hizo y qué no.
//
// Cerrar una columna del programa daba por hechos todos sus renglones sin que
// nadie lo dijera. Si el taller no tenía el filtro, el sistema afirmaba igual
// que se cambió y el renglón quedaba al día con la pieza vieja puesta. Esto es
// lo que rompe ese silencio: cada renglón exige respuesta, y la respuesta queda
// guardada —también la de lo que no se hizo, que es lo que antes se perdía—.
//
// Vive dentro del formulario de mantenimiento y no en un paso aparte porque una
// de las respuestas se comprueba contra lo que el formulario lleva capturado:
// un renglón que consume refacción no se puede dar por hecho si el
// mantenimiento no trae cargada una pieza de su tipo. Separarlos obligaría a
// descubrir el problema después de guardar.
import { Stack, Group, Text, Badge, Paper, SegmentedControl, TextInput, Tooltip } from '@mantine/core'
import { exigePiezaFaltante } from '../lib/acta'
import type { RenglonColumna, ActaValor } from '../lib/acta'

export default function ActaVisitaPrograma({
  renglones, value, onChange, tiposCargados, errores,
}: {
  renglones:     RenglonColumna[]
  value:         ActaValor
  onChange:      (v: ActaValor) => void
  /** Tipos de pieza que el mantenimiento ya trae capturados. */
  tiposCargados: Set<number>
  /** Lo que falta de cada renglón. Solo se pinta después de intentar guardar. */
  errores:       Record<number, string>
}) {
  function responder(id: number, hecha: boolean) {
    onChange({ ...value, [id]: { hecha, nota: value[id]?.nota ?? '' } })
  }
  function anotar(id: number, nota: string) {
    onChange({ ...value, [id]: { hecha: value[id]?.hecha ?? false, nota } })
  }

  const hechas = renglones.filter((r) => value[r.operacion_id]?.hecha === true).length
  const sinResponder = renglones.filter((r) => !value[r.operacion_id]).length

  return (
    <Stack gap="xs">
      <Group gap="xs" justify="space-between">
        <Text size="sm" fw={500}>Qué se hizo de esta columna</Text>
        <Group gap={6}>
          <Badge size="sm" variant="light" color="teal">{hechas} hechas</Badge>
          {sinResponder > 0 && (
            <Badge size="sm" variant="light" color="gray">{sinResponder} sin responder</Badge>
          )}
        </Group>
      </Group>
      <Text size="xs" c="dimmed">
        Cada renglón necesita respuesta. Lo que no se haga queda anotado con su motivo y
        sigue vencido: la próxima visita vuelve a pedirlo.
      </Text>

      <Stack gap={6}>
        {renglones.map((r) => {
          const resp  = value[r.operacion_id]
          const error = errores[r.operacion_id]
          return (
            <Paper
              key={r.operacion_id} withBorder p="xs" radius="sm"
              style={error ? { borderColor: 'var(--mantine-color-red-5)' } : undefined}
            >
              <Group justify="space-between" align="flex-start" wrap="nowrap" gap="sm">
                <Stack gap={2} style={{ minWidth: 0, flex: 1 }}>
                  <Group gap={6} wrap="nowrap">
                    <Tooltip label={r.accion_nombre} withArrow>
                      <Badge variant="light" size="sm">{r.accion}</Badge>
                    </Tooltip>
                    <Text size="sm" style={{ minWidth: 0 }}>{r.nombre}</Text>
                  </Group>
                  {r.requiere_pieza && r.tipo_pieza_id != null ? (
                    <Text size="xs" c="dimmed">
                      Consume refacción: exige un{'\u00A0'}
                      <Text span fw={500}>{r.tipo_pieza_nombre ?? 'tipo de pieza'}</Text> cargado abajo
                    </Text>
                  ) : r.categoria && (
                    <Text size="xs" c="dimmed">{r.categoria}</Text>
                  )}
                </Stack>
                <SegmentedControl
                  size="xs"
                  // Sin valor de arranque a propósito: la palomita tiene que ser
                  // una decisión, no lo que ya venía puesto.
                  value={resp == null ? '' : resp.hecha ? 'si' : 'no'}
                  onChange={(v) => responder(r.operacion_id, v === 'si')}
                  data={[
                    { value: 'si', label: 'Se hizo' },
                    { value: 'no', label: 'No' },
                  ]}
                />
              </Group>

              {/* En cuanto se marca como hecho, el reclamo de la refacción
                  aparece solo: no hay que intentar guardar para enterarse. */}
              {exigePiezaFaltante(r, resp, tiposCargados) && !error && (
                <Text size="xs" c="orange" mt={4}>
                  Falta cargar la refacción abajo para poder darla por hecha.
                </Text>
              )}

              {resp?.hecha === false && (
                <TextInput
                  mt={6} size="xs" maxLength={300}
                  placeholder="Por qué no se hizo (no había filtro en existencia, no dio tiempo…)"
                  value={resp.nota}
                  onChange={(e) => anotar(r.operacion_id, e.currentTarget.value)}
                />
              )}
              {error && <Text size="xs" c="red" mt={4}>{error}</Text>}
            </Paper>
          )
        })}
      </Stack>
    </Stack>
  )
}
