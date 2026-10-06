// Qué puede hacer quien está conectado, en un solo sitio.
//
// ESTO NO ES LA PROTECCIÓN. La de verdad está en dos capas del backend: los
// `allowedRoles` de `staticwebapp.config.json` en el borde y el `requireRole`
// de cada función. Lo que hace este módulo es no ofrecer botones ni pantallas
// que van a terminar en un 403: la UI no es seguridad, es cortesía.
//
// Antes esto vivía disperso como `user?.userRoles.includes('admin')` repetido en
// cada componente. Con un rol más ese patrón deja de escalar, porque la pregunta
// interesante dejó de ser "¿es admin?" y pasó a ser "¿puede editar esto?".
import { useAuth } from './useAuth'

/** Secciones del menú lateral. Debe coincidir con `Section` de Layout.tsx. */
export type Seccion =
  | 'dashboard' | 'piezas' | 'inventario' | 'modelos' | 'vehiculos' | 'incidencias'
  | 'mantenimientos' | 'sitios' | 'vales' | 'registros' | 'chequeos'
  | 'errores-captura' | 'facturas' | 'facturas-gasolina' | 'facturas-mantenimientos'
  | 'facturas-casetas' | 'solicitudes'

// Lo único que el practicante puede abrir sin chocar contra un 403. Es la lista
// corta a propósito: el dashboard queda fuera porque sus doce endpoints piden
// `lector`, así que la pantalla de inicio se llenaría de errores. Modelos entra
// porque es donde se capturan los programas de mantenimiento; el modelo en sí
// sólo lo mira. El chequeo de flotilla lo hace: recorre el patio y captura,
// pero no decide qué hacer con el reporte de un chofer (ver
// `puedeCapturarChequeo` y `puedeRevisarChequeo`). Las incidencias,
// igual: las lee, no las reporta ni las atiende (ver `puedeReportarIncidencia`).
// Vehículos, solo para consultar: la ficha como la ve el responsable —datos,
// chequeos, incidencias y recargas— sin lo de mantenimiento ni los botones de
// alta y edición (ver `puedeVerMantenimiento` y `puedeEditar`).
const SECCIONES_PRACTICANTE: readonly Seccion[] = [
  'piezas', 'modelos', 'sitios', 'vales', 'facturas', 'facturas-gasolina', 'chequeos',
  'incidencias', 'vehiculos',
]

// El responsable de sucursal: la flota de su sucursal y la de translado, el
// chequeo, las incidencias, los vales y el inventario de su sucursal (sin
// precios ni facturas). Fuera quedan el catálogo de refacciones,
// mantenimientos, modelos, facturas y el tablero, cuyos endpoints se le niegan.
// Qué filas ve dentro de cada sección no se decide aquí: lo acota la API por
// `usuarios.sucursal_id` (ver api/src/shared/alcance.ts).
const SECCIONES_RESPONSABLE: readonly Seccion[] = [
  'chequeos', 'vehiculos', 'incidencias', 'vales', 'inventario', 'sitios',
  // Ve las de su sucursal, y esa es la mitad del valor del módulo: es lo que
  // le permite no volver a pedir lo que su compañero ya pidió.
  'solicitudes',
]

const CATALOGOS_RESPONSABLE: readonly string[] = ['conductores', 'permisos']

export interface Permisos {
  /** Rol efectivo, sin los que Static Web Apps le pone a todo el mundo. */
  rol: string | undefined
  esAdmin: boolean
  esPracticante: boolean
  esResponsable: boolean
  /**
   * Si puede corregir un vale o una recarga, según quién lo capturó. El editor
   * corrige cualquiera; el practicante solo los suyos, para arreglar su propio
   * error sin esperar a nadie. Espejo de `exigirCapturaPropia` de la API.
   */
  puedeCorregirCaptura: (capturadoPor: string | null) => boolean
  /**
   * Si puede modificar lo que ya existe. El practicante da de alta pero no
   * corrige: si se equivocó, lo arregla un editor. La excepción son sus propios
   * vales y recargas; ver `puedeCorregirCaptura`.
   *
   * Está escrito en negativo -y no como `esAdmin || esEditor`- porque `lector`
   * sigue viendo hoy los botones de edición que la API le niega. Arreglar eso
   * es otro cambio; mientras tanto, negar sólo lo que se sabe negado evita
   * apagarle la interfaz a un rol que nadie revisó.
   */
  puedeEditar: boolean
  /**
   * Si puede dar de alta en refacciones, inventario y catálogos. El
   * responsable sólo los consulta: lo que captura es lo de su patio (chequeos,
   * incidencias, vales y recargas), que tiene sus propios botones. La
   * excepción son los choferes: los registra porque sin ellos no puede
   * entregar un vale, así que su botón no pasa por aquí.
   */
  puedeDarDeAlta: boolean
  /**
   * Si ve lo que es de mantenimiento en la ficha de una unidad: servicios,
   * programa, garantías y refacciones montadas. Ni el responsable ni el
   * practicante: sus endpoints no los admiten, y las consultas ni se lanzan.
   */
  puedeVerMantenimiento: boolean
  /**
   * Si ve de qué compra salió una refacción: costo, IVA, factura, proveedor y
   * quién la compró. Al responsable la API ni siquiera se los manda
   * (api/src/shared/datosDeCompra.ts); esto sólo quita las columnas vacías.
   */
  puedeVerCompras: boolean
  /**
   * Si envía, acepta, rechaza y cancela traspasos. Al responsable sí: mover
   * piezas entre patios es parte de su día, aunque no dé de alta inventario. La
   * API lo acota a su lado de cada traspaso.
   */
  puedeTraspasar: boolean
  /**
   * Si hace el chequeo de flotilla: lo captura y lo corrige. El practicante sí
   * —recorrer el patio es parte de su día—; el lector solo consulta:
   * `chequeos-create` y `-update` no lo admiten, así que no se le abre un
   * formulario que no va a poder guardar.
   */
  puedeCapturarChequeo: boolean
  /**
   * Si decide qué hacer con el reporte de un chofer (`chequeos-revisar`). Es
   * aparte de capturar: el practicante hace el recorrido, pero lo que sale del
   * reporte —abrir incidencias, descartarlo— lo decide alguien más.
   */
  puedeRevisarChequeo: boolean
  /**
   * Si corrige los datos de un chofer (`conductores-update`). El practicante
   * sí: captura licencias y expedientes y es quien encuentra el dato mal. El
   * responsable da de alta choferes pero no los corrige. Archivarlos sigue
   * siendo `puedeEditar`.
   */
  puedeEditarChofer: boolean
  /**
   * Si da de alta incidencias. `incidencias-create` admite a admin, editor y
   * responsable; el practicante y el lector solo las consultan. Atenderlas y
   * corregirlas sigue siendo `puedeEditar`.
   */
  puedeReportarIncidencia: boolean
  /**
   * Si registra un tipo de pieza nuevo y lo declara en un modelo
   * (`tipos-pieza-create`, `modelo-tipos-pieza-add`). El practicante sí: lo
   * necesita a media captura de un programa o de una refacción. Renombrar o
   * quitar un tipo sigue siendo `puedeEditar`.
   */
  puedeRegistrarTipoPieza: boolean
  /** Si la sección debe aparecer en el menú y poder abrirse. */
  puedeVerSeccion: (s: Seccion) => boolean
  /** Si la pestaña de Catálogos debe aparecer. */
  puedeVerCatalogo: (tab: string) => boolean
  /**
   * Si puede abrir la ficha de un proveedor. Son dos pestañas —precios
   * pactados y cuánto se le ha pagado— y las dos son información comercial que
   * el practicante no tiene por qué ver; sus endpoints se la niegan igual, así
   * que el renglón no se hace clicable en vez de abrir una ficha rota.
   */
  puedeVerFichaProveedor: boolean
  /** Sección de arranque: la primera que la persona sí puede abrir. */
  seccionInicial: Seccion
}

export function usePermisos(): Permisos {
  const { user } = useAuth()

  const rol = user?.userRoles.find((r) => !['anonymous', 'authenticated'].includes(r))
  const esAdmin = user?.userRoles.includes('admin') ?? false
  const esPracticante = user?.userRoles.includes('practicante') ?? false
  const esResponsable = user?.userRoles.includes('responsable') ?? false

  return {
    rol,
    esAdmin,
    esPracticante,
    esResponsable,
    puedeCorregirCaptura: (capturadoPor) => {
      if (!esPracticante) return !esResponsable
      return !!capturadoPor && !!user
        && capturadoPor.toLowerCase() === user.userDetails.toLowerCase()
    },
    puedeEditar: !esPracticante && !esResponsable,
    puedeDarDeAlta: !esResponsable,
    puedeVerMantenimiento: !esResponsable && !esPracticante,
    puedeVerCompras: !esResponsable,
    puedeTraspasar: !esPracticante,
    puedeCapturarChequeo: rol !== 'lector',
    puedeRevisarChequeo: !esPracticante && rol !== 'lector',
    puedeEditarChofer: !esResponsable && rol !== 'lector',
    puedeReportarIncidencia: !esPracticante && rol !== 'lector',
    puedeRegistrarTipoPieza: !esResponsable && rol !== 'lector',
    puedeVerSeccion: (s) => {
      if (s === 'registros' || s === 'errores-captura') return esAdmin
      if (esPracticante) return SECCIONES_PRACTICANTE.includes(s)
      if (esResponsable) return SECCIONES_RESPONSABLE.includes(s)
      return true
    },
    puedeVerCatalogo: (tab) => {
      // El practicante los ve todos. Dar de alta y corregir es otra cosa: cada
      // panel lo decide con `puedeEditar`, y la ficha del técnico —lo que ha
      // cobrado— se le cierra como la del proveedor.
      if (esPracticante) return true
      if (esResponsable) return CATALOGOS_RESPONSABLE.includes(tab)
      return true
    },
    puedeVerFichaProveedor: !esPracticante && !esResponsable,
    // El responsable no ve el tablero: arranca en la flota de su sucursal.
    seccionInicial: esPracticante ? 'piezas' : esResponsable ? 'vehiculos' : 'dashboard',
  }
}
