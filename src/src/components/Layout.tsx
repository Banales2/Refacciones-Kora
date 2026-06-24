import { useState } from 'react'
import {
  AppShell,
  Burger,
  Group,
  NavLink,
  Text,
  ActionIcon,
  Stack,
  Divider,
  Badge,
  Tooltip,
} from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { useAuth } from '../hooks/useAuth'
import Dashboard from './Dashboard'
import Piezas from '../pages/Piezas'
import Proveedores from '../pages/Proveedores'
import Vehiculos from '../pages/Vehiculos'
import Modelos from '../pages/Modelos'
import SitiosYRutas from '../pages/SitiosYRutas'

type Section = 'dashboard' | 'piezas' | 'proveedores' | 'vehiculos' | 'modelos' | 'sitios' | 'mantenimientos'

const NAV_ITEMS: { section: Section; label: string; description: string; group?: string }[] = [
  { section: 'piezas',         label: 'Piezas',         description: 'Catálogo e inventario'           },
  { section: 'proveedores',    label: 'Proveedores',    description: 'Gestión de proveedores'          },
  { section: 'vehiculos',      label: 'Vehículos',      description: 'Camiones y tractocamiones'       },
  { section: 'modelos',        label: 'Modelos',        description: 'Marcas y modelos'                },
  { section: 'sitios',         label: 'Sitios y rutas', description: 'Sucursales y rutas de transporte'},
  { section: 'mantenimientos', label: 'Mantenimientos', description: 'Historial de servicios'          },
]

function SectionPlaceholder({ section }: { section: Section }) {
  const item = NAV_ITEMS.find((i) => i.section === section)!
  return (
    <Stack gap="xs" pt="md">
      <Text size="xl" fw={600}>{item.label}</Text>
      <Text c="dimmed" size="sm">{item.description}</Text>
      <Text c="dimmed" mt="xl" size="sm">Esta sección está en construcción.</Text>
    </Stack>
  )
}

export default function Layout() {
  const { user } = useAuth()
  const [mobileOpened, { toggle: toggleMobile }] = useDisclosure()
  const [desktopCollapsed, setDesktopCollapsed] = useState(false)
  const [section, setSection] = useState<Section>('dashboard')

  const rol = user?.userRoles.find((r) => !['anonymous', 'authenticated'].includes(r))

  function navigate(s: Section) {
    setSection(s)
    if (mobileOpened) toggleMobile()
  }

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{
        width: 220,
        breakpoint: 'sm',
        collapsed: { mobile: !mobileOpened, desktop: desktopCollapsed },
      }}
      padding="md"
    >
      {/* ── Header ── */}
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group gap="sm">
            <Burger
              opened={mobileOpened}
              onClick={toggleMobile}
              hiddenFrom="sm"
              size="sm"
            />
            <Tooltip
              label={desktopCollapsed ? 'Expandir menú' : 'Colapsar menú'}
              position="right"
            >
              <ActionIcon
                visibleFrom="sm"
                variant="subtle"
                color="gray"
                onClick={() => setDesktopCollapsed((c) => !c)}
                aria-label="Toggle sidebar"
                size="lg"
              >
                {desktopCollapsed ? '›' : '‹'}
              </ActionIcon>
            </Tooltip>
            <Text fw={700} size="md">
              Refacciones Kora
            </Text>
          </Group>

          <Group gap="sm">
            <Text size="sm" c="dimmed" visibleFrom="sm">
              {user?.userDetails}
            </Text>
            {rol && (
              <Badge variant="light" size="sm" visibleFrom="sm">
                {rol}
              </Badge>
            )}
            <Text
              component="a"
              href="/.auth/logout"
              size="sm"
              c="dimmed"
              style={{ textDecoration: 'none' }}
            >
              Salir
            </Text>
          </Group>
        </Group>
      </AppShell.Header>

      {/* ── Sidebar ── */}
      <AppShell.Navbar p="sm">
        <Stack gap={2}>
          <NavLink
            label="Dashboard"
            active={section === 'dashboard'}
            onClick={() => navigate('dashboard')}
            style={{ borderRadius: 6 }}
          />

          <Divider my="xs" label="Módulos" labelPosition="left" />

          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.section}
              label={item.label}
              description={item.description}
              active={section === item.section}
              onClick={() => navigate(item.section)}
              style={{ borderRadius: 6 }}
            />
          ))}
        </Stack>
      </AppShell.Navbar>

      {/* ── Contenido ── */}
      <AppShell.Main>
        {section === 'dashboard'     && <Dashboard />}
        {section === 'piezas'        && <Piezas />}
        {section === 'proveedores'   && <Proveedores />}
        {section === 'vehiculos'     && <Vehiculos />}
        {section === 'modelos'        && <Modelos />}
        {section === 'sitios'         && <SitiosYRutas />}
        {section === 'mantenimientos' && <SectionPlaceholder section={section} />}
      </AppShell.Main>
    </AppShell>
  )
}
