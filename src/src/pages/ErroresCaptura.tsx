// Errores de captura: cuánto dinero se equivocó cada quien registrando compras.
//
// Sale de la revisión de facturas. Cuando alguien cuadra una factura contra su
// papel y encuentra un costo o una cantidad mal tecleada, la corrección queda
// registrada con dos cosas: a quién se le carga y cuánto valía el error en pesos
// —ya con el descuento y el IVA de la factura aplicados, no la resta cruda de
// los importes—. Ver `docs/revision-de-facturas.md`.
//
// PARA QUÉ SIRVE ESTA PANTALLA, que es lo que conviene tener claro antes de
// mirarla: no es una lista de culpables, es dónde poner el esfuerzo de
// enseñar. Alguien con cuarenta correcciones de un peso no tiene el mismo
// problema que alguien con una de veinte mil, y por eso se muestran las dos
// medidas y no un solo número.
//
// De sólo lectura. Nada de lo que hay aquí se edita: corregir se corrige en la
// factura, revisándola.
import { useState } from 'react'
import {
  Alert, Badge, Card, Center, Group, Loader, Stack, Table, Text, Tooltip,
} from '@mantine/core'
import { IconInfoCircle, IconUser, IconX } from '@tabler/icons-react'
import {
  useCorreccionesCaptura, useErroresCaptura, NOMBRE_DE_CAMPO,
} from '../hooks/useRevision'
import type { ErroresDePersona } from '../hooks/useRevision'
import { FechaInput } from '../components/FechaInput'
import { formatMXN, formatFecha } from '../lib/formato'

const SIN_NOMBRE = 'Sin identificar'

/**
 * El importe de un error, con el signo explicado en palabras.
 *
 * El signo importa y no se lee solo: un delta positivo significa que lo
 * capturado estaba por DEBAJO de lo que dice el papel. Poner el número a secas
 * obliga a recordar la convención cada vez.
 */
function Delta({ valor, conSigno = true }: { valor: number; conSigno?: boolean }) {
  if (Math.abs(valor) < 0.01) {
    return <Text size="sm" c="dimmed">—</Text>
  }
  const deMenos = valor > 0
  return (
    <Tooltip label={deMenos ? 'Se había registrado de menos' : 'Se había registrado de más'}>
      <Text size="sm" fw={500} c={deMenos ? 'orange.7' : 'blue.7'}>
        {conSigno && (deMenos ? '+' : '−')}{formatMXN(Math.abs(valor))}
      </Text>
    </Tooltip>
  )
}

function Tarjeta({ label, valor, ayuda }: { label: string; valor: string; ayuda: string }) {
  return (
    <Card withBorder padding="sm" style={{ flex: 1, minWidth: 150 }}>
      <Group gap={4}>
        <Text size="xs" c="dimmed">{label}</Text>
        <Tooltip label={ayuda} multiline w={260}>
          <IconInfoCircle size={13} style={{ opacity: 0.5 }} />
        </Tooltip>
      </Group>
      <Text size="xl" fw={700}>{valor}</Text>
    </Card>
  )
}

export default function ErroresCaptura() {
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  // Null = el detalle de todos. Al elegir una persona el detalle se filtra, que
  // es la pregunta que sigue siempre a ver el acumulado: "¿en qué se equivocó?".
  const [persona, setPersona] = useState<string | null>(null)

  const filtros = { desde: desde || undefined, hasta: hasta || undefined }
  const { data, isLoading, isError } = useErroresCaptura(filtros)
  const detalle = useCorreccionesCaptura({
    ...filtros,
    capturado_por: persona ?? undefined,
  })

  const personas: ErroresDePersona[] = data?.data ?? []
  const totalSubregistrado = personas.reduce((s, p) => s + p.subregistrado, 0)
  const totalDeMas = personas.reduce((s, p) => s + p.de_mas, 0)
  const totalCorrecciones = personas.reduce((s, p) => s + p.correcciones, 0)

  return (
    <Stack gap="md">
      <div>
        <Text fw={700} size="lg">Errores de captura</Text>
        <Text size="sm" c="dimmed">
          Lo que la revisión de facturas tuvo que corregir, y cuánto dinero valía
          cada error. Sirve para saber a quién hay que enseñarle a capturar, no
          para llevar la cuenta de los tropiezos de nadie.
        </Text>
      </div>

      <Group grow>
        <FechaInput label="Desde" clearable value={desde} onChange={setDesde} />
        <FechaInput label="Hasta" clearable value={hasta} onChange={setHasta} />
      </Group>

      {isError ? (
        <Alert color="red" title="Error">No se pudo cargar el reporte.</Alert>
      ) : isLoading ? (
        <Center py="xl"><Loader /></Center>
      ) : personas.length === 0 ? (
        <Alert color="green" variant="light">
          No hay errores de captura registrados
          {desde || hasta ? ' en este periodo' : ''}. O todo se capturó bien, o
          todavía no se ha revisado ninguna factura contra su papel.
        </Alert>
      ) : (
        <>
          <Group gap="sm" wrap="wrap">
            {/* Las dos NO se suman: miden cosas distintas. Ponerlas juntas en
                un solo número daría una cantidad que no significa nada. */}
            <Tarjeta
              label="Gasto que no estaba registrado"
              valor={formatMXN(totalSubregistrado)}
              ayuda="El papel cobraba más de lo capturado: refacciones que nadie registró, costos tecleados por debajo. Corregirlo SUBE el gasto — no se ahorra dinero, se deja de mentir sobre cuánto se gastó."
            />
            <Tarjeta
              label="Dinero que se evitó pagar de más"
              valor={formatMXN(totalDeMas)}
              ayuda="El sistema tenía más de lo que cobra el papel: un lote que no se compró, un costo inflado, una cantidad de más. Esto sí es dinero que se iba a pagar o a contar sin deberse, y es lo que la revisión evita que se fugue."
            />
            <Tarjeta
              label="Correcciones"
              valor={String(totalCorrecciones)}
              ayuda="Una por cada campo corregido. Si en un renglón estaban mal la cantidad y el costo, son dos."
            />
            <Tarjeta
              label="Personas"
              valor={String(personas.length)}
              ayuda="Cuántas personas tienen al menos una corrección en el periodo."
            />
          </Group>

          <div>
            <Text fw={600} size="sm" mb={4}>Por persona</Text>
            <Text size="xs" c="dimmed" mb="xs">
              Ordenado por lo que más pesa. Toca un renglón para ver sus
              correcciones abajo.
            </Text>
            <Table withTableBorder striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Capturó</Table.Th>
                  <Table.Th style={{ textAlign: 'center' }}>Correcciones</Table.Th>
                  <Table.Th style={{ textAlign: 'center' }}>Renglones</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Sin registrar</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Evitado de más</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {personas.map((p) => {
                  const nombre = p.capturado_por ?? SIN_NOMBRE
                  const activa = persona === p.capturado_por
                  return (
                    <Table.Tr
                      key={nombre}
                      style={{ cursor: 'pointer' }}
                      bg={activa ? 'var(--mantine-color-blue-light)' : undefined}
                      onClick={() => setPersona(activa ? null : p.capturado_por)}
                    >
                      <Table.Td>
                        <Group gap={6}>
                          <IconUser size={14} style={{ opacity: 0.5 }} />
                          <Text size="sm" fw={500} c={p.capturado_por ? undefined : 'dimmed'}>
                            {nombre}
                          </Text>
                        </Group>
                      </Table.Td>
                      <Table.Td style={{ textAlign: 'center' }}>{p.correcciones}</Table.Td>
                      <Table.Td style={{ textAlign: 'center' }}>{p.renglones}</Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>
                        <Text size="sm" fw={600} c={p.subregistrado > 0 ? 'orange.7' : 'dimmed'}>
                          {p.subregistrado > 0 ? formatMXN(p.subregistrado) : '—'}
                        </Text>
                      </Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>
                        <Text size="sm" fw={600} c={p.de_mas > 0 ? 'blue.7' : 'dimmed'}>
                          {p.de_mas > 0 ? formatMXN(p.de_mas) : '—'}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  )
                })}
              </Table.Tbody>
            </Table>
          </div>

          <div>
            <Group gap="xs" mb={4}>
              <Text fw={600} size="sm">
                {persona ? `Correcciones de ${persona}` : 'Últimas correcciones'}
              </Text>
              {persona && (
                <Badge
                  size="xs" variant="light" style={{ cursor: 'pointer' }}
                  rightSection={<IconX size={10} />}
                  onClick={() => setPersona(null)}
                >
                  quitar filtro
                </Badge>
              )}
            </Group>

            {detalle.isLoading ? (
              <Center py="lg"><Loader size="sm" /></Center>
            ) : detalle.isError ? (
              <Alert color="red" title="Error">No se pudo cargar el detalle.</Alert>
            ) : !detalle.data?.data.length ? (
              <Text size="sm" c="dimmed">Nada que mostrar.</Text>
            ) : (
              <Table.ScrollContainer minWidth={720}>
                <Table withTableBorder striped>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Factura</Table.Th>
                      <Table.Th>Refacción</Table.Th>
                      <Table.Th>Campo</Table.Th>
                      <Table.Th>Decía</Table.Th>
                      <Table.Th>Debía decir</Table.Th>
                      <Table.Th style={{ textAlign: 'right' }}>Importe</Table.Th>
                      <Table.Th>Revisó</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {detalle.data.data.map((c) => (
                      <Table.Tr key={c.id}>
                        <Table.Td>
                          <Text size="sm" fw={500}>{c.folio}</Text>
                          <Text size="xs" c="dimmed">{c.proveedor}</Text>
                        </Table.Td>
                        <Table.Td>
                          {/* Sin refacción = la corrección fue de la cabecera:
                              el folio, la fecha, el IVA o el descuento, que no
                              pertenecen a ningún renglón. */}
                          {c.numero_serie
                            ? <Text size="sm">{c.numero_serie}</Text>
                            : <Text size="xs" c="dimmed">Datos de la factura</Text>}
                        </Table.Td>
                        <Table.Td>
                          <Badge size="xs" variant="light">
                            {NOMBRE_DE_CAMPO[c.campo] ?? c.campo}
                          </Badge>
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm" c="dimmed">{c.valor_antes ?? '(vacío)'}</Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm">{c.valor_despues ?? '(vacío)'}</Text>
                        </Table.Td>
                        <Table.Td style={{ textAlign: 'right' }}>
                          <Group justify="flex-end" gap={0}><Delta valor={c.delta_dinero} /></Group>
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs">{c.corregida_por}</Text>
                          <Text size="xs" c="dimmed">
                            {formatFecha(c.corregida_en.slice(0, 10))}
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            )}
          </div>
        </>
      )}
    </Stack>
  )
}
