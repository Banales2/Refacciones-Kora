import { useState } from 'react'
import { ActionIcon, Group } from '@mantine/core'
import { DateInput, type DateInputProps } from '@mantine/dates'
import { IconCalendar, IconX } from '@tabler/icons-react'
import { FORMATO_FECHA, PLACEHOLDER_FECHA, formatearFecha, parseFechaEscrita } from '../lib/fechas'

export interface FechaInputProps
  extends Omit<DateInputProps, 'value' | 'onChange' | 'valueFormat' | 'dateParser' | 'rightSection'> {
  /** ISO "YYYY-MM-DD"; la cadena vacía cuenta como sin fecha. */
  value?: string | null
  /** Devuelve ISO "YYYY-MM-DD", o cadena vacía si se limpió. */
  onChange?: (value: string) => void
  /** Muestra la ✕ para dejar el campo sin fecha. */
  clearable?: boolean
}

/**
 * Campo de fecha único de la app. Se escribe primero —dd/mm/aaaa, con día por
 * delante— y el calendario se abre solo con el icono, porque teclear una fecha
 * conocida es más rápido que navegar meses. El texto se valida al salir del
 * campo: si no es un día real se avisa en lugar de dejarlo pasar.
 *
 * Trabaja con fechas en texto ISO "YYYY-MM-DD", igual que la API y la base:
 * pasarle un Date colgaba el navegador porque DateInput sincroniza su estado
 * interno en un efecto que depende de `value`, y un objeto nuevo en cada render
 * reactivaba el efecto sin parar.
 */
export function FechaInput({
  value,
  onChange,
  clearable,
  error,
  onBlur,
  onFocus,
  onKeyDown,
  minDate,
  maxDate,
  disabled,
  readOnly,
  placeholder,
  ...props
}: FechaInputProps) {
  const [abierto, setAbierto] = useState(false)
  const [errorFormato, setErrorFormato] = useState<string | null>(null)

  // DateInput reemplaza el texto por la última fecha válida al salir del campo
  // (fixOnBlur), así que sin este aviso lo tecleado desaparecería sin explicación.
  function revisarTexto(texto: string) {
    const t = texto.trim()
    if (!t) {
      setErrorFormato(null)
      return
    }
    const fecha = parseFechaEscrita(t)
    if (!fecha) {
      setErrorFormato('Fecha inválida — escríbela como dd/mm/aaaa')
    } else if (typeof minDate === 'string' && fecha < minDate) {
      setErrorFormato(`No puede ser anterior al ${formatearFecha(minDate)}`)
    } else if (typeof maxDate === 'string' && fecha > maxDate) {
      setErrorFormato(`No puede ser posterior al ${formatearFecha(maxDate)}`)
    } else {
      setErrorFormato(null)
    }
  }

  const puedeLimpiar = clearable && !!value && !disabled && !readOnly

  return (
    <DateInput
      {...props}
      placeholder={placeholder ?? PLACEHOLDER_FECHA}
      valueFormat={FORMATO_FECHA}
      dateParser={parseFechaEscrita}
      minDate={minDate}
      maxDate={maxDate}
      disabled={disabled}
      readOnly={readOnly}
      // La cadena vacía de los formularios no es una fecha: dayjs('') la toma
      // como inválida y el input se queda con texto basura.
      value={value || null}
      allowDeselect={clearable}
      error={errorFormato ?? error}
      onChange={(d) => {
        setErrorFormato(null)
        setAbierto(false)
        onChange?.(d ?? '')
      }}
      onFocus={(e) => {
        setErrorFormato(null)
        onFocus?.(e)
      }}
      onBlur={(e) => {
        // Se lee antes de llamar a onBlur del padre: DateInput corrige el texto
        // después de propagar el evento.
        revisarTexto(e.currentTarget.value)
        onBlur?.(e)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') setAbierto(false)
        onKeyDown?.(e)
      }}
      // DateInput abre su dropdown al enfocar o al hacer clic en el input;
      // `popoverProps` se esparce después de ese `opened` interno, así que aquí
      // el control es nuestro y el calendario solo sale con el icono.
      popoverProps={{ opened: abierto, onDismiss: () => setAbierto(false) }}
      rightSectionPointerEvents="all"
      rightSectionWidth={puedeLimpiar ? 62 : 38}
      rightSection={
        <Group gap={2} wrap="nowrap">
          {puedeLimpiar && (
            <ActionIcon
              variant="subtle"
              color="gray"
              size="sm"
              aria-label="Quitar fecha"
              // Sin esto el input pierde el foco antes del clic y el evento se pierde.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setErrorFormato(null)
                setAbierto(false)
                onChange?.('')
              }}
            >
              <IconX size={14} />
            </ActionIcon>
          )}
          <ActionIcon
            variant="subtle"
            color="gray"
            size="sm"
            aria-label="Abrir calendario"
            disabled={disabled || readOnly}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setAbierto((o) => !o)}
          >
            <IconCalendar size={16} />
          </ActionIcon>
        </Group>
      }
    />
  )
}
