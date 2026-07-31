// Bitácora: quién creó, modificó o eliminó qué, y cuándo. Pantalla de sólo
// lectura — no hay forma de editar ni borrar un registro desde aquí, y no debe
// haberla: una bitácora que se puede retocar no sirve para nada.
import { useState } from 'react'
import {
  Stack, Group, Text, Table, Loader, Center, Alert, Badge, Select,
  TextInput, Pagination, Modal, Button, Code, ScrollArea, Tooltip,
} from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import { IconSearch, IconX } from '@tabler/icons-react'
import {
  useRegistrosCambios, useFiltrosRegistros,
} from '../hooks/useRegistrosCambios'
import type { RegistroCambio, Cambio } from '../hooks/useRegistrosCambios'

const TAMANO = 50

const COLOR_ACCION: Record<string, string> = {
  CREAR:    'green',
  EDITAR:   'blue',
  ELIMINAR: 'red',
  LOGIN:    'gray',
}

const ETIQUETA_ACCION: Record<string, string> = {
  CREAR:    'Creó',
  EDITAR:   'Modificó',
  ELIMINAR: 'Eliminó',
  LOGIN:    'Entró',
}

// La API guarda UTC. Se muestra en hora de México, que es la única que le
// significa algo a quien lee la pantalla.
const ZONA = 'America/Mexico_City'

function fechaCorta(iso: string) {
  return new Date(iso).toLocaleDateString('es-MX', {
    timeZone: ZONA, day: '2-digit', month: 'short', year: 'numeric',
  })
}

function horaCorta(iso: string) {
  return new Date(iso).toLocaleTimeString('es-MX', {
    timeZone: ZONA, hour: '2-digit', minute: '2-digit',
  })
}

function fechaCompleta(iso: string) {
  return new Date(iso).toLocaleString('es-MX', {
    timeZone: ZONA, dateStyle: 'full', timeStyle: 'medium',
  })
}

function valorLegible(v: unknown): string {
  if (v === null || v === undefined || v === '') return '(vacío)'
  if (typeof v === 'number') return v.toLocaleString('es-MX')
  if (typeof v === 'boolean') return v ? 'sí' : 'no'
  return String(v)
}

// ── Detalle ───────────────────────────────────────────────────────────────────

function TablaCambios({ cambios }: { cambios: Cambio[] }) {
  return (
    <Table withTableBorder withColumnBorders>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Campo</Table.Th>
          <Table.Th>Antes</Table.Th>
          <Table.Th>Después</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {cambios.map((c) => (
          <Table.Tr key={c.campo}>
            <Table.Td><Text size="sm" fw={500}>{c.campo}</Text></Table.Td>
            <Table.Td><Text size="sm" c="dimmed">{valorLegible(c.antes)}</Text></Table.Td>
            <Table.Td><Text size="sm">{valorLegible(c.despues)}</Text></Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  )
}

function TablaFila({ fila }: { fila: Record<string, unknown> }) {
  return (
    <Table withTableBorder>
      <Table.Tbody>
        {Object.entries(fila).map(([campo, valor]) => (
          <Table.Tr key={campo}>
            <Table.Td w="40%"><Text size="sm" fw={500}>{campo}</Text></Table.Td>
            <Table.Td><Text size="sm">{valorLegible(valor)}</Text></Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  )
}

function DetalleModal({ registro, onClose }: { registro: RegistroCambio | null; onClose: () => void }) {
  const d = registro?.detalles
  return (
    <Modal
      opened={!!registro}
      onClose={onClose}
      title={registro ? `${ETIQUETA_ACCION[registro.accion] ?? registro.accion} · ${registro.etiqueta}` : ''}
      size="lg"
    >
      {registro && (
        <Stack gap="md">
          <Stack gap={4}>
            <Text size="sm">
              <Text span c="dimmed">Cuándo: </Text>{fechaCompleta(registro.fecha_hora)}
            </Text>
            <Text size="sm">
              <Text span c="dimmed">Quién: </Text>
              {registro.usuario_nombre ? `${registro.usuario_nombre} · ` : ''}
              {registro.usuario_email}
            </Text>
            {registro.registro_id && (
              <Text size="sm">
                <Text span c="dimmed">Registro: </Text>
                {registro.etiqueta} #{registro.registro_id}
              </Text>
            )}
            {registro.ip && (
              <Text size="sm"><Text span c="dimmed">IP: </Text>{registro.ip}</Text>
            )}
          </Stack>

          {d?.registro && (
            <Text size="sm"><Text span c="dimmed">Sobre: </Text>{d.registro}</Text>
          )}

          {d?.cambios && d.cambios.length > 0 && (
            <Stack gap="xs">
              <Text size="sm" fw={600}>Campos modificados</Text>
              <TablaCambios cambios={d.cambios} />
            </Stack>
          )}

          {d?.eliminado && (
            <Stack gap="xs">
              <Text size="sm" fw={600}>Datos del registro eliminado</Text>
              {/* Es lo único que queda de la fila: el id ya no apunta a nada. */}
              <Text size="xs" c="dimmed">
                Copia guardada al momento de borrarlo. El registro ya no existe en la base de datos.
              </Text>
              <TablaFila fila={d.eliminado} />
            </Stack>
          )}

          {d?.creado && (
            <Stack gap="xs">
              <Text size="sm" fw={600}>Datos con los que se creó</Text>
              <TablaFila fila={d.creado} />
            </Stack>
          )}

          {d?.contexto && (
            <Stack gap="xs">
              <Text size="sm" fw={600}>Contexto</Text>
              <Code block>{JSON.stringify(d.contexto, null, 2)}</Code>
            </Stack>
          )}
        </Stack>
      )}
    </Modal>
  )
}

// ── Pantalla ──────────────────────────────────────────────────────────────────

export default function RegistrosCambios() {
  const [pagina, setPagina]   = useState(1)
  const [usuario, setUsuario] = useState<string | null>(null)
  const [accion, setAccion]   = useState<string | null>(null)
  const [tabla, setTabla]     = useState<string | null>(null)
  const [desde, setDesde]     = useState('')
  const [hasta, setHasta]     = useState('')
  const [texto, setTexto]     = useState('')
  const [debouncedTexto]      = useDebouncedValue(texto, 300)
  const [detalle, setDetalle] = useState<RegistroCambio | null>(null)

  const { data: opciones } = useFiltrosRegistros()
  const { data, isLoading, error } = useRegistrosCambios({
    usuario: usuario ?? undefined,
    accion:  accion ?? undefined,
    tabla:   tabla ?? undefined,
    desde:   desde || undefined,
    hasta:   hasta || undefined,
    texto:   debouncedTexto || undefined,
    pagina,
    tamano:  TAMANO,
  })

  // Cualquier cambio de filtro devuelve a la primera página: si estabas en la 7
  // y el filtro nuevo sólo tiene 2, la tabla saldría vacía sin explicación.
  function filtrar<T>(set: (v: T) => void) {
    return (v: T) => { set(v); setPagina(1) }
  }

  const hayFiltros = !!(usuario || accion || tabla || desde || hasta || texto)

  function limpiar() {
    setUsuario(null); setAccion(null); setTabla(null)
    setDesde(''); setHasta(''); setTexto(''); setPagina(1)
  }

  const total = data?.total ?? 0
  const paginas = Math.max(1, Math.ceil(total / TAMANO))

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end">
        <Stack gap={2}>
          <Text fw={700} size="xl">Registros de cambios</Text>
          <Text size="sm" c="dimmed">
            Todo lo que se ha creado, modificado o eliminado en el sistema.
          </Text>
        </Stack>
        {total > 0 && (
          <Text size="sm" c="dimmed">
            {total.toLocaleString('es-MX')} {total === 1 ? 'registro' : 'registros'}
          </Text>
        )}
      </Group>

      <Group gap="sm" align="flex-end" wrap="wrap">
        <TextInput
          label="Buscar"
          placeholder="Placas, serie, nombre…"
          leftSection={<IconSearch size={16} />}
          value={texto}
          onChange={(e) => filtrar(setTexto)(e.currentTarget.value)}
          w={220}
        />
        <Select
          label="Usuario"
          placeholder="Todos"
          clearable
          value={usuario}
          onChange={filtrar(setUsuario)}
          data={(opciones?.usuarios ?? []).map((u) => ({
            value: u.email,
            label: u.nombre ? `${u.nombre} (${u.email})` : u.email,
          }))}
          w={230}
        />
        <Select
          label="Acción"
          placeholder="Todas"
          clearable
          value={accion}
          onChange={filtrar(setAccion)}
          data={[
            { value: 'CREAR',    label: 'Creó' },
            { value: 'EDITAR',   label: 'Modificó' },
            { value: 'ELIMINAR', label: 'Eliminó' },
            { value: 'LOGIN',    label: 'Inició sesión' },
          ]}
          w={150}
        />
        <Select
          label="Módulo"
          placeholder="Todos"
          clearable
          searchable
          value={tabla}
          onChange={filtrar(setTabla)}
          data={(opciones?.tablas ?? []).map((t) => ({ value: t.tabla, label: t.etiqueta }))}
          w={200}
        />
        <TextInput
          label="Desde"
          type="date"
          value={desde}
          onChange={(e) => filtrar(setDesde)(e.currentTarget.value)}
          w={150}
        />
        <TextInput
          label="Hasta"
          type="date"
          value={hasta}
          onChange={(e) => filtrar(setHasta)(e.currentTarget.value)}
          w={150}
        />
        {hayFiltros && (
          <Button variant="subtle" color="gray" leftSection={<IconX size={16} />} onClick={limpiar}>
            Limpiar
          </Button>
        )}
      </Group>

      {error && <Alert color="red">No se pudo cargar la bitácora: {(error as Error).message}</Alert>}

      {isLoading ? (
        <Center h={200}><Loader /></Center>
      ) : data && data.data.length === 0 ? (
        <Center h={160}>
          <Text c="dimmed" size="sm">
            {hayFiltros ? 'Ningún registro coincide con los filtros.' : 'Todavía no hay actividad registrada.'}
          </Text>
        </Center>
      ) : (
        <ScrollArea>
          <Table highlightOnHover striped miw={860}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={130}>Fecha</Table.Th>
                <Table.Th w={70}>Hora</Table.Th>
                <Table.Th w={220}>Usuario</Table.Th>
                <Table.Th w={110}>Acción</Table.Th>
                <Table.Th w={170}>Módulo</Table.Th>
                <Table.Th>Detalle</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data?.data.map((r) => (
                <Table.Tr
                  key={r.id}
                  onClick={() => setDetalle(r)}
                  style={{ cursor: 'pointer' }}
                >
                  <Table.Td><Text size="sm">{fechaCorta(r.fecha_hora)}</Text></Table.Td>
                  <Table.Td><Text size="sm" c="dimmed">{horaCorta(r.fecha_hora)}</Text></Table.Td>
                  <Table.Td>
                    <Tooltip label={r.usuario_email} position="top-start">
                      <Text size="sm" truncate>{r.usuario_nombre ?? r.usuario_email}</Text>
                    </Tooltip>
                  </Table.Td>
                  <Table.Td>
                    <Badge variant="light" size="sm" color={COLOR_ACCION[r.accion] ?? 'gray'}>
                      {ETIQUETA_ACCION[r.accion] ?? r.accion}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{r.etiqueta}</Text>
                    {r.registro_id && <Text size="xs" c="dimmed">#{r.registro_id}</Text>}
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" lineClamp={2}>{r.descripcion ?? '—'}</Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      )}

      {paginas > 1 && (
        <Group justify="center">
          <Pagination value={pagina} onChange={setPagina} total={paginas} size="sm" />
        </Group>
      )}

      <DetalleModal registro={detalle} onClose={() => setDetalle(null)} />
    </Stack>
  )
}
