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
import Vehiculos from '../pages/Vehiculos'
import SitiosYRutas from '../pages/SitiosYRutas'
import Calendario from '../pages/Calendario'
import type { VehiculoRow } from '../hooks/useVehiculos'

type Section = 'dashboard' | 'piezas' | 'vehiculos' | 'sitios' | 'calendario'

const NAV_ITEMS: { section: Section; label: string; description: string }[] = [
  { section: 'piezas',     label: 'Piezas',      description: 'Catálogo e inventario'                       },
  { section: 'vehiculos',  label: 'Vehículos',   description: 'Camiones y tractocamiones'                   },
  { section: 'calendario', label: 'Calendario',  description: 'Fechas de mantenimiento'                     },
  { section: 'sitios',     label: 'Catálogos',   description: 'Modelos, proveedores, sucursales y rutas'    },
]


export default function Layout() {
  const { user } = useAuth()
  const [mobileOpened, { toggle: toggleMobile }] = useDisclosure()
  const [desktopCollapsed, setDesktopCollapsed] = useState(false)
  const [section, setSection] = useState<Section>('dashboard')
  const [pendingVehiculo, setPendingVehiculo] = useState<VehiculoRow | null>(null)
  const [pendingVehiculoId, setPendingVehiculoId] = useState<number | null>(null)

  const rol = user?.userRoles.find((r) => !['anonymous', 'authenticated'].includes(r))

  function navigate(s: Section) {
    if (s !== 'vehiculos') {
      setPendingVehiculo(null)
      setPendingVehiculoId(null)
    }
    setSection(s)
    if (mobileOpened) toggleMobile()
  }

  function navigateToVehiculo(v: VehiculoRow) {
    setPendingVehiculo(v)
    setPendingVehiculoId(null)
    setSection('vehiculos')
    if (mobileOpened) toggleMobile()
  }

  function navigateToVehiculoId(id: number) {
    setPendingVehiculo(null)
    setPendingVehiculoId(id)
    setSection('vehiculos')
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
        {section === 'dashboard' && <Dashboard onNavigateVehiculo={navigateToVehiculoId} />}
        {section === 'piezas'    && <Piezas />}
        {section === 'vehiculos' && (
          <Vehiculos
            initialVehiculo={pendingVehiculo ?? undefined}
            initialVehiculoId={pendingVehiculoId ?? undefined}
          />
        )}
        {section === 'sitios'    && <SitiosYRutas onNavigateVehiculo={navigateToVehiculo} />}
        {section === 'calendario' && <Calendario onNavigateVehiculo={navigateToVehiculoId} />}
      </AppShell.Main>
    </AppShell>
  )
}
