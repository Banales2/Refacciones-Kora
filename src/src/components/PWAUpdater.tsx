// Aviso de actualización de la PWA: cuando el service worker detecta una
// versión nueva muestra un banner flotante con opción de recargar ahora o
// posponer.
import { useRegisterSW } from 'virtual:pwa-register/react'

export function PWAUpdater() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(swUrl) {
      console.log('Service Worker registrado:', swUrl)
    },
    onRegisterError(error) {
      console.error('Error al registrar SW:', error)
    },
  })

  if (!needRefresh) return null

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 16,
        right: 16,
        padding: 16,
        background: '#1e293b',
        color: 'white',
        borderRadius: 8,
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        zIndex: 9999,
      }}
    >
      <p style={{ margin: '0 0 8px 0' }}>Hay una nueva versión disponible</p>
      <button onClick={() => updateServiceWorker(true)}>
        Actualizar ahora
      </button>
      <button
        onClick={() => setNeedRefresh(false)}
        style={{ marginLeft: 8 }}
      >
        Después
      </button>
    </div>
  )
}