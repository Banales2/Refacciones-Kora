// Chequeo de flotilla: el recorrido diario de una sucursal.
//
// El archivo y los identificadores siguen diciendo "patio" —`usePatio`,
// `/chequeos/patio`— porque describen el lugar físico que se camina, que no
// cambió; lo que cambió es cómo se llama la pantalla.
//
// La ficha del vehículo sirve para consultar una unidad; esto sirve para
// revisar treinta seguidas. La diferencia no es cosmética: con la ficha, cada
// unidad cuesta ir al tablero, abrir el detalle completo —refacciones,
// garantías, programa, mantenimientos— y regresar, para usar solo lo de hasta
// arriba. Aquí la lista se queda fija, el formulario se abre encima y al
// guardar avanza solo a la siguiente que falte.
//
// LAS DOS LISTAS SON DOS COSAS DISTINTAS. Las de base viven en esta sucursal y
// el sistema puede reclamarlas por su nombre. Los tráilers andan hoy aquí y
// mañana en otra parte, así que no se predicen: quien recorre los ve porque
// están enfrente, los busca y los agrega. Después de revisarlos aparecen abajo,
// porque su chequeo ya dice dónde se hizo.
import { useMemo, useState } from 'react'
import {
  Stack, Group, Text, Card, Badge, Button, Progress, Modal, Alert, Loader,
  Center, TextInput, Divider, ThemeIcon, ScrollArea,
} from '@mantine/core'
import {
  IconClipboardCheck, IconCheck, IconSearch, IconPlus,
  IconTruck, IconMessageReport,
} from '@tabler/icons-react'
import { SelectCatalogo } from '../components/SelectCatalogo'
import ChequeoDiarioForm from '../components/ChequeoDiarioForm'
import { useSucursales } from '../hooks/useSucursales'
import { useUsuarioActual } from '../hooks/useUsuarioActual'
import { useVehiculos } from '../hooks/useVehiculos'
import { usePatio, type UnidadPatio } from '../hooks/useChequeos'
import { TIPO_COLORS, TIPO_LABELS } from '../lib/tipoVehiculo'

function Renglon({
  unidad, onAbrir,
}: {
  unidad: UnidadPatio
  onAbrir: () => void
}) {
  const hecho = unidad.chequeo_id != null
  return (
    <Card
      withBorder
      radius="md"
      padding="sm"
      onClick={onAbrir}
      style={{ cursor: 'pointer', opacity: hecho ? 0.7 : 1 }}
    >
      <Group justify="space-between" wrap="nowrap" gap="xs">
        <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
          <ThemeIcon
            variant="light"
            radius="xl"
            size="lg"
            color={hecho ? (unidad.fallas > 0 ? 'red' : 'teal') : 'gray'}
          >
            {hecho ? <IconCheck size={18} /> : <IconTruck size={18} />}
          </ThemeIcon>
          <Stack gap={2} style={{ minWidth: 0 }}>
            <Text size="sm" fw={500} lineClamp={1}>{unidad.nombre}</Text>
            <Group gap={6}>
              <Badge size="xs" variant="light" color={TIPO_COLORS[unidad.tipo as keyof typeof TIPO_COLORS]}>
                {TIPO_LABELS[unidad.tipo as keyof typeof TIPO_LABELS] ?? unidad.tipo}
              </Badge>
              {unidad.placas && <Text size="xs" c="dimmed">{unidad.placas}</Text>}
            </Group>
          </Stack>
        </Group>

        <Group gap={4} wrap="nowrap">
          {unidad.hay_novedad && (
            <Badge size="xs" color="orange" variant="light" leftSection={<IconMessageReport size={11} />}>
              Reporte
            </Badge>
          )}
          {unidad.fallas > 0 && (
            <Badge size="xs" color="red" variant="light">{unidad.fallas}</Badge>
          )}
          {!hecho && <Badge size="xs" variant="outline" color="gray">Falta</Badge>}
        </Group>
      </Group>
    </Card>
  )
}

export default function ChequeoPatio() {
  const sucursales = useSucursales()
  const [sucursalId, setSucursalId] = useState<number | null>(null)
  const { data, isLoading, isError, refetch } = usePatio(sucursalId)
  const patio = data?.data

  // Quién recorre NO se captura: es la cuenta de la sesión, y la API la guarda
  // en `revisado_por` sin preguntar. Aquí solo se muestra para que quede claro
  // a nombre de quién va a quedar el recorrido.
  //
  // Y no tiene nada que ver con `declarado_por`, que es el chofer de cada
  // unidad. Son dos personas distintas y cambian a distinto ritmo: quien
  // recorre es una sola en todo el patio, el chofer es uno por unidad.
  const { data: usuario } = useUsuarioActual()

  const [abierta, setAbierta] = useState<UnidadPatio | null>(null)
  const [avisos, setAvisos] = useState<string[]>([])
  const [busqueda, setBusqueda] = useState('')

  // La búsqueda para agregar una unidad que no es de esta sucursal. El último
  // argumento la mantiene apagada hasta que hay algo escrito: detrás está el
  // padrón completo.
  const buscador = useVehiculos(
    1, busqueda.trim(), undefined, undefined, 8, busqueda.trim().length >= 2
  )

  const pendientes = patio?.base.filter((u) => u.chequeo_id == null) ?? []
  const avance = patio && patio.base.length > 0
    ? ((patio.base.length - pendientes.length) / patio.base.length) * 100
    : 0

  const opcionesSucursal = useMemo(
    () => (sucursales.data?.data ?? []).map((s) => ({ value: String(s.id), label: s.nombre })),
    [sucursales.data]
  )

  // Al guardar, la siguiente que falte. Es lo que convierte la pantalla en un
  // recorrido en vez de una lista: quien va caminando no debería tener que
  // volver a buscar dónde se quedó.
  const siguiente = (actual: UnidadPatio): UnidadPatio | null => {
    const faltan = (patio?.base ?? []).filter(
      (u) => u.chequeo_id == null && u.vehiculo_id !== actual.vehiculo_id
    )
    return faltan[0] ?? null
  }

  const alGuardar = (nuevos: string[], actual: UnidadPatio) => {
    setAvisos(nuevos)
    const sig = siguiente(actual)
    setAbierta(sig)
    if (!sig) refetch()
  }

  return (
    <Stack gap="md">
      {/* En el teléfono el selector baja y ocupa el ancho completo: a 390px, un
          campo de 240px junto al título deja los dos apretados contra los
          bordes. */}
      <Group justify="space-between" align="flex-end" wrap="wrap" gap="sm">
        <Stack gap={2}>
          <Group gap="xs">
            <IconClipboardCheck size={22} />
            <Text fw={700} size="lg">Chequeo de flotilla</Text>
          </Group>
          {usuario && (
            <Text size="xs" c="dimmed">
              Recorre {usuario.data.nombre}
            </Text>
          )}
        </Stack>
        <SelectCatalogo
          label="Sucursal"
          placeholder="¿Qué sucursal se recorre?"
          nombre="sucursales"
          estado={sucursales}
          data={opcionesSucursal}
          value={sucursalId != null ? String(sucursalId) : null}
          onChange={(v) => { setSucursalId(v ? Number(v) : null); setAbierta(null) }}
          w={{ base: '100%', sm: 240 }}
        />
      </Group>

      {sucursalId == null ? (
        <Alert color="blue" variant="light">
          Elige la sucursal que vas a recorrer para ver qué unidades le faltan hoy.
        </Alert>
      ) : isLoading ? (
        <Center py="xl"><Loader /></Center>
      ) : isError || !patio ? (
        <Alert color="red" title="No se pudo cargar la flotilla">
          <Button size="xs" variant="light" onClick={() => refetch()}>Reintentar</Button>
        </Alert>
      ) : (
        <>
          <Card withBorder radius="md" padding="md">
            <Stack gap="xs">
              <Group justify="space-between">
                <Text fw={600}>
                  {patio.base.length - pendientes.length} de {patio.base.length} revisadas
                </Text>
                {pendientes.length === 0 ? (
                  <Badge color="teal" leftSection={<IconCheck size={12} />}>Flotilla completa</Badge>
                ) : (
                  <Badge color="orange">Faltan {pendientes.length}</Badge>
                )}
              </Group>
              <Progress value={avance} color={pendientes.length === 0 ? 'teal' : 'blue'} />
              {pendientes.length > 0 && (
                <Button mt="xs" size="md" onClick={() => setAbierta(pendientes[0])}>
                  Empezar el recorrido
                </Button>
              )}
            </Stack>
          </Card>

          {avisos.length > 0 && (
            <Alert color="blue" variant="light" withCloseButton onClose={() => setAvisos([])}>
              <Stack gap={2}>
                {avisos.map((a, i) => <Text key={i} size="sm">{a}</Text>)}
              </Stack>
            </Alert>
          )}

          <Stack gap="xs">
            {patio.base.map((u) => (
              <Renglon key={u.vehiculo_id} unidad={u} onAbrir={() => setAbierta(u)} />
            ))}
            {patio.base.length === 0 && (
              <Text size="sm" c="dimmed">Esta sucursal no tiene unidades con base aquí.</Text>
            )}
          </Stack>

          <Divider
            label="De paso por esta sucursal"
            labelPosition="center"
          />
          <Text size="xs" c="dimmed" ta="center" mt={-8}>
            Los tráilers cambian de sucursal, así que no aparecen solos: búscalos y agrégalos.
          </Text>

          <Stack gap="xs">
            {patio.visitantes.map((u) => (
              <Renglon key={u.vehiculo_id} unidad={u} onAbrir={() => setAbierta(u)} />
            ))}

            <TextInput
              placeholder="Buscar por serie, placas o modelo"
              leftSection={<IconSearch size={16} />}
              value={busqueda}
              onChange={(e) => setBusqueda(e.currentTarget.value)}
            />
            {busqueda.trim().length >= 2 && (
              <ScrollArea.Autosize mah={240}>
                <Stack gap={4}>
                  {(buscador.data?.data ?? [])
                    .filter((v) => !patio.base.some((b) => b.vehiculo_id === v.id))
                    .map((v) => (
                      <Card
                        key={v.id}
                        withBorder
                        radius="sm"
                        padding="xs"
                        style={{ cursor: 'pointer' }}
                        onClick={() => setAbierta({
                          vehiculo_id: v.id,
                          nombre: `${v.marca} ${v.modelo} — ${v.serie}`,
                          tipo: v.tipo,
                          placas: v.placas,
                          chequeo_id: null,
                          fallas: 0,
                          hay_novedad: false,
                        })}
                      >
                        <Group justify="space-between" wrap="nowrap">
                          <Text size="sm" lineClamp={1}>
                            {v.marca} {v.modelo} — {v.serie}
                          </Text>
                          <IconPlus size={14} />
                        </Group>
                      </Card>
                    ))}
                </Stack>
              </ScrollArea.Autosize>
            )}
          </Stack>
        </>
      )}

      <Modal
        opened={abierta != null}
        onClose={() => setAbierta(null)}
        title={abierta?.nombre ?? 'Chequeo'}
        size="lg"
        fullScreen={typeof window !== 'undefined' && window.innerWidth < 768}
      >
        {abierta && patio && (
          <>
            {pendientes.length > 0 && (
              <Text size="xs" c="dimmed" mb="xs">
                Faltan {pendientes.length} de {patio.base.length} en esta sucursal
              </Text>
            )}
            <ChequeoDiarioForm
              // `key` obliga a montar un formulario limpio por unidad: sin él,
              // al avanzar a la siguiente se quedarían las respuestas de la
              // anterior, que es el peor error posible aquí.
              key={abierta.vehiculo_id}
              vehiculoId={abierta.vehiculo_id}
              ubicacionFija={patio.ubicacion}
              onListo={(nuevos) => alGuardar(nuevos, abierta)}
              onCancel={() => setAbierta(null)}
            />
          </>
        )}
      </Modal>
    </Stack>
  )
}
