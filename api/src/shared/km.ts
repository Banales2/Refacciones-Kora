import * as sql from 'mssql'

// Tipo SQL de una lectura de odómetro: un decimal, como marca el tablero
// (migración 058). Los intervalos del programa y los límites de garantía
// siguen como INT: son números del manual, no lecturas.
export const SQL_KM = sql.Decimal(12, 1)
