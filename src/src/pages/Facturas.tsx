// Las facturas de compra, en pantalla completa.
//
// Tiene sección propia porque es donde trabaja quien las verifica: llega con el
// fajo de papeles y se sienta un rato, factura por factura. Mientras el drawer
// de Refacciones era solo para corregirle el IVA a una compra vieja, colgar de
// ahí bastaba; una bandeja de trabajo diaria escondida detrás de un botón de
// otra sección, no.
//
// El botón de Refacciones sigue existiendo y abre lo mismo: es el atajo para
// cuando ya estás viendo una refacción y quieres su compra. Las dos entradas
// comparten `FacturasPanel`, así que no pueden divergir.
//
// Ver `docs/revision-de-facturas.md`.
import { Stack, Text } from '@mantine/core'
import { FacturasPanel } from '../components/FacturasDrawer'

export default function Facturas() {
  return (
    <Stack gap="md">
      <div>
        <Text fw={700} size="lg">Facturas de compra</Text>
        <Text size="sm" c="dimmed">
          Cada factura son los renglones que comparten folio y proveedor. Aquí se
          cuadran contra el papel original, renglón por renglón, y se les corrige
          lo que esté mal antes de sellarlas.
        </Text>
      </div>

      <FacturasPanel />
    </Stack>
  )
}
