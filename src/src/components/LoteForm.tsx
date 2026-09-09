// Formulario de alta/edición de un lote de compra. Vive aparte del drawer de
// lotes porque también se abre encadenado desde el alta de una refacción.
// Desde aquí se puede dar de alta un proveedor sin salir del formulario: al
// crearlo queda seleccionado.
import { useState } from 'react'
import {
  Stack, Group, Alert, Button, Modal, TextInput, NumberInput, Select, Switch, Text,
} from '@mantine/core'
import { useForm } from '@mantine/form'
import { IconPlus } from '@tabler/icons-react'
import { useProveedores, useCreateProveedor } from '../hooks/useProveedores'
import { useSucursales } from '../hooks/useSucursales'
import { useUsuarioActual } from '../hooks/useUsuarioActual'
import { TEXTO_SIMPLE, limpiarTextoSimple } from '../lib/validaciones'
import { formatMXN } from '../lib/formato'
import { IVA_DEFAULT, importeIva } from '../lib/iva'
import { FechaInput } from './FechaInput'
import ProveedorForm from './ProveedorForm'

export type LoteFormValues = {
  proveedor_id: string
  // Sucursal que recibe la compra: el lote entra completo ahí. Solo se captura
  // al dar de alta; después, mover piezas a otra sucursal es un traspaso, no
  // una corrección del lote.
  sucursal_id: string
  fecha_compra: string
  costo_unitario: number | string
  cantidad_inicial: number | string
  num_factura: string
  // Apagado —el caso normal— significa que el precio capturado ya trae IVA y no
  // hay nada que sumarle; encendido, la tasa se guarda en el lote y el importe
  // se calcula al mostrarlo. Ver `lib/iva` y la migración 020.
  sumar_iva: boolean
  tasa_iva: number | string
  comprado_por: string
}

function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function LoteForm({
  initial,
  autorizadoPor,
  isPending,
  error,
  onSubmit,
  onCancel,
}: {
  initial?: LoteFormValues
  /** Sólo al editar: quien autorizó la compra en su momento. */
  autorizadoPor?: string
  isPending: boolean
  error: string | null
  onSubmit: (v: LoteFormValues) => void
  onCancel: () => void
}) {
  const hoy = todayIso()
  const esEdicion = initial !== undefined
  const { data: sucData } = useSucursales()
  const sucursales = (sucData?.data ?? []).map((s) => ({ value: String(s.id), label: s.nombre }))
  const { data: provData } = useProveedores()
  const proveedores = (provData?.data ?? []).map((p) => ({
    value: String(p.id),
    label: p.nombre,
  }))

  // Alta de proveedor sin salir del formulario del lote.
  const [nuevoProvOpen, setNuevoProvOpen] = useState(false)
  const crearProvMut = useCreateProveedor()

  // Sólo informativo: el valor real lo pone la API con la cuenta de la sesión.
  // Al editar se muestra el autorizador original, que no cambia.
  const { data: usuario } = useUsuarioActual()
  const autoriza = autorizadoPor ?? usuario?.data.nombre ?? ''

  const form = useForm<LoteFormValues>({
    initialValues: initial ?? {
      proveedor_id: '',
      sucursal_id: '',
      fecha_compra: '',
      costo_unitario: '',
      cantidad_inicial: '',
      num_factura: '',
      sumar_iva: false,
      tasa_iva: IVA_DEFAULT,
      comprado_por: '',
    },
    validate: {
      proveedor_id: (v) => (!v ? 'Proveedor requerido' : null),
      // Al editar no se pide: la sucursal de recepción ya no cambia.
      sucursal_id: (v) => (!esEdicion && !v ? 'Sucursal requerida' : null),
      fecha_compra: (v) => {
        if (!v) return 'Fecha requerida'
        if (v > hoy) return 'No puede ser una fecha futura'
        return null
      },
      costo_unitario: (v) => {
        if (v === '' || Number(v) <= 0) return 'Debe ser mayor a 0'
        if (Number(v) > 200000) return 'No puede ser mayor a $200,000'
        return null
      },
      cantidad_inicial: (v) => {
        if (v === '' || !Number.isInteger(Number(v)) || Number(v) < 1)
          return 'Mínimo 1 unidad entera'
        if (Number(v) > 999) return 'Máximo 999 unidades'
        return null
      },
      num_factura: (v) => {
        if (!v.trim()) return 'No. factura requerido'
        if (v.trim().length > 30) return 'Máximo 30 caracteres'
        if (!/^[A-Za-z0-9/-]+$/.test(v.trim())) return 'Solo letras, números, guiones y diagonales'
        return null
      },
      // Solo cuenta con la casilla encendida: apagada, el campo ni se muestra.
      tasa_iva: (v, vals) => {
        if (!vals.sumar_iva) return null
        if (v === '' || Number(v) <= 0) return 'La tasa debe ser mayor a 0'
        if (Number(v) > 100) return 'La tasa no puede pasar de 100%'
        return null
      },
      comprado_por: (v) => {
        if (!v.trim()) return 'Requerido'
        if (v.trim().length > 120) return 'Máximo 120 caracteres'
        if (!TEXTO_SIMPLE.test(v.trim())) return 'Solo letras, números, espacios y guiones'
        return null
      },
    },
  })

  const subtotalLote =
    (Number(form.values.cantidad_inicial) || 0) * (Number(form.values.costo_unitario) || 0)
  const ivaLote = importeIva(
    subtotalLote, form.values.sumar_iva ? Number(form.values.tasa_iva) || 0 : null
  )

  return (
    <>
      <form onSubmit={form.onSubmit(onSubmit)}>
        <Stack gap="sm">
          <Stack gap={4}>
            <Select
              label="Proveedor"
              placeholder="Selecciona un proveedor"
              data={proveedores}
              searchable
              required
              nothingFoundMessage="Sin proveedores: da de alta uno nuevo"
              {...form.getInputProps('proveedor_id')}
            />
            <Group justify="flex-start">
              <Button
                variant="subtle" size="compact-xs" leftSection={<IconPlus size={12} />}
                onClick={() => { crearProvMut.reset(); setNuevoProvOpen(true) }}
              >
                Nuevo proveedor
              </Button>
            </Group>
          </Stack>
          {!esEdicion && (
            <Select
              label="Sucursal que recibe"
              description="El lote entra completo aquí. Para repartirlo, haz un traspaso desde Inventario."
              placeholder="Selecciona la sucursal"
              data={sucursales}
              searchable
              required
              nothingFoundMessage="Sin sucursales dadas de alta"
              {...form.getInputProps('sucursal_id')}
            />
          )}
          <FechaInput
            label="Fecha de compra"
            required
            maxDate={hoy}
            value={form.values.fecha_compra}
            onChange={(d) => form.setFieldValue('fecha_compra', d)}
            error={form.errors.fecha_compra as string}
          />
          <NumberInput
            label="Costo unitario"
            placeholder="0.00"
            min={0.01}
            max={200000}
            clampBehavior="strict"
            decimalScale={2}
            thousandSeparator=","
            prefix="$"
            required
            {...form.getInputProps('costo_unitario')}
          />
          <NumberInput
            label="Cantidad inicial"
            placeholder="0"
            min={1}
            max={999}
            clampBehavior="strict"
            allowDecimal={false}
            required
            {...form.getInputProps('cantidad_inicial')}
          />
          <TextInput
            label="No. factura"
            placeholder="Ej. A-12345 o A-123/2026"
            maxLength={30}
            required
            spellCheck={false}
            {...form.getInputProps('num_factura')}
            onChange={(e) =>
              // Allowlist: solo letras, números, guiones y diagonales
              form.setFieldValue('num_factura', e.currentTarget.value.replace(/[^A-Za-z0-9/-]/g, ''))
            }
          />
          {/* El IVA se suma una sola vez, al total del lote: `costo_unitario`
              se guarda como viene en la factura. Apagado —el caso normal—
              significa que ese precio ya lo incluye. */}
          <Group gap="md" align="flex-start" wrap="nowrap">
            <Switch
              label="Sumar IVA al total"
              description="Actívalo si el costo capturado es el subtotal. Apagado, se toma como precio final."
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
          {form.values.sumar_iva && (
            <Text size="xs" c="dimmed" ta="right">
              Subtotal {formatMXN(subtotalLote)} · IVA {formatMXN(ivaLote)} ·{' '}
              <Text component="span" fw={700}>Total {formatMXN(subtotalLote + ivaLote)}</Text>
            </Text>
          )}
          <TextInput
            label="Comprado por"
            placeholder="Quién hizo la compra"
            description="El empleado que realizó la compra"
            maxLength={120}
            required
            {...form.getInputProps('comprado_por')}
            onChange={(e) =>
              form.setFieldValue('comprado_por', limpiarTextoSimple(e.currentTarget.value, 120))
            }
          />
          <TextInput
            label="Autorizado por"
            value={autoriza}
            disabled
            description={autorizadoPor
              ? 'Quien registró la compra; no cambia al editarla'
              : 'Se registra automáticamente con tu cuenta: registrarla es autorizarla'}
          />
          {error && (
            <Alert color="red" title="Error">{error}</Alert>
          )}
          <Group justify="flex-end" mt="xs">
            <Button variant="default" onClick={onCancel} disabled={isPending}>
              Cancelar
            </Button>
            <Button type="submit" loading={isPending}>
              Guardar
            </Button>
          </Group>
        </Stack>
      </form>

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

export default LoteForm
