// Solicitudes de refacción: lo que una sucursal pide a oficina.
//
// La pantalla es la misma para los dos lados y cambia según lo que la persona
// pueda hacer, porque es la misma conversación: el responsable ve lo que su
// patio pidió —y por eso no vuelve a pedirlo—, y quien autoriza ve lo que
// espera respuesta.
//
// Las que esperan respuesta van arriba, y dentro de ellas lo más viejo primero:
// una solicitud de hace cinco días es más urgente que la de hoy, y un orden
// cronológico a secas la enterraría. El orden lo fija la API.
import { useMemo, useState } from 'react'
import {
  Stack, Group, Text, Card, Badge, Button, Alert, Loader, Center, Modal,
  Table, Textarea, NumberInput, ActionIcon, Tabs, Tooltip,
} from '@mantine/core'
import { IconPlus, IconTrash, IconCheck, IconX, IconPackage } from '@tabler/icons-react'
import {
  useSolicitudes, useCreateSolicitud, useResolverSolicitud, useSurtirSolicitud,
  ESTADO_SOLICITUD,
} from '../hooks/useSolicitudes'
import type { Solicitud } from '../hooks/useSolicitudes'
import { useTodasLasPiezas } from '../hooks/useRefacciones'
import { useSucursales } from '../hooks/useSucursales'
import { useUsuarioActual } from '../hooks/useUsuarioActual'
import { usePermisos } from '../hooks/usePermisos'
import SelectCatalogo from '../components/SelectCatalogo'
import { TEXTO_LIBRE } from '../lib/validaciones'

function fmtFecha(iso: string) {
  return new Date(`${iso.split('T')[0]}T12:00:00`).toLocaleDateString('es-MX', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

// ─── Alta ─────────────────────────────────────────────────────────────────────

type RenglonDraft = { pieza_id: string; cantidad: number | '' }

function NuevaSolicitudModal({ onClose }: { onClose: () => void }) {
  const catalogos = useSucursalesYPiezas()
  const { piezas, sucursales, sucursalFija, cargandoPiezas } = catalogos
  const mut = useCreateSolicitud()

  const [sucursalId, setSucursalId] = useState<string | null>(null)
  const [motivo, setMotivo] = useState('')
  const [renglones, setRenglones] = useState<RenglonDraft[]>([{ pieza_id: '', cantidad: 1 }])

  const llenos = renglones.filter((r) => r.pieza_id && r.cantidad !== '' && Number(r.cantidad) > 0)
  const repetida = new Set(llenos.map((r) => r.pieza_id)).size !== llenos.length
  const motivoOk = motivo.trim().length >= 5 && TEXTO_LIBRE.test(motivo.trim())
  // A quien tiene sucursal asignada no se le pregunta: la API le pone la suya.
  const destinoOk = sucursalFija != null || sucursalId !== null

  function guardar() {
    if (!llenos.length || repetida || !motivoOk || !destinoOk) return
    mut.mutate(
      {
        ...(sucursalFija == null && sucursalId ? { sucursal_id: Number(sucursalId) } : {}),
        motivo: motivo.trim(),
        renglones: llenos.map((r) => ({ pieza_id: Number(r.pieza_id), cantidad: Number(r.cantidad) })),
      },
      { onSuccess: onClose },
    )
  }

  return (
    <Modal opened onClose={onClose} title="Pedir refacciones" size="lg">
      <Stack gap="sm">
        {sucursalFija ? (
          <Alert color="gray" variant="light" py={8}>
            <Text size="xs">
              La refacción va a <Text component="span" fw={600}>{sucursalFija}</Text>, tu sucursal.
            </Text>
          </Alert>
        ) : (
          <SelectCatalogo
            estado={catalogos.sucQuery}
            nombre="sucursales"
            label="¿Para qué sucursal?"
            placeholder="Selecciona la sucursal"
            data={sucursales}
            value={sucursalId}
            onChange={setSucursalId}
            required
          />
        )}

        <Stack gap={6}>
          <Text size="sm" fw={500}>Refacciones</Text>
          {renglones.map((r, i) => (
            <Group key={i} gap="xs" wrap="nowrap" align="flex-start">
              <SelectCatalogo
                estado={catalogos.piezasQuery}
                nombre="refacciones"
                placeholder={cargandoPiezas ? 'Cargando…' : 'Busca la refacción'}
                data={piezas}
                value={r.pieza_id || null}
                onChange={(v) => setRenglones((prev) =>
                  prev.map((x, j) => (j === i ? { ...x, pieza_id: v ?? '' } : x)))}
                style={{ flex: 1 }}
              />
              <NumberInput
                w={110} min={1} max={999} clampBehavior="strict" allowDecimal={false}
                aria-label="Cantidad"
                value={r.cantidad}
                onChange={(v) => setRenglones((prev) =>
                  prev.map((x, j) => (j === i ? { ...x, cantidad: v === '' ? '' : Number(v) } : x)))}
              />
              {/* No se deja quitar el último: una solicitud sin renglones no
                  pide nada, y el formulario quedaría sin por dónde empezar. */}
              <ActionIcon
                variant="subtle" color="red" mt={4}
                disabled={renglones.length === 1}
                aria-label="Quitar refacción"
                onClick={() => setRenglones((prev) => prev.filter((_, j) => j !== i))}
              >
                <IconTrash size={16} />
              </ActionIcon>
            </Group>
          ))}
          <Button
            variant="subtle" size="compact-xs" w="fit-content" leftSection={<IconPlus size={13} />}
            onClick={() => setRenglones((prev) => [...prev, { pieza_id: '', cantidad: 1 }])}
          >
            Agregar otra refacción
          </Button>
          {repetida && (
            <Text size="xs" c="red">
              Una refacción está dos veces: súmala en una sola cantidad.
            </Text>
          )}
        </Stack>

        <Textarea
          label="¿Para qué se necesita?"
          description="Es lo que le permite a quien autoriza decidir sin tener que llamarte."
          placeholder="El torton 7 está parado sin balatas…"
          required
          rows={3}
          maxLength={500}
          value={motivo}
          onChange={(e) => setMotivo(e.currentTarget.value)}
          error={motivo.trim() && !motivoOk ? 'Explica para qué se necesita' : undefined}
        />

        {mut.error && <Alert color="red" title="Error">{(mut.error as Error).message}</Alert>}

        <Group justify="flex-end" mt="xs">
          <Button variant="default" onClick={onClose} disabled={mut.isPending}>Cancelar</Button>
          <Button
            loading={mut.isPending}
            disabled={!llenos.length || repetida || !motivoOk || !destinoOk}
            onClick={guardar}
          >
            Enviar solicitud
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}

// Los dos catálogos que el alta necesita, con la sucursal ya resuelta: quien
// está acotado a una no elige, y saberlo aquí evita pintar un selector que la
// API va a ignorar.
function useSucursalesYPiezas() {
  const piezasQuery = useTodasLasPiezas()
  const sucQuery = useSucursales()
  const { data: usuario } = useUsuarioActual()

  const sucursales = (sucQuery.data?.data ?? []).map((s) => ({
    value: String(s.id), label: s.nombre,
  }))
  const piezas = (piezasQuery.data?.data ?? []).map((p) => ({
    value: String(p.id), label: `${p.numero_serie} — ${p.descripcion}`,
  }))
  const miSucursal = usuario?.data.sucursal_id ?? null
  const sucursalFija = miSucursal == null
    ? null
    : (sucQuery.data?.data ?? []).find((s) => s.id === miSucursal)?.nombre ?? 'tu sucursal'

  return {
    piezasQuery, sucQuery, piezas, sucursales, sucursalFija,
    cargandoPiezas: piezasQuery.isLoading,
  }
}

// ─── Una solicitud ────────────────────────────────────────────────────────────

function SolicitudCard({ solicitud }: { solicitud: Solicitud }) {
  const { puedeEditar } = usePermisos()
  const resolverMut = useResolverSolicitud()
  const surtirMut = useSurtirSolicitud()
  const [rechazando, setRechazando] = useState(false)
  const [nota, setNota] = useState('')

  const est = ESTADO_SOLICITUD[solicitud.estado]
  const pendiente = solicitud.estado === 'pendiente'

  return (
    <Card withBorder radius="md" padding="sm">
      <Stack gap="xs">
        <Group justify="space-between" wrap="nowrap" align="flex-start">
          <div>
            <Group gap={8}>
              <Text size="sm" fw={600}>{solicitud.sucursal}</Text>
              <Badge size="sm" variant="light" color={est.color}>{est.label}</Badge>
            </Group>
            <Text size="xs" c="dimmed">
              {solicitud.solicitado_por} · {fmtFecha(solicitud.fecha)}
            </Text>
          </div>
          {puedeEditar && (
            <Group gap={4} wrap="nowrap">
              {pendiente && (
                <>
                  <Tooltip label="Aprobar">
                    <ActionIcon
                      variant="light" color="green" aria-label="Aprobar"
                      loading={resolverMut.isPending && resolverMut.variables?.estado === 'aprobada'}
                      onClick={() => resolverMut.mutate({ id: solicitud.id, estado: 'aprobada' })}
                    >
                      <IconCheck size={16} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label="Rechazar">
                    <ActionIcon
                      variant="light" color="red" aria-label="Rechazar"
                      onClick={() => { setNota(''); resolverMut.reset(); setRechazando(true) }}
                    >
                      <IconX size={16} />
                    </ActionIcon>
                  </Tooltip>
                </>
              )}
              {solicitud.estado === 'aprobada' && (
                <Button
                  size="compact-xs" variant="light"
                  leftSection={<IconPackage size={13} />}
                  loading={surtirMut.isPending}
                  onClick={() => surtirMut.mutate(solicitud.id)}
                >
                  Marcar surtida
                </Button>
              )}
            </Group>
          )}
        </Group>

        <Table withTableBorder>
          <Table.Tbody>
            {solicitud.renglones.map((r) => (
              <Table.Tr key={r.pieza_id}>
                <Table.Td>
                  <Text size="sm" fw={500}>{r.numero_serie}</Text>
                  <Text size="xs" c="dimmed">{r.descripcion}</Text>
                </Table.Td>
                <Table.Td ta="right" style={{ width: 90 }}>
                  <Text size="sm" fw={600}>{r.cantidad}</Text>
                </Table.Td>
                <Table.Td style={{ width: 150 }}>
                  {/* La primera pregunta de quien autoriza: pedir cuatro
                      teniendo seis en el estante suele ser que no se buscaron. */}
                  <Text size="xs" c={r.existencia > 0 ? 'orange' : 'dimmed'}>
                    {r.existencia > 0
                      ? `Hay ${r.existencia} en la sucursal`
                      : 'Sin existencia ahí'}
                  </Text>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>

        <Text size="sm">{solicitud.motivo}</Text>

        {solicitud.resuelto_por && (
          <Text size="xs" c="dimmed">
            {solicitud.estado === 'rechazada' ? 'Rechazada' : 'Aprobada'} por {solicitud.resuelto_por}
            {solicitud.resolucion_nota ? `: ${solicitud.resolucion_nota}` : ''}
          </Text>
        )}
        {solicitud.surtido_por && (
          <Text size="xs" c="dimmed">Surtida por {solicitud.surtido_por}</Text>
        )}

        {resolverMut.error && (
          <Alert color="red" p="xs"><Text size="xs">{(resolverMut.error as Error).message}</Text></Alert>
        )}
        {surtirMut.error && (
          <Alert color="red" p="xs"><Text size="xs">{(surtirMut.error as Error).message}</Text></Alert>
        )}
      </Stack>

      {/* Rechazar pide el porqué; aprobar no. Un "no" sin razón obliga a quien
          pidió a volver a preguntar, y entonces el canal no sirvió de nada. */}
      <Modal
        opened={rechazando}
        onClose={() => setRechazando(false)}
        title="Rechazar la solicitud"
        centered
      >
        <Stack gap="sm">
          <Textarea
            label="¿Por qué?"
            placeholder="Ya se pidió al proveedor, hay existencia en Vallarta…"
            required
            data-autofocus
            rows={3}
            maxLength={500}
            value={nota}
            onChange={(e) => setNota(e.currentTarget.value)}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setRechazando(false)}>Cancelar</Button>
            <Button
              color="red"
              loading={resolverMut.isPending}
              disabled={!nota.trim()}
              onClick={() => resolverMut.mutate(
                { id: solicitud.id, estado: 'rechazada', nota: nota.trim() },
                { onSuccess: () => setRechazando(false) },
              )}
            >
              Rechazar
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Card>
  )
}

// ─── Página ───────────────────────────────────────────────────────────────────

export default function Solicitudes() {
  const [filtro, setFiltro] = useState<string | null>('abiertas')
  const [creando, setCreando] = useState(false)
  const { data, isLoading, isError } = useSolicitudes()
  const { puedeEditar, esResponsable, esAdmin } = usePermisos()
  // Pedir es del patio y de oficina; el lector solo mira.
  const puedeSolicitar = puedeEditar || esResponsable || esAdmin

  const todas = useMemo(() => data?.data ?? [], [data])
  const abiertas = todas.filter((s) => s.estado === 'pendiente' || s.estado === 'aprobada')
  const cerradas = todas.filter((s) => s.estado === 'surtida' || s.estado === 'rechazada')
  const pendientes = todas.filter((s) => s.estado === 'pendiente').length

  const visibles = filtro === 'cerradas' ? cerradas : abiertas

  return (
    <>
      <Stack gap="md">
        <Group justify="space-between" align="flex-end">
          <div>
            <Text size="xl" fw={600}>Solicitudes de refacción</Text>
            <Text size="sm" c="dimmed">
              {esResponsable
                ? 'Lo que tu sucursal ha pedido. Revísalo antes de pedir: puede que ya esté solicitado.'
                : 'Lo que las sucursales piden a oficina.'}
            </Text>
          </div>
          {puedeSolicitar && (
            <Button leftSection={<IconPlus size={16} />} onClick={() => setCreando(true)}>
              Pedir refacciones
            </Button>
          )}
        </Group>

        <Tabs value={filtro} onChange={setFiltro}>
          <Tabs.List>
            <Tabs.Tab
              value="abiertas"
              rightSection={pendientes > 0
                ? <Badge size="xs" circle color="orange">{pendientes}</Badge>
                : undefined}
            >
              Abiertas
            </Tabs.Tab>
            <Tabs.Tab value="cerradas">Cerradas</Tabs.Tab>
          </Tabs.List>
        </Tabs>

        {isLoading ? (
          <Center py="xl"><Loader /></Center>
        ) : isError ? (
          <Alert color="red" title="Error al cargar">
            No se pudieron obtener las solicitudes. Verifica la conexión.
          </Alert>
        ) : visibles.length === 0 ? (
          <Center py="xl">
            <Text c="dimmed">
              {filtro === 'cerradas'
                ? 'No hay solicitudes cerradas todavía.'
                : 'No hay solicitudes abiertas.'}
            </Text>
          </Center>
        ) : (
          <Stack gap="sm">
            {visibles.map((s) => <SolicitudCard key={s.id} solicitud={s} />)}
          </Stack>
        )}
      </Stack>

      {creando && <NuevaSolicitudModal onClose={() => setCreando(false)} />}
    </>
  )
}
