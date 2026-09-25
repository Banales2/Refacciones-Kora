// Qué le pasó a un vale de gasolina.
//
// El estado no se guarda —salvo el archivado, que es una decisión de alguien y
// no un hecho derivable—; se calcula al leerlo. Ver la cabecera de la
// migración 055.

export type EstadoVale = 'creado' | 'usado' | 'perdido' | 'archivado'

/**
 * Cuántos días sin usarse convierten un vale en perdido.
 *
 * Vive aquí y no en la base porque es una política, no una regla del dato: el
 * día que se quiera pasar a tres días, esto es una línea y no una migración.
 *
 * Dos es corto a propósito. Un vale se entrega para cargar ese día o el
 * siguiente; si a las 48 horas nadie lo gastó, o se perdió o alguien lo trae en
 * la cartera, y las dos cosas hay que salir a preguntarlas mientras todavía se
 * acuerdan de él.
 */
export const DIAS_PARA_PERDERSE = 2

/**
 * El estado de un vale, como expresión SQL.
 *
 * El orden de los CASE es la precedencia, y no es arbitrario:
 *
 *   archivado gana sobre todo: es la decisión de una persona, y mientras esté
 *             puesta no importa lo que digan las fechas.
 *   usado     gana sobre perdido: un vale que apareció y se gastó ya no está
 *             perdido, aunque haya tardado dos semanas.
 *   perdido   es el que nadie gastó y ya pasó el plazo.
 *   creado    todo lo demás.
 *
 * `alias` es el alias de `vales_gasolina` en la consulta.
 */
export function estadoDelVale(alias = 'vg'): string {
  return `
    CASE
      WHEN ${alias}.archivado_en IS NOT NULL THEN 'archivado'
      WHEN EXISTS (SELECT 1 FROM recargas_combustible rc WHERE rc.vale_id = ${alias}.id)
        THEN 'usado'
      WHEN ${alias}.fecha <= DATEADD(day, -${DIAS_PARA_PERDERSE},
             CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'Central Standard Time (Mexico)' AS date))
        THEN 'perdido'
      ELSE 'creado'
    END`
}
