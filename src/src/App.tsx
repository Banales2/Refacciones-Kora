import type { ReactNode } from 'react'
import { useAuth } from './hooks/useAuth'
import { useUsuarioActual } from './hooks/useUsuarioActual'
import Layout from './components/Layout'
import { PWAUpdater } from './components/PWAUpdater'

const centrado = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: '100svh',
  gap: '16px',
} as const

function Cargando() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100svh' }}>
      <span>Cargando...</span>
    </div>
  )
}

// El responsable sin sucursal no ve nada: la API le contesta 403 en todo
// (api/src/shared/alcance.ts). Sin este aviso abriría la aplicación y vería
// cada pantalla fallar sin saber por qué ni a quién pedírselo.
function ExigirSucursal({ children }: { children: ReactNode }) {
  const { data, isLoading } = useUsuarioActual()

  if (isLoading) return <Cargando />
  if (data && data.data.sucursal_id == null) {
    return (
      <div style={{ ...centrado, padding: '0 16px', textAlign: 'center' }}>
        <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700 }}>Sin sucursal asignada</h1>
        <p style={{ margin: 0, color: '#6b7280', maxWidth: 420 }}>
          Tu cuenta es de responsable de sucursal, pero todavía no tiene una sucursal
          asignada. Pide a un administrador que te la asigne; en cuanto lo haga, recarga
          la página.
        </p>
        <a href="/.auth/logout" style={{ color: '#7c3aed' }}>Salir</a>
      </div>
    )
  }
  return <>{children}</>
}

function App() {
  const { user, loading, sinRed, reintentar } = useAuth()

  if (loading) return <Cargando />

  // Sin red no se sabe si hay sesión. Mandar al login sería mentir, y sin señal
  // el login tampoco abre: se dice qué pasa y se reintenta solo al volver.
  if (sinRed) {
    return (
      <div style={{ ...centrado, padding: '0 16px', textAlign: 'center' }}>
        <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700 }}>Sin conexión</h1>
        <p style={{ margin: 0, color: '#6b7280', maxWidth: 420 }}>
          No se pudo comprobar tu sesión porque no hay internet. En cuanto regrese la
          señal se vuelve a intentar sola.
        </p>
        <button
          type="button"
          onClick={reintentar}
          style={{
            padding: '10px 24px', background: '#7c3aed', color: '#fff', border: 0,
            borderRadius: '8px', fontWeight: 500, fontSize: '1rem', cursor: 'pointer',
          }}
        >
          Reintentar
        </button>
      </div>
    )
  }

  if (!user) {
    return (
      <div style={centrado}>
        <h1 style={{ margin: 0, fontSize: '2rem', fontWeight: 700 }}>Refacciones Kora</h1>
        <p style={{ margin: 0, color: '#6b7280' }}>Inicia sesión para acceder al sistema</p>
        <a
          href="/.auth/login/aad?post_login_redirect_uri=/"
          style={{
            marginTop: '8px',
            padding: '10px 24px',
            background: '#7c3aed',
            color: '#fff',
            borderRadius: '8px',
            textDecoration: 'none',
            fontWeight: 500,
          }}
        >
          Iniciar sesión con Microsoft
        </a>
      </div>
    )
  }

  // El service worker precachea toda la aplicación y está configurado como
  // 'prompt': la versión nueva se instala pero se queda esperando hasta que
  // alguien la active. Sin este banner montado, nadie podía activarla y el
  // navegador seguía sirviendo el build viejo por más que se recargara.
  const layout = (
    <>
      <Layout />
      <PWAUpdater />
    </>
  )
  return user.userRoles.includes('responsable')
    ? <ExigirSucursal>{layout}</ExigirSucursal>
    : layout
}

export default App
