import { useState } from 'react'
import {
  Stack, Group, Text, TextInput, Table,
  Loader, Center, Alert, Badge,
} from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import { useModelos } from '../hooks/useModelos'

export default function Modelos() {
  const [search, setSearch] = useState('')
  const [debounced] = useDebouncedValue(search, 300)

  const { data, isLoading, isError } = useModelos()

  const modelos = (data?.data ?? []).filter((m) => {
    if (!debounced) return true
    const q = debounced.toLowerCase()
    return m.marca.toLowerCase().includes(q) || m.nombre.toLowerCase().includes(q)
  })

  // Agrupar por marca para el conteo de badges
  const marcas = [...new Set(modelos.map((m) => m.marca))].sort()

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end">
        <div>
          <Text size="xl" fw={600}>Modelos de vehículos</Text>
          <Text size="sm" c="dimmed">Catálogo de marcas y modelos</Text>
        </div>
        {data?.data && (
          <Text size="sm" c="dimmed">
            {modelos.length} modelo{modelos.length !== 1 ? 's' : ''}
            {marcas.length > 0 && ` · ${marcas.length} marca${marcas.length !== 1 ? 's' : ''}`}
          </Text>
        )}
      </Group>

      <TextInput
        placeholder="Buscar por marca o modelo…"
        value={search}
        onChange={(e) => setSearch(e.currentTarget.value)}
        rightSection={
          search ? (
            <Text
              component="button"
              size="xs"
              c="dimmed"
              style={{ cursor: 'pointer', background: 'none', border: 'none', padding: 0 }}
              onClick={() => setSearch('')}
            >
              ✕
            </Text>
          ) : null
        }
      />

      {isLoading ? (
        <Center py="xl"><Loader /></Center>
      ) : isError ? (
        <Alert color="red" title="Error al cargar">
          No se pudieron obtener los modelos. Verifica la conexión.
        </Alert>
      ) : modelos.length === 0 ? (
        <Center py="xl">
          <Text c="dimmed">
            {search ? `No hay modelos para "${search}".` : 'No hay modelos registrados.'}
          </Text>
        </Center>
      ) : (
        <Table.ScrollContainer minWidth={320}>
          <Table striped highlightOnHover withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Marca</Table.Th>
                <Table.Th>Modelo</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {modelos.map((m) => (
                <Table.Tr key={m.id}>
                  <Table.Td>
                    <Badge variant="light" color="gray" size="sm">{m.marca}</Badge>
                  </Table.Td>
                  <Table.Td fw={500}>{m.nombre}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </Stack>
  )
}
