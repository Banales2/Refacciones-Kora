// Usuario de la sesión con su nombre real. `useAuth` lee /.auth/me, que sólo
// trae el correo; el nombre vive en la tabla `usuarios` y lo resuelve la API.
// Se usa donde la pantalla tiene que mostrar el mismo texto que se va a guardar.
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

export interface UsuarioActual {
  email:  string
  nombre: string
  roles:  string[]
}

export function useUsuarioActual() {
  return useQuery({
    queryKey: ['usuario-actual'],
    queryFn: () => api.get<{ data: UsuarioActual }>('/usuario-actual'),
    // No cambia durante la sesión.
    staleTime: Infinity,
  })
}
