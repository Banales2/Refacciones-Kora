import { createRoot } from 'react-dom/client'
import '@mantine/core/styles.css'
import '@mantine/dates/styles.css'
import '@mantine/charts/styles.css'
import './index.css'
import App from './App.tsx'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MantineProvider, createTheme } from '@mantine/core'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      // La navegación es por estado local, sin router: cambiar de sección
      // desmonta y vuelve a montar la pantalla. Con 'always' cada regreso
      // revalida contra la API, así que un cambio hecho en otra pantalla se ve
      // sin recargar. No parpadea: se pintan los datos en caché al instante y
      // se corrigen solos cuando llega la respuesta.
      refetchOnMount: 'always',
      // Volver a la pestaña del navegador también revalida: entre varias
      // personas usando la app, lo que se ve al regresar está al día.
      refetchOnWindowFocus: true,
    },
  },
})

const theme = createTheme({
  primaryColor: 'violet',
  defaultRadius: 'md',
})

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <App />
    </MantineProvider>
  </QueryClientProvider>
)
