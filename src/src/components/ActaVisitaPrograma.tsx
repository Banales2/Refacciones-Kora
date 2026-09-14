// El acta de la visita: renglón por renglón de la columna, cómo terminó.
//
// Cerrar una columna del programa daba por hechos todos sus renglones sin que
// nadie lo dijera. Si el taller no tenía el filtro, el sistema afirmaba igual
// que se cambió y el renglón quedaba al día con la pieza vieja puesta. Esto es
// lo que rompe ese silencio.
//
// PERO NO A COSTA DE LA CAPTURA. Un servicio de posgarantía es un chequeo
// general: una lista larga donde casi todo sale bien y solo algunas cosas se
// atienden. Por eso todo arranca en "no se ocupó" y aquí solo se tocan las
// excepciones —lo que sí se cambió y lo que no se alcanzó a ver—. Obligar a
// marcar treinta renglones a mano no lo haría nadie dos veces, y a la tercera
// se marcaría todo de corrido: el candado se volvería mentira.
//
// Lo único sin arranque son los renglones que consumen refacción: ahí el
// sistema no contesta por el taller (ver `exigeRespuesta`).
//
// Vive dentro del formulario de mantenimiento y no en un paso aparte porque una
// de las respuestas se comprueba contra lo que el formulario lleva capturado:
// un renglón no se puede dar por atendido si el mantenimiento no trae cargada
// una pieza de su tipo. Separarlos obligaría a descubrirlo después de guardar.
import { Stack, Group, Text, Badge, Paper, SegmentedControl, TextInput, Tooltip } from '@mantine/core'
import { exigePiezaFaltante, exigeRespuesta, respuestaDe, RESULTADO_LABEL } from '../lib/acta'
import type { RenglonColumna, ActaValor, ResultadoRenglon } from '../lib/acta'

const OPCIONES = (['atendida', 'revisada', 'omitida'] as ResultadoRenglon[])
  .map((r) => ({ value: r, label: RESULTADO_LABEL[r] }))

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
  function responder(r: RenglonColumna, resultado: ResultadoRenglon) {
    onChange({
      ...value,
      [r.operacion_id]: { resultado, nota: respuestaDe(r, value)?.nota ?? '' },
    })
  }
  function anotar(r: RenglonColumna, nota: string) {
    const resp = respuestaDe(r, value)
    onChange({
      ...value,
      [r.operacion_id]: { resultado: resp?.resultado ?? 'omitida', nota },
    })
  }

  const cuenta = (res: ResultadoRenglon) =>
    renglones.filter((r) => respuestaDe(r, value)?.resultado === res).length
  const porElegir = renglones.filter((r) => !respuestaDe(r, value)).length

  return (
    <Stack gap="xs">
      <Group gap="xs" justify="space-between">
        <Text size="sm" fw={500}>Cómo salió cada cosa</Text>
        <Group gap={6}>
          {cuenta('atendida') > 0 && (
            <Badge size="sm" variant="light" color="blue">{cuenta('atendida')} atendidas</Badge>
          )}
          <Badge size="sm" variant="light" color="teal">{cuenta('revisada')} no se ocuparon</Badge>
          {cuenta('omitida') > 0 && (
            <Badge size="sm" variant="light" color="yellow">{cuenta('omitida')} pendientes</Badge>
          )}
          {porElegir > 0 && (
            <Badge size="sm" variant="light" color="gray">{porElegir} por decidir</Badge>
          )}
        </Group>
      </Group>
      <Text size="xs" c="dimmed">
        Todo arranca en «No se ocupó»: se revisó y no hizo falta cambiar nada. Toca solo lo
        que sí se haya atendido y lo que no se haya alcanzado a ver. Lo que quede pendiente se
        anota con su motivo y sigue vencido.
      </Text>

      <Stack gap={6}>
        {renglones.map((r) => {
          const resp  = respuestaDe(r, value)
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
                  {exigeRespuesta(r) ? (
                    <Text size="xs" c="dimmed">
                      Consume refacción: si se cambió, exige un{'\u00A0'}
                      <Text span fw={500}>{r.tipo_pieza_nombre ?? 'tipo de pieza'}</Text> cargado abajo
                    </Text>
                  ) : r.categoria && (
                    <Text size="xs" c="dimmed">{r.categoria}</Text>
                  )}
                </Stack>
                <SegmentedControl
                  size="xs"
                  // Vacío solo en los que exigen elegir: ahí la respuesta tiene
                  // que ser una decisión, no lo que ya venía puesto.
                  value={resp?.resultado ?? ''}
                  onChange={(v) => responder(r, v as ResultadoRenglon)}
                  data={OPCIONES}
                />
              </Group>

              {/* En cuanto se marca como atendida, el reclamo de la refacción
                  aparece solo: no hay que intentar guardar para enterarse. */}
              {exigePiezaFaltante(r, resp, tiposCargados) && !error && (
                <Text size="xs" c="orange" mt={4}>
                  Falta cargar la refacción abajo para poder darla por atendida.
                </Text>
              )}

              {resp?.resultado === 'omitida' && (
                <TextInput
                  mt={6} size="xs" maxLength={300}
                  placeholder="Por qué quedó pendiente (no había filtro en existencia, no dio tiempo…)"
                  value={resp.nota}
                  onChange={(e) => anotar(r, e.currentTarget.value)}
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
