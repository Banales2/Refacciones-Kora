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
  Badge,
  Tooltip,
  ScrollArea,
} from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { useIsFetching, useQueryClient } from '@tanstack/react-query'
import {
  IconRefresh, IconLayoutDashboard, IconTruck, IconCar, IconTool,
  IconAlertTriangle, IconCalendar, IconGasStation, IconBox, IconBuildingStore, IconSettings,
  IconHistory,
} from '@tabler/icons-react'
import type { Icon } from '@tabler/icons-react'
import { useAuth } from '../hooks/useAuth'
import Dashboard from './Dashboard'
import Piezas from '../pages/Piezas'
import Inventario from '../pages/Inventario'
import Vehiculos from '../pages/Vehiculos'
import Incidencias from '../pages/Incidencias'
import Modelos from '../pages/Modelos'
import SitiosYRutas from '../pages/SitiosYRutas'
import Calendario from '../pages/Calendario'
import ValesGasolina from '../pages/ValesGasolina'
import RegistrosCambios from '../pages/RegistrosCambios'
import Mantenimientos from '../pages/Mantenimientos'
import type { VehiculoRow } from '../hooks/useVehiculos'

type Section =
  | 'dashboard' | 'piezas' | 'inventario' | 'modelos' | 'vehiculos' | 'incidencias'
  | 'mantenimientos' | 'sitios' | 'calendario' | 'vales' | 'registros'

const SECTION_LABELS: Record<Section, string> = {
  dashboard:      'Dashboard',
  piezas:         'Refacciones',
  inventario:     'Inventario por sucursal',
  modelos:        'Modelos',
  vehiculos:      'Vehículos',
  incidencias:    'Incidencias',
  mantenimientos: 'Mantenimientos',
  sitios:         'Catálogos',
  calendario:     'Calendario',
  vales:          'Vales de gasolina',
  registros:      'Registros de cambios',
}

// Agrupadas por lo que hace el usuario, no por tabla: primero la flota, luego
// lo que se le hace a la flota, y al final los catálogos que alimentan a ambos.
// La descripción se movió al tooltip: en la barra ocupaba tres renglones por
// entrada y obligaba a bajar la vista para llegar a Catálogos.
const NAV_GROUPS: {
  titulo: string
  items: { section: Section; label: string; description: string; icon: Icon }[]
}[] = [
  {
    titulo: 'Flota',
    items: [
      { section: 'vehiculos',   label: 'Vehículos',   description: 'Unidades de reparto y tractocamiones', icon: IconTruck },
      { section: 'modelos',     label: 'Modelos',     description: 'Marcas y modelos de la flota',         icon: IconCar   },
    ],
  },
  {
    titulo: 'Operación',
    items: [
      { section: 'mantenimientos', label: 'Mantenimientos', description: 'Historial de servicios de toda la flota', icon: IconTool          },
      { section: 'incidencias',    label: 'Incidencias',    description: 'Incidencias reportadas de la flota',      icon: IconAlertTriangle },
      { section: 'calendario',     label: 'Calendario',     description: 'Fechas de mantenimiento',                 icon: IconCalendar      },
      { section: 'vales',          label: 'Vales',          description: 'Vales de gasolina entregados a choferes', icon: IconGasStation    },
    ],
  },
  {
    titulo: 'Inventario',
    items: [
      { section: 'piezas',     label: 'Refacciones', description: 'Catálogo de refacciones y sus compras',      icon: IconBox            },
      { section: 'inventario', label: 'Inventario',  description: 'Qué hay en cada sucursal, mínimos y traspasos', icon: IconBuildingStore },
      { section: 'sitios', label: 'Catálogos',   description: 'Proveedores, sucursales, translados y más', icon: IconSettings },
    ],
  },
]

// Pestañas de Catálogos, replicadas aquí para poder entrar directo a cualquiera
// desde la barra lateral. Los value deben coincidir con los <Tabs.Tab> de
// SitiosYRutas.tsx, que es quien manda sobre la pestaña activa.
const CATALOGOS_TABS: { value: string; label: string }[] = [
  { value: 'proveedores', label: 'Proveedores' },
  { value: 'sucursales',  label: 'Sucursales'  },
  { value: 'rutas',       label: 'Translados'  },
  { value: 'gasolineras', label: 'Gasolineras' },
  { value: 'conductores', label: 'Conductores' },
  { value: 'tecnicos',    label: 'Técnicos'    },
  { value: 'seguros',     label: 'Seguros'     },
  { value: 'permisos',    label: 'Permisos'    },
]


function GrupoTitulo({ children }: { children: string }) {
  return (
    <Text size="10px" fw={700} c="dimmed" tt="uppercase" px="xs" pb={4} style={{ letterSpacing: '.06em' }}>
      {children}
    </Text>
  )
}

// Una sola línea por entrada: icono, etiqueta y nada más. Lo que antes era la
// descripción vive en el tooltip, que sólo estorba a quien lo pide.
function NavItem({
  label, description, icon: IconComponent, active, onClick,
}: {
  label:       string
  description: string
  icon:        Icon
  active:      boolean
  onClick:     () => void
}) {
  return (
    <Tooltip label={description} position="right" openDelay={500} withArrow>
      <NavLink
        label={label}
        leftSection={<IconComponent size={17} stroke={1.6} />}
        active={active}
        onClick={onClick}
        py={6}
        style={{ borderRadius: 6 }}
        styles={{ label: { fontSize: 13.5 } }}
      />
    </Tooltip>
  )
}

// Catálogos agrupa ocho pestañas; en vez de entrar siempre por Proveedores y
// buscar la pestaña, el clic despliega la lista y lleva directo a una. El clic
// en el padre sólo abre/cierra: navegar a ciegas a Proveedores era el problema.
function CatalogosNavItem({
  description, icon: IconComponent, active, opened, onToggle, activeTab, onSelectTab,
}: {
  description:  string
  icon:         Icon
  active:       boolean
  opened:       boolean
  onToggle:     () => void
  activeTab:    string | null
  onSelectTab:  (tab: string) => void
}) {
  return (
    <Tooltip label={description} position="right" openDelay={500} withArrow>
      <NavLink
        label="Catálogos"
        leftSection={<IconComponent size={17} stroke={1.6} />}
        active={active}
        opened={opened}
        onClick={onToggle}
        py={6}
        childrenOffset={26}
        style={{ borderRadius: 6 }}
        styles={{ label: { fontSize: 13.5 } }}
      >
        {CATALOGOS_TABS.map((tab) => (
          <NavLink
            key={tab.value}
            label={tab.label}
            active={active && activeTab === tab.value}
            onClick={(e) => {
              e.stopPropagation()
              onSelectTab(tab.value)
            }}
            py={4}
            style={{ borderRadius: 6 }}
            styles={{ label: { fontSize: 13 } }}
          />
        ))}
      </NavLink>
    </Tooltip>
  )
}

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
  // Catálogos es la única entrada con submenú: se despliega para saltar directo
  // a una pestaña sin pasar por la de Proveedores.
  const [catalogosOpen, setCatalogosOpen] = useState(false)
  // Seguro/permiso cuyo drawer de asignación estaba abierto, para reabrirlo al
  // regresar desde el detalle de un vehículo.
  const [seguroDrawerId, setSeguroDrawerId]   = useState<number | null>(null)
  const [permisoDrawerId, setPermisoDrawerId] = useState<number | null>(null)
  // Chofer al que se saltó desde otra pantalla (Vales): la pestaña Conductores
  // lo resalta y lo trae a la vista.
  const [conductorDestacado, setConductorDestacado] = useState<number | null>(null)
  // Modelo cuyo detalle está abierto; se conserva al saltar a un vehículo para
  // poder regresar al mismo modelo (no solo a la lista de modelos).
  const [modeloDetalleId, setModeloDetalleId] = useState<number | null>(null)

  const rol = user?.userRoles.find((r) => !['anonymous', 'authenticated'].includes(r))
  const esAdmin = user?.userRoles.includes('admin') ?? false

  function navigate(s: Section) {
    if (s !== 'vehiculos') {
      setPendingVehiculo(null)
      setPendingVehiculoId(null)
    }
    if (s !== 'piezas') setPendingPiezaId(null)
    setConductorDestacado(null)
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

  // Salto al chofer desde Vales. No pasa por navigate() porque ese limpia el
  // destacado, que es justo lo que aquí se quiere conservar.
  function navigateToConductor(id: number) {
    setConductorDestacado(id)
    setSitiosTab('conductores')
    setSection('sitios')
    if (mobileOpened) toggleMobile()
  }

  function navigateToCatalogo(tab: string) {
    setSitiosTab(tab)
    navigate('sitios')
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
        width: 196,
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
      {/* Con el submenú de Catálogos abierto la barra ya no cabe en pantalla:
          la sección scrolleable evita que las últimas entradas queden cortadas
          contra el borde inferior. */}
      <AppShell.Navbar p="xs">
        <AppShell.Section grow component={ScrollArea} type="auto" offsetScrollbars>
          <Stack gap={1} pb="xs">
            <NavItem
              label="Dashboard" description="Resumen de la flota" icon={IconLayoutDashboard}
              active={section === 'dashboard'} onClick={() => navigate('dashboard')}
            />

            {NAV_GROUPS.map((grupo) => (
              <Stack key={grupo.titulo} gap={1} mt="sm">
                <GrupoTitulo>{grupo.titulo}</GrupoTitulo>
                {grupo.items.map((item) => (
                  item.section === 'sitios' ? (
                    <CatalogosNavItem
                      key={item.section}
                      description={item.description}
                      icon={item.icon}
                      active={section === 'sitios'}
                      opened={catalogosOpen}
                      onToggle={() => setCatalogosOpen((o) => !o)}
                      activeTab={section === 'sitios' ? sitiosTab : null}
                      onSelectTab={navigateToCatalogo}
                    />
                  ) : (
                    <NavItem
                      key={item.section}
                      label={item.label} description={item.description} icon={item.icon}
                      active={section === item.section}
                      onClick={() => navigate(item.section)}
                    />
                  )
                ))}
              </Stack>
            ))}

            {/* La bitácora enseña la actividad de todo el mundo, con su correo.
                Ocultarla no es la protección real —esa la da el allowedRoles de
                staticwebapp.config.json, que devuelve 403 a quien no sea admin—,
                pero evita ofrecer una pantalla que acabaría en un error. */}
            {esAdmin && (
              <Stack gap={1} mt="sm">
                <GrupoTitulo>Administración</GrupoTitulo>
                <NavItem
                  label="Registros" description="Quién creó, modificó o eliminó qué" icon={IconHistory}
                  active={section === 'registros'} onClick={() => navigate('registros')}
                />
              </Stack>
            )}
          </Stack>
        </AppShell.Section>
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
        {section === 'inventario' && <Inventario />}
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
        {section === 'incidencias' && <Incidencias onNavigateVehiculo={navigateToVehiculoId} />}
        {section === 'sitios'    && (
          <SitiosYRutas
            onNavigateVehiculo={navigateToVehiculo}
            activeTab={sitiosTab}
            conductorDestacadoId={conductorDestacado}
            seguroDrawerId={seguroDrawerId}
            onSeguroDrawerChange={setSeguroDrawerId}
            permisoDrawerId={permisoDrawerId}
            onPermisoDrawerChange={setPermisoDrawerId}
          />
        )}
        {section === 'mantenimientos' && (
          <Mantenimientos onNavigateVehiculo={navigateToVehiculoId} />
        )}
        {section === 'calendario' && <Calendario onNavigateVehiculo={navigateToVehiculoId} />}
        {section === 'vales'      && (
          <ValesGasolina
            onNavigateVehiculo={navigateToVehiculoId}
            onNavigateConductor={navigateToConductor}
          />
        )}
        {section === 'registros' && esAdmin && <RegistrosCambios />}
      </AppShell.Main>
    </AppShell>
  )
}
