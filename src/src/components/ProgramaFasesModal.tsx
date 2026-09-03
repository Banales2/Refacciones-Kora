// Las columnas del programa: a qué marcas de odómetro el fabricante manda la
// unidad al taller, y cuáles de esas marcas ocurren una sola vez.
//
// Se editan todas juntas porque cambiar una cambia el recorrido completo, y
// porque las tres reglas del ciclo solo se pueden comprobar sobre la lista
// entera. La API empata las columnas por kilometraje, así que mover una de
// lugar o marcarla como única no tira las celdas que ya tiene capturadas.
import { useState } from 'react'
import {
  Stack, Group, Text, Button, NumberInput, ActionIcon, Switch, Alert, Divider, Badge,
} from '@mantine/core'
import { IconPlus, IconTrash } from '@tabler/icons-react'
import { KM_MAX } from '../lib/validaciones'
import { proximosServicios, type FasePrograma, type FasePayload } from '../hooks/usePrograma'

interface Renglon {
  km:    number | null
  unica: boolean
  /** Lo que el taller cobra por la columna completa. Nulo = sin cotizar. */
  costo: number | null
}

const nf = new Intl.NumberFormat('es-MX')

// Las mismas tres reglas que valida la API (api/src/schemas/programaSchema.ts),
// aquí para que el error se vea antes de mandarlo y explicado en su renglón.
function validar(fases: Renglon[]): Map<number, string> {
  const errores = new Map<number, string>()
  fases.forEach((f, i) => {
    if (!f.km || f.km < 1) errores.set(i, 'Falta el kilometraje')
    else if (f.km > KM_MAX) errores.set(i, `Máximo ${nf.format(KM_MAX)} km`)
    else if (i > 0 && fases[i - 1].km != null && f.km <= fases[i - 1].km!) {
      errores.set(i, 'Tiene que ser mayor que la columna anterior')
    }
  })
  const primeraDelBucle = fases.findIndex((f) => !f.unica)
  if (primeraDelBucle === -1 && fases.length) {
    errores.set(fases.length - 1, 'Al menos una columna tiene que repetirse')
  } else {
    fases.forEach((f, i) => {
      if (f.unica && i > primeraDelBucle && !errores.has(i)) {
        errores.set(i, 'Las columnas de una sola vez tienen que ir primero')
      }
    })
  }
  return errores
}

export default function ProgramaFasesModal({
  fases, isPending, error, onSubmit, onCancel,
}: {
  fases:     FasePrograma[]
  isPending: boolean
  error:     string | null
  onSubmit:  (fases: FasePayload[]) => void
  onCancel:  () => void
}) {
  const [renglones, setRenglones] = useState<Renglon[]>(
    fases.length
      ? fases.map((f) => ({ km: f.km, unica: f.unica, costo: f.costo }))
      : [{ km: null, unica: false, costo: null }]
  )

  const errores = validar(renglones)
  const valido  = errores.size === 0 && renglones.length > 0

  function set(i: number, cambio: Partial<Renglon>) {
    setRenglones((prev) => prev.map((r, j) => (j === i ? { ...r, ...cambio } : r)))
  }

  // La nueva columna se propone a la misma distancia que hay entre las dos
  // últimas: casi siempre el programa avanza a paso constante.
  function agregar() {
    const ultimo = renglones[renglones.length - 1]?.km ?? 0
    const previo = renglones[renglones.length - 2]?.km ?? 0
    const paso   = ultimo && previo ? ultimo - previo : ultimo || 15000
    setRenglones((prev) => [...prev, { km: ultimo + paso, unica: false, costo: null }])
  }

  // Cómo va a quedar el recorrido, con la vuelta incluida. Es lo único que hace
  // evidente que las columnas únicas se consumen y que después se cicla.
  const listas = renglones
    .filter((r): r is { km: number; unica: boolean; costo: number | null } => r.km != null && r.km > 0)
    .map((r, i) => ({ id: i, orden: i, km: r.km, unica: r.unica, costo: r.costo }))
  const recorrido = valido ? proximosServicios(listas, 0, Math.min(listas.length + 4, 14)) : []

  return (
    <Stack gap="sm">
      <Text size="sm" c="dimmed">
        Cada columna es un servicio del manual, con la marca de odómetro tal como la publica el
        fabricante. Las marcadas <strong>una sola vez</strong> son las de asentamiento: se hacen en
        la primera pasada y después el recorrido se queda dando vueltas sobre el resto.
      </Text>
      <Text size="sm" c="dimmed">
        El costo es lo que el taller cobra por la columna completa —mano de obra y refacciones
        juntas—, que es como llega la cotización. Dejarlo vacío no es cotizarlo en cero: la
        proyección de gastos deja fuera esa visita y lo dice.
      </Text>

      {renglones.map((r, i) => (
        <Group key={i} gap="xs" align="flex-start" wrap="nowrap">
          <NumberInput
            flex={1}
            label={i === 0 ? 'Marca de odómetro' : undefined}
            min={1} max={KM_MAX}
            suffix=" km" thousandSeparator=","
            allowDecimal={false} allowNegative={false} clampBehavior="strict"
            value={r.km ?? ''}
            error={errores.get(i)}
            onChange={(v) => set(i, { km: typeof v === 'number' ? v : parseInt(String(v), 10) || null })}
          />
          <NumberInput
            w={150}
            label={i === 0 ? 'Costo cotizado' : undefined}
            min={0} max={9_999_999}
            prefix="$" thousandSeparator="," decimalScale={2}
            placeholder="Sin cotizar"
            allowNegative={false} clampBehavior="strict"
            value={r.costo ?? ''}
            onChange={(v) => set(i, {
              costo: v === '' || v == null ? null : Number(v),
            })}
          />
          <Switch
            mt={i === 0 ? 32 : 8}
            label="Una sola vez"
            checked={r.unica}
            onChange={(e) => set(i, { unica: e.currentTarget.checked })}
          />
          <ActionIcon
            variant="subtle" color="red" size="lg" mt={i === 0 ? 26 : 2}
            aria-label={`Quitar la columna ${i + 1}`}
            disabled={renglones.length === 1}
            onClick={() => setRenglones((prev) => prev.filter((_, j) => j !== i))}
          >
            <IconTrash size={16} />
          </ActionIcon>
        </Group>
      ))}

      <Button
        variant="light" size="xs" leftSection={<IconPlus size={14} />}
        onClick={agregar} style={{ alignSelf: 'flex-start' }}
      >
        Agregar columna
      </Button>

      {recorrido.length > 0 && (
        <>
          <Divider label="Cómo queda el recorrido" labelPosition="left" />
          <Group gap={6} wrap="wrap">
            {recorrido.map((s) => (
              <Badge
                key={s.indice}
                variant={s.km === s.fase.km ? 'light' : 'outline'}
                color={s.km === s.fase.km ? 'blue' : 'grape'}
                size="sm"
              >
                {nf.format(s.km)} km
                {s.km !== s.fase.km && ` · columna ${nf.format(s.fase.km)}`}
              </Badge>
            ))}
          </Group>
          <Text size="xs" c="dimmed">
            En morado, las visitas en las que el programa ya dio la vuelta y repite una columna
            anterior.
          </Text>
        </>
      )}

      {/* Quitar una columna se lleva sus celdas: es la única pérdida de captura
          que puede provocar este formulario, y conviene decirlo antes. */}
      <Alert color="orange" variant="light" p="xs">
        <Text size="xs">
          Si quitas una columna se borra lo que estaba marcado en ella. Cambiarla de lugar o
          marcarla como única no afecta lo capturado.
        </Text>
      </Alert>

      {error && <Alert color="red" title="Error">{error}</Alert>}

      <Group justify="flex-end">
        <Button variant="default" onClick={onCancel} disabled={isPending}>Cancelar</Button>
        <Button
          loading={isPending} disabled={!valido}
          onClick={() => onSubmit(listas.map((f) => ({ km: f.km, unica: f.unica, costo: f.costo })))}
        >
          Guardar columnas
        </Button>
      </Group>
    </Stack>
  )
}
