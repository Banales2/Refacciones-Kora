// Inventario por sucursal: qué piezas hay en cada una, de qué compra salieron,
// y los mínimos que cada sucursal debe mantener para no quedarse varada.
//
// Todo cuelga de una sucursal elegida arriba: es la pregunta que la pantalla
// contesta ("¿qué hay en Vallarta?"), y sin ese filtro las tres pestañas serían
// listas de toda la flota que no ayudan a decidir nada.
import { useMemo, useState } from 'react'
import {
  Stack, Group, Title, Text, Tabs, Table, Badge, Button, Alert, Center,
  Loader, Modal, NumberInput, Textarea, ActionIcon, Paper,
} from '@mantine/core'
import { IconArrowsExchange, IconPlus, IconTrash, IconAlertTriangle } from '@tabler/icons-react'
import { useSucursales } from '../hooks/useSucursales'
import { useTodasLasPiezas } from '../hooks/useRefacciones'
import {
  useExistencias, useTraspasos, useCreateTraspaso,
  useMinimos, useCreateMinimo, useUpdateMinimo, useDeleteMinimo,
} from '../hooks/useInventario'
import type { ExistenciaEnSucursal, MinimoSucursal } from '../hooks/useInventario'
import { useDescuadres, useResolverDescuadre } from '../hooks/useDescuadres'
import { useCuadreUnidades } from '../hooks/useCuadreUnidades'
import type { Descuadre, ResolucionDescuadre } from '../hooks/useDescuadres'
import { FechaInput } from '../components/FechaInput'
import SelectCatalogo from '../components/SelectCatalogo'
import { formatearFecha } from '../lib/fechas'

const formatMXN = (n: number) =>
  n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })

const hoy = () => new Date().toISOString().slice(0, 10)

export default function Inventario() {
  const sucQuery = useSucursales()
  const { data: sucData, isLoading: cargandoSuc } = sucQuery
  const sucursales = useMemo(() => sucData?.data ?? [], [sucData])

  // Sin sucursal elegida no se asume ninguna: elegir por el usuario haría que
  // la primera lectura de la pantalla fuera de una sucursal que no pidió.
  const [sucursalId, setSucursalId] = useState<string | null>(null)
  const sucursal = sucursales.find((s) => String(s.id) === sucursalId)
  const idNum = sucursal?.id

  const [traspasoDe, setTraspasoDe] = useState<ExistenciaEnSucursal | null>(null)
  const [minimoOpen, setMinimoOpen] = useState(false)
  // Los de TODA la flota, no los de la sucursal elegida: el aviso existe para
  // mandar a la sucursal donde está el problema, que casi nunca es la que se
  // está mirando.
  const { data: descuadresData } = useDescuadres()
  const descuadres = descuadresData?.data ?? []

  if (cargandoSuc) return <Center py="xl"><Loader /></Center>

  // Antes que el "no hay ninguna": si la consulta se cayó, la lista está vacía
  // porque no llegó, no porque no existan. Mandar a dar de alta una sucursal
  // que ya está dada de alta es el peor final posible para un internet malo.
  if (sucQuery.isError) {
    return (
      <Stack gap="md">
        <Title order={2}>Inventario</Title>
        <Alert color="red" title="No se pudo cargar la lista de sucursales">
          <Stack gap="xs" align="flex-start">
            <Text size="sm">
              Revisa tu conexión. Tus datos están a salvo: no se ha perdido nada.
            </Text>
            <Button size="xs" variant="light" onClick={() => sucQuery.refetch()}>
              Reintentar
            </Button>
          </Stack>
        </Alert>
      </Stack>
    )
  }

  if (sucursales.length === 0) {
    return (
      <Stack gap="md">
        <Title order={2}>Inventario</Title>
        <Alert color="yellow" title="Sin sucursales">
          Da de alta al menos una sucursal en Catálogos para poder llevar inventario.
        </Alert>
      </Stack>
    )
  }

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end">
        <Stack gap={2}>
          <Title order={2}>Inventario</Title>
          <Text size="sm" c="dimmed">
            Qué refacciones hay en cada sucursal y de qué compra salieron.
          </Text>
        </Stack>
        <SelectCatalogo
          estado={sucQuery}
          nombre="sucursales"
          label="Sucursal"
          placeholder="Selecciona una sucursal"
          data={sucursales.map((s) => ({ value: String(s.id), label: s.nombre }))}
          value={sucursalId}
          onChange={setSucursalId}
          w={260}
        />
      </Group>

      {descuadres.length > 0 && (
        <Alert
          color="orange"
          variant="light"
          icon={<IconAlertTriangle size={18} />}
          title={
            descuadres.length === 1
              ? 'Hay 1 descuadre de inventario sin resolver'
              : `Hay ${descuadres.length} descuadres de inventario sin resolver`
          }
        >
          <Text size="sm">
            {resumenPorSucursal(descuadres)}. Ábrelos en la pestaña
            {' '}<Text component="span" fw={600}>Descuadres</Text> de esa sucursal: hay que
            contar el estante y decir qué se encontró.
          </Text>
        </Alert>
      )}

      {idNum === undefined ? (
        <Text c="dimmed" py="lg">Elige una sucursal para ver su inventario.</Text>
      ) : (
        <Tabs defaultValue="existencias">
          <Tabs.List>
            <Tabs.Tab value="existencias">Existencias</Tabs.Tab>
            <Tabs.Tab value="minimos">Mínimos</Tabs.Tab>
            <Tabs.Tab value="traspasos">Traspasos</Tabs.Tab>
            <Tabs.Tab
              value="descuadres"
              rightSection={
                descuadresDe(descuadres, idNum) > 0 ? (
                  <Badge size="xs" circle color="orange">{descuadresDe(descuadres, idNum)}</Badge>
                ) : undefined
              }
            >
              Descuadres
            </Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="existencias" pt="md">
            <PanelExistencias sucursalId={idNum} onTraspasar={setTraspasoDe} />
          </Tabs.Panel>
          <Tabs.Panel value="minimos" pt="md">
            <PanelMinimos sucursalId={idNum} onNuevo={() => setMinimoOpen(true)} />
          </Tabs.Panel>
          <Tabs.Panel value="traspasos" pt="md">
            <PanelTraspasos sucursalId={idNum} />
          </Tabs.Panel>
          <Tabs.Panel value="descuadres" pt="md">
            <PanelDescuadres sucursalId={idNum} />
          </Tabs.Panel>
        </Tabs>
      )}

      {traspasoDe && (
        <TraspasoModal
          existencia={traspasoDe}
          onClose={() => setTraspasoDe(null)}
        />
      )}
      {minimoOpen && idNum !== undefined && (
        <MinimoModal sucursalId={idNum} onClose={() => setMinimoOpen(false)} />
      )}
    </Stack>
  )
}

// ─── Existencias ─────────────────────────────────────────────────────────────

// Un renglón por lote y no por refacción: es lo que permite ver que dos piezas
// iguales de la misma sucursal vienen de compras distintas, con proveedores y
// costos distintos. Es también el paso previo a identificarlas una por una.
function PanelExistencias({
  sucursalId, onTraspasar,
}: {
  sucursalId: number
  onTraspasar: (e: ExistenciaEnSucursal) => void
}) {
  const { data, isLoading } = useExistencias(sucursalId)
  const filas = data?.data ?? []

  if (isLoading) return <Center py="xl"><Loader /></Center>
  if (filas.length === 0) {
    return <Text c="dimmed" py="lg">Esta sucursal no tiene piezas en inventario.</Text>
  }

  const total = filas.reduce((s, f) => s + f.cantidad * f.costo_unitario, 0)

  return (
    <Stack gap="sm">
      <Paper withBorder p="xs">
        <Group gap="xl">
          <Stack gap={0}>
            <Text size="xs" c="dimmed">Piezas</Text>
            <Text fw={600}>{filas.reduce((s, f) => s + f.cantidad, 0).toLocaleString('es-MX')}</Text>
          </Stack>
          <Stack gap={0}>
            <Text size="xs" c="dimmed">Valor a costo</Text>
            <Text fw={600}>{formatMXN(total)}</Text>
          </Stack>
        </Group>
      </Paper>

      <Table.ScrollContainer minWidth={860}>
        <Table striped withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Refacción</Table.Th>
              <Table.Th>Tipo</Table.Th>
              <Table.Th>Compra</Table.Th>
              <Table.Th ta="right">Cantidad</Table.Th>
              <Table.Th ta="right">Costo unit.</Table.Th>
              <Table.Th style={{ width: 40 }} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {filas.map((f) => (
              <Table.Tr key={`${f.lote_id}-${f.sucursal_id}`}>
                <Table.Td>
                  <Text size="sm" fw={500}>{f.numero_serie}</Text>
                  <Text size="xs" c="dimmed">{f.descripcion}</Text>
                </Table.Td>
                <Table.Td><Text size="xs">{f.tipo_pieza ?? 'Sin tipo'}</Text></Table.Td>
                <Table.Td>
                  {/* Sin proveedor solo puede ser el lote de recuperación. */}
                  <Text size="xs" c={f.proveedor ? undefined : 'dimmed'}>
                    {f.proveedor ?? 'Recuperada de unidad'}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {f.num_factura ? `Fact. ${f.num_factura}` : 'Sin factura'} · {formatearFecha(f.fecha_compra)}
                  </Text>
                </Table.Td>
                <Table.Td ta="right"><Text size="sm" fw={500}>{f.cantidad}</Text></Table.Td>
                <Table.Td ta="right"><Text size="xs">{formatMXN(f.costo_unitario)}</Text></Table.Td>
                <Table.Td>
                  <ActionIcon
                    variant="subtle"
                    aria-label={`Traspasar ${f.numero_serie} a otra sucursal`}
                    onClick={() => onTraspasar(f)}
                  >
                    <IconArrowsExchange size={16} />
                  </ActionIcon>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Stack>
  )
}

// ─── Mínimos ─────────────────────────────────────────────────────────────────

// Los mínimos van por refacción exacta, no por tipo: existen para tener lista
// la pieza concreta que esa sucursal necesita en una emergencia, y "una del
// mismo tipo" no siempre sirve.
function PanelMinimos({ sucursalId, onNuevo }: { sucursalId: number; onNuevo: () => void }) {
  const { data, isLoading } = useMinimos(sucursalId)
  const updateMut = useUpdateMinimo()
  const deleteMut = useDeleteMinimo()

  const filas = data?.data ?? []
  const faltantes = filas.filter((m) => m.existencia < m.minimo)

  if (isLoading) return <Center py="xl"><Loader /></Center>

  return (
    <Stack gap="sm">
      <Group justify="space-between">
        <Text size="sm" c="dimmed">
          Refacciones que esta sucursal debe tener siempre disponibles.
        </Text>
        <Button size="xs" leftSection={<IconPlus size={14} />} onClick={onNuevo}>
          Nuevo mínimo
        </Button>
      </Group>

      {faltantes.length > 0 && (
        <Alert color="red" icon={<IconAlertTriangle size={16} />} title="Por debajo del mínimo">
          {faltantes.length} refacción(es) sin la existencia mínima en esta sucursal.
        </Alert>
      )}

      {updateMut.error && <Alert color="red">{(updateMut.error as Error).message}</Alert>}
      {deleteMut.error && <Alert color="red">{(deleteMut.error as Error).message}</Alert>}

      {filas.length === 0 ? (
        <Text c="dimmed" py="lg">Esta sucursal no tiene mínimos configurados.</Text>
      ) : (
        <Table.ScrollContainer minWidth={720}>
          <Table striped withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Refacción</Table.Th>
                <Table.Th>Tipo</Table.Th>
                <Table.Th ta="right" style={{ width: 110 }}>Mínimo</Table.Th>
                <Table.Th ta="right" style={{ width: 100 }}>Hay</Table.Th>
                <Table.Th style={{ width: 120 }}>Estado</Table.Th>
                <Table.Th style={{ width: 40 }} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {filas.map((m) => (
                <FilaMinimo
                  key={m.id}
                  minimo={m}
                  onGuardar={(valor) => updateMut.mutate({ id: m.id, minimo: valor })}
                  onBorrar={() => deleteMut.mutate(m.id)}
                  guardando={updateMut.isPending && updateMut.variables?.id === m.id}
                  borrando={deleteMut.isPending && deleteMut.variables === m.id}
                />
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </Stack>
  )
}

function FilaMinimo({
  minimo, onGuardar, onBorrar, guardando, borrando,
}: {
  minimo: MinimoSucursal
  onGuardar: (valor: number) => void
  onBorrar: () => void
  guardando: boolean
  borrando: boolean
}) {
  const [valor, setValor] = useState<number | string>(minimo.minimo)
  const falta = minimo.existencia < minimo.minimo
  const cambiado = Number(valor) !== minimo.minimo && valor !== ''

  return (
    <Table.Tr>
      <Table.Td>
        <Text size="sm" fw={500}>{minimo.numero_serie}</Text>
        <Text size="xs" c="dimmed">{minimo.descripcion}</Text>
      </Table.Td>
      <Table.Td><Text size="xs">{minimo.tipo_pieza ?? 'Sin tipo'}</Text></Table.Td>
      <Table.Td>
        <Group gap={4} wrap="nowrap" justify="flex-end">
          <NumberInput
            size="xs" w={60} min={1} max={999} allowDecimal={false}
            value={valor}
            onChange={(v) => setValor(v === '' ? '' : Number(v))}
            aria-label={`Mínimo de ${minimo.numero_serie}`}
          />
          {cambiado && (
            <Button size="compact-xs" loading={guardando} onClick={() => onGuardar(Number(valor))}>
              OK
            </Button>
          )}
        </Group>
      </Table.Td>
      <Table.Td ta="right"><Text size="sm" fw={500}>{minimo.existencia}</Text></Table.Td>
      <Table.Td>
        {falta ? (
          <Badge size="xs" color="red" variant="light">
            Faltan {minimo.minimo - minimo.existencia}
          </Badge>
        ) : (
          <Badge size="xs" color="green" variant="light">Cubierto</Badge>
        )}
      </Table.Td>
      <Table.Td>
        <ActionIcon
          variant="subtle" color="red" loading={borrando}
          aria-label={`Quitar el mínimo de ${minimo.numero_serie}`}
          onClick={onBorrar}
        >
          <IconTrash size={14} />
        </ActionIcon>
      </Table.Td>
    </Table.Tr>
  )
}

// ─── Traspasos ───────────────────────────────────────────────────────────────

function PanelTraspasos({ sucursalId }: { sucursalId: number }) {
  const { data, isLoading } = useTraspasos(sucursalId)
  const filas = data?.data ?? []

  if (isLoading) return <Center py="xl"><Loader /></Center>
  if (filas.length === 0) {
    return <Text c="dimmed" py="lg">Esta sucursal no ha enviado ni recibido traspasos.</Text>
  }

  return (
    <Table.ScrollContainer minWidth={760}>
      <Table striped withTableBorder>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Fecha</Table.Th>
            <Table.Th>Refacción</Table.Th>
            <Table.Th>Movimiento</Table.Th>
            <Table.Th ta="right">Cantidad</Table.Th>
            <Table.Th>Registró</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {filas.map((t) => {
            const salio = t.origen_sucursal_id === sucursalId
            return (
              <Table.Tr key={t.id}>
                <Table.Td><Text size="xs">{formatearFecha(t.fecha)}</Text></Table.Td>
                <Table.Td>
                  <Text size="sm">{t.numero_serie}</Text>
                  <Text size="xs" c="dimmed">{t.descripcion}</Text>
                </Table.Td>
                <Table.Td>
                  <Badge size="xs" variant="light" color={salio ? 'orange' : 'green'}>
                    {salio ? 'Salida' : 'Entrada'}
                  </Badge>
                  <Text size="xs" c="dimmed">{t.origen} → {t.destino}</Text>
                </Table.Td>
                <Table.Td ta="right"><Text size="sm" fw={500}>{t.cantidad}</Text></Table.Td>
                <Table.Td><Text size="xs" c="dimmed">{t.usuario_email ?? '—'}</Text></Table.Td>
              </Table.Tr>
            )
          })}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  )
}

function TraspasoModal({
  existencia, onClose,
}: {
  existencia: ExistenciaEnSucursal
  onClose: () => void
}) {
  const sucQuery = useSucursales()
  const sucData = sucQuery.data
  const crearMut = useCreateTraspaso()

  const [destino, setDestino] = useState<string | null>(null)
  const [cantidad, setCantidad] = useState<number | string>(1)
  const [fecha, setFecha] = useState(hoy())
  const [obs, setObs] = useState('')

  // El origen no puede ser también el destino: se saca de la lista en vez de
  // dejar que el usuario lo elija y reciba un error después.
  const destinos = (sucData?.data ?? [])
    .filter((s) => s.id !== existencia.sucursal_id)
    .map((s) => ({ value: String(s.id), label: s.nombre }))

  function confirmar() {
    if (!destino) return
    crearMut.mutate(
      {
        lote_id:             existencia.lote_id,
        origen_sucursal_id:  existencia.sucursal_id,
        destino_sucursal_id: Number(destino),
        cantidad:            Number(cantidad),
        fecha,
        observaciones:       obs.trim() || null,
      },
      { onSuccess: onClose },
    )
  }

  return (
    <Modal opened onClose={onClose} title="Traspasar piezas a otra sucursal" size="md">
      <Stack gap="sm">
        <Paper withBorder p="xs">
          <Text size="sm" fw={500}>{existencia.numero_serie} — {existencia.descripcion}</Text>
          <Text size="xs" c="dimmed">
            {existencia.proveedor ?? 'Recuperada de unidad'}
            {existencia.num_factura ? ` · Fact. ${existencia.num_factura}` : ''}
            {' · '}{existencia.cantidad} disponible(s) en {existencia.sucursal}
          </Text>
        </Paper>

        <SelectCatalogo
          estado={sucQuery}
          nombre="sucursales"
          label="Sucursal de destino"
          placeholder="A dónde se mueven"
          data={destinos}
          value={destino}
          onChange={setDestino}
          required
          nothingFoundMessage="No hay otra sucursal dada de alta"
        />
        <NumberInput
          label="Cantidad"
          min={1}
          max={existencia.cantidad}
          clampBehavior="strict"
          allowDecimal={false}
          description={`Máximo ${existencia.cantidad}, que es lo que hay en ${existencia.sucursal}`}
          value={cantidad}
          onChange={(v) => setCantidad(v === '' ? '' : Number(v))}
        />
        <FechaInput label="Fecha" maxDate={hoy()} value={fecha} onChange={setFecha} />
        <Textarea
          label="Observaciones"
          placeholder="Opcional: por qué se movieron"
          rows={2}
          maxLength={300}
          value={obs}
          onChange={(e) => setObs(e.currentTarget.value)}
        />

        {crearMut.error && <Alert color="red" title="Error">{(crearMut.error as Error).message}</Alert>}

        <Group justify="flex-end" mt="xs">
          <Button variant="default" onClick={onClose} disabled={crearMut.isPending}>Cancelar</Button>
          <Button onClick={confirmar} loading={crearMut.isPending} disabled={!destino}>
            Traspasar
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}

function MinimoModal({ sucursalId, onClose }: { sucursalId: number; onClose: () => void }) {
  const piezasQuery = useTodasLasPiezas()
  const piezasData = piezasQuery.data
  const crearMut = useCreateMinimo()

  const [piezaId, setPiezaId] = useState<string | null>(null)
  const [minimo, setMinimo] = useState<number | string>(1)
  const [obs, setObs] = useState('')

  const opciones = (piezasData?.data ?? []).map((p) => ({
    value: String(p.id),
    label: `${p.numero_serie} — ${p.descripcion}`,
  }))

  function confirmar() {
    if (!piezaId) return
    crearMut.mutate(
      {
        sucursal_id:   sucursalId,
        pieza_id:      Number(piezaId),
        minimo:        Number(minimo),
        observaciones: obs.trim() || null,
      },
      { onSuccess: onClose },
    )
  }

  return (
    <Modal opened onClose={onClose} title="Mínimo de una refacción" size="md">
      <Stack gap="sm">
        <SelectCatalogo
          estado={piezasQuery}
          nombre="refacciones"
          label="Refacción"
          description="La refacción exacta que esta sucursal debe tener lista, no solo una de su tipo."
          placeholder="Selecciona la refacción"
          data={opciones}
          value={piezaId}
          onChange={setPiezaId}
          required
        />
        <NumberInput
          label="Mínimo"
          min={1}
          max={999}
          clampBehavior="strict"
          allowDecimal={false}
          value={minimo}
          onChange={(v) => setMinimo(v === '' ? '' : Number(v))}
        />
        <Textarea
          label="Observaciones"
          placeholder="Opcional: por qué esta sucursal la necesita"
          rows={2}
          maxLength={300}
          value={obs}
          onChange={(e) => setObs(e.currentTarget.value)}
        />

        {crearMut.error && <Alert color="red" title="Error">{(crearMut.error as Error).message}</Alert>}

        <Group justify="flex-end" mt="xs">
          <Button variant="default" onClick={onClose} disabled={crearMut.isPending}>Cancelar</Button>
          <Button onClick={confirmar} loading={crearMut.isPending} disabled={!piezaId}>
            Guardar
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}

// ─── Descuadres ──────────────────────────────────────────────────────────────

// Cuántos hay abiertos en una sucursal, para la insignia de la pestaña. Los que
// no tienen sucursal cuentan en todas: no son de ninguna, y esconderlos hasta
// que alguien adivine dónde buscarlos es la forma segura de que no los vea nadie.
function descuadresDe(descuadres: Descuadre[], sucursalId: number) {
  return descuadres.filter((d) => d.sucursal_id === sucursalId || d.sucursal_id === null).length
}

// "Vallarta (2), Sin sucursal (1)". Se dice dónde están porque el aviso vive
// arriba del selector, antes de elegir ninguna.
function resumenPorSucursal(descuadres: Descuadre[]) {
  const porSuc = new Map<string, number>()
  for (const d of descuadres) {
    const clave = d.sucursal ?? 'Sin sucursal'
    porSuc.set(clave, (porSuc.get(clave) ?? 0) + 1)
  }
  return [...porSuc.entries()].map(([suc, n]) => `${suc} (${n})`).join(', ')
}

/**
 * Los descuadres abiertos de una sucursal, y las dos formas de cerrarlos.
 *
 * No se cierran con un botón de "listo": las dos salidas dicen cosas distintas
 * —el sistema estaba mal y se corrigió, o el sistema estaba bien y la sospecha
 * era infundada— y guardar cuál fue es lo que permite después saber si esta
 * clase de descuadre vale la pena perseguirla.
 */
function PanelDescuadres({ sucursalId }: { sucursalId: number }) {
  const { data, isLoading, isError } = useDescuadres(sucursalId)
  const [cerrando, setCerrando] = useState<{ d: Descuadre; status: ResolucionDescuadre } | null>(null)

  const filas = data?.data ?? []

  if (isLoading) return <Center py="xl"><Loader /></Center>
  if (isError) {
    return <Alert color="red" title="Error">No se pudieron cargar los descuadres.</Alert>
  }
  if (!filas.length) {
    return (
      <Stack gap="sm">
        <CuadreUnidades sucursalId={sucursalId} />
        <Center py="xl">
          <Text c="dimmed">Esta sucursal no tiene descuadres de inventario pendientes.</Text>
        </Center>
      </Stack>
    )
  }

  return (
    <>
      <Stack gap="sm">
        <CuadreUnidades sucursalId={sucursalId} />
        <Text size="sm" c="dimmed">
          Diferencias que el sistema detectó y no pudo corregir solas. Cada una sigue
          aquí hasta que alguien cuente el estante y diga qué encontró.
        </Text>
        {filas.map((d) => (
          <Paper key={d.id} withBorder p="sm" radius="sm">
            <Stack gap={6}>
              <Group justify="space-between" wrap="nowrap" align="flex-start">
                <div>
                  <Group gap={6}>
                    <Text fw={600} size="sm">{d.numero_serie}</Text>
                    <Badge size="xs" variant="light" color="orange">
                      {d.diferencia > 0
                        ? `Sobra${d.diferencia === 1 ? '' : 'n'} ${d.diferencia}`
                        : `Falta${d.diferencia === -1 ? '' : 'n'} ${Math.abs(d.diferencia)}`}
                    </Badge>
                    {/* No es de esta sucursal ni de otra: hay que decidir dónde
                        entra, y eso es parte de resolverlo. */}
                    {d.sucursal_id === null && (
                      <Badge size="xs" variant="light" color="gray">Sin sucursal</Badge>
                    )}
                  </Group>
                  <Text size="xs" c="dimmed">{d.descripcion}</Text>
                </div>
                <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
                  {formatearFecha(d.created_at)}
                </Text>
              </Group>

              <Text size="xs">{d.motivo}</Text>

              <Text size="xs" c="dimmed">
                {d.num_factura ? `Factura ${d.num_factura}` : 'Sin factura'}
                {d.vehiculo ? ` · Unidad ${d.vehiculo}` : ''}
              </Text>

              <Group gap="xs" mt={2}>
                <Button size="compact-xs" onClick={() => setCerrando({ d, status: 'ajustado' })}>
                  Ya ajusté la existencia
                </Button>
                <Button
                  size="compact-xs" variant="default"
                  onClick={() => setCerrando({ d, status: 'aceptado' })}
                >
                  Conté y sí estaba: era correcto
                </Button>
              </Group>
            </Stack>
          </Paper>
        ))}
      </Stack>

      {cerrando && (
        <CerrarDescuadreModal
          descuadre={cerrando.d}
          status={cerrando.status}
          onClose={() => setCerrando(null)}
        />
      )}
    </>
  )
}

function CerrarDescuadreModal({ descuadre, status, onClose }: {
  descuadre: Descuadre
  status:    ResolucionDescuadre
  onClose:   () => void
}) {
  const [nota, setNota] = useState('')
  const mut = useResolverDescuadre()

  const ajuste = status === 'ajustado'

  return (
    <Modal opened onClose={onClose} title="Cerrar descuadre" centered size="md">
      <Stack gap="sm">
        <Text size="sm">
          {ajuste ? (
            <>
              Vas a cerrar el descuadre de{' '}
              <Text component="span" fw={600}>{descuadre.numero_serie}</Text> como{' '}
              <Text component="span" fw={600}>ajustado</Text>: contaste el estante, el
              sistema estaba mal y ya corregiste la existencia.
            </>
          ) : (
            <>
              Vas a cerrar el descuadre de{' '}
              <Text component="span" fw={600}>{descuadre.numero_serie}</Text> como{' '}
              <Text component="span" fw={600}>correcto</Text>: contaste el estante, la
              pieza sí estaba y no había nada que ajustar.
            </>
          )}
        </Text>

        {/* El ajuste de la existencia se hace en Existencias, con un traspaso o
            corrigiendo el lote: cerrarlo aquí NO mueve inventario. Decirlo evita
            que alguien lo cierre creyendo que el número se arregla solo. */}
        {ajuste && (
          <Alert color="blue" variant="light" py={6}>
            <Text size="xs">
              Cerrarlo aquí no mueve el inventario: solo quita el pendiente. El ajuste
              de la cantidad se hace desde Existencias.
            </Text>
          </Alert>
        )}

        <Textarea
          label="¿Qué encontraste?"
          description="Opcional. Queda guardado con quién lo cerró y cuándo."
          placeholder="Ej. Se contaron 3 en el estante, el sistema decía 4."
          autosize minRows={2} maxRows={5}
          maxLength={500}
          value={nota}
          onChange={(e) => setNota(e.currentTarget.value.slice(0, 500))}
        />

        {mut.error && <Alert color="red" title="Error">{(mut.error as Error).message}</Alert>}

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} disabled={mut.isPending}>Cancelar</Button>
          <Button
            loading={mut.isPending}
            onClick={() => mut.mutate(
              { id: descuadre.id, status, nota },
              { onSuccess: onClose },
            )}
          >
            Cerrar descuadre
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}

// ─── Cuadre de piezas identificadas ──────────────────────────────────────────

/**
 * Dónde las piezas identificadas no coinciden con la existencia de su estante.
 *
 * No es un descuadre registrado y por eso no se "resuelve": se calcula cada vez
 * que se pregunta y desaparece solo en cuanto las dos cifras vuelven a
 * coincidir. Está aquí porque es el mismo tipo de pregunta —algo no cuadra en
 * este estante— y porque mientras las unidades y las existencias convivan, esta
 * es la única forma de ver que se separaron.
 */
function CuadreUnidades({ sucursalId }: { sucursalId: number }) {
  const { data } = useCuadreUnidades()
  const filas = (data?.data ?? []).filter(
    (c) => c.sucursal_id === sucursalId || c.sucursal_id === null,
  )
  if (!filas.length) return null

  return (
    <Alert
      color="yellow"
      variant="light"
      icon={<IconAlertTriangle size={18} />}
      title="Piezas identificadas que no cuadran con la existencia"
    >
      <Stack gap={4}>
        <Text size="xs">
          Estas refacciones se rastrean pieza por pieza, y el número de piezas
          identificadas no coincide con lo que dice el inventario. Suele significar que
          entró o salió stock sin que se registrara la unidad correspondiente.
        </Text>
        {filas.map((c) => (
          <Text size="xs" key={`${c.pieza_id}-${c.sucursal_id}`}>
            <Text component="span" fw={600}>{c.numero_serie}</Text>
            {' — '}{c.unidades} identificada{c.unidades === 1 ? '' : 's'}
            {' vs '}{c.existencia} en existencia
            {c.sucursal ? ` (${c.sucursal})` : ' (sin sucursal)'}
          </Text>
        ))}
      </Stack>
    </Alert>
  )
}
