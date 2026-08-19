// Selector del periodo que cubre un reporte.
//
// Son dos decisiones encadenadas y no una: primero *de qué tipo* es el corte
// (una ventana móvil, un año, unas fechas), y solo si es lo último aparecen los
// dos campos de fecha. Ponerlos siempre visibles hacía que la mayoría de la
// gente los llenara de más "por si acaso", cuando lo que quería era el mes.
//
// Lo usan el modal de reportes del tablero, el historial de mantenimientos y el
// expediente de una unidad, así que las opciones se nombran igual en los tres.
import { Group, Select, Stack, Text } from '@mantine/core'
import { FechaInput } from './FechaInput'
import { hoyIso } from '../lib/fechas'
import {
  type Periodo, aniosDisponibles, etiquetaPeriodo, periodoValido,
} from '../lib/reportes/periodo'

// El valor del Select es string porque así lo maneja Mantine; se codifica el
// modo y su parámetro juntos y se decodifica de vuelta aquí mismo.
function codificar(p: Periodo): string {
  switch (p.modo) {
    case 'dias':  return `dias-${p.dias}`
    case 'anio':  return `anio-${p.anio}`
    case 'rango': return 'rango'
    default:      return 'default'
  }
}

function decodificar(valor: string | null, previo: Periodo): Periodo {
  if (!valor || valor === 'default') return { modo: 'default' }
  if (valor.startsWith('dias-')) return { modo: 'dias', dias: Number(valor.slice(5)) }
  if (valor.startsWith('anio-')) return { modo: 'anio', anio: Number(valor.slice(5)) }
  // Al entrar a "rango" se conservan las fechas que ya se habían escrito, para
  // no perderlas si alguien se asomó a otra opción y regresó.
  if (previo.modo === 'rango') return previo
  return { modo: 'rango', desde: '', hasta: '' }
}

export default function SelectorPeriodoReporte({
  value, onChange, etiquetaDefault, disabled,
}: {
  value:  Periodo
  onChange: (p: Periodo) => void
  /** Cómo se llama la ventana de siempre de este reporte. */
  etiquetaDefault: string
  disabled?: boolean
}) {
  const opciones = [
    { value: 'default',   label: etiquetaDefault },
    { value: 'dias-30',   label: 'Últimos 30 días' },
    { value: 'dias-90',   label: 'Últimos 90 días' },
    { value: 'dias-180',  label: 'Últimos 180 días' },
    { value: 'dias-365',  label: 'Últimos 365 días' },
    ...aniosDisponibles().map((a) => ({ value: `anio-${a}`, label: `Año ${a}` })),
    { value: 'rango',     label: 'Entre dos fechas…' },
  ]

  const esRango = value.modo === 'rango'
  // Solo se marca error cuando ya hay las dos fechas y están al revés: avisar
  // mientras se escribe la primera sería regañar por no haber terminado.
  const invertido = esRango && !!value.desde && !!value.hasta && !periodoValido(value)

  return (
    <Stack gap="xs">
      <Select
        label="Periodo del reporte"
        data={opciones}
        value={codificar(value)}
        onChange={(v) => onChange(decodificar(v, value))}
        disabled={disabled}
        comboboxProps={{ withinPortal: true }}
      />

      {esRango && (
        <Group grow align="flex-start">
          <FechaInput
            label="Desde"
            value={value.desde}
            onChange={(d) => onChange({ ...value, desde: d })}
            maxDate={value.hasta || hoyIso()}
            disabled={disabled}
            clearable
          />
          <FechaInput
            label="Hasta"
            value={value.hasta}
            onChange={(h) => onChange({ ...value, hasta: h })}
            minDate={value.desde || undefined}
            disabled={disabled}
            error={invertido ? 'Debe ser posterior al inicio' : undefined}
            clearable
          />
        </Group>
      )}

      <Text size="xs" c="dimmed">
        {esRango && !periodoValido(value)
          ? 'Escribe las dos fechas para poder generar el reporte.'
          : `El reporte cubrirá: ${etiquetaPeriodo(value, etiquetaDefault.toLowerCase())}.`}
      </Text>
    </Stack>
  )
}
