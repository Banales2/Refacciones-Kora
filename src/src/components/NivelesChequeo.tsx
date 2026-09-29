// Los niveles que se leyeron en un chequeo —aceite, líquidos, combustible—
// aunque ninguno haya sido falla.
//
// Un nivel en 1/2 no abre incidencia, pero es el antecedente: si mañana sale en
// 1/4, lo que importa es que ayer ya venía bajando. Sin esta línea el chequeo
// solo enseñaba las fallas y ese dato no se veía en ningún lado.
//
// En amarillo el nivel que queda justo arriba del umbral de falla: todavía no
// es problema, pero es el siguiente paso antes de serlo.
import { Badge, Group, Text } from '@mantine/core'
import { ITEMS_CHEQUEO, NIVELES_TANQUE } from '../lib/chequeoItems'
import type { ChequeoItem } from '../hooks/useChequeos'

function etiquetaNivel(valor: string): string {
  return NIVELES_TANQUE.find((n) => n.valor === valor)?.label ?? valor
}

// Un cuarto arriba del umbral de falla.
function alBorde(umbral: string | undefined, valor: string): boolean {
  if (!umbral) return false
  const i = NIVELES_TANQUE.findIndex((n) => n.valor === valor)
  const u = NIVELES_TANQUE.findIndex((n) => n.valor === umbral)
  return i >= 0 && u >= 0 && i === u + 1
}

export default function NivelesChequeo({ items }: { items: ChequeoItem[] }) {
  const niveles = items.flatMap((it) => {
    const def = ITEMS_CHEQUEO.find((d) => d.clave === it.clave && d.captura === 'fraccion')
    return def && it.valor ? [{ it, def }] : []
  })
  if (niveles.length === 0) return null

  return (
    <Group gap={4} wrap="wrap">
      <Text size="xs" c="dimmed">Niveles:</Text>
      {niveles.map(({ it, def }) => (
        <Badge
          key={it.clave}
          size="xs"
          variant="light"
          color={it.resultado === 'falla' ? 'red' : alBorde(def.umbralFalla, it.valor!) ? 'yellow' : 'gray'}
          style={{ textTransform: 'none' }}
        >
          {def.label} {etiquetaNivel(it.valor!)}
        </Badge>
      ))}
    </Group>
  )
}
