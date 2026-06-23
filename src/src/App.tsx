import { useAuth } from './hooks/useAuth'
import Layout from './components/Layout'

function App() {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100svh' }}>
        <span>Cargando...</span>
      </div>
    )
  }

  if (!user) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100svh',
        gap: '16px',
      }}>
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

  return <Layout />
}

export default App
