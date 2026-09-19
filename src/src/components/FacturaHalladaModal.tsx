// Dar de alta la factura que nadie había capturado.
//
// Es el hueco que el cuadre por sí solo no puede cerrar. La revisión caza lo que
// falta DENTRO de una factura conocida, pero una factura que nunca se capturó no
// existe como fila: no sale en el listado, no entra a la bandeja y no tiene
// cuadre que abrir.
//
// NO HAY FORMA DE DETECTARLA SOLA, y conviene tenerlo claro: no existe ningún
// dato en el sistema que pueda notar la ausencia de algo que nunca se capturó.
// El único detector es la persona con el fajo de papeles. Esto es donde lo
// registra cuando lo encuentra.
//
// Solo la cabecera. Nace sin renglones a propósito: al abrir su cuadre, todo lo
// que se transcriba del papel sale como "falta capturar", que es la verdad.
//
// Ver `db/migrations/045_factura_hallada_en_revision.sql`.
import { useState } from 'react'
import {
  Alert, Button, Group, Modal, NumberInput, Stack, Switch, Text, TextInput,
} from '@mantine/core'
import { useCrearFacturaHallada } from '../hooks/useCuadreFactura'
import { useProveedores } from '../hooks/useProveedores'
import { SelectCatalogo } from './SelectCatalogo'
import { FechaInput } from './FechaInput'
import { IVA_DEFAULT, DESCUENTO_DEFAULT } from '../lib/totales'
import { limpiarFolio, normalizarFolio } from '../lib/validaciones'

export default function FacturaHalladaModal({
  abierto, onClose, onCreada,
}: {
  abierto:  boolean
  onClose:  () => void
  /** Se llama con el id recién creado, para abrir su cuadre de inmediato. */
  onCreada: (id: number, folio: string) => void
}) {
  const proveedores = useProveedores()
  const [proveedorId, setProveedorId] = useState<string | null>(null)
  const [folio, setFolio] = useState('')
  const [fecha, setFecha] = useState('')
  const [compradoPor, setCompradoPor] = useState('')
  const [conIva, setConIva] = useState(true)
  const [tasa, setTasa] = useState<number | string>(IVA_DEFAULT)
  const [conDesc, setConDesc] = useState(false)
  const [desc, setDesc] = useState<number | string>(DESCUENTO_DEFAULT)
  const mut = useCrearFacturaHallada()

  const folioNuevo = normalizarFolio(folio)
  const invalido = !proveedorId || folioNuevo === '' || !fecha || compradoPor.trim() === ''
    || (conIva && !(Number(tasa) > 0 && Number(tasa) <= 100))
    || (conDesc && !(Number(desc) > 0 && Number(desc) < 100))

  function limpiar() {
    setProveedorId(null); setFolio(''); setFecha(''); setCompradoPor('')
    setConIva(true); setTasa(IVA_DEFAULT); setConDesc(false); setDesc(DESCUENTO_DEFAULT)
  }

  function guardar() {
    mut.mutate(
      {
        proveedor_id: Number(proveedorId),
        num_factura: folioNuevo,
        fecha_compra: fecha,
        tasa_iva: conIva ? Number(tasa) : null,
        descuento_pct: conDesc ? Number(desc) : null,
        comprado_por: compradoPor.trim(),
      },
      {
        onSuccess: (r) => {
          const id = r.data.id
          limpiar()
          onClose()
          // Directo al cuadre: la cabecera sola no sirve de nada, lo que hace
          // falta es transcribir el papel y registrar sus renglones.
          onCreada(id, folioNuevo)
        },
      },
    )
  }

  return (
    <Modal
      opened={abierto}
      onClose={onClose}
      title={<Text fw={700}>Factura que no está en el sistema</Text>}
    >
      <Stack gap="sm">
        <Alert color="orange" variant="light">
          <Text size="sm">
            Para el papel que tienes en la mano y que nadie capturó. Se da de alta
            la cabecera y enseguida se transcriben sus renglones: cada uno va a
            salir como <b>falta capturar</b>, y desde ahí se registra su compra.
          </Text>
        </Alert>

        <SelectCatalogo
          label="Proveedor" nombre="proveedores" estado={proveedores}
          data={(proveedores.data?.data ?? []).map((p) => ({
            value: String(p.id), label: p.nombre,
          }))}
          value={proveedorId} onChange={setProveedorId}
        />

        <Group grow align="flex-start">
          <TextInput
            label="Folio" maxLength={30}
            value={folio}
            onChange={(e) => {
              setFolio(limpiarFolio(e.currentTarget.value, 30))
              if (mut.error) mut.reset()
            }}
          />
          <FechaInput label="Fecha de la factura" value={fecha} onChange={setFecha} />
        </Group>

        <TextInput
          label="Quién hizo la compra"
          description="Según el papel. Quien la registra aquí queda aparte."
          maxLength={120}
          value={compradoPor}
          onChange={(e) => setCompradoPor(e.currentTarget.value)}
        />

        <Group grow align="flex-start">
          <Stack gap={4}>
            <Switch
              size="xs" label="Hay que sumarle IVA" checked={conIva}
              onChange={(e) => setConIva(e.currentTarget.checked)}
            />
            {conIva && (
              <NumberInput
                size="xs" min={0.01} max={100} decimalScale={2} suffix="%"
                value={tasa} onChange={setTasa}
              />
            )}
          </Stack>
          <Stack gap={4}>
            <Switch
              size="xs" label="Trae descuento" checked={conDesc}
              onChange={(e) => setConDesc(e.currentTarget.checked)}
            />
            {conDesc && (
              <NumberInput
                size="xs" min={0.01} max={99.99} decimalScale={2} suffix="%"
                value={desc} onChange={setDesc}
              />
            )}
          </Stack>
        </Group>

        {mut.error && (
          <Alert color="red" title="No se pudo dar de alta">
            {(mut.error as Error).message}
          </Alert>
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Cancelar</Button>
          <Button color="orange" disabled={invalido} loading={mut.isPending} onClick={guardar}>
            Dar de alta y cuadrar
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
