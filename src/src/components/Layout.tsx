// Estructura general de la app (AppShell de Mantine): barra lateral de
// navegación, encabezado con usuario/rol y render de la sección activa. La
// navegación es por estado local (sin router); navigateToVehiculo permite
// saltar desde cualquier pantalla al detalle de un vehículo.
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
import { useIsFetching, useQueryClient } from '@tanstack/react-query'
import { IconRefresh } from '@tabler/icons-react'
import { useAuth } from '../hooks/useAuth'
import Dashboard from './Dashboard'
import Piezas from '../pages/Piezas'
import Vehiculos from '../pages/Vehiculos'
import Modelos from '../pages/Modelos'
import SitiosYRutas from '../pages/SitiosYRutas'
import Calendario from '../pages/Calendario'
import type { VehiculoRow } from '../hooks/useVehiculos'

type Section = 'dashboard' | 'piezas' | 'modelos' | 'vehiculos' | 'sitios' | 'calendario'

const SECTION_LABELS: Record<Section, string> = {
  dashboard:  'Dashboard',
  piezas:     'Refacciones',
  modelos:    'Modelos',
  vehiculos:  'Vehículos',
  sitios:     'Catálogos',
  calendario: 'Calendario',
}

const NAV_ITEMS: { section: Section; label: string; description: string }[] = [
  { section: 'piezas',     label: 'Refacciones', description: 'Catálogo e inventario'                       },
  { section: 'modelos',    label: 'Modelos',     description: 'Marcas y modelos de la flota'                },
  { section: 'vehiculos',  label: 'Vehículos',   description: 'Unidades de reparto y tractocamiones'        },
  { section: 'calendario', label: 'Calendario',  description: 'Fechas de mantenimiento'                     },
  { section: 'sitios',     label: 'Catálogos',   description: 'Proveedores, sucursales, traslados y más'    },
]


export default function Layout() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const fetching = useIsFetching()
  const [mobileOpened, { toggle: toggleMobile }] = useDisclosure()
  const [desktopCollapsed, setDesktopCollapsed] = useState(false)
  const [section, setSection] = useState<Section>('dashboard')
  const [pendingVehiculo, setPendingVehiculo] = useState<VehiculoRow | null>(null)
  const [pendingVehiculoId, setPendingVehiculoId] = useState<number | null>(null)
  const [pendingPiezaId, setPendingPiezaId] = useState<number | null>(null)
  // Sección desde la que se saltó al detalle de un vehículo, para poder volver.
  const [vehiculoOrigin, setVehiculoOrigin] = useState<Section | null>(null)
  // Pestaña activa de Catálogos; vive aquí para persistir al saltar a un
  // vehículo y regresar a la misma pestaña (Seguros, Permisos, etc.).
  const [sitiosTab, setSitiosTab] = useState<string | null>('proveedores')
  // Seguro/permiso cuyo drawer de asignación estaba abierto, para reabrirlo al
  // regresar desde el detalle de un vehículo.
  const [seguroDrawerId, setSeguroDrawerId]   = useState<number | null>(null)
  const [permisoDrawerId, setPermisoDrawerId] = useState<number | null>(null)
  // Modelo cuyo detalle está abierto; se conserva al saltar a un vehículo para
  // poder regresar al mismo modelo (no solo a la lista de modelos).
  const [modeloDetalleId, setModeloDetalleId] = useState<number | null>(null)

  const rol = user?.userRoles.find((r) => !['anonymous', 'authenticated'].includes(r))

  function navigate(s: Section) {
    if (s !== 'vehiculos') {
      setPendingVehiculo(null)
      setPendingVehiculoId(null)
    }
    if (s !== 'piezas') setPendingPiezaId(null)
    setVehiculoOrigin(null)
    // Navegación explícita por el menú: el detalle de Modelos vuelve a la lista.
    setModeloDetalleId(null)
    setSection(s)
    if (mobileOpened) toggleMobile()
  }

  function navigateToVehiculo(v: VehiculoRow) {
    setVehiculoOrigin(section)
    setPendingVehiculo(v)
    setPendingVehiculoId(null)
    setSection('vehiculos')
    if (mobileOpened) toggleMobile()
  }

  function navigateToVehiculoId(id: number) {
    setVehiculoOrigin(section)
    setPendingVehiculo(null)
    setPendingVehiculoId(id)
    setSection('vehiculos')
    if (mobileOpened) toggleMobile()
  }

  // Regresa a la sección desde la que se abrió el vehículo. A diferencia de
  // navigate(), conserva modeloDetalleId para reabrir el detalle del modelo.
  function backFromVehiculo() {
    if (!vehiculoOrigin) return
    setPendingVehiculo(null)
    setPendingVehiculoId(null)
    setSection(vehiculoOrigin)
    setVehiculoOrigin(null)
    if (mobileOpened) toggleMobile()
  }

  function navigateToPiezaId(id: number) {
    setPendingPiezaId(id)
    setSection('piezas')
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
            <Tooltip label="Actualizar datos" position="bottom">
              <ActionIcon
                variant="subtle"
                color="gray"
                size="lg"
                loading={fetching > 0}
                onClick={() => qc.invalidateQueries()}
                aria-label="Actualizar datos"
              >
                <IconRefresh size={18} />
              </ActionIcon>
            </Tooltip>
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
        {section === 'dashboard' && (
          <Dashboard
            onNavigateVehiculo={navigateToVehiculoId}
            onNavigatePieza={navigateToPiezaId}
          />
        )}
        {section === 'piezas'    && <Piezas initialPiezaId={pendingPiezaId ?? undefined} />}
        {section === 'modelos'   && (
          <Modelos
            onNavigateVehiculo={navigateToVehiculo}
            openId={modeloDetalleId}
            onOpenIdChange={setModeloDetalleId}
          />
        )}
        {section === 'vehiculos' && (
          <Vehiculos
            initialVehiculo={pendingVehiculo ?? undefined}
            initialVehiculoId={pendingVehiculoId ?? undefined}
            onBack={vehiculoOrigin ? backFromVehiculo : undefined}
            backLabel={vehiculoOrigin ? SECTION_LABELS[vehiculoOrigin] : undefined}
          />
        )}
        {section === 'sitios'    && (
          <SitiosYRutas
            onNavigateVehiculo={navigateToVehiculo}
            activeTab={sitiosTab}
            onTabChange={setSitiosTab}
            seguroDrawerId={seguroDrawerId}
            onSeguroDrawerChange={setSeguroDrawerId}
            permisoDrawerId={permisoDrawerId}
            onPermisoDrawerChange={setPermisoDrawerId}
          />
        )}
        {section === 'calendario' && <Calendario onNavigateVehiculo={navigateToVehiculoId} />}
      </AppShell.Main>
    </AppShell>
  )
}
