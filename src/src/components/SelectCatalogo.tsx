// Un Select que dice la verdad mientras su catálogo viaja por la red.
//
// El problema que resuelve: los formularios arman las opciones con
// `data?.data ?? []`, así que una consulta lenta —o caída— se ve exactamente
// igual que un catálogo vacío. En una laptop con internet malo eso parecía que
// la app no servía, y la salida era cerrar la pantalla y volver a abrirla.
// Aquí, mientras carga lo dice y al fallar ofrece reintentar sin perder lo ya
// capturado en el resto del formulario.
import { Select, Loader, ActionIcon, Tooltip } from '@mantine/core'
import type { SelectProps } from '@mantine/core'
import { IconRefresh } from '@tabler/icons-react'

/** Lo mínimo que se le pide al resultado de un useQuery. */
export interface EstadoCatalogo {
  isLoading: boolean
  isError:   boolean
  refetch:   () => unknown
}

export function SelectCatalogo({
  estado, nombre, ...props
}: SelectProps & {
  estado: EstadoCatalogo
  /** Cómo se llama lo que se está cargando, en plural: "proveedores". */
  nombre: string
}) {
  const cargando = estado.isLoading
  const fallo = estado.isError

  return (
    <Select
      searchable
      {...props}
      placeholder={
        cargando ? `Cargando ${nombre}…`
        : fallo   ? `No se pudieron cargar los ${nombre}`
        : props.placeholder
      }
      nothingFoundMessage={
        cargando ? `Cargando ${nombre}…`
        : fallo   ? 'Falló la carga. Usa el botón de recargar.'
        : props.nothingFoundMessage ?? 'Sin resultados'
      }
      rightSection={
        cargando ? <Loader size="xs" />
        : fallo ? (
          <Tooltip label={`Reintentar la carga de ${nombre}`}>
            <ActionIcon
              variant="subtle" color="red" size="sm"
              onClick={(e) => {
                // Sin esto el clic también abre el desplegable, que está vacío.
                e.preventDefault()
                e.stopPropagation()
                estado.refetch()
              }}
            >
              <IconRefresh size={14} />
            </ActionIcon>
          </Tooltip>
        )
        : props.rightSection
      }
      // El error del catálogo no pisa el del formulario ("Proveedor requerido"):
      // ese es del campo y sigue mandando.
      error={props.error}
    />
  )
}

export default SelectCatalogo
