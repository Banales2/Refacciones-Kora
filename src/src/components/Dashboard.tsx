import { SimpleGrid, Card, Text, Group, ThemeIcon, Stack } from '@mantine/core'

const stats = [
  { label: 'Piezas en inventario', value: '--', color: 'violet' },
  { label: 'Vehículos activos', value: '--', color: 'blue' },
  { label: 'Mantenimientos del mes', value: '--', color: 'teal' },
  { label: 'Requerimientos pendientes', value: '--', color: 'orange' },
]

export default function Dashboard() {
  return (
    <Stack gap="xl">
      <div>
        <Text size="xl" fw={600}>Resumen general</Text>
        <Text c="dimmed" size="sm">Vista general del sistema</Text>
      </div>

      <SimpleGrid cols={{ base: 1, sm: 2, xl: 4 }} spacing="md">
        {stats.map((stat) => (
          <Card key={stat.label} withBorder padding="lg" radius="md">
            <Group justify="space-between" align="flex-start">
              <Stack gap={4}>
                <Text size="sm" c="dimmed" fw={500}>
                  {stat.label}
                </Text>
                <Text fz="2rem" fw={700} lh={1}>
                  {stat.value}
                </Text>
              </Stack>
              <ThemeIcon color={stat.color} variant="light" size="lg" radius="md">
                <span style={{ fontSize: 16 }}>◈</span>
              </ThemeIcon>
            </Group>
          </Card>
        ))}
      </SimpleGrid>
    </Stack>
  )
}
