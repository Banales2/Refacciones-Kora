// Tarjeta de KPI del tablero. Antes cada una pintaba un rombo genérico: cinco
// tarjetas idénticas en las que había que leer la etiqueta para saber cuál era
// cuál. Ahora cada métrica trae su ícono y una franja de color a la izquierda,
// que es lo que se alcanza a ver de reojo al entrar.
import { Card, Group, Stack, Text, ThemeIcon, Tooltip } from '@mantine/core'
import { IconInfoCircle, IconTrendingDown, IconTrendingUp, type Icon } from '@tabler/icons-react'
import type { ReactNode } from 'react'

export interface StatCardProps {
  label:   string
  value:   ReactNode
  sub?:    ReactNode
  color:   string
  icon:    Icon
  /** Explicación de cómo se calcula la métrica; sale en un tooltip junto al título. */
  ayuda?:  string
  /**
   * Variación contra el periodo anterior, en porcentaje. El color no se deduce
   * del signo: en gasto, subir es malo; en rendimiento, subir es bueno. Lo dice
   * `subirEsBueno`.
   */
  delta?:  number | null
  subirEsBueno?: boolean
  onClick?: () => void
}

export function StatCard({
  label, value, sub, color, icon: Icono, ayuda, delta, subirEsBueno = false, onClick,
}: StatCardProps) {
  const hayDelta = delta != null && Number.isFinite(delta) && Math.abs(delta) >= 0.5
  const subiendo = (delta ?? 0) > 0
  const colorDelta = !hayDelta ? 'dimmed' : subiendo === subirEsBueno ? 'teal' : 'red'
  const IconoDelta = subiendo ? IconTrendingUp : IconTrendingDown

  return (
    <Card
      withBorder
      radius="md"
      padding="md"
      onClick={onClick}
      style={{
        // La franja va como borde izquierdo y no como elemento aparte para que
        // no meta un hijo más en la fila y descuadre el espaciado.
        borderLeft: `3px solid var(--mantine-color-${color}-6)`,
        cursor: onClick ? 'pointer' : undefined,
        height: '100%',
      }}
    >
      <Group justify="space-between" align="flex-start" wrap="nowrap" gap="xs">
        <Stack gap={2} style={{ minWidth: 0 }}>
          <Group gap={4} wrap="nowrap">
            <Text size="xs" c="dimmed" fw={600} tt="uppercase" lts={0.3} lineClamp={2}>
              {label}
            </Text>
            {ayuda && (
              <Tooltip label={ayuda} multiline w={260} withArrow position="top">
                <IconInfoCircle size={13} style={{ color: 'var(--mantine-color-dimmed)', flexShrink: 0 }} />
              </Tooltip>
            )}
          </Group>
          <Text fz="1.75rem" fw={700} lh={1.15} style={{ fontVariantNumeric: 'tabular-nums' }}>
            {value}
          </Text>
          <Group gap={6} wrap="nowrap">
            {hayDelta && (
              <Group gap={2} wrap="nowrap">
                <IconoDelta size={13} color={`var(--mantine-color-${colorDelta}-6)`} />
                <Text size="xs" fw={600} c={colorDelta}>{Math.abs(delta!).toFixed(0)}%</Text>
              </Group>
            )}
            {sub && <Text size="xs" c="dimmed" lineClamp={1}>{sub}</Text>}
          </Group>
        </Stack>
        <ThemeIcon color={color} variant="light" size={38} radius="md">
          <Icono size={20} />
        </ThemeIcon>
      </Group>
    </Card>
  )
}
