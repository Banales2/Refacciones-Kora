// Leer los renglones de una factura de gasolinera pegados como texto.
//
// Teclear a mano los renglones de cada factura es el trabajo que hace que nadie
// concilie. El desglose del PDF se puede seleccionar y pegar, así que esto lo
// convierte en renglones.
//
// NO PRETENDE ENTENDER EL PDF. Los PDF de las gasolineras no comparten formato y
// un parser que intente adivinar cuál columna es cuál se equivoca en silencio,
// que es la peor forma de equivocarse con dinero. Lo que hace es mucho más
// modesto: toma una línea, saca los números que traiga y los interpreta por
// posición, con una regla fija que se puede explicar en una frase. Lo que no
// encaje se reporta como error y se teclea a mano.
//
// LA REGLA: de los números de la línea, los DOS ÚLTIMOS son cantidad e importe
// cuando hay dos, y cuando hay tres o más son cantidad, precio e importe — el
// precio unitario se descarta, porque no se guarda: sale de dividir. Lo demás de
// la línea que sea texto se toma como descripción.
import type { RenglonNuevo } from '../hooks/useFacturasGasolina'

export interface ResultadoPegado {
  renglones: RenglonNuevo[]
  /** Las líneas que no se pudieron leer, con su número, para enseñarlas. */
  errores: { linea: number; texto: string }[]
}

/** Un número con posibles separadores de miles: "1,234.56" -> 1234.56 */
function aNumero(t: string): number | null {
  const limpio = t.replace(/[$,\s]/g, '')
  if (!/^\d+(\.\d+)?$/.test(limpio)) return null
  const n = Number(limpio)
  return Number.isFinite(n) ? n : null
}

export function leerRenglonesPegados(texto: string): ResultadoPegado {
  const renglones: RenglonNuevo[] = []
  const errores: { linea: number; texto: string }[] = []

  for (const [i, cruda] of texto.split(/\r?\n/).entries()) {
    const linea = cruda.trim()
    if (linea === '') continue

    // Se parte por tabulador, coma o dos o más espacios. Un espacio solo no
    // sirve: la descripción puede traerlos dentro.
    const trozos = linea.split(/\t|,(?=\s)|\s{2,}|;/).map((t) => t.trim()).filter(Boolean)
    const planos = trozos.length > 1 ? trozos : linea.split(/\s+/)

    const numeros: number[] = []
    const textos: string[] = []
    for (const t of planos) {
      const n = aNumero(t)
      if (n !== null) numeros.push(n)
      else textos.push(t)
    }

    let cantidad: number | null = null
    let importe: number | null = null

    if (numeros.length >= 3) {
      // Tres o más: cantidad, precio unitario e importe. El precio se descarta
      // —no se guarda, sale de dividir— y si el emisor antepone claves numéricas
      // quedan fuera solas.
      const ultimos = numeros.slice(-3)
      cantidad = ultimos[0]
      importe = ultimos[2]
    } else if (numeros.length === 2) {
      cantidad = numeros[0]
      importe = numeros[1]
    }

    if (cantidad === null || importe === null || cantidad <= 0 || importe < 0) {
      errores.push({ linea: i + 1, texto: linea })
      continue
    }

    // La descripción es lo que quede de texto, sin la unidad. Se junta tal cual:
    // es una copia de lo impreso, no algo con lo que se opere.
    const descripcion = textos
      .filter((t) => !/^(LTR|LT|L|PZA|PZ)$/i.test(t))
      .join(' ')
      .slice(0, 100) || null

    renglones.push({ descripcion, cantidad, importe })
  }

  return { renglones, errores }
}
