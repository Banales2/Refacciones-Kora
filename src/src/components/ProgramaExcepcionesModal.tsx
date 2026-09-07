// Lo que una unidad hace distinto del programa de su modelo.
//
// El programa se captura una vez por modelo y lo siguen todas sus unidades. Casi
// siempre eso basta, pero no siempre: a una unidad que trabaja en terracería se
// le adelanta una columna, a otra se le apaga un renglón porque trae otro equipo.
// Copiar la cuadrícula entera a cada unidad daría esa libertad y costaría que
// una corrección al programa del modelo ya no alcanzara a nadie, así que aquí
// se guardan solo las diferencias: lo que esta pantalla no toca sigue viniendo
// del catálogo, y una corrección al modelo sí llega.
//
// Por eso se pinta el valor del modelo en gris de fondo y lo de la unidad
// encima: lo que se está editando no es el programa, es la diferencia contra él.
import { useState } from 'react'
import {
  Stack, Group, Text, Table, Button, Alert, NumberInput, Switch, Badge, Tooltip,
  Divider, ScrollArea,
} from '@mantine/core'
import type { Programa } from '../hooks/usePrograma'
import type { Excepciones } from '../hooks/useProgramaVehiculo'
import { KM_MAX } from '../lib/validaciones'

const nf = new Intl.NumberFormat('es-MX')

/** Lo que la unidad cambió, indexado para editarlo sin recorrer listas. */
type MapaFases = Record<number, { km: number | null; costo: number | null; omitida: boolean }>
type MapaOps   = Record<number, { activa: boolean; limite_meses: number | null }>

function indexar(exc: Excepciones): { fases: MapaFases; operaciones: MapaOps } {
  const fases: MapaFases = {}
  for (const f of exc.fases) fases[f.fase_id] = { km: f.km, costo: f.costo, omitida: f.omitida }
  const operaciones: MapaOps = {}
  for (const o of exc.operaciones) {
    operaciones[o.operacion_id] = { activa: o.activa, limite_meses: o.limite_meses }
  }
  return { fases, operaciones }
}

export default function ProgramaExcepcionesModal({
  programa, excepciones, isPending, error, onSubmit, onCancel,
}: {
  /** El del modelo, ya con las excepciones aplicadas: de él salen los ids. */
  programa:    Programa
  excepciones: Excepciones
  isPending:   boolean
  error:       string | null
  onSubmit:    (e: Excepciones) => void
  onCancel:    () => void
}) {
  const inicial = indexar(excepciones)
  const [fases, setFases] = useState<MapaFases>(inicial.fases)
  const [ops, setOps]     = useState<MapaOps>(inicial.operaciones)

  function fase(id: number) {
    return fases[id] ?? { km: null, costo: null, omitida: false }
  }
  function op(id: number) {
    return ops[id] ?? { activa: true, limite_meses: null }
  }
  function tocarFase(id: number, cambio: Partial<MapaFases[number]>) {
    setFases((prev) => ({ ...prev, [id]: { ...fase(id), ...cambio } }))
  }
  function tocarOp(id: number, cambio: Partial<MapaOps[number]>) {
    setOps((prev) => ({ ...prev, [id]: { ...op(id), ...cambio } }))
  }

  // Solo viaja lo que efectivamente cambia algo. La API vuelve a filtrar, pero
  // hacerlo aquí también evita mandar cincuenta filas vacías en cada guardado.
  function guardar() {
    onSubmit({
      fases: Object.entries(fases)
        .map(([id, f]) => ({ fase_id: Number(id), ...f }))
        .filter((f) => f.omitida || f.km != null || f.costo != null),
      operaciones: Object.entries(ops)
        .map(([id, o]) => ({ operacion_id: Number(id), ...o }))
        .filter((o) => !o.activa || o.limite_meses != null),
    })
  }

  const cambios =
    Object.values(fases).filter((f) => f.omitida || f.km != null || f.costo != null).length +
    Object.values(ops).filter((o) => !o.activa || o.limite_meses != null).length

  return (
    <Stack gap="md">
      <Text size="sm" c="dimmed">
        En gris, lo que dice el programa <strong>{programa.nombre}</strong>. Lo que se capture aquí
        aplica solo a esta unidad; lo que se deje vacío sigue viniendo del modelo y se actualiza
        con él.
      </Text>

      <Divider label="Columnas" labelPosition="left" />
      <ScrollArea.Autosize mah={260}>
        <Table striped withTableBorder verticalSpacing={4}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th style={{ width: 110 }}>Del modelo</Table.Th>
              <Table.Th style={{ width: 150 }}>Kilometraje</Table.Th>
              <Table.Th style={{ width: 150 }}>Costo</Table.Th>
              <Table.Th style={{ width: 110, textAlign: 'center' }}>No aplica</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {programa.fases.map((f) => {
              const e = fase(f.id)
              return (
                <Table.Tr key={f.id}>
                  <Table.Td>
                    <Group gap={4} wrap="nowrap">
                      <Text size="sm" c="dimmed">{nf.format(f.km)} km</Text>
                      {f.unica && (
                        <Tooltip label="Solo en la primera pasada">
                          <Badge size="xs" variant="outline" color="gray">1 vez</Badge>
                        </Tooltip>
                      )}
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    <NumberInput
                      size="xs" min={1} max={KM_MAX} suffix=" km" thousandSeparator=","
                      allowDecimal={false} allowNegative={false} clampBehavior="strict"
                      placeholder={nf.format(f.km)}
                      disabled={e.omitida}
                      value={e.km ?? ''}
                      onChange={(v) => tocarFase(f.id, { km: v === '' ? null : Number(v) })}
                    />
                  </Table.Td>
                  <Table.Td>
                    <NumberInput
                      size="xs" min={0} max={9_999_999} prefix="$" thousandSeparator=","
                      decimalScale={2} allowNegative={false} clampBehavior="strict"
                      placeholder={f.costo != null ? nf.format(f.costo) : 'sin cotizar'}
                      disabled={e.omitida}
                      value={e.costo ?? ''}
                      onChange={(v) => tocarFase(f.id, { costo: v === '' ? null : Number(v) })}
                    />
                  </Table.Td>
                  <Table.Td style={{ textAlign: 'center' }}>
                    <Switch
                      size="xs" checked={e.omitida}
                      onChange={(ev) => tocarFase(f.id, { omitida: ev.currentTarget.checked })}
                    />
                  </Table.Td>
                </Table.Tr>
              )
            })}
          </Table.Tbody>
        </Table>
      </ScrollArea.Autosize>

      <Divider label="Renglones" labelPosition="left" />
      <ScrollArea.Autosize mah={300}>
        <Table striped withTableBorder verticalSpacing={4}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Operación</Table.Th>
              <Table.Th style={{ width: 150 }}>Límite de meses</Table.Th>
              <Table.Th style={{ width: 90, textAlign: 'center' }}>Aplica</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {programa.operaciones.map((o) => {
              const e = op(o.id)
              return (
                <Table.Tr key={o.id}>
                  <Table.Td>
                    <Text size="sm" c={e.activa ? undefined : 'dimmed'}>{o.nombre}</Text>
                    {o.categoria && <Text size="xs" c="dimmed">{o.categoria}</Text>}
                  </Table.Td>
                  <Table.Td>
                    <NumberInput
                      size="xs" min={1} max={600}
                      allowDecimal={false} allowNegative={false} clampBehavior="strict"
                      placeholder={o.limite_meses != null ? String(o.limite_meses) : 'sin límite'}
                      disabled={!e.activa}
                      value={e.limite_meses ?? ''}
                      onChange={(v) => tocarOp(o.id, { limite_meses: v === '' ? null : Number(v) })}
                    />
                  </Table.Td>
                  <Table.Td style={{ textAlign: 'center' }}>
                    <Switch
                      size="xs" checked={e.activa}
                      onChange={(ev) => tocarOp(o.id, { activa: ev.currentTarget.checked })}
                    />
                  </Table.Td>
                </Table.Tr>
              )
            })}
          </Table.Tbody>
        </Table>
      </ScrollArea.Autosize>

      {error && <Alert color="red" title="Error">{error}</Alert>}

      <Group justify="space-between">
        <Text size="xs" c="dimmed">
          {cambios === 0
            ? 'Esta unidad sigue el programa del modelo tal cual.'
            : `${cambios} ${cambios === 1 ? 'diferencia' : 'diferencias'} contra el programa del modelo.`}
        </Text>
        <Group gap="xs">
          <Button variant="default" onClick={onCancel} disabled={isPending}>Cancelar</Button>
          <Button loading={isPending} onClick={guardar}>Guardar</Button>
        </Group>
      </Group>
    </Stack>
  )
}
