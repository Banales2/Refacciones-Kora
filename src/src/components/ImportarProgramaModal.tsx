// Importar el programa de mantenimiento de un modelo desde la tabla del
// fabricante en CSV, en vez de transcribirla casilla por casilla.
//
// El archivo trae las columnas de kilometraje, los renglones y qué se hace en
// cada cruce; lo que NO puede traer es con qué tipo de pieza del sistema se
// cumple cada reemplazo. Eso se pregunta aquí, renglón por renglón, antes de
// guardar: un renglón que manda reemplazar sin tipo de pieza se colaría en el
// acta de la visita como una inspección más (migración 031).
//
// Ver `docs/importar-programa.md` para el formato de los archivos.
import { useMemo, useState } from 'react'
import {
  Modal, Stack, Group, Text, Alert, Button, TextInput, FileInput, Select, Table,
  Badge, Paper, Collapse, UnstyledButton, ScrollArea,
} from '@mantine/core'
import {
  IconFileTypeCsv, IconUpload, IconChevronDown, IconChevronRight,
} from '@tabler/icons-react'
import { leerTexto } from '../lib/csv'
import {
  ArchivoInvalidoError, armarPrograma, leerArchivoPrecios, leerArchivoPrograma,
  modeloDelArchivo,
} from '../lib/programaCsv'
import type { ArchivoPrograma, OperacionArmada, PrecioServicio } from '../lib/programaCsv'
import { TEXTO_LIBRE, limpiarTextoLibre } from '../lib/validaciones'
import { formatMXN } from '../lib/formato'
import {
  useAccionesPrograma, useImportarPrograma, proximosServicios, TIPO_PROGRAMA_LABEL,
} from '../hooks/usePrograma'
import type { TipoPrograma, FasePrograma } from '../hooks/usePrograma'
import { useModelos } from '../hooks/useModelos'
import { useTiposPiezaModelo } from '../hooks/useTiposPiezaModelo'
import SelectTipoPiezaModelo from './SelectTipoPiezaModelo'

const nf = new Intl.NumberFormat('es-MX')

// Para casar el nombre de un renglón con un tipo que el modelo ya declara:
// "Filtro de aire" y "FILTRO DE AIRE" son el mismo tipo.
function clave(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase().replace(/\s+/g, ' ')
}

// Lee un archivo elegido y lo pasa por su lector. El error del lector es para
// la persona; cualquier otro es que el archivo ni siquiera abrió.
async function leer<T>(archivo: File, lector: (texto: string) => T): Promise<T> {
  let texto: string
  try {
    texto = await leerTexto(archivo)
  } catch {
    throw new ArchivoInvalidoError('No se pudo abrir el archivo.')
  }
  return lector(texto)
}

export default function ImportarProgramaModal({ modeloId, tipo, onClose }: {
  modeloId: number
  tipo:     TipoPrograma
  onClose:  () => void
}) {
  const modelosQuery  = useModelos(true)
  const accionesQuery = useAccionesPrograma()
  const tiposQuery    = useTiposPiezaModelo(modeloId)
  const importarMut   = useImportarPrograma(modeloId)

  const modelo   = modelosQuery.data?.data.find((m) => m.id === modeloId)
  const accionesData = accionesQuery.data
  const acciones = useMemo(() => accionesData?.data ?? [], [accionesData])

  const [archivoOps, setArchivoOps]         = useState<File | null>(null)
  const [archivo, setArchivo]               = useState<ArchivoPrograma | null>(null)
  const [errorOps, setErrorOps]             = useState<string | null>(null)
  const [archivoPrecios, setArchivoPrecios] = useState<File | null>(null)
  const [precios, setPrecios]               = useState<PrecioServicio[] | null>(null)
  const [errorPrecios, setErrorPrecios]     = useState<string | null>(null)

  // Lo que la persona eligió encima de lo que se dedujo del archivo. Null o
  // ausente = lo deducido.
  const [modeloElegido, setModeloElegido] = useState<string | null>(null)
  const [nombre, setNombre]               = useState<string | null>(null)
  const [unicas, setUnicas]               = useState('0')
  const [tipoPorNo, setTipoPorNo]         = useState<Record<number, string>>({})
  const [verNotas, setVerNotas]           = useState(false)

  function elegirOps(f: File | null) {
    setArchivoOps(f)
    setArchivo(null)
    setErrorOps(null)
    setModeloElegido(null)
    setNombre(null)
    setUnicas('0')
    setTipoPorNo({})
    importarMut.reset()
    if (!f) return
    leer(f, leerArchivoPrograma)
      .then(setArchivo)
      .catch((e) => setErrorOps(e instanceof ArchivoInvalidoError ? e.message : 'No se pudo leer el archivo.'))
  }

  function elegirPrecios(f: File | null) {
    setArchivoPrecios(f)
    setPrecios(null)
    setErrorPrecios(null)
    importarMut.reset()
    if (!f) return
    leer(f, leerArchivoPrecios)
      .then(setPrecios)
      .catch((e) => setErrorPrecios(e instanceof ArchivoInvalidoError ? e.message : 'No se pudo leer el archivo.'))
  }

  // Qué modelo del archivo es este. Se deduce por el nombre; si no encaja
  // ninguno —o encajan varios— lo elige la persona.
  const deducido = archivo && modelo ? modeloDelArchivo(archivo.modelos, modelo) : null
  const modeloArchivo = modeloElegido ?? deducido

  const armado = useMemo(() => {
    if (!archivo || !modeloArchivo) return null
    const nombreAccion = (c: string) => acciones.find((a) => a.codigo === c)?.nombre ?? c
    return armarPrograma(archivo, modeloArchivo, nombreAccion, precios ?? undefined)
  }, [archivo, modeloArchivo, acciones, precios])

  const nombrePorDefecto = archivo && modeloArchivo
    ? limpiarTextoLibre(
        `Programa de mantenimiento ${modeloArchivo}${archivo.anios ? ` ${archivo.anios}` : ''}`, 160)
    : ''
  const nombreFinal = (nombre ?? nombrePorDefecto).trim()
  const errorNombre =
    !nombreFinal ? 'Requerido'
    : !TEXTO_LIBRE.test(nombreFinal) ? 'Contiene caracteres no permitidos'
    : null

  // Las acciones que consumen refacción (hoy solo 'R'). Un renglón con alguna
  // de ellas, en la cuadrícula o en sus reglas por tiempo, pide su tipo de pieza.
  const exigen = new Set(acciones.filter((a) => a.requiere_pieza).map((a) => a.codigo))
  const conReemplazo = (armado?.operaciones ?? []).filter((op) =>
    [...op.acciones].some((a) => exigen.has(a)))

  const delModelo = tiposQuery.data?.data ?? []
  function tipoDe(op: OperacionArmada): string {
    if (op.no in tipoPorNo) return tipoPorNo[op.no]
    // Si el modelo ya declara un tipo con el mismo nombre, es ese: una segunda
    // importación no tiene por qué volver a preguntarlo.
    const igual = delModelo.find((t) =>
      !t.etiqueta && [clave(op.sugerenciaTipo), clave(op.nombre)].includes(clave(t.nombre)))
    return igual ? String(igual.id) : ''
  }
  const faltanTipos = conReemplazo.filter((op) => !tipoDe(op))

  const desconocidas = [...new Set((armado?.operaciones ?? [])
    .flatMap((op) => op.celdas.map((c) => c.accion))
    .filter((a) => !acciones.some((x) => x.codigo === a)))]

  const nUnicas = Number(unicas)
  const fases = (armado?.fases ?? []).map((f, i) => ({ ...f, unica: i < nUnicas }))
  const recorrido = proximosServicios(
    fases.map((f, i): FasePrograma => ({ id: i, orden: i, ...f })),
    0, Math.min(fases.length + 3, 14),
  )
  const conNotasSinProgramar = (armado?.operaciones ?? []).filter((op) => op.sinProgramar.length)

  const listo = !!armado && !errorNombre && !faltanTipos.length && !desconocidas.length
    && fases.length > 0 && !accionesQuery.isLoading

  function importar() {
    if (!armado || !listo) return
    importarMut.mutate({
      tipo,
      nombre: nombreFinal,
      fases,
      operaciones: armado.operaciones.map((op) => ({
        nombre:        op.nombre,
        descripcion:   op.descripcion,
        limite_meses:  op.limite_meses,
        tipo_pieza_id: tipoDe(op) ? Number(tipoDe(op)) : null,
        celdas:        op.celdas,
      })),
    }, { onSuccess: onClose })
  }

  return (
    <Modal
      opened onClose={onClose} centered size="xl"
      title={`Importar programa — ${TIPO_PROGRAMA_LABEL[tipo].toLowerCase()}`}
    >
      <Stack gap="md">
        <Group grow align="flex-start">
          <FileInput
            label="Operaciones" required
            description="mantenimiento_….csv: una fila por regla"
            placeholder="Selecciona el archivo…"
            accept=".csv,text/csv"
            leftSection={<IconFileTypeCsv size={16} />}
            value={archivoOps}
            onChange={elegirOps}
            clearable
            error={errorOps}
          />
          <FileInput
            label="Precios por servicio"
            description="precios_servicio_….csv: opcional"
            placeholder="Selecciona el archivo…"
            accept=".csv,text/csv"
            leftSection={<IconFileTypeCsv size={16} />}
            value={archivoPrecios}
            onChange={elegirPrecios}
            clearable
            error={errorPrecios}
          />
        </Group>

        {archivo && (
          <Group grow align="flex-start">
            <Select
              label="Este modelo en el archivo" required
              description={
                deducido ? 'Deducido por el nombre del modelo.'
                : 'No se pudo deducir por el nombre: elige cuál es.'}
              data={archivo.modelos}
              value={modeloArchivo}
              onChange={setModeloElegido}
              allowDeselect={false}
            />
            <TextInput
              label="Nombre del programa" required maxLength={160}
              value={nombre ?? nombrePorDefecto}
              onChange={(e) => setNombre(limpiarTextoLibre(e.currentTarget.value, 160))}
              error={errorNombre}
            />
          </Group>
        )}

        {armado && (
          <>
            <Paper withBorder p="sm">
              <Stack gap="xs">
                <Group justify="space-between" align="flex-end">
                  <Text size="sm" fw={600}>
                    {fases.length} columna(s) · {armado.operaciones.length} renglón(es)
                  </Text>
                  <Select
                    size="xs" w={280}
                    label="Columnas de una sola vez"
                    data={fases.slice(0, -1).map((_, i) => ({
                      value: String(i + 1),
                      label: i === 0
                        ? `La primera (${nf.format(fases[0].km)})`
                        : `Las primeras ${i + 1} (hasta ${nf.format(fases[i].km)})`,
                    })).concat([{ value: '0', label: 'Ninguna: todas se repiten' }]).reverse()}
                    value={unicas}
                    onChange={(v) => setUnicas(v ?? '0')}
                    allowDeselect={false}
                  />
                </Group>
                <ScrollArea>
                  <Table withTableBorder verticalSpacing={4} fz="xs">
                    <Table.Tbody>
                      <Table.Tr>
                        <Table.Th>Km</Table.Th>
                        {fases.map((f) => (
                          <Table.Td key={f.km} style={{ textAlign: 'center' }}>
                            {nf.format(f.km)}
                            {f.unica && <Text size={'9px' as string} c="dimmed">1 vez</Text>}
                          </Table.Td>
                        ))}
                      </Table.Tr>
                      <Table.Tr>
                        <Table.Th>Precio</Table.Th>
                        {fases.map((f) => (
                          <Table.Td key={f.km} style={{ textAlign: 'center' }}>
                            {f.costo != null ? formatMXN(f.costo) : <Text span c="dimmed">—</Text>}
                          </Table.Td>
                        ))}
                      </Table.Tr>
                    </Table.Tbody>
                  </Table>
                </ScrollArea>
                <Group gap={6} wrap="wrap">
                  <Text size="xs" c="dimmed" fw={600} tt="uppercase" mr={4}>Recorrido</Text>
                  {recorrido.map((s) => (
                    <Badge
                      key={s.indice} size="sm"
                      variant={s.km === s.fase.km ? 'light' : 'outline'}
                      color={s.km === s.fase.km ? 'blue' : 'grape'}
                    >
                      {nf.format(s.km)}
                      {s.km !== s.fase.km && ` · col ${nf.format(s.fase.km)}`}
                    </Badge>
                  ))}
                </Group>
                <Text size="xs" c="dimmed">
                  Revisa que el recorrido coincida con el manual: al acabar la última columna el
                  programa vuelve a la primera que se repite. Si las primeras columnas son servicios
                  de asentamiento que no se repiten, márcalas arriba.
                </Text>
                {precios && armado.sinPrecio.length > 0 && (
                  <Text size="xs" c="orange">
                    Sin precio en el archivo: {armado.sinPrecio.map((k) => nf.format(k)).join(', ')} km.
                    Quedan sin cotizar; se pueden capturar después en las columnas del programa.
                  </Text>
                )}
              </Stack>
            </Paper>

            {desconocidas.length > 0 && (
              <Alert color="red" title="Acciones que no están en el catálogo">
                El archivo usa {desconocidas.map((a) => `"${a}"`).join(', ')}. Corrige el archivo o
                agrega la acción al catálogo antes de importar.
              </Alert>
            )}

            {conReemplazo.length > 0 && (
              <Stack gap="xs">
                <Group justify="space-between">
                  <Text size="sm" fw={600}>Tipo de pieza de cada reemplazo</Text>
                  <Badge color={faltanTipos.length ? 'orange' : 'green'} variant="light">
                    {faltanTipos.length
                      ? `Faltan ${faltanTipos.length} de ${conReemplazo.length}`
                      : 'Completo'}
                  </Badge>
                </Group>
                <Text size="xs" c="dimmed">
                  Estos renglones mandan reemplazar algo. Al cerrar la visita se va a exigir una
                  refacción de su tipo, así que cada uno necesita el suyo, declarado en el modelo.
                  Si todavía no existe, ábrelo y elige la primera opción para registrarlo.
                </Text>
                {conReemplazo.map((op) => (
                  <Group key={op.no} grow align="flex-start" gap="sm" wrap="nowrap">
                    <Stack gap={0}>
                      <Text size="sm">{op.nombre}</Text>
                      <Text size="xs" c="dimmed">
                        {op.celdas.some((c) => exigen.has(c.accion))
                          ? `Reemplazo a los ${op.celdas.filter((c) => exigen.has(c.accion))
                              .map((c) => nf.format(c.km)).join(', ')} km`
                          : 'Reemplazo por tiempo o fuera de las columnas'}
                      </Text>
                    </Stack>
                    <SelectTipoPiezaModelo
                      modeloId={modeloId}
                      size="xs"
                      sugerencia={op.sugerenciaTipo}
                      placeholder="Qué pieza se cambia"
                      value={tipoDe(op)}
                      onChange={(v) => setTipoPorNo((prev) => ({ ...prev, [op.no]: v }))}
                    />
                  </Group>
                ))}
              </Stack>
            )}

            {conNotasSinProgramar.length > 0 && (
              <Paper withBorder p="xs">
                <UnstyledButton onClick={() => setVerNotas((v) => !v)} w="100%">
                  <Group gap={6}>
                    {verNotas ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                    <Text size="sm">
                      {conNotasSinProgramar.length} renglón(es) traen reglas que el programa no
                      vence solo; quedan en sus notas
                    </Text>
                  </Group>
                </UnstyledButton>
                <Collapse expanded={verNotas}>
                  <Stack gap={4} mt="xs">
                    {conNotasSinProgramar.map((op) => (
                      <Text key={op.no} size="xs">
                        <b>{op.nombre}:</b> {op.sinProgramar.join(' ')}
                      </Text>
                    ))}
                  </Stack>
                </Collapse>
              </Paper>
            )}
          </>
        )}

        {importarMut.error && (
          <Alert color="red" title="No se pudo importar">{(importarMut.error as Error).message}</Alert>
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} disabled={importarMut.isPending}>Cancelar</Button>
          <Button
            leftSection={<IconUpload size={16} />}
            loading={importarMut.isPending}
            disabled={!listo}
            onClick={importar}
          >
            Importar
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
