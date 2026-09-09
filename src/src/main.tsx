import { createRoot } from 'react-dom/client'
import '@mantine/core/styles.css'
import '@mantine/dates/styles.css'
import '@mantine/charts/styles.css'
import './index.css'
import App from './App.tsx'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { esReintentable } from './lib/api'
import { MantineProvider, createTheme } from '@mantine/core'
import { DatesProvider } from '@mantine/dates'
import 'dayjs/locale/es'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Internet malo es la condición normal en varias de las laptops que usan
      // esto, no la excepción: una consulta que falla se reintenta sola varias
      // veces antes de darse por vencida. Sin esto, dos tropiezos seguidos
      // dejaban el formulario con los catálogos vacíos hasta salir y volver a
      // entrar a la pantalla. Solo se repite lo que se arregla esperando —ver
      // `esReintentable`—; un 400 no mejora por insistirle.
      retry: (intento, err) => esReintentable(err) && intento < 4,
      // Esperas crecientes (1s, 2s, 4s, 8s) y con tope: repetir de inmediato
      // sobre una conexión saturada es lo que la termina de tumbar.
      retryDelay: (intento) => Math.min(1000 * 2 ** intento, 15_000),
      // 'offlineFirst' = intentar siempre, aunque el navegador se crea sin
      // conexión. Con el modo normal ('online'), un wifi que parpadea deja las
      // consultas en pausa: ni cargan ni fallan, y el usuario ve una pantalla
      // vacía sin error y sin nada que reintentar. Vale más mandar la petición
      // y que falle, porque de ahí sí se sale sola.
      networkMode: 'offlineFirst',
      // Al recuperar la conexión se vuelve a pedir todo, aunque siga fresco:
      // lo que se quedó a medias durante el corte se completa solo.
      refetchOnReconnect: 'always',
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
    mutations: {
      // Guardar NO se reintenta solo: una alta que sí entró pero cuya respuesta
      // se perdió se duplicaría. Reintentar es decisión del usuario, que ve el
      // error y vuelve a darle a Guardar.
      retry: false,
      networkMode: 'offlineFirst',
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
      {/* Todos los calendarios en español y con la semana empezando en lunes,
          como los calendarios de aquí; sin esto Mantine cae en inglés. */}
      <DatesProvider settings={{ locale: 'es', firstDayOfWeek: 1 }}>
        <App />
      </DatesProvider>
    </MantineProvider>
  </QueryClientProvider>
)
