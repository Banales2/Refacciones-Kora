// Leer los renglones de una factura de gasolinera pegados como texto.
//
// Teclear a mano los tickets de cada factura es el trabajo que hace que nadie
// concilie. El desglose del CFDI se puede seleccionar y pegar, así que esto lo
// convierte en renglones.
//
// NO PRETENDE ENTENDER EL PDF. Los PDF de las gasolineras no comparten formato y
// un parser que intente adivinar cuál es cuál se equivoca en silencio, que es la
// peor forma de equivocarse con dinero. Lo que hace es mucho más modesto: toma
// una línea, saca los números que traiga y los interpreta por posición, con una
// regla fija que se puede explicar en una frase. Lo que no encaje se reporta como
// error y se teclea a mano.
//
// LA REGLA, según cuántos números traiga la línea:
//
//   4 -> litros, precio unitario, importe     (y el texto de antes es el ticket)
//   3 -> litros, precio unitario, importe
//   2 -> litros, importe
//
// El ticket sale del primer trozo que no sea uno de esos números: en el CFDI es
// el "No. Identificación" completo ("PL/6809/EXP/ES/2015-8367437"), y se guarda
// entero porque el servidor ya compara por su último tramo.

export interface RenglonPegado {
  ticket: string | null
  producto: string | null
  litros: number
  precio_unitario: number | null
  importe: number
}

export interface ResultadoPegado {
  renglones: RenglonPegado[]
  /** Las líneas que no se pudieron leer, con su número, para enseñarlas. */
  errores: { linea: number; texto: string }[]
}

const PRODUCTOS = ['DIESEL', 'MAGNA', 'PREMIUM', 'GASOLINA']

/** Un número con posibles separadores de miles: "1,234.56" -> 1234.56 */
function aNumero(t: string): number | null {
  const limpio = t.replace(/[$,\s]/g, '')
  if (!/^\d+(\.\d+)?$/.test(limpio)) return null
  const n = Number(limpio)
  return Number.isFinite(n) ? n : null
}

export function leerRenglonesPegados(texto: string): ResultadoPegado {
  const renglones: RenglonPegado[] = []
  const errores: { linea: number; texto: string }[] = []

  const lineas = texto.split(/\r?\n/)
  for (const [i, cruda] of lineas.entries()) {
    const linea = cruda.trim()
    if (linea === '') continue

    // Se parte por tabulador, coma o dos o más espacios. Un espacio solo no
    // sirve: el identificador del CFDI y el producto pueden traerlos dentro.
    const trozos = linea.split(/\t|,(?=\s)|\s{2,}|;/).map((t) => t.trim()).filter(Boolean)
    const planos = trozos.length > 1 ? trozos : linea.split(/\s+/)

    const numeros: number[] = []
    const textos: string[] = []
    for (const t of planos) {
      const n = aNumero(t)
      if (n !== null) numeros.push(n)
      else textos.push(t)
    }

    let litros: number | null = null
    let precio: number | null = null
    let importe: number | null = null
    // Los números que no son ninguno de los tres valores. De aquí sale el ticket
    // cuando viene suelto y numérico ("8368392, 57.91, 23.33, 1351.35").
    let sobrantes: number[] = []

    if (numeros.length >= 3) {
      // Con tres o más se toman los tres últimos: si el emisor antepone una
      // clave numérica (15101505), queda fuera sola.
      const [l, p, im] = numeros.slice(-3)
      litros = l; precio = p; importe = im
      sobrantes = numeros.slice(0, -3)
    } else if (numeros.length === 2) {
      litros = numeros[0]; importe = numeros[1]
    }

    if (litros === null || importe === null || litros <= 0 || importe < 0) {
      errores.push({ linea: i + 1, texto: linea })
      continue
    }

    const producto = textos.find((t) => PRODUCTOS.includes(t.toUpperCase())) ?? null
    // El ticket es el texto más largo que no sea el producto ni la unidad: en el
    // CFDI es el identificador, que siempre es lo más largo de la línea.
    const ticketTexto = textos
      .filter((t) => t !== producto && !/^(LTR|LT|L|PZA)$/i.test(t))
      .sort((a, b) => b.length - a.length)[0] ?? null

    // Si no hay identificador de texto, el ticket puede venir suelto y numérico.
    // Se toma el último de los sobrantes —el más pegado a los valores— y solo si
    // es un entero largo: los cortos son claves de producto, no folios.
    const ticketNumerico = sobrantes
      .filter((n) => Number.isInteger(n) && String(n).length >= 5)
      .slice(-1)[0]

    const ticket = ticketTexto
      ?? (ticketNumerico !== undefined ? String(ticketNumerico) : null)

    renglones.push({
      ticket,
      producto,
      litros,
      precio_unitario: precio,
      importe,
    })
  }

  return { renglones, errores }
}
