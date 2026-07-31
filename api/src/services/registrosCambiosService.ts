import * as repo from '../repositories/registrosCambiosRepo'
import { etiquetaDe } from '../shared/audit'

// La bitácora guarda UTC; los filtros de fecha llegan como día natural mexicano
// («del 3 al 5 de agosto»). México dejó de aplicar horario de verano en 2022,
// así que la zona central es UTC-6 todo el año y basta un desplazamiento fijo.
//
// Se hace aquí y no en SQL porque `fecha_hora AT TIME ZONE ...` en el WHERE
// impide usar el índice por fecha: obliga a convertir cada fila antes de
// comparar. Corriendo los límites, la comparación sigue siendo directa.
const OFFSET_HORAS = 6

/** Las 00:00 de ese día en México, expresadas en UTC. */
function inicioDelDia(fecha: string): Date {
  return new Date(Date.parse(`${fecha}T00:00:00.000Z`) + OFFSET_HORAS * 3600_000)
}

/** El día siguiente a las 00:00 locales: el filtro `hasta` es exclusivo, así
 *  que «hasta el 5» incluye todo el día 5. */
function finDelDia(fecha: string): Date {
  const d = inicioDelDia(fecha)
  return new Date(d.getTime() + 24 * 3600_000)
}

export interface Consulta {
  usuario?: string
  accion?:  string
  tabla?:   string
  desde?:   string
  hasta?:   string
  texto?:   string
  pagina:   number
  tamano:   number
}

export async function listar(c: Consulta) {
  const { data, total } = await repo.buscar({
    usuario: c.usuario,
    accion:  c.accion,
    tabla:   c.tabla,
    desde:   c.desde ? inicioDelDia(c.desde) : undefined,
    hasta:   c.hasta ? finDelDia(c.hasta) : undefined,
    texto:   c.texto,
    pagina:  c.pagina,
    tamano:  c.tamano,
  })

  return {
    data: data.map((r) => ({ ...r, etiqueta: etiquetaDe(r.tabla) })),
    total,
    pagina: c.pagina,
    tamano: c.tamano,
  }
}

export async function filtros() {
  const { usuarios, tablas } = await repo.opciones()
  return {
    usuarios,
    tablas: tablas.map((t) => ({ tabla: t, etiqueta: etiquetaDe(t) })),
  }
}
