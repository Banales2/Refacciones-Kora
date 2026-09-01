// El programa de mantenimiento del modelo, capturado como lo publica el
// fabricante: una cuadrícula de servicios (columnas) por operaciones (renglones)
// donde cada casilla dice qué se le hace a esa pieza en ese servicio.
//
// Vive junto a la plantilla de requerimientos y no la reemplaza: la plantilla es
// para lo que no está en el manual (llantas, lavado, algo que pidió el cliente),
// y esto es lo que dicta el fabricante.
//
// La captura es por brocha —se elige una acción arriba y se va marcando sobre la
// cuadrícula— porque lo que se está haciendo es transcribir una tabla de varios
// cientos de casillas, y un menú por casilla haría eterno ese trabajo.
import { useState } from 'react'
import {
  Stack, Group, Text, Table, Badge, Button, Modal, Alert, Loader, Center,
  ActionIcon, Tooltip, Divider, Paper, SegmentedControl, UnstyledButton, TextInput, Textarea,
} from '@mantine/core'
import { useForm } from '@mantine/form'
import { IconPlus, IconPencil, IconTrash, IconChecklist, IconColumns } from '@tabler/icons-react'
import {
  useProgramaModelo, useAccionesPrograma, useCreatePrograma, useUpdatePrograma,
  useDeletePrograma, useSetFases, useCreateOperacion, useUpdateOperacion,
  useDeleteOperacion, useSetCeldas, proximosServicios,
} from '../hooks/usePrograma'
import type {
  Programa, OperacionPrograma, OperacionPayload, FasePayload, AccionPrograma,
} from '../hooks/usePrograma'
import { TEXTO_LIBRE, limpiarTextoLibre } from '../lib/validaciones'
import ProgramaFasesModal from './ProgramaFasesModal'
import ProgramaOperacionForm from './ProgramaOperacionForm'

const nf = new Intl.NumberFormat('es-MX')

// Color por acción, asignado por posición en el catálogo para que agregar una
// sexta no obligue a tocar esto.
const COLORES = ['blue', 'grape', 'orange', 'teal', 'red', 'indigo', 'lime']
function colorDe(acciones: AccionPrograma[], codigo: string): string {
  const i = acciones.findIndex((a) => a.codigo === codigo)
  return COLORES[(i < 0 ? 0 : i) % COLORES.length]
}

// "5,000 y 15,000 una sola vez; después ciclo de 30,000 a 105,000."
function resumenRecorrido(programa: Programa): string | null {
  if (!programa.fases.length) return null
  const unicas = programa.fases.filter((f) => f.unica)
  const bucle  = programa.fases.filter((f) => !f.unica)
  const partes: string[] = []
  if (unicas.length) {
    partes.push(`${unicas.map((f) => nf.format(f.km)).join(' y ')} km una sola vez`)
  }
  if (bucle.length === 1) partes.push(`después cada ${nf.format(bucle[0].km)} km`)
  else if (bucle.length) {
    partes.push(
      `después ciclo de ${nf.format(bucle[0].km)} a ${nf.format(bucle[bucle.length - 1].km)} km`
    )
  }
  return partes.join('; ')
}

// ── Alta del programa ────────────────────────────────────────────────────────

function ProgramaForm({
  initial, isPending, error, onSubmit, onCancel,
}: {
  initial?:  Programa
  isPending: boolean
  error:     string | null
  onSubmit:  (p: { nombre: string; descripcion: string | null }) => void
  onCancel:  () => void
}) {
  const form = useForm({
    initialValues: {
      nombre:      initial?.nombre ?? '',
      descripcion: initial?.descripcion ?? '',
    },
    validate: {
      nombre: (v) =>
        !v.trim() ? 'Requerido' :
        v.length > 160 ? 'Máximo 160 caracteres' :
        !TEXTO_LIBRE.test(v.trim()) ? 'Contiene caracteres no permitidos' : null,
      descripcion: (v) =>
        v && v.trim() && !TEXTO_LIBRE.test(v.trim()) ? 'Contiene caracteres no permitidos' : null,
    },
  })

  return (
    <form onSubmit={form.onSubmit((v) => onSubmit({
      nombre: v.nombre.trim(), descripcion: v.descripcion.trim() || null,
    }))}>
      <Stack gap="sm">
        <TextInput
          label="Nombre del programa" required maxLength={160}
          placeholder="Ej. Programa de mantenimiento ELF 100, 200 y 300 (Euro V) 2020-2025"
          {...form.getInputProps('nombre')}
          onChange={(e) => form.setFieldValue('nombre', limpiarTextoLibre(e.currentTarget.value, 160))}
        />
        <Textarea
          label="Notas" autosize minRows={2} maxLength={2000}
          placeholder="Las notas al pie del manual: uso severo, calidad del diesel, etc."
          {...form.getInputProps('descripcion')}
          onChange={(e) => form.setFieldValue('descripcion', limpiarTextoLibre(e.currentTarget.value, 2000))}
        />
        {error && <Alert color="red" title="Error">{error}</Alert>}
        <Group justify="flex-end">
          <Button variant="default" onClick={onCancel} disabled={isPending}>Cancelar</Button>
          <Button type="submit" loading={isPending}>
            {initial ? 'Guardar cambios' : 'Crear programa'}
          </Button>
        </Group>
      </Stack>
    </form>
  )
}

// ── Sección ──────────────────────────────────────────────────────────────────

export default function ProgramaModeloSection({ modeloId }: { modeloId: number }) {
  const { data, isLoading } = useProgramaModelo(modeloId)
  const { data: accionesData } = useAccionesPrograma()
  const programa = data?.data ?? null
  const acciones = accionesData?.data ?? []

  const createMut    = useCreatePrograma(modeloId)
  const updateMut    = useUpdatePrograma(modeloId)
  const deleteMut    = useDeletePrograma(modeloId)
  const fasesMut     = useSetFases(modeloId)
  const crearOpMut   = useCreateOperacion(modeloId)
  const editarOpMut  = useUpdateOperacion(modeloId)
  const borrarOpMut  = useDeleteOperacion(modeloId)
  const celdasMut    = useSetCeldas(modeloId)

  const [programaFormOpen, setProgramaFormOpen] = useState(false)
  const [fasesOpen, setFasesOpen]   = useState(false)
  const [opFormOpen, setOpFormOpen] = useState(false)
  const [editandoOp, setEditandoOp] = useState<OperacionPrograma | null>(null)
  const [borrandoOp, setBorrandoOp] = useState<OperacionPrograma | null>(null)
  const [borrandoPrograma, setBorrandoPrograma] = useState(false)
  const [formError, setFormError]   = useState<string | null>(null)
  const [celdaError, setCeldaError] = useState<string | null>(null)

  // La acción que se está pintando. '' es la goma: quita lo que haya.
  const [pincel, setPincel] = useState('')

  // Renglones con un cambio de casilla todavía en vuelo. Se pintan desde aquí
  // para que la cuadrícula responda al instante; en cuanto el servidor contesta
  // con el programa entero, el renglón vuelve a leerse de la caché.
  const [enVuelo, setEnVuelo] = useState<Record<number, Record<number, string>>>({})

  const fases       = programa?.fases ?? []
  const operaciones = programa?.operaciones ?? []
  const categorias  = [...new Set(operaciones.map((o) => o.categoria).filter((c): c is string => !!c))]

  function filaDe(op: OperacionPrograma): Record<number, string> {
    return enVuelo[op.id] ?? op.celdas
  }

  function marcar(op: OperacionPrograma, faseId: number) {
    const fila = { ...filaDe(op) }
    // Volver a pintar con la misma acción borra: es lo que uno espera de una
    // brocha, y evita tener que cambiar a la goma para corregir un dedazo.
    if (pincel === '' || fila[faseId] === pincel) delete fila[faseId]
    else fila[faseId] = pincel

    setCeldaError(null)
    setEnVuelo((prev) => ({ ...prev, [op.id]: fila }))
    celdasMut.mutate(
      {
        operacionId: op.id,
        celdas: Object.entries(fila).map(([fid, accion]) => ({ fase_id: Number(fid), accion })),
      },
      {
        onSettled: () => setEnVuelo((prev) => {
          const copia = { ...prev }
          delete copia[op.id]
          return copia
        }),
        onError: (e: Error) => setCeldaError(e.message),
      }
    )
  }

  function guardarOperacion(payload: OperacionPayload) {
    setFormError(null)
    const ok = () => setOpFormOpen(false)
    const fail = (e: Error) => setFormError(e.message)
    if (editandoOp) {
      editarOpMut.mutate({ id: editandoOp.id, payload }, { onSuccess: ok, onError: fail })
    } else {
      crearOpMut.mutate({ programaId: programa!.id, payload }, { onSuccess: ok, onError: fail })
    }
  }

  const encabezado = (
    <Divider
      label={
        <Group gap="xs">
          <IconChecklist size={14} />
          <Text size="sm" fw={500}>Programa de mantenimiento del fabricante</Text>
        </Group>
      }
      labelPosition="left"
    />
  )

  if (isLoading) {
    return <>{encabezado}<Center py="xl"><Loader /></Center></>
  }

  // ── Sin programa todavía ──
  if (!programa) {
    return (
      <>
        {encabezado}
        <Paper withBorder p="lg" radius="md">
          <Stack gap="sm" align="flex-start">
            <Text size="sm" c="dimmed">
              Este modelo no tiene capturado el programa del fabricante. Es la tabla del manual:
              los servicios por kilometraje y qué se le hace a cada pieza en cada uno, con el
              límite de meses de cada renglón.
            </Text>
            <Button
              leftSection={<IconPlus size={14} />}
              onClick={() => { setFormError(null); setProgramaFormOpen(true) }}
            >
              Capturar programa
            </Button>
          </Stack>
        </Paper>

        <Modal
          opened={programaFormOpen} onClose={() => setProgramaFormOpen(false)}
          title="Nuevo programa de mantenimiento" centered size="lg"
        >
          <ProgramaForm
            isPending={createMut.isPending}
            error={formError}
            onSubmit={(p) => createMut.mutate(p, {
              onSuccess: () => setProgramaFormOpen(false),
              onError:   (e: Error) => setFormError(e.message),
            })}
            onCancel={() => setProgramaFormOpen(false)}
          />
        </Modal>
      </>
    )
  }

  // ── Con programa ──
  return (
    <>
      {encabezado}

      <Paper withBorder p="md" radius="md">
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Stack gap={4}>
            <Group gap="xs">
              <Text fw={600}>{programa.nombre}</Text>
              {!programa.activo && <Badge variant="light" color="gray" size="sm">Inactivo</Badge>}
            </Group>
            {resumenRecorrido(programa) && (
              <Text size="sm" c="dimmed">{resumenRecorrido(programa)}</Text>
            )}
            {programa.descripcion && <Text size="xs" c="dimmed">{programa.descripcion}</Text>}
          </Stack>
          <Group gap="xs" wrap="nowrap">
            <Tooltip label="Editar columnas del programa">
              <ActionIcon variant="light" color="blue" onClick={() => { setFormError(null); setFasesOpen(true) }}>
                <IconColumns size={16} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Editar nombre y notas">
              <ActionIcon variant="light" color="blue" onClick={() => { setFormError(null); setProgramaFormOpen(true) }}>
                <IconPencil size={16} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Eliminar programa">
              <ActionIcon variant="light" color="red" onClick={() => setBorrandoPrograma(true)}>
                <IconTrash size={16} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>
      </Paper>

      {fases.length === 0 ? (
        <Alert color="blue" variant="light" title="Faltan las columnas">
          <Stack gap="xs" align="flex-start">
            <Text size="sm">
              Antes de capturar los renglones hay que decir a qué kilometrajes manda el fabricante
              la unidad al taller.
            </Text>
            <Button size="xs" leftSection={<IconColumns size={14} />} onClick={() => setFasesOpen(true)}>
              Definir columnas
            </Button>
          </Stack>
        </Alert>
      ) : (
        <>
          <Group justify="space-between" align="flex-end" wrap="wrap" gap="sm">
            <Stack gap={4}>
              <Text size="xs" c="dimmed" fw={600} tt="uppercase">Marcar con</Text>
              <SegmentedControl
                size="xs"
                value={pincel}
                onChange={setPincel}
                data={[
                  { value: '', label: 'Borrar' },
                  ...acciones.map((a) => ({ value: a.codigo, label: `${a.codigo} · ${a.nombre}` })),
                ]}
              />
            </Stack>
            <Button
              size="xs" leftSection={<IconPlus size={14} />}
              onClick={() => { setEditandoOp(null); setFormError(null); setOpFormOpen(true) }}
            >
              Agregar operación
            </Button>
          </Group>

          {celdaError && <Alert color="red" title="No se pudo guardar">{celdaError}</Alert>}

          {operaciones.length === 0 ? (
            <Center py="xl">
              <Text c="dimmed">Todavía no hay operaciones capturadas.</Text>
            </Center>
          ) : (
            <Table.ScrollContainer minWidth={520 + fases.length * 64}>
              <Table striped highlightOnHover withTableBorder verticalSpacing={4}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th style={{ minWidth: 260 }}>Operación</Table.Th>
                    {fases.map((f) => (
                      <Table.Th key={f.id} style={{ textAlign: 'center', width: 64 }}>
                        <Stack gap={0} align="center">
                          <Text size="xs" fw={600}>{nf.format(f.km)}</Text>
                          {f.unica && (
                            <Tooltip label="Solo en la primera pasada">
                              <Text size={'9px' as string} c="dimmed">1 vez</Text>
                            </Tooltip>
                          )}
                        </Stack>
                      </Table.Th>
                    ))}
                    <Table.Th style={{ textAlign: 'center', width: 90 }}>Límite</Table.Th>
                    <Table.Th style={{ width: 70 }} />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {operaciones.map((op) => {
                    const fila = filaDe(op)
                    return (
                      <Table.Tr key={op.id}>
                        <Table.Td>
                          <Text size="sm">{op.nombre}</Text>
                          {op.categoria && <Text size="xs" c="dimmed">{op.categoria}</Text>}
                        </Table.Td>
                        {fases.map((f) => {
                          const accion = fila[f.id]
                          return (
                            <Table.Td key={f.id} style={{ textAlign: 'center', padding: 2 }}>
                              <UnstyledButton
                                onClick={() => marcar(op, f.id)}
                                aria-label={`${op.nombre}, ${nf.format(f.km)} km`}
                                style={{
                                  display: 'block', width: '100%', height: 28, borderRadius: 4,
                                  cursor: 'pointer',
                                  border: '1px solid var(--mantine-color-default-border)',
                                  background: accion
                                    ? `var(--mantine-color-${colorDe(acciones, accion)}-light)`
                                    : 'transparent',
                                  color: accion
                                    ? `var(--mantine-color-${colorDe(acciones, accion)}-filled)`
                                    : 'var(--mantine-color-dimmed)',
                                  fontSize: 12, fontWeight: 700, lineHeight: '26px',
                                }}
                              >
                                {accion ?? '·'}
                              </UnstyledButton>
                            </Table.Td>
                          )
                        })}
                        <Table.Td style={{ textAlign: 'center' }}>
                          {op.limite_meses
                            ? <Text size="xs">{op.limite_meses} {op.limite_meses === 1 ? 'mes' : 'meses'}</Text>
                            : <Text size="xs" c="dimmed">—</Text>}
                        </Table.Td>
                        <Table.Td>
                          <Group gap={2} wrap="nowrap">
                            <Tooltip label="Editar">
                              <ActionIcon
                                variant="subtle" color="blue" size="sm"
                                onClick={() => { setEditandoOp(op); setFormError(null); setOpFormOpen(true) }}
                              >
                                <IconPencil size={14} />
                              </ActionIcon>
                            </Tooltip>
                            <Tooltip label="Eliminar">
                              <ActionIcon
                                variant="subtle" color="red" size="sm"
                                onClick={() => setBorrandoOp(op)}
                              >
                                <IconTrash size={14} />
                              </ActionIcon>
                            </Tooltip>
                          </Group>
                        </Table.Td>
                      </Table.Tr>
                    )
                  })}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )}

          {/* Lo que el taller va a ver: a qué odómetro cae cada visita. Aquí se
              hace evidente que después de la última columna el programa da la
              vuelta en vez de volver al principio. */}
          {operaciones.length > 0 && (
            <Group gap={6} wrap="wrap">
              <Text size="xs" c="dimmed" fw={600} tt="uppercase" mr={4}>Recorrido</Text>
              {proximosServicios(fases, 0, Math.min(fases.length + 3, 14)).map((s) => (
                <Badge
                  key={s.indice}
                  size="sm"
                  variant={s.km === s.fase.km ? 'light' : 'outline'}
                  color={s.km === s.fase.km ? 'blue' : 'grape'}
                >
                  {nf.format(s.km)}
                  {s.km !== s.fase.km && ` · col ${nf.format(s.fase.km)}`}
                </Badge>
              ))}
            </Group>
          )}
        </>
      )}

      <Modal
        opened={programaFormOpen} onClose={() => setProgramaFormOpen(false)}
        title="Editar programa de mantenimiento" centered size="lg"
      >
        <ProgramaForm
          initial={programa}
          isPending={updateMut.isPending}
          error={formError}
          onSubmit={(p) => updateMut.mutate({ id: programa.id, payload: p }, {
            onSuccess: () => setProgramaFormOpen(false),
            onError:   (e: Error) => setFormError(e.message),
          })}
          onCancel={() => setProgramaFormOpen(false)}
        />
      </Modal>

      <Modal
        opened={fasesOpen} onClose={() => setFasesOpen(false)}
        title="Columnas del programa" centered size="lg"
      >
        <ProgramaFasesModal
          fases={fases}
          isPending={fasesMut.isPending}
          error={formError}
          onSubmit={(nuevas: FasePayload[]) => fasesMut.mutate(
            { programaId: programa.id, fases: nuevas },
            {
              onSuccess: () => setFasesOpen(false),
              onError:   (e: Error) => setFormError(e.message),
            }
          )}
          onCancel={() => setFasesOpen(false)}
        />
      </Modal>

      <Modal
        opened={opFormOpen} onClose={() => setOpFormOpen(false)}
        title={editandoOp ? 'Editar operación' : 'Nueva operación'} centered size="lg"
      >
        <ProgramaOperacionForm
          modeloId={modeloId}
          initial={editandoOp ?? undefined}
          categorias={categorias}
          isPending={crearOpMut.isPending || editarOpMut.isPending}
          error={formError}
          onSubmit={guardarOperacion}
          onCancel={() => setOpFormOpen(false)}
        />
      </Modal>

      <Modal
        opened={borrandoOp !== null} onClose={() => setBorrandoOp(null)}
        title="Eliminar operación" centered size="sm"
      >
        <Stack gap="md">
          <Text>¿Eliminar <strong>{borrandoOp?.nombre}</strong> del programa?</Text>
          <Text size="sm" c="dimmed">Se borra también lo que tuviera marcado en la cuadrícula.</Text>
          {borrarOpMut.error && <Alert color="red" title="Error">{(borrarOpMut.error as Error).message}</Alert>}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setBorrandoOp(null)} disabled={borrarOpMut.isPending}>
              Cancelar
            </Button>
            <Button color="red" loading={borrarOpMut.isPending}
              onClick={() => borrarOpMut.mutate(borrandoOp!.id, { onSuccess: () => setBorrandoOp(null) })}>
              Sí, eliminar
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={borrandoPrograma} onClose={() => setBorrandoPrograma(false)}
        title="Eliminar programa de mantenimiento" centered size="sm"
      >
        <Stack gap="md">
          <Text>¿Eliminar <strong>{programa.nombre}</strong>?</Text>
          <Alert color="orange" title="Atención" variant="light">
            Se van con él todas las columnas y las {operaciones.length} operaciones capturadas.
          </Alert>
          {deleteMut.error && <Alert color="red" title="Error">{(deleteMut.error as Error).message}</Alert>}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setBorrandoPrograma(false)} disabled={deleteMut.isPending}>
              Cancelar
            </Button>
            <Button color="red" loading={deleteMut.isPending}
              onClick={() => deleteMut.mutate(programa.id, { onSuccess: () => setBorrandoPrograma(false) })}>
              Sí, eliminar
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  )
}
