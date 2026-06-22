import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  publicDir: 'src/public',
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: 'auto',
      manifest: {
        name: 'Refacciones Kora',
        short_name: 'Kora',
        description: 'Sistema interno de Refacciones Kora',
        theme_color: '#1e293b',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Cachear SOLO assets estáticos. Nada de datos de la API.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // NUNCA cachear llamadas a la API ni rutas de autenticación
        navigateFallbackDenylist: [/^\/api/, /^\/\.auth/],
        runtimeCaching: [
          {
            // Las llamadas a /api SIEMPRE van a la red, nunca al cache
            urlPattern: /^.*\/api\/.*/,
            handler: 'NetworkOnly',
          },
        ],
        clientsClaim: true,
      },
      devOptions: {
        // Útil para probar PWA en desarrollo
        enabled: true,
        type: 'module',
      },
    }),
  ],
})