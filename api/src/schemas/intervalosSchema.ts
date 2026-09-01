import { z } from 'zod'
import { KM_MAX } from './common'
import { MAX_INTERVALOS_INICIALES } from '../shared/intervalos'

// Los primeros servicios de un preventivo que no siguen el intervalo de ciclo,
// en orden y como distancias entre servicios: [5000, 10000] con
// intervalo_km = 15000 significa primer servicio a los 5,000 km, segundo 10,000
// km después de ese, y del tercero en adelante cada 15,000.
//
// Ausente = no se toca lo que ya estaba. null o [] = sin excepciones, todos los
// servicios al mismo intervalo.
export const IntervalosInicialesSchema = z
  .array(z.coerce.number().int().positive().max(KM_MAX, 'Máximo 9,999,999 km'))
  .max(MAX_INTERVALOS_INICIALES, `Máximo ${MAX_INTERVALOS_INICIALES} primeros servicios`)
  .nullable()
  .optional()
