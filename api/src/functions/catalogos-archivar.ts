import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { z } from 'zod'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import * as service from '../services/archivadoService'
import type { TablaArchivable } from '../repositories/archivadoRepo'

// Archivar un catálogo sustituye a borrarlo (migración 033). Dos acciones, las
// dos POST: `/archivar` y `/restaurar`. Lo que se pone y se quita aquí es el
// archivado, no el renglón, que no se borra nunca desde la aplicación.
//
// Son dos rutas y no una con dos verbos porque la API no expone DELETE en
// ninguna parte, para poder bloquear el verbo entero en el borde. Ver
// docs/sin-delete.md.
//
// Las ocho rutas se registran desde un solo archivo porque el manejador es
// literalmente el mismo y lo único que cambia es la tabla. Ocho copias del
// mismo bloque era la forma segura de que a la séptima se le olvidara la
// auditoría.
const Schema = z.object({
  motivo: z.string().trim().max(200, 'Máximo 200 caracteres').optional(),
})

interface Catalogo {
  /** Tabla real; también es lo que se anota en la auditoría. */
  tabla:    TablaArchivable
  /** Prefijo de la ruta HTTP, que no siempre coincide con la tabla. */
  ruta:     string
  /** Cómo se le nombra en los mensajes de error. */
  etiqueta: string
}

const CATALOGOS: Catalogo[] = [
  { tabla: 'sucursales',  ruta: 'sucursales',  etiqueta: 'La sucursal'     },
  { tabla: 'rutas',       ruta: 'rutas',       etiqueta: 'La ruta'         },
  { tabla: 'gasolineras', ruta: 'gasolineras', etiqueta: 'La gasolinera'   },
  { tabla: 'conductores', ruta: 'conductores', etiqueta: 'El conductor'    },
  { tabla: 'tecnicos',    ruta: 'tecnicos',    etiqueta: 'El técnico'      },
  { tabla: 'proveedores', ruta: 'proveedores', etiqueta: 'El proveedor'    },
  // La tabla se llama `piezas` y la ruta `refacciones`: el nombre de la ruta
  // es el que se quedó en la API y las pantallas, y renombrarlo no es de esta
  // migración.
  { tabla: 'piezas',      ruta: 'refacciones', etiqueta: 'La refacción'    },
  { tabla: 'tipos_pieza', ruta: 'tipos-pieza', etiqueta: 'El tipo de pieza' },
]

function handler(cat: Catalogo, accion: 'archivar' | 'restaurar') {
  return async function archivarCatalogo(
    req: HttpRequest, ctx: InvocationContext,
  ): Promise<HttpResponseInit> {
    try {
      const user = requireRole(req, 'admin')
      const id = parseInt(req.params.id, 10)
      if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }

      const antes = await capturar(cat.tabla, id)
      if (accion === 'restaurar') {
        await service.restaurar(cat.tabla, cat.etiqueta, id)
      } else {
        const { motivo } = Schema.parse(await req.json().catch(() => ({})))
        await service.archivar(cat.tabla, cat.etiqueta, id, motivo)
      }

      await audit({
        user,
        accion: 'EDITAR',
        tabla: cat.tabla,
        registroId: id,
        antes,
        despues: await capturar(cat.tabla, id),
        ipAddress: getClientIp(req),
      })
      return { status: 204 }
    } catch (err) { return handleError(err, ctx) }
  }
}

for (const cat of CATALOGOS) {
  for (const accion of ['archivar', 'restaurar'] as const) {
    app.http(`${cat.ruta}-${accion}`, {
      methods: ['POST'],
      route: `${cat.ruta}/{id}/${accion}`,
      authLevel: 'anonymous',
      handler: handler(cat, accion),
    })
  }
}
