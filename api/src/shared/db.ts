import * as sql from 'mssql'
import { DefaultAzureCredential } from '@azure/identity'
import { SecretClient } from '@azure/keyvault-secrets'

// Static Web Apps sólo expande las referencias a Key Vault para los secretos
// de autenticación; lo que consume la API llega como texto literal. Si nos
// dan una referencia en vez de una cadena, la resolvemos aquí con la identidad
// administrada.
const REFERENCIA_KEY_VAULT = /^@Microsoft\.KeyVault\(SecretUri=(.+?)\)$/

let cadenaResuelta: string | null = null

async function resolverCadena(valor: string): Promise<string> {
  const referencia = valor.match(REFERENCIA_KEY_VAULT)
  if (!referencia) return valor

  // El SecretUri trae la forma https://<vault>/secrets/<nombre>[/<versión>].
  // Fijamos la versión si viene: si no, una rotación cambiaría la contraseña
  // bajo los pies del pool ya abierto.
  const uri = new URL(referencia[1])
  const [, , nombre, version] = uri.pathname.split('/')
  if (!nombre) {
    throw new Error(`SecretUri sin nombre de secreto: ${referencia[1]}`)
  }

  const cliente = new SecretClient(uri.origin, new DefaultAzureCredential())
  const secreto = await cliente.getSecret(nombre, version ? { version } : undefined)

  if (!secreto.value) {
    throw new Error(`El secreto ${nombre} no tiene valor`)
  }
  return secreto.value
}

// Una sola promesa de conexión compartida por proceso. Guardamos la *promesa*,
// no el pool ya resuelto: si guardáramos sólo el pool, varias peticiones
// concurrentes que llegan mientras la conexión aún está en vuelo verían
// `pool.connected === false` y abrirían cada una su propio ConnectionPool.
let poolPromise: Promise<sql.ConnectionPool> | null = null
let currentPool: sql.ConnectionPool | null = null

async function connect(): Promise<sql.ConnectionPool> {
  const configurada = process.env.SQL_CONNECTION_STRING
  if (!configurada) {
    throw new Error('SQL_CONNECTION_STRING no está configurada')
  }

  // Resolver el secreto cuesta una llamada de red, así que guardamos el
  // resultado: al reconectar tras un error del pool no volvemos a Key Vault.
  if (!cadenaResuelta) {
    cadenaResuelta = await resolverCadena(configurada)
  }

  const pool = new sql.ConnectionPool(cadenaResuelta)

  // Un pool roto no se puede reutilizar: lo descartamos para que la siguiente
  // llamada a getPool() abra uno nuevo, y lo cerramos para no filtrar sockets.
  pool.on('error', (err) => {
    console.error('Error en el pool de SQL:', err.message)
    invalidate(pool)
  })

  await pool.connect()
  currentPool = pool
  return pool
}

// Sólo descarta el pool si sigue siendo el activo: el evento `error` de un pool
// ya reemplazado no debe tirar la conexión buena que lo sustituyó.
function invalidate(pool: sql.ConnectionPool) {
  if (currentPool === pool) {
    currentPool = null
    poolPromise = null
  }
  pool.close().catch(() => { /* ya estaba cerrado */ })
}

export async function getPool(): Promise<sql.ConnectionPool> {
  if (!poolPromise) {
    poolPromise = connect()
    // Si la conexión falla, no dejamos cacheada una promesa rechazada: la
    // siguiente petición debe poder volver a intentarlo.
    poolPromise.catch(() => { poolPromise = null })
  }
  return poolPromise
}
