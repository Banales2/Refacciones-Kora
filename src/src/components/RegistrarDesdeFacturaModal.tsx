// Registrar, desde un renglón sin casar de la factura de gasolina, la recarga
// que el chofer no reportó —y el vale, si el encargado tampoco lo registró—.
// Es el caso del ticket que llega a la oficina junto con el vale: la gasolinera
// ya está cobrando la carga y en el sistema no está.
//
// La gasolinera es la de la factura y no se pregunta. Litros, costo y producto
// arrancan con lo del renglón; se corrigen con el ticket en la mano. Al guardar,
// la recarga queda casada con el renglón y marcada para el reporte de
// omisiones (pestaña "Sin reportar"). Ver la migración 069.
import { useMemo, useState } from 'react'
import {
  Alert, Button, Group, Loader, Modal, NumberInput, Radio, SegmentedControl, Select,
  Stack, Text, TextInput,
} from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import { IconAlertTriangle } from '@tabler/icons-react'
import type { FacturaGasolina, RenglonFactura, Registrada } from '../hooks/useFacturasGasolina'
import { useRegistrarDesdeFactura } from '../hooks/useFacturasGasolina'
import { useValesGasolina, useCuentasVale } from '../hooks/useValesGasolina'
import { useConductores } from '../hooks/useConductores'
import { useVehiculo, useVehiculos } from '../hooks/useVehiculos'
import { useAuth } from '../hooks/useAuth'
import { useUsuarioActual } from '../hooks/useUsuarioActual'
import { useSucursales } from '../hooks/useSucursales'
import SelectCatalogo from './SelectCatalogo'
import { FechaInput } from './FechaInput'
import ConfirmarAvanceKm from './ConfirmarAvanceKm'
import { opcionVale, renderOpcionVale, filtrarVales } from './OpcionVale'
import { opcionVehiculo, renderOpcionVehiculo, sinFiltroLocal, vehiculoLabelCorto } from './OpcionVehiculo'
import { CODIGO, KM_MAX, limpiarCodigo, validarKm } from '../lib/validaciones'
import { GASOLINAS, esGasolina, familiaCombustible } from '../lib/combustible'
import { avanzaOdometro } from '../lib/odometro'
import { formatFecha, formatMXN } from '../lib/formato'

const FOLIO_MAX = 30

function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

type Modo = 'existente' | 'nuevo'
type VehiculoElegido = { id: number; label: string }

export default function RegistrarDesdeFacturaModal({
  factura, renglon, onClose, onRegistrada,
}: {
  factura: FacturaGasolina
  /** null = cerrado. */
  renglon: RenglonFactura | null
  onClose: () => void
  onRegistrada: (renglonId: number, r: Registrada) => void
}) {
  return (
    <Modal
      opened={renglon !== null}
      onClose={onClose}
      title="Registrar la recarga que no se reportó"
      size="lg"
      centered
    >
      {/* `key`: otro renglón empieza el formulario de cero. */}
      {renglon && (
        <Formulario
          key={renglon.id}
          factura={factura}
          renglon={renglon}
          onClose={onClose}
          onRegistrada={onRegistrada}
        />
      )}
    </Modal>
  )
}

function Formulario({
  factura, renglon, onClose, onRegistrada,
}: {
  factura: FacturaGasolina
  renglon: RenglonFactura
  onClose: () => void
  onRegistrada: (renglonId: number, r: Registrada) => void
}) {
  const hoy = todayIso()
  const registrar = useRegistrarDesdeFactura()
  const [modo, setModo] = useState<Modo>('existente')
  const [errores, setErrores] = useState<Record<string, string>>({})

  // ── El vale ──
  // Los que todavía se pueden gastar: sin usar o perdidos. Los cancelados no
  // llegan; si el papel apareció, primero se le quita la cancelación.
  const valesQuery = useValesGasolina()
  const valesLibres = useMemo(
    () => (valesQuery.data?.data ?? []).filter((v) => v.estado === 'creado' || v.estado === 'perdido'),
    [valesQuery.data],
  )
  const [valeId, setValeId] = useState<string | null>(null)
  const vale = valesLibres.find((v) => String(v.id) === valeId)

  // El vale que tampoco estaba registrado.
  const { user } = useAuth()
  const miCorreo = user?.userDetails ?? ''
  const cuentasQuery = useCuentasVale(modo === 'nuevo')
  const cuentas = useMemo(() => {
    const opts = (cuentasQuery.data?.data ?? [])
      .filter((c) => c.email.toLowerCase() !== miCorreo.toLowerCase())
      .map((c) => ({ value: c.email, label: c.nombre ? `${c.nombre} · ${c.email}` : c.email }))
    return miCorreo ? [{ value: miCorreo, label: `Yo · ${miCorreo}` }, ...opts] : opts
  }, [cuentasQuery.data, miCorreo])
  const [folio, setFolio] = useState('')
  const [encargado, setEncargado] = useState<string | null>(null)
  const [fechaVale, setFechaVale] = useState(factura.fecha.slice(0, 10))
  const usuarioQuery = useUsuarioActual()
  const eligeSucursal = !usuarioQuery.isLoading && (usuarioQuery.data?.data.sucursal_id ?? null) == null
  const sucQuery = useSucursales()
  const sucursales = (sucQuery.data?.data ?? []).map((s) => ({ value: String(s.id), label: s.nombre }))
  const [sucursalId, setSucursalId] = useState<string | null>(null)

  // ── Unidad y chofer ──
  // Con el vale registrado salen de él; sin él, se eligen.
  const [busqueda, setBusqueda] = useState('')
  const [debounced] = useDebouncedValue(busqueda, 300)
  const { data: vehData, isLoading: buscando } = useVehiculos(1, debounced, undefined, undefined, 20)
  const [elegido, setElegido] = useState<VehiculoElegido | null>(null)
  const vehiculoId = modo === 'existente' ? vale?.vehiculo_id : elegido?.id
  const vehQuery = useVehiculo(vehiculoId)
  const vehiculo = vehQuery.data?.data
  const opcionesVehiculo = useMemo(() => {
    const opts = (vehData?.data ?? []).map(opcionVehiculo)
    if (elegido && !opts.some((o) => o.value === String(elegido.id))) {
      opts.unshift({ value: String(elegido.id), label: elegido.label })
    }
    return opts
  }, [vehData, elegido])

  const conQuery = useConductores()
  const conductores = (conQuery.data?.data ?? []).map((c) => ({ value: String(c.id), label: c.nombre }))
  const [conductorId, setConductorId] = useState<string | null>(null)

  // ── La recarga ──
  const [fecha, setFecha] = useState(factura.fecha.slice(0, 10) > hoy ? hoy : factura.fecha.slice(0, 10))
  const [litros, setLitros] = useState<number | string>(renglon.cantidad)
  const [costo, setCosto] = useState<number | string>(renglon.importe_con_iva)
  const [km, setKm] = useState<number | string>('')
  const preguntaProducto = familiaCombustible(vehiculo?.combustible) === 'gasolina'
  const [producto, setProducto] = useState<string>(esGasolina(renglon.descripcion) ? renglon.descripcion : '')
  const [porConfirmarKm, setPorConfirmarKm] = useState(false)

  function elegirVale(id: string | null) {
    setValeId(id)
    const v = valesLibres.find((x) => String(x.id) === id)
    if (v) setConductorId(String(v.conductor_id))
  }

  function seleccionarVehiculo(id: string | null) {
    if (!id) { setElegido(null); return }
    if (elegido && String(elegido.id) === id) return
    const v = (vehData?.data ?? []).find((x) => String(x.id) === id)
    if (v) setElegido({ id: v.id, label: vehiculoLabelCorto(v) })
  }

  function validar(): Record<string, string> {
    const e: Record<string, string> = {}
    if (modo === 'existente') {
      if (!vale) e.vale = 'Elige el vale'
      else if (fecha && fecha < vale.fecha) e.fecha = `No puede ser anterior al vale (${formatFecha(vale.fecha)})`
    } else {
      if (!folio.trim()) e.folio = 'Folio requerido'
      else if (!CODIGO.test(folio)) e.folio = 'Solo mayúsculas, números y guiones'
      if (!elegido) e.vehiculo = 'Vehículo requerido'
      if (eligeSucursal && !sucursalId) e.sucursal = 'Sucursal requerida'
      if (!fechaVale) e.fechaVale = 'Fecha requerida'
      else if (fechaVale > hoy) e.fechaVale = 'No puede ser una fecha futura'
      else if (fecha && fecha < fechaVale) e.fecha = 'No puede ser anterior al vale'
    }
    if (!conductorId) e.conductor = 'Chofer requerido'
    if (!fecha) e.fecha = 'Fecha requerida'
    else if (fecha > hoy) e.fecha = 'No puede ser una fecha futura'
    if (litros === '' || Number(litros) <= 0) e.litros = 'Debe ser mayor a 0'
    if (costo === '' || Number(costo) < 0) e.costo = 'No puede ser negativo'
    if (km !== '') {
      const k = validarKm(km)
      if (k) e.km = k
    }
    if (preguntaProducto && !esGasolina(producto)) e.producto = 'Elige Magna o Premium'
    return e
  }

  function guardar(confirmadoKm = false) {
    const e = validar()
    setErrores(e)
    if (Object.keys(e).length > 0 || vehiculoId === undefined) return
    const kmNum = km === '' ? null : Number(km)
    if (!confirmadoKm && kmNum != null && avanzaOdometro(kmNum, vehiculo?.kilometraje ?? null)) {
      setPorConfirmarKm(true)
      return
    }
    setPorConfirmarKm(false)
    registrar.mutate(
      {
        factura_id: factura.id,
        renglon_id: renglon.id,
        ...(modo === 'existente'
          ? { vale_id: vale!.id }
          : {
              vale_nuevo: {
                folio: folio.trim(),
                fecha: fechaVale,
                ...(eligeSucursal && sucursalId ? { sucursal_id: Number(sucursalId) } : {}),
                ...(encargado && encargado !== miCorreo ? { creado_por: encargado } : {}),
              },
            }),
        vehiculo_id: vehiculoId,
        conductor_id: Number(conductorId),
        fecha,
        litros: Number(litros),
        costo: Number(costo),
        kilometraje: kmNum,
        ...(preguntaProducto && esGasolina(producto) ? { producto } : {}),
      },
      { onSuccess: (res) => onRegistrada(renglon.id, res.data) },
    )
  }

  const opcionesVale = valesLibres.map(opcionVale)

  return (
    <Stack gap="sm">
      <Text size="sm">
        Renglón de <b>{renglon.cantidad} L</b> por <b>{formatMXN(renglon.importe_con_iva)}</b>
        {renglon.descripcion ? ` (${renglon.descripcion})` : ''} en <b>{factura.gasolinera}</b>,
        factura {factura.folio} del {formatFecha(factura.fecha)}.
      </Text>

      <SegmentedControl
        fullWidth
        value={modo}
        onChange={(v) => { setModo(v as Modo); setErrores({}) }}
        data={[
          { value: 'existente', label: 'El vale sí está registrado' },
          { value: 'nuevo', label: 'El vale tampoco está registrado' },
        ]}
      />

      {modo === 'existente' ? (
        <>
          <SelectCatalogo
            estado={valesQuery}
            nombre="vales"
            label="Vale de gasolina"
            placeholder={opcionesVale.length ? 'Busca por folio, chofer o unidad' : 'No hay vales libres'}
            data={opcionesVale}
            renderOption={renderOpcionVale}
            filter={filtrarVales}
            required
            value={valeId}
            onChange={elegirVale}
            error={errores.vale}
          />
          <Text size="xs" c="dimmed">
            Se registra solo la recarga: queda señalada como no reportada por el chofer.
          </Text>
        </>
      ) : (
        <>
          <TextInput
            label="Folio del vale"
            placeholder="Número impreso en el vale"
            required
            value={folio}
            onChange={(e) => setFolio(limpiarCodigo(e.currentTarget.value, FOLIO_MAX))}
            error={errores.folio}
          />
          <Select
            label="Encargado que entregó el vale"
            description="El vale queda a su nombre y señalado como no registrado por él."
            data={cuentas}
            value={encargado ?? (miCorreo || null)}
            onChange={(v) => setEncargado(v ?? miCorreo)}
            allowDeselect={false}
            searchable
            nothingFoundMessage="Sin cuentas"
            disabled={cuentasQuery.isLoading}
          />
          {eligeSucursal && (
            <SelectCatalogo
              estado={sucQuery}
              nombre="sucursales"
              label="Sucursal del vale"
              placeholder="Selecciona la sucursal"
              data={sucursales}
              required
              value={sucursalId}
              onChange={setSucursalId}
              error={errores.sucursal}
            />
          )}
          <FechaInput
            label="Fecha del vale"
            required
            maxDate={hoy}
            value={fechaVale}
            onChange={setFechaVale}
            error={errores.fechaVale}
          />
          <Select
            label="Vehículo"
            placeholder="Busca por marca, modelo, serie o placas"
            data={opcionesVehiculo}
            searchable
            filter={sinFiltroLocal}
            renderOption={renderOpcionVehiculo}
            required
            value={elegido ? String(elegido.id) : null}
            onChange={seleccionarVehiculo}
            searchValue={busqueda}
            onSearchChange={setBusqueda}
            rightSection={buscando ? <Loader size="xs" /> : undefined}
            nothingFoundMessage={buscando ? 'Buscando…' : 'Sin resultados'}
            error={errores.vehiculo}
          />
        </>
      )}

      <SelectCatalogo
        estado={conQuery}
        nombre="choferes"
        label="Chofer que cargó"
        description={modo === 'existente' ? 'El del vale. Cámbialo si el papel lo cargó otro.' : undefined}
        placeholder="Selecciona el chofer"
        data={conductores}
        required
        value={conductorId}
        onChange={setConductorId}
        error={errores.conductor}
      />

      <FechaInput
        label="Fecha de la recarga"
        required
        maxDate={hoy}
        value={fecha}
        onChange={setFecha}
        error={errores.fecha}
      />
      {vehiculoId !== undefined && vehQuery.isLoading && <Loader size="xs" />}
      {preguntaProducto && (
        <Radio.Group label="¿Qué se cargó?" required value={producto} onChange={setProducto}
          error={errores.producto}>
          <Group gap="lg" mt={4}>
            {GASOLINAS.map((g) => <Radio key={g} value={g} label={g} />)}
          </Group>
        </Radio.Group>
      )}
      <Group grow align="flex-start">
        <NumberInput
          label="Litros" required min={0} decimalScale={3} step={0.001} suffix=" L"
          value={litros} onChange={setLitros} error={errores.litros}
        />
        <NumberInput
          label="Costo (del ticket)" required min={0} decimalScale={2} step={0.01}
          prefix="$" thousandSeparator=","
          value={costo} onChange={setCosto} error={errores.costo}
          description={renglon.iva_estimado ? 'El IVA del renglón es estimado: usa el del ticket.' : undefined}
        />
      </Group>
      <NumberInput
        decimalScale={1}
        label="Kilometraje (opcional)"
        placeholder="Si el ticket lo trae"
        min={0} max={KM_MAX} suffix=" km" thousandSeparator="," allowNegative={false} clampBehavior="strict"
        description={vehiculo?.kilometraje != null
          ? `Sin él no avanza el odómetro ni cuenta para el rendimiento. Actual: ${vehiculo.kilometraje.toLocaleString('es-MX')} km`
          : 'Sin él no avanza el odómetro ni cuenta para el rendimiento.'}
        value={km} onChange={setKm} error={errores.km}
      />

      {registrar.error && (
        <Alert color="red" title="No se pudo registrar" icon={<IconAlertTriangle size={16} />}>
          {(registrar.error as Error).message}
        </Alert>
      )}
      <Group justify="flex-end" mt="xs">
        <Button variant="default" onClick={onClose} disabled={registrar.isPending}>Volver</Button>
        <Button onClick={() => guardar()} loading={registrar.isPending}>
          {modo === 'nuevo' ? 'Registrar vale y recarga' : 'Registrar recarga'}
        </Button>
      </Group>

      <ConfirmarAvanceKm
        opened={porConfirmarKm}
        kmVehiculo={vehiculo?.kilometraje ?? null}
        kmNuevo={Number(km || 0)}
        isPending={registrar.isPending}
        onCancel={() => setPorConfirmarKm(false)}
        onConfirm={() => guardar(true)}
      />
    </Stack>
  )
}
