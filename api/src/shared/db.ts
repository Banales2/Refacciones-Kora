import * as sql from 'mssql'

let pool: sql.ConnectionPool | null = null

export async function getPool(): Promise<sql.ConnectionPool> {
  if (pool && pool.connected) return pool

  const connectionString = process.env.SQL_CONNECTION_STRING
  if (!connectionString) {
    throw new Error('SQL_CONNECTION_STRING no está configurada')
  }

  pool = await new sql.ConnectionPool(connectionString).connect()

  pool.on('error', (err) => {
    console.error('Error en el pool de SQL:', err.message)
    pool = null
  })

  return pool
}