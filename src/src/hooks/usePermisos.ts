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

// Lo único que el practicante puede abrir sin chocar contra un 403. Es la lista
// corta a propósito: el dashboard queda fuera porque sus doce endpoints piden
// `lector`, así que la pantalla de inicio se llenaría de errores.
const SECCIONES_PRACTICANTE: readonly Seccion[] = [
  'piezas', 'sitios', 'vales', 'facturas', 'facturas-gasolina',
]

// El responsable de sucursal: la flota de su sucursal y la de translado, el
// chequeo, las incidencias, los vales, las refacciones y su inventario (sin
// precios ni facturas). Fuera quedan mantenimientos, modelos, facturas y el
// tablero, cuyos endpoints se le niegan. Qué filas ve dentro de cada sección no se decide aquí: lo acota la
// API por `usuarios.sucursal_id` (ver api/src/shared/alcance.ts).
const SECCIONES_RESPONSABLE: readonly Seccion[] = [
  'chequeos', 'vehiculos', 'incidencias', 'vales', 'piezas', 'inventario', 'sitios',
]

const CATALOGOS_RESPONSABLE: readonly string[] = ['conductores', 'permisos']

// Pestañas de Catálogos cuyo listado responde al practicante. Faltan Translados,
// Técnicos y Permisos: sus `-list` piden `lector` o `viewer`.
const CATALOGOS_PRACTICANTE: readonly string[] = [
  'proveedores', 'sucursales', 'gasolineras', 'conductores', 'seguros',
]

export interface Permisos {
  /** Rol efectivo, sin los que Static Web Apps le pone a todo el mundo. */
  rol: string | undefined
  esAdmin: boolean
  esPracticante: boolean
  esResponsable: boolean
  /**
   * Si puede modificar lo que ya existe. El practicante da de alta pero no
   * corrige: si se equivocó, lo arregla un editor.
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
   * incidencias, vales y recargas), que tiene sus propios botones.
   */
  puedeDarDeAlta: boolean
  /**
   * Si ve lo que es de mantenimiento en la ficha de una unidad: servicios,
   * programa, garantías y refacciones montadas.
   */
  puedeVerMantenimiento: boolean
  /**
   * Si ve de qué compra salió una refacción: costo, IVA, factura, proveedor y
   * quién la compró. Al responsable la API ni siquiera se los manda
   * (api/src/shared/datosDeCompra.ts); esto sólo quita las columnas vacías.
   */
  puedeVerCompras: boolean
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
    puedeEditar: !esPracticante && !esResponsable,
    puedeDarDeAlta: !esResponsable,
    puedeVerMantenimiento: !esResponsable,
    puedeVerCompras: !esResponsable,
    puedeVerSeccion: (s) => {
      if (s === 'registros' || s === 'errores-captura') return esAdmin
      if (esPracticante) return SECCIONES_PRACTICANTE.includes(s)
      if (esResponsable) return SECCIONES_RESPONSABLE.includes(s)
      return true
    },
    puedeVerCatalogo: (tab) => {
      if (esPracticante) return CATALOGOS_PRACTICANTE.includes(tab)
      if (esResponsable) return CATALOGOS_RESPONSABLE.includes(tab)
      return true
    },
    puedeVerFichaProveedor: !esPracticante && !esResponsable,
    // El chequeo es lo que el responsable tiene que hacer cada mañana.
    seccionInicial: esPracticante ? 'piezas' : esResponsable ? 'chequeos' : 'dashboard',
  }
}
