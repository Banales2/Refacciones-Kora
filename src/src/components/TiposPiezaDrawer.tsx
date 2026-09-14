// El catálogo de tipos de pieza: "filtro de aire", "llanta", "balata". Lo que un
// modelo necesita, sin decir cuál refacción concreta lo cubre.
//
// Hasta ahora los tipos solo se podían CREAR, y de pasada, desde el buscador del
// formulario de una refacción. Renombrarlos o borrarlos era imposible desde la
// aplicación aunque la API lo permitiera, así que un tipo mal escrito se quedaba
// mal escrito para siempre.
//
// Existe sobre todo por el interruptor de rastreo individual: es la decisión que
// dice si las piezas de ese tipo se identifican una por una —cada llanta con su
// historia— o se cuentan a granel. Ver `docs/piezas-identificadas.md`.
import { useState } from 'react'
import {
  Drawer, Stack, Group, Text, TextInput, Switch, Button, Alert, Loader, Center,
  Paper, ActionIcon, Tooltip, Badge,
} from '@mantine/core'
import {
  IconPencil, IconCheck, IconX, IconTag, IconArchive, IconArchiveOff,
} from '@tabler/icons-react'
import {
  useTiposPieza, useUpdateTipoPieza,
} from '../hooks/useTiposPieza'
import ArchivarCatalogoModal from './ArchivarCatalogoModal'
import type { TipoPieza } from '../hooks/useTiposPieza'
import { limpiarTextoSimple } from '../lib/validaciones'
import IdentificarExistentesModal from './IdentificarExistentesModal'

/** Un renglón del catálogo: nombre editable en sitio y su interruptor. */
function TipoRow({ tipo, onArchivar }: { tipo: TipoPieza; onArchivar: () => void }) {
  const [editando, setEditando] = useState(false)
  const [nombre, setNombre] = useState(tipo.nombre)
  // Al encender el rastreo se abre la captura de lo que ya estaba en el estante.
  // Es el momento en que tiene sentido preguntarlo: encender el interruptor y no
  // decir nada dejaría todo el stock existente sin poder identificarse, y nadie
  // volvería a acordarse.
  const [identificando, setIdentificando] = useState(false)
  const mut = useUpdateTipoPieza()

  const limpio = nombre.trim()
  const puedeGuardar = limpio.length >= 2 && limpio !== tipo.nombre

  function guardarNombre() {
    if (!puedeGuardar) return
    mut.mutate({ id: tipo.id, nombre: limpio }, { onSuccess: () => setEditando(false) })
  }

  return (
    <Paper withBorder p="xs" radius="sm">
      <Stack gap={6}>
        <Group justify="space-between" wrap="nowrap" align="center">
          {editando ? (
            <Group gap={4} wrap="nowrap" style={{ flex: 1 }}>
              <TextInput
                size="xs" style={{ flex: 1 }} data-autofocus
                value={nombre}
                maxLength={40}
                onChange={(e) => setNombre(limpiarTextoSimple(e.currentTarget.value, 40))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') guardarNombre()
                  if (e.key === 'Escape') { setNombre(tipo.nombre); setEditando(false) }
                }}
              />
              <ActionIcon
                variant="subtle" color="green" size="sm" aria-label="Guardar nombre"
                disabled={!puedeGuardar} loading={mut.isPending}
                onClick={guardarNombre}
              >
                <IconCheck size={15} />
              </ActionIcon>
              <ActionIcon
                variant="subtle" color="gray" size="sm" aria-label="Cancelar"
                onClick={() => { setNombre(tipo.nombre); setEditando(false); mut.reset() }}
              >
                <IconX size={15} />
              </ActionIcon>
            </Group>
          ) : (
            <>
              <Group gap={6} wrap="nowrap">
                <Text size="sm" fw={500} c={tipo.archivado_en ? 'dimmed' : undefined}>
                  {tipo.nombre}
                </Text>
                {tipo.archivado_en && (
                  <Badge size="xs" variant="light" color="gray">Archivado</Badge>
                )}
                {tipo.rastreo_individual && (
                  <Badge size="xs" variant="light" color="teal">Rastreo individual</Badge>
                )}
              </Group>
              <Group gap={2} wrap="nowrap">
                <Tooltip label="Renombrar">
                  <ActionIcon
                    variant="subtle" color="blue" size="sm" aria-label={`Renombrar ${tipo.nombre}`}
                    onClick={() => setEditando(true)}
                  >
                    <IconPencil size={14} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label={tipo.archivado_en ? 'Restaurar' : 'Archivar'}>
                  <ActionIcon
                    variant="subtle" size="sm"
                    color={tipo.archivado_en ? 'teal' : 'orange'}
                    aria-label={`${tipo.archivado_en ? 'Restaurar' : 'Archivar'} ${tipo.nombre}`}
                    onClick={onArchivar}
                  >
                    {tipo.archivado_en ? <IconArchiveOff size={14} /> : <IconArchive size={14} />}
                  </ActionIcon>
                </Tooltip>
              </Group>
            </>
          )}
        </Group>

        {/* El interruptor se guarda solo, sin botón: es un dato de una decisión,
            no de un formulario, y obligar a "guardar" un switch es la vía segura
            a que alguien lo mueva y se vaya creyendo que quedó. */}
        <Switch
          size="xs"
          label="Identificar las piezas una por una"
          description="Para lo que vale la pena seguirle la pista: llantas, baterías. Lo que se gasta a granel —aceite, tornillos— déjalo apagado."
          checked={tipo.rastreo_individual}
          disabled={mut.isPending}
          onChange={(e) => {
            const encendiendo = e.currentTarget.checked
            mut.mutate(
              { id: tipo.id, rastreo_individual: encendiendo },
              { onSuccess: () => { if (encendiendo) setIdentificando(true) } },
            )
          }}
        />

        {/* Ya está encendido: se puede volver a abrir la captura para lo que
            haya quedado pendiente, o para el stock que entró por otra vía. */}
        {tipo.rastreo_individual && (
          <Button
            variant="subtle" size="compact-xs" w="fit-content"
            leftSection={<IconTag size={12} />}
            onClick={() => setIdentificando(true)}
          >
            Identificar piezas existentes
          </Button>
        )}

        {mut.error && (
          <Alert color="red" p="xs">
            <Text size="xs">{(mut.error as Error).message}</Text>
          </Alert>
        )}
      </Stack>

      <IdentificarExistentesModal
        opened={identificando}
        onClose={() => setIdentificando(false)}
        tipoPiezaId={tipo.id}
        tipoNombre={tipo.nombre}
      />
    </Paper>
  )
}

export default function TiposPiezaDrawer({
  opened, onClose,
}: {
  opened:  boolean
  onClose: () => void
}) {
  // Siempre se piden con archivados: así el switch puede decir cuántos hay sin
  // una segunda consulta, y prenderlo no dispara un refetch.
  const { data, isLoading, isError } = useTiposPieza(true)
  // Tipo que se está por archivar (o restaurar). No hay borrado.
  const [archivando, setArchivando] = useState<TipoPieza | null>(null)
  const [verArchivados, setVerArchivados] = useState(false)

  const todos      = data?.data ?? []
  const archivados = todos.filter((t) => t.archivado_en).length
  const tipos      = todos.filter((t) => verArchivados || !t.archivado_en)

  return (
    <>
      <Drawer
        opened={opened}
        onClose={onClose}
        title={<Text fw={700}>Tipos de pieza</Text>}
        position="right"
        size="md"
        overlayProps={{ backgroundOpacity: 0.3 }}
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            Lo que un modelo necesita —"filtro de aire", "llanta"—, sin decir cuál
            refacción lo cubre. Los tipos nuevos se crean al vuelo desde el formulario
            de una refacción; aquí se corrigen y se decide cuáles se rastrean pieza
            por pieza.
          </Text>

          {(archivados > 0 || verArchivados) && (
            <Switch
              size="sm" label={`Ver archivados (${archivados})`}
              checked={verArchivados}
              onChange={(e) => setVerArchivados(e.currentTarget.checked)}
            />
          )}

          {isError ? (
            <Alert color="red" title="Error">No se pudieron cargar los tipos de pieza.</Alert>
          ) : isLoading ? (
            <Center py="xl"><Loader /></Center>
          ) : !tipos.length ? (
            <Center py="xl">
              <Text c="dimmed">Todavía no hay tipos de pieza.</Text>
            </Center>
          ) : (
            <Stack gap="xs">
              {tipos.map((t) => (
                <TipoRow key={t.id} tipo={t} onArchivar={() => setArchivando(t)} />
              ))}
            </Stack>
          )}
        </Stack>
      </Drawer>

      {/* zIndex por encima del cajón, que si no lo tapa. */}
      <ArchivarCatalogoModal
        recurso="tipos-pieza" item={archivando} etiqueta="el tipo de pieza"
        onClose={() => setArchivando(null)}
      />
    </>
  )
}
