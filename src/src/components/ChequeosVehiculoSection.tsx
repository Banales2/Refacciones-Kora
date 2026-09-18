// Los chequeos diarios en la ficha de la unidad: el de hoy (o el botón para
// hacerlo) y el historial.
//
// El historial se lee de arriba abajo buscando dos cosas: qué días no se
// revisó, y qué reportes del chofer siguen sin leer. Todo lo demás —las
// preguntas que salieron bien— se resume en una línea, porque un chequeo limpio
// no tiene nada que contar.
import { useState } from 'react'
import {
  Stack, Group, Button, Text, Card, Badge, Alert, Loader, Center, Modal,
  Timeline, Textarea, SegmentedControl, Divider, Paper, ScrollArea,
} from '@mantine/core'
import {
  IconClipboardCheck, IconAlertTriangle, IconCheck, IconGauge, IconEye,
} from '@tabler/icons-react'
import ChequeoDiarioForm from './ChequeoDiarioForm'
import { labelDeItem } from '../lib/chequeoItems'
import type { Severidad } from '../lib/chequeoItems'
import {
  useChequeosVehiculo, useRevisarChequeo, type Chequeo,
} from '../hooks/useChequeos'
import { limpiarTextoLibre } from '../lib/validaciones'

function fechaLegible(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${a}`
}

/** El panel de revisión de un reporte del chofer. */
function RevisarReporte({
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

      <Group grow>
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
      </Group>
    </Stack>
  )
}

function ResumenChequeo({ chequeo, onRevisar }: { chequeo: Chequeo; onRevisar: () => void }) {
  const fallas = chequeo.items.filter((i) => i.resultado === 'falla')
  const noSePudo = chequeo.items.filter((i) => i.resultado === 'na')
  const sinRevisar = chequeo.hay_novedad && !chequeo.revisada_en

  // El odómetro que baja: la lectura se guardó, pero el odómetro de la unidad
  // no retrocedió. Es la señal de que está desconectado o lo alteraron.
  const retrocede =
    chequeo.lectura != null &&
    chequeo.lectura_anterior != null &&
    chequeo.lectura < chequeo.lectura_anterior

  return (
    <Card withBorder radius="md" padding="sm">
      <Stack gap="xs">
        <Group justify="space-between" wrap="nowrap">
          <Group gap="xs">
            <Text fw={600} size="sm">{fechaLegible(chequeo.fecha)}</Text>
            {/* Sin chofer se dice, no se deja el hueco: un nombre vacío se lee
                como un dato que faltó capturar, y aquí es información. */}
            <Text size="xs" c="dimmed" fs={chequeo.sin_chofer ? 'italic' : undefined}>
              {chequeo.sin_chofer ? 'Sin chofer presente' : chequeo.declarado_por}
            </Text>
          </Group>
          <Group gap={4}>
            {sinRevisar && <Badge color="orange" size="sm">Reporte sin leer</Badge>}
            {fallas.length > 0 && (
              <Badge color="red" variant="light" size="sm">
                {fallas.length} {fallas.length === 1 ? 'falla' : 'fallas'}
              </Badge>
            )}
            {fallas.length === 0 && !chequeo.hay_novedad && !chequeo.sin_chofer && (
              <Badge color="teal" variant="light" size="sm" leftSection={<IconCheck size={11} />}>
                Sin novedad
              </Badge>
            )}
          </Group>
        </Group>

        {chequeo.lectura != null && (
          <Group gap={6}>
            <IconGauge size={14} style={{ color: 'var(--mantine-color-dimmed)' }} />
            <Text size="xs" c={retrocede ? 'red' : 'dimmed'}>
              {chequeo.lectura.toLocaleString('es-MX')}
              {chequeo.lectura_anterior != null && (
                retrocede
                  ? ` — menor que el registrado (${chequeo.lectura_anterior.toLocaleString('es-MX')})`
                  : ` (+${(chequeo.lectura - chequeo.lectura_anterior).toLocaleString('es-MX')})`
              )}
            </Text>
          </Group>
        )}

        {chequeo.hay_novedad && (
          <Alert
            color={sinRevisar ? 'orange' : 'gray'}
            variant="light"
            p="xs"
          >
            <Text size="sm">{chequeo.declaracion}</Text>
            {chequeo.revisada_en ? (
              <Text size="xs" c="dimmed" mt={4}>
                Revisado por {chequeo.revisada_por}
                {chequeo.revision_nota ? `: ${chequeo.revision_nota}` : ''}
              </Text>
            ) : (
              <Button
                size="compact-xs"
                variant="light"
                color="orange"
                mt={6}
                leftSection={<IconEye size={13} />}
                onClick={onRevisar}
              >
                Revisar
              </Button>
            )}
          </Alert>
        )}

        {fallas.length > 0 && (
          <Stack gap={2}>
            {fallas.map((f) => (
              <Text key={f.clave} size="xs" c="red">
                • {labelDeItem(f.clave)}{f.nota ? `: ${f.nota}` : ''}
              </Text>
            ))}
          </Stack>
        )}

        {noSePudo.length > 0 && (
          <Text size="xs" c="dimmed">
            No se pudo revisar: {noSePudo.map((n) => labelDeItem(n.clave)).join(', ')}
          </Text>
        )}
      </Stack>
    </Card>
  )
}

export default function ChequeosVehiculoSection({ vehiculoId }: { vehiculoId: number }) {
  const { data, isLoading, isError, refetch } = useChequeosVehiculo(vehiculoId)
  const [abierto, setAbierto] = useState(false)
  const [revisando, setRevisando] = useState<Chequeo | null>(null)
  const [avisos, setAvisos] = useState<string[]>([])

  const chequeos = data?.data ?? []
  const hoy = new Date().toISOString().slice(0, 10)
  const chequeoDeHoy = chequeos.find((c) => c.fecha.slice(0, 10) === hoy) ?? null

  if (isLoading) {
    return (
      <Paper withBorder p="md" radius="md">
        <Center py="md"><Loader size="sm" /></Center>
      </Paper>
    )
  }
  if (isError) {
    return (
      <Paper withBorder p="md" radius="md">
        <Alert color="red" title="No se pudieron cargar los chequeos">
          <Button size="xs" variant="light" onClick={() => refetch()}>Reintentar</Button>
        </Alert>
      </Paper>
    )
  }

  return (
    <Paper withBorder p="md" radius="md">
    <Stack gap="sm">
      <Group justify="space-between" align="center">
        <Group gap="xs">
          <IconClipboardCheck size={18} />
          <Text size="sm" fw={500}>
            Chequeo diario{chequeos.length > 0 ? ` (${chequeos.length})` : ''}
          </Text>
        </Group>
        <Button
          size="xs"
          variant={chequeoDeHoy ? 'default' : 'filled'}
          onClick={() => setAbierto(true)}
        >
          {chequeoDeHoy ? 'Corregir el de hoy' : 'Hacer el de hoy'}
        </Button>
      </Group>

      {!chequeoDeHoy && (
        <Alert color="yellow" variant="light" p="xs">
          <Text size="sm">Esta unidad todavía no tiene chequeo de hoy.</Text>
        </Alert>
      )}

      {avisos.length > 0 && (
        <Alert color="blue" variant="light" withCloseButton onClose={() => setAvisos([])}>
          <Stack gap={2}>
            {avisos.map((a, i) => <Text key={i} size="sm">{a}</Text>)}
          </Stack>
        </Alert>
      )}

      {chequeos.length === 0 ? (
        <Text size="sm" c="dimmed">Sin chequeos capturados.</Text>
      ) : (
        // Con tope de altura: son noventa días de historial y sin esto la
        // ficha del vehículo se vuelve una tira de tres metros.
        <ScrollArea.Autosize mah={420} type="auto">
          <Timeline bulletSize={12} lineWidth={2}>
            {chequeos.map((c) => (
              <Timeline.Item
                key={c.id}
                color={c.hay_novedad && !c.revisada_en ? 'orange'
                  : c.items.some((i) => i.resultado === 'falla') ? 'red' : 'teal'}
              >
                <ResumenChequeo chequeo={c} onRevisar={() => setRevisando(c)} />
              </Timeline.Item>
            ))}
          </Timeline>
        </ScrollArea.Autosize>
      )}

      <Modal
        opened={abierto}
        onClose={() => setAbierto(false)}
        title="Chequeo diario"
        size="lg"
        fullScreen={typeof window !== 'undefined' && window.innerWidth < 768}
      >
        {abierto && (
          <ChequeoDiarioForm
            vehiculoId={vehiculoId}
            onListo={(nuevos) => { setAvisos(nuevos); setAbierto(false) }}
            onCancel={() => setAbierto(false)}
          />
        )}
      </Modal>

      <Modal
        opened={revisando != null}
        onClose={() => setRevisando(null)}
        title="Reporte del chofer"
        size="md"
      >
        {revisando && (
          <RevisarReporte
            chequeo={revisando}
            vehiculoId={vehiculoId}
            onListo={() => setRevisando(null)}
          />
        )}
      </Modal>
    </Stack>
    </Paper>
  )
}
