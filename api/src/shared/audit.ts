// Bitácora de cambios: quién tocó qué, cuándo y con qué valores.
//
// Regla que gobierna todo este archivo: **registrar nunca puede romper lo que
// se está registrando**. Cada camino atrapa sus propios errores y sigue. Un
// fallo de la bitácora se traduce en un `console.error` y, como mucho, en un
// registro con menos detalle; jamás en un 500 sobre una operación que el
// usuario ya dio por buena.
import * as sql from 'mssql'
import { getPool } from './db'
import { ClientPrincipal } from './auth'
import { Fila } from './snapshot'

export type Accion = 'CREAR' | 'EDITAR' | 'ELIMINAR' | 'VER_SENSIBLE' | 'LOGIN' | 'EXPORTAR'

export interface AuditEntry {
  user: ClientPrincipal
  accion: Accion
  tabla: string
  registroId?: string | number
  /** Contexto extra del endpoint (p. ej. `{ agenda_id: 3 }`). */
  detalles?: Record<string, unknown>
  /** Estado previo, de `capturar()`. Obligatorio en ELIMINAR para no perderlo. */
  antes?: Fila | null
  /** Estado resultante. En EDITAR, lo que devuelve el service. */
  despues?: Fila | null
  /** Frase ya redactada. Sólo para acciones sin fila que describir, como LOGIN. */
  descripcion?: string
  ipAddress?: string
}

// Columnas que no aportan nada al leer un cambio: el id ya va en su propia
// columna y las marcas de tiempo se mueven en cada UPDATE, ensuciando el diff.
const IGNORADAS = new Set(['id', 'created_at', 'updated_at'])

// Las consultas de snapshot.ts traen el nombre legible junto a la llave
// foránea. Cuando cambia la llave, mostramos el nombre y ocultamos el número:
// «modelo: NP300 → Hilux» se entiende; «modelo_id: 3 → 7» no.
const LEGIBLE_DE: Record<string, string> = {
  modelo_id:      'modelo',
  vehiculo_id:    'vehiculo_serie',
  conductor_id:   'conductor',
  gasolinera_id:  'gasolinera',
  proveedor_id:   'proveedor',
  tipo_pieza_id:  'tipo_pieza',
  pieza_id:       'pieza',
  tecnico_id:     'tecnico_nombre',
}

// Cómo se llama cada tabla en la pantalla, y qué columnas la identifican de un
// vistazo. El orden importa: se muestran así.
const ENTIDADES: Record<string, { etiqueta: string; campos: string[] }> = {
  agendas_mantenimiento:           { etiqueta: 'Agenda de mantenimiento', campos: ['tipo', 'vehiculo_serie', 'vehiculo_placas', 'fecha_inicio'] },
  conductores:                     { etiqueta: 'Conductor',               campos: ['nombre'] },
  detalle_mtto_pieza:              { etiqueta: 'Pieza de mantenimiento',  campos: ['pieza', 'pieza_serie', 'cantidad', 'vehiculo_serie'] },
  gasolineras:                     { etiqueta: 'Gasolinera',              campos: ['nombre', 'ubicacion'] },
  lotes_pieza:                     { etiqueta: 'Lote de refacción',       campos: ['pieza', 'pieza_serie', 'proveedor', 'num_factura'] },
  mantenimiento:                   { etiqueta: 'Mantenimiento',           campos: ['tipo', 'vehiculo_serie', 'vehiculo_placas', 'fecha'] },
  modelos:                         { etiqueta: 'Modelo',                  campos: ['marca', 'nombre', 'anio'] },
  permisos_circulacion:            { etiqueta: 'Permiso de circulación',  campos: ['zona_circulacion', 'fecha_expiracion'] },
  piezas:                          { etiqueta: 'Refacción',               campos: ['descripcion', 'numero_serie', 'tipo_pieza'] },
  piezas_vehiculo:                 { etiqueta: 'Pieza instalada',         campos: ['pieza', 'tipo_pieza', 'vehiculo_serie', 'vehiculo_placas'] },
  plantilla_requerimientos_modelo: { etiqueta: 'Plantilla de requerimiento', campos: ['nombre', 'marca', 'modelo'] },
  proveedores:                     { etiqueta: 'Proveedor',               campos: ['nombre', 'contacto'] },
  recargas_combustible:            { etiqueta: 'Recarga de combustible',  campos: ['vehiculo_serie', 'conductor', 'gasolinera', 'fecha', 'litros'] },
  requerimientos_exclusivos:       { etiqueta: 'Requerimiento',           campos: ['nombre', 'vehiculo_serie', 'vehiculo_placas'] },
  rutas:                           { etiqueta: 'Ruta',                    campos: ['nombre', 'ubicacion'] },
  seguros:                         { etiqueta: 'Seguro',                  campos: ['poliza', 'compania', 'fecha_expiracion'] },
  sesion:                          { etiqueta: 'Sesión',                  campos: [] },
  sucursales:                      { etiqueta: 'Sucursal',                campos: ['nombre', 'ubicacion'] },
  tecnicos:                        { etiqueta: 'Técnico',                 campos: ['nombre', 'ubicacion'] },
  tipos_pieza:                     { etiqueta: 'Tipo de pieza',           campos: ['nombre'] },
  tipos_pieza_modelo:              { etiqueta: 'Tipo de pieza del modelo', campos: ['tipo_pieza', 'marca', 'modelo'] },
  tipos_pieza_vehiculo:            { etiqueta: 'Tipo de pieza del vehículo', campos: ['tipo_pieza', 'vehiculo_serie', 'vehiculo_placas'] },
  vales_gasolina:                  { etiqueta: 'Vale de gasolina',        campos: ['conductor', 'vehiculo_serie', 'fecha'] },
  vehiculos:                       { etiqueta: 'Vehículo',                campos: ['marca', 'modelo', 'numero_serie', 'placas', 'tipo'] },
}

export function etiquetaDe(tabla: string): string {
  return ENTIDADES[tabla]?.etiqueta ?? tabla
}

// mssql devuelve Date para date/datetime2 y string para el resto. Normalizamos
// para que el diff compare valores equivalentes y para que el JSON guardado sea
// legible sin post-proceso.
function normalizar(valor: unknown): unknown {
  if (valor === null || valor === undefined) return null
  if (valor instanceof Date) {
    const iso = valor.toISOString()
    // Las columnas `date` llegan a medianoche UTC: guardar la hora sólo añade
    // ruido y sugiere una precisión que el dato no tiene.
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso
  }
  if (typeof valor === 'object') return JSON.stringify(valor)
  return valor
}

function formatear(valor: unknown): string {
  const v = normalizar(valor)
  if (v === null || v === '') return '(vacío)'
  if (typeof v === 'number') return v.toLocaleString('es-MX')
  if (typeof v === 'boolean') return v ? 'sí' : 'no'
  return String(v)
}

/** Frase que identifica el registro: «Nissan · NP300 · 3N6AD · ABC-123». */
function describir(tabla: string, fila: Fila | null | undefined): string | null {
  if (!fila) return null
  const campos = ENTIDADES[tabla]?.campos ?? []
  const partes = campos
    .map((c) => fila[c])
    .filter((v) => v !== null && v !== undefined && v !== '')
    .map((v) => formatear(v))
  return partes.length ? partes.join(' · ') : null
}

export interface Cambio {
  campo: string
  antes: unknown
  despues: unknown
}

function diferencias(antes: Fila, despues: Fila): Cambio[] {
  const cambios: Cambio[] = []
  // Recorremos las claves de ambos: un campo que pasa de tener valor a no
  // existir en el resultado también es un cambio que interesa.
  const campos = new Set([...Object.keys(antes), ...Object.keys(despues)])
  const derivados = new Set(Object.values(LEGIBLE_DE))

  for (const campo of campos) {
    if (IGNORADAS.has(campo)) continue
    // Los campos legibles se emiten junto a su llave foránea, no por su cuenta.
    if (derivados.has(campo)) continue

    const a = normalizar(antes[campo])
    const d = normalizar(despues[campo])
    if (a === d) continue

    const legible = LEGIBLE_DE[campo]
    if (legible && (legible in antes || legible in despues)) {
      cambios.push({ campo: legible, antes: normalizar(antes[legible]), despues: normalizar(despues[legible]) })
    } else {
      cambios.push({ campo, antes: a, despues: d })
    }
  }
  return cambios
}

function resumirCambios(cambios: Cambio[]): string {
  return cambios
    .map((c) => `${c.campo}: ${formatear(c.antes)} → ${formatear(c.despues)}`)
    .join(' · ')
}

// El nombre vive en `usuarios` y no cambia casi nunca, así que se cachea por
// proceso. El coste de una entrada obsoleta es un nombre viejo en un registro;
// el de no cachear, una consulta extra en cada escritura de la aplicación.
const nombres = new Map<string, string | null>()

async function nombreDe(userId: string): Promise<string | null> {
  if (nombres.has(userId)) return nombres.get(userId) ?? null
  try {
    const pool = await getPool()
    const r = await pool.request()
      .input('oid', sql.NVarChar(100), userId)
      .query(`SELECT TOP 1 nombre FROM usuarios
              WHERE TRY_CONVERT(uniqueidentifier, @oid) IS NOT NULL
                AND EntraObjectId = TRY_CONVERT(uniqueidentifier, @oid)`)
    const nombre = (r.recordset[0]?.nombre as string) ?? null
    nombres.set(userId, nombre)
    return nombre
  } catch {
    // Sin cachear el fallo: la próxima escritura vuelve a intentarlo.
    return null
  }
}

// `userId` de Static Web Apps viene sin guiones; la tabla los usa.
function conGuiones(valor: string): string {
  if (valor.includes('-') || valor.length !== 32) return valor
  return [valor.slice(0, 8), valor.slice(8, 12), valor.slice(12, 16), valor.slice(16, 20), valor.slice(20)].join('-')
}

const MAX_DESCRIPCION = 1000

// Qué llega a la tabla. `VER_SENSIBLE` se dispara en cada listado de
// refacciones: persistirlo ahogaría los cambios reales bajo miles de filas de
// «alguien miró una pantalla». Se sigue escribiendo en el log de la función,
// que es donde tiene sentido buscarlo. Para incluirlo, basta con añadirlo aquí.
const PERSISTIDAS: ReadonlySet<Accion> = new Set<Accion>([
  'CREAR', 'EDITAR', 'ELIMINAR', 'LOGIN',
])

export async function audit(entry: AuditEntry): Promise<void> {
  const { user, accion, tabla, registroId, antes, despues, detalles, ipAddress } = entry

  let descripcion: string | null = entry.descripcion ?? null
  const cuerpo: Record<string, unknown> = {}

  try {
    const registro = describir(tabla, despues ?? antes)

    if (accion === 'EDITAR' && antes && despues) {
      const cambios = diferencias(antes, despues)
      cuerpo.cambios = cambios
      if (registro) cuerpo.registro = registro
      // Un UPDATE que no cambia ningún valor sigue siendo actividad del
      // usuario y se registra, pero conviene que se lea como lo que es.
      descripcion ??= cambios.length ? resumirCambios(cambios) : 'Sin cambios efectivos'
    } else if (accion === 'ELIMINAR') {
      // El snapshot completo es el único rastro que queda de la fila.
      if (antes) cuerpo.eliminado = Object.fromEntries(
        Object.entries(antes).map(([k, v]) => [k, normalizar(v)])
      )
      descripcion ??= registro
    } else {
      if (despues) cuerpo.creado = Object.fromEntries(
        Object.entries(despues).map(([k, v]) => [k, normalizar(v)])
      )
      descripcion ??= registro
    }

    if (detalles && Object.keys(detalles).length) cuerpo.contexto = detalles
  } catch (err) {
    console.error('[AUDIT] no se pudo armar el registro:', err)
  }

  const linea = `[AUDIT] ${accion} | ${user.userDetails} | ${tabla}${registroId !== undefined ? ` #${registroId}` : ''}${descripcion ? ` | ${descripcion}` : ''}`
  console.log(linea)

  if (!PERSISTIDAS.has(accion)) return

  try {
    const nombre = await nombreDe(conGuiones(user.userId))
    const pool = await getPool()
    await pool.request()
      .input('email',       sql.NVarChar(255), user.userDetails ?? '(desconocido)')
      .input('nombre',      sql.NVarChar(100), nombre)
      .input('usuario_id',  sql.NVarChar(100), user.userId ?? null)
      .input('accion',      sql.NVarChar(20),  accion)
      .input('tabla',       sql.NVarChar(80),  tabla)
      .input('registro_id', sql.NVarChar(60),  registroId !== undefined ? String(registroId) : null)
      .input('descripcion', sql.NVarChar(sql.MAX), descripcion?.slice(0, MAX_DESCRIPCION) ?? null)
      .input('detalles',    sql.NVarChar(sql.MAX), Object.keys(cuerpo).length ? JSON.stringify(cuerpo) : null)
      .input('ip',          sql.NVarChar(60),  ipAddress ?? null)
      .query(`
        INSERT INTO registros_cambios
          (usuario_email, usuario_nombre, usuario_id, accion, tabla, registro_id, descripcion, detalles, ip)
        VALUES
          (@email, @nombre, @usuario_id, @accion, @tabla, @registro_id, @descripcion, @detalles, @ip)`)
  } catch (err) {
    // Se traga a propósito. Ver la nota de arriba del archivo.
    console.error('[AUDIT] no se pudo guardar en la bitácora:', err)
  }
}

export function getClientIp(req: { headers: { get(name: string): string | null } }): string | undefined {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
}
