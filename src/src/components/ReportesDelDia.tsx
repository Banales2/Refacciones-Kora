// Lo que salió de los chequeos de hoy, de toda la flota y de un jalón.
//
// POR QUÉ NO BASTABA CON LA FICHA DE CADA UNIDAD. Ahí los reportes se leen de
// uno en uno: entrar al vehículo, abrir el historial, encontrar el de hoy. Para
// vaciar la bandeja del día eso son treinta idas y vueltas, y lo que pasa
// entonces es que no se vacía. Aquí está todo lo del día junto y cada reporte
// se atiende sin salir de la lista.
//
// LO QUE ORDENA ES LA URGENCIA, NO LA HORA. Primero los reportes del chofer que
// nadie ha leído —son los únicos que esperan una decisión de una persona—,
// luego las unidades con fallas, y hasta abajo las que salieron limpias. Un
// orden cronológico se vería más natural y serviría menos: lo que hay que
// atender quedaría repartido entre lo que no.
//
// Las fallas del checklist ya abrieron su incidencia solas al guardar el
// chequeo (el catálogo trae la severidad de antemano). Aquí se listan para
// saber qué salió, no para decidirlo: lo único que se decide en esta pantalla
// es qué hacer con lo que dijo el chofer.
//
// Lo que sí hay que mirar es el rojo sólido: son las fallas que NO abrieron
// nada porque ya tenían una incidencia abierta de días pasados. Al no abrir
// nada, no generan ruido en ningún lado, y sin este aviso la falla que lleva
// cuatro días sin atenderse se vería exactamente igual que la de esta mañana.
import { useMemo, useState } from 'react'
import {
  Stack, Group, Text, Card, Badge, Button, Alert, Loader, Center, Modal,
  Switch, ThemeIcon, Divider,
} from '@mantine/core'
import {
  IconAlertTriangle, IconCheck, IconEye, IconMessageReport, IconTruck,
} from '@tabler/icons-react'
import RevisarReporteChequeo from './RevisarReporteChequeo'
import { labelDeItem, arrastra, diaMes } from '../lib/chequeoItems'
import { useChequeosRango, type ChequeoConVehiculo } from '../hooks/useChequeos'
import { TIPO_COLORS, TIPO_LABELS } from '../lib/tipoVehiculo'

/** "14:30:00" → "14:30". La hora es opcional: quien captura no siempre la sabe. */
function horaCorta(hora: string | null): string | null {
  return hora ? hora.slice(0, 5) : null
}

function Renglon({
  chequeo, onRevisar,
}: {
  chequeo:   ChequeoConVehiculo
  onRevisar: () => void
}) {
  const fallas     = chequeo.items.filter((i) => i.resultado === 'falla')
  const sinRevisar = chequeo.hay_novedad && !chequeo.revisada_en
  const hora       = horaCorta(chequeo.hora)
  // Lo que ya venía fallando de días pasados. No abrió incidencia nueva, y por
  // eso hay que decirlo dos veces: en el encabezado del renglón, para que se
  // vea sin desplegar, y en la falla misma.
  const arrastradas = fallas.filter((f) => arrastra(f, chequeo.fecha) != null).length

  return (
    <Card
      withBorder
      radius="md"
      padding="sm"
      // El borde de color es lo que hace hojeable la lista en el teléfono: dice
      // qué renglón pide algo sin tener que leerlo.
      style={{
        borderLeftWidth: 4,
        borderLeftColor: sinRevisar
          ? 'var(--mantine-color-orange-6)'
          : fallas.length > 0
            ? 'var(--mantine-color-red-6)'
            : 'var(--mantine-color-teal-6)',
      }}
    >
      <Stack gap="xs">
        <Group justify="space-between" wrap="nowrap" gap="xs">
          <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
            <ThemeIcon
              variant="light"
              radius="xl"
              size="md"
              color={sinRevisar ? 'orange' : fallas.length > 0 ? 'red' : 'teal'}
            >
              {sinRevisar ? <IconMessageReport size={16} />
                : fallas.length > 0 ? <IconAlertTriangle size={16} />
                  : <IconCheck size={16} />}
            </ThemeIcon>
            <Stack gap={2} style={{ minWidth: 0 }}>
              <Text size="sm" fw={500} lineClamp={1}>{chequeo.vehiculo_nombre}</Text>
              <Group gap={6}>
                <Badge
                  size="xs"
                  variant="light"
                  color={TIPO_COLORS[chequeo.vehiculo_tipo as keyof typeof TIPO_COLORS]}
                >
                  {TIPO_LABELS[chequeo.vehiculo_tipo as keyof typeof TIPO_LABELS] ?? chequeo.vehiculo_tipo}
                </Badge>
                <Text size="xs" c="dimmed" lineClamp={1}>
                  {chequeo.ubicacion}{hora ? ` · ${hora}` : ''}
                </Text>
              </Group>
            </Stack>
          </Group>

          <Group gap={4} wrap="nowrap">
            {arrastradas > 0 && (
              <Badge size="xs" color="red" variant="filled">
                {arrastradas} sin atender
              </Badge>
            )}
            {fallas.length > 0 && (
              <Badge size="xs" color="red" variant="light">{fallas.length}</Badge>
            )}
            {sinRevisar && <Badge size="xs" color="orange">Sin leer</Badge>}
          </Group>
        </Group>

        {/* Quién revisó y a nombre de quién quedó el reporte. Son dos personas
            distintas y en la bandeja del día importa: una responde por el
            recorrido, la otra por lo que dijo de su unidad. */}
        <Text size="xs" c="dimmed">
          Revisó {chequeo.revisado_por}
          {chequeo.sin_chofer
            ? ' · sin chofer presente'
            : chequeo.declarado_por ? ` · chofer ${chequeo.declarado_por}` : ''}
        </Text>

        {chequeo.hay_novedad && (
          <Alert color={sinRevisar ? 'orange' : 'gray'} variant="light" p="xs">
            <Text size="sm">{chequeo.declaracion}</Text>
            {chequeo.revisada_en ? (
              <Text size="xs" c="dimmed" mt={4}>
                Revisado por {chequeo.revisada_por}
                {chequeo.revision_nota ? `: ${chequeo.revision_nota}` : ''}
                {chequeo.declaracion_pendiente_id != null ? ' · abrió incidencia' : ''}
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
                Revisar y decidir
              </Button>
            )}
          </Alert>
        )}

        {fallas.length > 0 && (
          <Stack gap={2}>
            {fallas.map((f) => {
              const desde = arrastra(f, chequeo.fecha)
              return (
                <Group key={f.clave} gap={6} wrap="nowrap" align="flex-start">
                  <Text size="xs" c="red" style={{ flex: 1 }}>
                    • {labelDeItem(f.clave)}
                    {f.valor ? ` — ${f.valor}` : ''}
                    {f.nota ? `: ${f.nota}` : ''}
                    {f.pendiente_id == null ? ' (sin incidencia)' : ''}
                  </Text>
                  {/* No abrió incidencia porque ya había una: sin este aviso, la
                      falla que lleva días se vería igual que la de hoy, que es
                      justo al revés de lo que importa. */}
                  {desde && (
                    <Badge size="xs" color="red" variant="filled">
                      Desde {diaMes(desde)}
                    </Badge>
                  )}
                </Group>
              )
            })}
          </Stack>
        )}

        {chequeo.nota && (
          <Text size="xs" c="dimmed" fs="italic">“{chequeo.nota}”</Text>
        )}
      </Stack>
    </Card>
  )
}

export default function ReportesDelDia() {
  // Sin parámetros: la API responde el día de hoy en hora de México, que no es
  // lo mismo que el día del teléfono de quien mira.
  const { data, isLoading, isError, refetch } = useChequeosRango({})
  const [revisando, setRevisando] = useState<ChequeoConVehiculo | null>(null)
  const [soloPendientes, setSoloPendientes] = useState(true)

  const chequeos = useMemo(() => data?.data ?? [], [data])

  const { ordenados, sinLeer, conFallas } = useMemo(() => {
    const urgencia = (c: ChequeoConVehiculo) => {
      if (c.hay_novedad && !c.revisada_en) return 0
      if (c.items.some((i) => i.resultado === 'falla')) return 1
      return 2
    }
    const ordenados = [...chequeos].sort((a, b) => urgencia(a) - urgencia(b))
    return {
      ordenados,
      sinLeer:   chequeos.filter((c) => c.hay_novedad && !c.revisada_en).length,
      conFallas: chequeos.filter((c) => c.items.some((i) => i.resultado === 'falla')).length,
    }
  }, [chequeos])

  const visibles = soloPendientes
    ? ordenados.filter((c) => (c.hay_novedad && !c.revisada_en) || c.items.some((i) => i.resultado === 'falla'))
    : ordenados

  if (isLoading) return <Center py="xl"><Loader /></Center>
  if (isError) {
    return (
      <Alert color="red" title="No se pudieron cargar los reportes de hoy">
        <Button size="xs" variant="light" onClick={() => refetch()}>Reintentar</Button>
      </Alert>
    )
  }

  return (
    <Stack gap="md">
      <Card withBorder radius="md" padding="md">
        <Stack gap="xs">
          <Group justify="space-between" wrap="wrap" gap="xs">
            <Group gap="xs">
              <IconTruck size={18} />
              <Text fw={600}>
                {chequeos.length} {chequeos.length === 1 ? 'chequeo' : 'chequeos'} hoy
              </Text>
            </Group>
            <Group gap={6}>
              {sinLeer > 0 && (
                <Badge color="orange" leftSection={<IconMessageReport size={11} />}>
                  {sinLeer} sin leer
                </Badge>
              )}
              {conFallas > 0 && (
                <Badge color="red" variant="light">{conFallas} con fallas</Badge>
              )}
              {sinLeer === 0 && conFallas === 0 && chequeos.length > 0 && (
                <Badge color="teal" leftSection={<IconCheck size={11} />}>Nada pendiente</Badge>
              )}
            </Group>
          </Group>

          {/* Encendido por omisión: a esta pestaña se entra a vaciar la bandeja,
              no a hojear. Lo limpio se puede ver, pero hay que pedirlo. */}
          <Switch
            size="xs"
            label="Solo lo que necesita atención"
            checked={soloPendientes}
            onChange={(e) => setSoloPendientes(e.currentTarget.checked)}
          />
        </Stack>
      </Card>

      {chequeos.length === 0 ? (
        <Alert color="blue" variant="light">
          Todavía no se ha capturado ningún chequeo hoy.
        </Alert>
      ) : visibles.length === 0 ? (
        <Alert color="teal" variant="light" icon={<IconCheck size={16} />}>
          Ningún chequeo de hoy tiene fallas ni reportes sin leer. Apaga el filtro
          para ver los {chequeos.length} completos.
        </Alert>
      ) : (
        <Stack gap="xs">
          {visibles.map((c, i) => (
            <div key={c.id}>
              {/* La raya donde deja de haber algo que hacer: lo de abajo es
                  historial del día, no bandeja. */}
              {!soloPendientes && i > 0 &&
                esPendiente(visibles[i - 1]) && !esPendiente(c) && (
                  <Divider my="sm" label="Sin novedad" labelPosition="center" />
                )}
              <Renglon chequeo={c} onRevisar={() => setRevisando(c)} />
            </div>
          ))}
        </Stack>
      )}

      <Modal
        opened={revisando != null}
        onClose={() => setRevisando(null)}
        title={revisando ? `Reporte de ${revisando.vehiculo_nombre}` : 'Reporte del chofer'}
        size="md"
        classNames={{ content: 'chequeo-movil' }}
      >
        {revisando && (
          <RevisarReporteChequeo
            chequeo={revisando}
            vehiculoId={revisando.vehiculo_id}
            onListo={() => setRevisando(null)}
          />
        )}
      </Modal>
    </Stack>
  )
}

function esPendiente(c: ChequeoConVehiculo): boolean {
  return (c.hay_novedad && !c.revisada_en) || c.items.some((i) => i.resultado === 'falla')
}
