// Compra de varias refacciones en una sola captura: una factura arriba y tantos
// renglones como partidas traiga.
//
// Sustituye a los dos modales encadenados que había antes ("registrar compra" y
// "dar de alta refacción"), que obligaban a una factura por refacción. Una
// compra real es una factura con varias partidas, y capturarla renglón por
// renglón repitiendo proveedor, fecha y folio era donde se colaban los folios
// tecleados distinto que luego no cuadran contra el papel.
//
// En la base no hay tabla `compras`: cada renglón se guarda como su propio lote
// y lo que los junta es `num_factura`. Van en una sola llamada porque la API los
// mete en una transacción — media factura registrada es stock real que nadie
// sabe que está incompleto.
import { useState, useMemo } from 'react'
import {
  Modal, Stack, Group, Grid, Text, Alert, Button, Select, TextInput, Textarea,
  NumberInput, ActionIcon, Divider, Paper, Badge, Tooltip, Switch,
} from '@mantine/core'
import { useForm } from '@mantine/form'
import { IconPlus, IconTrash } from '@tabler/icons-react'
import { FechaInput } from './FechaInput'
import ProveedorForm from './ProveedorForm'
import TipoPiezaSelect from './TipoPiezaSelect'
import { formatMXN } from '../lib/formato'
import { IVA_DEFAULT, importeIva } from '../lib/iva'
import {
  TEXTO_SIMPLE, TEXTO_LIBRE, FOLIO,
  limpiarTextoSimple, limpiarTextoLibre, limpiarFolio, normalizarFolio,
} from '../lib/validaciones'
import { useProveedores, useCreateProveedor } from '../hooks/useProveedores'
import { useSucursales } from '../hooks/useSucursales'
import { useUsuarioActual } from '../hooks/useUsuarioActual'
import { useTodasLasPiezas } from '../hooks/useRefacciones'
import { useCreateCompra } from '../hooks/useCompras'
import type { CompraLote, CompraRenglonPayload } from '../hooks/useCompras'

type RenglonValues = {
  /** Del catálogo o dada de alta aquí mismo. Decide qué campos se piden. */
  nueva:            boolean
  pieza_id:         string
  numero_serie:     string
  descripcion:      string
  tipo_pieza_id:    string
  cantidad_inicial: number | string
  costo_unitario:   number | string
}

type CompraFormValues = {
  proveedor_id: string
  sucursal_id:  string
  fecha_compra: string
  num_factura:  string
  // Apagado —el caso normal— significa que los precios capturados ya traen IVA
  // y no hay nada que sumarles. Encendido, la tasa se guarda en cada lote de la
  // factura y el importe se calcula al mostrarlo, nunca se guarda.
  sumar_iva:    boolean
  tasa_iva:     number | string
  comprado_por: string
  renglones:    RenglonValues[]
}

const RENGLON_VACIO: Omit<RenglonValues, 'nueva'> = {
  pieza_id: '', numero_serie: '', descripcion: '', tipo_pieza_id: '',
  cantidad_inicial: 1, costo_unitario: '',
}

function hoyIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** El renglón al que pertenece el campo que se está validando ("renglones.2.x"). */
function renglonDe(vals: CompraFormValues, path: string): RenglonValues | undefined {
  return vals.renglones[Number(path.split('.')[1])]
}

export default function CompraModal({
  opened, onClose, onCreated,
}: {
  opened:  boolean
  onClose: () => void
  /** Los lotes recién creados, ya con forma de opción del selector de refacciones. */
  onCreated: (lotes: CompraLote[]) => void
}) {
  const hoy = hoyIso()

  const { data: sucData }    = useSucursales()
  const { data: provData }   = useProveedores()
  const { data: piezasData } = useTodasLasPiezas(opened)
  const { data: usuario }    = useUsuarioActual()

  const crearCompraMut = useCreateCompra()
  const crearProvMut   = useCreateProveedor()
  const [nuevoProvOpen, setNuevoProvOpen] = useState(false)

  const sucursales = (sucData?.data ?? []).map((s) => ({ value: String(s.id), label: s.nombre }))
  const proveedores = (provData?.data ?? []).map((p) => ({ value: String(p.id), label: p.nombre }))
  const piezas = useMemo(() => piezasData?.data ?? [], [piezasData])
  const piezaOptions = useMemo(
    () => piezas.map((p) => ({ value: String(p.id), label: `${p.numero_serie} — ${p.descripcion}` })),
    [piezas],
  )

  const form = useForm<CompraFormValues>({
    initialValues: {
      proveedor_id: '', sucursal_id: '', fecha_compra: '', num_factura: '', comprado_por: '',
      sumar_iva: false, tasa_iva: IVA_DEFAULT,
      renglones: [{ nueva: false, ...RENGLON_VACIO }],
    },
    validate: {
      proveedor_id: (v) => (!v ? 'Proveedor requerido' : null),
      sucursal_id:  (v) => (!v ? 'Sucursal requerida' : null),
      fecha_compra: (v) =>
        !v ? 'Fecha requerida' :
        v > hoy ? 'No puede ser una fecha futura' : null,
      // Se valida sobre el folio ya normalizado, que es lo que se manda y lo
      // que acaba en la base.
      num_factura: (v) => {
        const folio = normalizarFolio(v)
        if (!folio) return 'No. factura requerido'
        if (folio.length > 30) return 'Máximo 30 caracteres'
        if (!FOLIO.test(folio)) return 'Solo letras, números, espacios, guiones y diagonales'
        return null
      },
      comprado_por: (v) =>
        !v.trim() ? 'Requerido' :
        v.trim().length > 120 ? 'Máximo 120 caracteres' :
        !TEXTO_SIMPLE.test(v.trim()) ? 'Solo letras, números, espacios y guiones' : null,
      // Solo cuenta con la casilla encendida: apagada, el campo ni se muestra.
      tasa_iva: (v, vals) => {
        if (!vals.sumar_iva) return null
        if (v === '' || Number(v) <= 0) return 'La tasa debe ser mayor a 0'
        if (Number(v) > 100) return 'La tasa no puede pasar de 100%'
        return null
      },
      renglones: {
        pieza_id: (v, vals, path) =>
          renglonDe(vals, path)?.nueva ? null : (!v ? 'Selecciona la refacción' : null),
        numero_serie: (v, vals, path) => {
          const r = renglonDe(vals, path)
          if (!r?.nueva) return null
          if (!v.trim()) return 'Requerido'
          if (v.length > 20) return 'Máximo 20 caracteres'
          if (!/^[A-Z0-9-]+$/.test(v)) return 'Solo mayúsculas, números y guiones'
          // Dos renglones dando de alta la misma serie chocarían en la base; el
          // aviso aquí evita el viaje y señala cuál es el repetido.
          const repetida = vals.renglones.filter(
            (o) => o.nueva && o.numero_serie.trim().toUpperCase() === v.trim().toUpperCase()
          ).length > 1
          if (repetida) return 'Esta serie se repite en la factura'
          const enCatalogo = piezas.some((p) => p.numero_serie.toUpperCase() === v.trim().toUpperCase())
          if (enCatalogo) return 'Ya existe: elígela del catálogo'
          return null
        },
        descripcion: (v, vals, path) => {
          if (!renglonDe(vals, path)?.nueva) return null
          if (v.trim().length < 3) return 'Mínimo 3 caracteres'
          if (v.length > 255) return 'Máximo 255 caracteres'
          if (!TEXTO_LIBRE.test(v.trim())) return 'Contiene caracteres no permitidos'
          return null
        },
        tipo_pieza_id: (v, vals, path) =>
          renglonDe(vals, path)?.nueva && !v ? 'Requerido' : null,
        cantidad_inicial: (v) => {
          if (v === '' || !Number.isInteger(Number(v)) || Number(v) < 1) return 'Mínimo 1 unidad entera'
          if (Number(v) > 999) return 'Máximo 999 unidades'
          return null
        },
        costo_unitario: (v) => {
          if (v === '' || Number(v) <= 0) return 'Debe ser mayor a 0'
          if (Number(v) > 200000) return 'Máximo $200,000'
          return null
        },
      },
    },
  })

  const renglones = form.values.renglones
  const subtotal = renglones.reduce(
    (s, r) => s + (Number(r.cantidad_inicial) || 0) * (Number(r.costo_unitario) || 0), 0
  )
  // El IVA se suma una sola vez, al total: los renglones se capturan como
  // vienen en la factura y ninguno se toca.
  const tasa = form.values.sumar_iva ? Number(form.values.tasa_iva) || 0 : null
  const iva = importeIva(subtotal, tasa)
  const total = subtotal + iva

  // Solo informativo: el valor real lo pone la API con la cuenta de la sesión.
  const autoriza = usuario?.data.nombre ?? ''

  function cerrar() {
    form.reset()
    crearCompraMut.reset()
    onClose()
  }

  function agregar(nueva: boolean) {
    form.insertListItem('renglones', { nueva, ...RENGLON_VACIO })
  }

  function handleSubmit(vals: CompraFormValues) {
    const payload: CompraRenglonPayload[] = vals.renglones.map((r) => ({
      ...(r.nueva
        ? {
          pieza_nueva: {
            numero_serie:  r.numero_serie.trim(),
            descripcion:   r.descripcion.trim(),
            tipo_pieza_id: Number(r.tipo_pieza_id),
          },
        }
        : { pieza_id: Number(r.pieza_id) }),
      cantidad_inicial: Number(r.cantidad_inicial),
      costo_unitario:   Number(r.costo_unitario),
    }))

    crearCompraMut.mutate(
      {
        proveedor_id: Number(vals.proveedor_id),
        sucursal_id:  Number(vals.sucursal_id),
        fecha_compra: vals.fecha_compra,
        num_factura:  normalizarFolio(vals.num_factura),
        // Sin la casilla no se guarda tasa: el precio ya la trae dentro.
        tasa_iva:     vals.sumar_iva ? Number(vals.tasa_iva) : null,
        comprado_por: vals.comprado_por.trim(),
        renglones:    payload,
      },
      {
        onSuccess: ({ data }) => {
          // Se entregan armados para el selector: la lista de lotes disponibles
          // se acaba de invalidar y aún no trae los nuevos.
          onCreated(data.lotes)
          cerrar()
        },
      },
    )
  }

  return (
    <>
      <Modal
        opened={opened}
        onClose={cerrar}
        title="Registrar una compra de refacciones"
        centered
        size="xl"
        closeOnClickOutside={false}
        zIndex={300}
      >
        <form onSubmit={form.onSubmit(handleSubmit)}>
          <Stack gap="sm">
            <Text size="sm" c="dimmed">
              Una factura con todas las refacciones que traiga. Entran completas a la
              sucursal que las recibe y quedan disponibles para este mantenimiento.
            </Text>

            <Grid>
              <Grid.Col span={6}>
                <Select
                  label="Proveedor" required
                  placeholder="Selecciona un proveedor"
                  data={proveedores}
                  searchable
                  nothingFoundMessage="Sin proveedores: da de alta uno nuevo"
                  {...form.getInputProps('proveedor_id')}
                />
                <Button
                  variant="subtle" size="compact-xs" mt={4} leftSection={<IconPlus size={12} />}
                  onClick={() => { crearProvMut.reset(); setNuevoProvOpen(true) }}
                >
                  Nuevo proveedor
                </Button>
              </Grid.Col>
              <Grid.Col span={6}>
                <Select
                  label="Sucursal que recibe" required
                  description="Toda la factura entra aquí. Para repartirla, haz un traspaso desde Inventario."
                  placeholder="Selecciona la sucursal"
                  data={sucursales}
                  searchable
                  nothingFoundMessage="Sin sucursales dadas de alta"
                  {...form.getInputProps('sucursal_id')}
                />
              </Grid.Col>
              <Grid.Col span={4}>
                <FechaInput
                  label="Fecha de compra" required
                  maxDate={hoy}
                  value={form.values.fecha_compra}
                  onChange={(d) => form.setFieldValue('fecha_compra', d)}
                  error={form.errors.fecha_compra as string}
                />
              </Grid.Col>
              <Grid.Col span={4}>
                <TextInput
                  label="No. factura" required
                  placeholder="Ej. A-12345, A-123/2026 o FAC 1234"
                  maxLength={30}
                  spellCheck={false}
                  {...form.getInputProps('num_factura')}
                  onChange={(e) => form.setFieldValue('num_factura', limpiarFolio(e.currentTarget.value, 30))}
                />
              </Grid.Col>
              <Grid.Col span={4}>
                <TextInput
                  label="Comprado por" required
                  placeholder="Quién hizo la compra"
                  maxLength={120}
                  {...form.getInputProps('comprado_por')}
                  onChange={(e) =>
                    form.setFieldValue('comprado_por', limpiarTextoSimple(e.currentTarget.value, 120))
                  }
                />
              </Grid.Col>
            </Grid>

            <Divider
              label={<Text size="sm" fw={500}>Refacciones de esta factura ({renglones.length})</Text>}
              labelPosition="left"
            />

            <Stack gap="xs">
              {renglones.map((r, idx) => (
                <Paper key={idx} withBorder p="xs" radius="sm">
                  <Group justify="space-between" mb={6} wrap="nowrap">
                    <Group gap={6}>
                      <Text size="xs" c="dimmed" fw={600}>#{idx + 1}</Text>
                      {r.nueva && (
                        <Badge size="xs" variant="light" color="teal">Refacción nueva</Badge>
                      )}
                    </Group>
                    {/* La factura necesita al menos un renglón: el último no se
                        quita, se cambia. */}
                    <Tooltip
                      label={renglones.length === 1
                        ? 'La factura necesita al menos una refacción'
                        : 'Quitar este renglón'}
                    >
                      <ActionIcon
                        variant="subtle" color="red" size="sm"
                        aria-label={`Quitar renglón ${idx + 1}`}
                        disabled={renglones.length === 1}
                        onClick={() => form.removeListItem('renglones', idx)}
                      >
                        <IconTrash size={14} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>

                  {r.nueva ? (
                    <Grid gap="xs">
                      <Grid.Col span={3}>
                        <TextInput
                          label="No. serie" size="xs" required
                          placeholder="EJ-001"
                          maxLength={20}
                          spellCheck={false}
                          styles={{ input: { textTransform: 'uppercase' } }}
                          {...form.getInputProps(`renglones.${idx}.numero_serie`)}
                          onChange={(e) =>
                            // Allowlist: solo mayúsculas, números y guiones
                            form.setFieldValue(
                              `renglones.${idx}.numero_serie`,
                              e.currentTarget.value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 20),
                            )
                          }
                        />
                      </Grid.Col>
                      <Grid.Col span={5}>
                        <Textarea
                          label="Descripción" size="xs" required
                          placeholder="Descripción de la refacción"
                          autosize minRows={1} maxRows={3}
                          maxLength={255}
                          {...form.getInputProps(`renglones.${idx}.descripcion`)}
                          onChange={(e) =>
                            form.setFieldValue(
                              `renglones.${idx}.descripcion`,
                              limpiarTextoLibre(e.currentTarget.value, 255),
                            )
                          }
                        />
                      </Grid.Col>
                      <Grid.Col span={4}>
                        <TipoPiezaSelect
                          label="Tipo de pieza"
                          size="xs"
                          value={r.tipo_pieza_id}
                          onChange={(v) => form.setFieldValue(`renglones.${idx}.tipo_pieza_id`, v)}
                          error={form.errors[`renglones.${idx}.tipo_pieza_id`] as string}
                        />
                      </Grid.Col>
                    </Grid>
                  ) : (
                    <Select
                      label="Refacción" size="xs" required
                      placeholder="Busca por serie o descripción"
                      data={piezaOptions}
                      searchable
                      nothingFoundMessage='Sin coincidencias: agrégala con "Dar de alta una nueva"'
                      value={r.pieza_id || null}
                      onChange={(v) => form.setFieldValue(`renglones.${idx}.pieza_id`, v ?? '')}
                      error={form.errors[`renglones.${idx}.pieza_id`] as string}
                    />
                  )}

                  <Grid gap="xs" mt={6} align="flex-end">
                    <Grid.Col span={3}>
                      <NumberInput
                        label="Cantidad" size="xs" required
                        placeholder="0"
                        min={1} max={999} clampBehavior="strict" allowDecimal={false}
                        {...form.getInputProps(`renglones.${idx}.cantidad_inicial`)}
                      />
                    </Grid.Col>
                    <Grid.Col span={4}>
                      <NumberInput
                        label="Costo unitario" size="xs" required
                        placeholder="0.00"
                        min={0.01} max={200000} clampBehavior="strict"
                        decimalScale={2} thousandSeparator="," prefix="$"
                        {...form.getInputProps(`renglones.${idx}.costo_unitario`)}
                      />
                    </Grid.Col>
                    <Grid.Col span={5}>
                      <Text size="xs" c="dimmed" ta="right">
                        Subtotal{' '}
                        <Text component="span" fw={600} c="var(--mantine-color-text)">
                          {formatMXN((Number(r.cantidad_inicial) || 0) * (Number(r.costo_unitario) || 0))}
                        </Text>
                      </Text>
                    </Grid.Col>
                  </Grid>
                </Paper>
              ))}
            </Stack>

            <Group justify="space-between">
              <Group gap={6}>
                <Button
                  variant="light" size="xs" leftSection={<IconPlus size={14} />}
                  onClick={() => agregar(false)}
                >
                  Del catálogo
                </Button>
                <Tooltip label="La refacción todavía no existe: se da de alta con este renglón">
                  <Button
                    variant="subtle" size="xs" leftSection={<IconPlus size={14} />}
                    onClick={() => agregar(true)}
                  >
                    Dar de alta una nueva
                  </Button>
                </Tooltip>
              </Group>
              <Stack gap={2} align="flex-end">
                {tasa !== null && (
                  <>
                    <Text size="xs" c="dimmed">
                      Subtotal <Text component="span" fw={600}>{formatMXN(subtotal)}</Text>
                    </Text>
                    <Text size="xs" c="dimmed">
                      IVA ({tasa}%) <Text component="span" fw={600}>{formatMXN(iva)}</Text>
                    </Text>
                  </>
                )}
                <Text size="sm" c="dimmed">
                  Total factura: <Text component="span" fw={700}>{formatMXN(total)}</Text>
                </Text>
              </Stack>
            </Group>

            {/* El IVA es de la factura, no del renglón: se suma una sola vez al
                total y los precios de arriba se quedan como vienen en el papel.
                Apagado —el caso normal— significa que el precio capturado ya lo
                incluye, así que no hay nada que sumar y nada que guardar. */}
            <Group gap="md" align="flex-start" wrap="nowrap">
              <Switch
                label="Sumar IVA al total"
                description="Actívalo si los precios capturados son el subtotal. Apagado, se toman como precio final."
                checked={form.values.sumar_iva}
                onChange={(e) => form.setFieldValue('sumar_iva', e.currentTarget.checked)}
              />
              {form.values.sumar_iva && (
                <NumberInput
                  label="Tasa" size="xs" w={110}
                  min={0.01} max={100} clampBehavior="strict"
                  decimalScale={2} suffix="%"
                  {...form.getInputProps('tasa_iva')}
                />
              )}
            </Group>

            <TextInput
              label="Autorizado por"
              value={autoriza}
              disabled
              description="Se registra automáticamente con tu cuenta: registrarla es autorizarla"
            />

            {crearCompraMut.error && (
              <Alert color="red" title="Error">{(crearCompraMut.error as Error).message}</Alert>
            )}

            <Group justify="flex-end" mt="xs">
              <Button variant="default" onClick={cerrar} disabled={crearCompraMut.isPending}>
                Cancelar
              </Button>
              <Button type="submit" loading={crearCompraMut.isPending}>
                Registrar compra
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      {/* Modal encadenado: nuevo proveedor. Al crearlo queda seleccionado. */}
      <Modal
        opened={nuevoProvOpen}
        onClose={() => setNuevoProvOpen(false)}
        title="Nuevo proveedor"
        centered
        size="sm"
        zIndex={400}
      >
        <ProveedorForm
          isPending={crearProvMut.isPending}
          error={crearProvMut.error ? (crearProvMut.error as Error).message : null}
          onSubmit={(payload) =>
            crearProvMut.mutate(payload, {
              onSuccess: ({ data: prov }) => {
                form.setFieldValue('proveedor_id', String(prov.id))
                setNuevoProvOpen(false)
              },
            })
          }
          onCancel={() => setNuevoProvOpen(false)}
        />
      </Modal>
    </>
  )
}
