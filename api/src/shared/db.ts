import * as sql from 'mssql'

// Una sola promesa de conexión compartida por proceso. Guardamos la *promesa*,
// no el pool ya resuelto: si guardáramos sólo el pool, varias peticiones
// concurrentes que llegan mientras la conexión aún está en vuelo verían
// `pool.connected === false` y abrirían cada una su propio ConnectionPool.
let poolPromise: Promise<sql.ConnectionPool> | null = null
let currentPool: sql.ConnectionPool | null = null

async function connect(): Promise<sql.ConnectionPool> {
  const connectionString = process.env.SQL_CONNECTION_STRING
  if (!connectionString) {
    throw new Error('SQL_CONNECTION_STRING no está configurada')
  }

  const pool = new sql.ConnectionPool(connectionString)

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
