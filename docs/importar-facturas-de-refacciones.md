# Importar facturas de refacciones (XML)

Se arrastra la carpeta de XML que se descargó del SAT —con sus subcarpetas por
proveedor— en **Facturas de compra → Importar XML**, y el sistema da de alta las
compras. Lo que el XML no dice se pide una vez y se aprende.

Ver `db/migrations/070_importar_cfdi_de_refacciones.sql`.

## Qué se deja fuera, solo

- **Notas de crédito (E)**, complementos de pago (P) y demás que no son compra.
  Las notas de crédito se ignoran por ahora.
- **Lo que no viene a nombre de la empresa** (`RFC_EMPRESA`, en
  `api/src/shared/empresa.ts` y su copia en `src/src/lib/empresa.ts`).
- Lo que no se puede leer, con el motivo: otra moneda, impuestos que no son IVA,
  retenciones, tasas de IVA mezcladas, conceptos que no suman lo impreso.
- La que ya se importó (por UUID) y la que ya estaba capturada a mano con ese
  folio —con o sin serie—. No se fusiona: se rechaza.

## Lo que el XML no dice

| dato | cómo se resuelve |
|---|---|
| sucursal que recibe | se elige una vez por importación |
| quién compró | se escribe una vez por importación |
| proveedor | **por RFC** (`proveedores.rfc`). La primera vez de un RFC se elige del catálogo o se da de alta con el nombre del XML; se le queda |
| qué es cada concepto | **por número de parte del proveedor** (`NoIdentificacion`), en `proveedor_conceptos`. La primera vez lo decide una persona; las siguientes llega puesto |

**No se adivina por la descripción.** Es la misma regla de la revisión: casar
por parecido se equivoca en silencio. La única sugerencia es el tipo: las claves
del SAT de 70000000 en adelante son servicios y se proponen como mano de obra.

Cada concepto es una de tres cosas:

- **Refacción**: entra al almacén como lote. Se elige del catálogo o se da de alta
  ahí mismo (número de serie sugerido desde el número de parte).
- **Mano de obra**: va a `facturas_mano_obra`, en un solo renglón por factura
  (un importe por servicio, 046) y **sin ligar a mantenimiento**: en el cuadre
  sale como cobro por ligar, que es lo cierto hasta que alguien lo ligue.
- **Otro cargo**: gasto que no es mercancía ni trabajo —el "cargo por usado" de
  una batería, un flete—. Va a `facturas_cargos`: no tiene lote ni existencia,
  pero cuenta en el subtotal y en el total de la factura.

### Litros y otras unidades

Los lotes son de piezas enteras. Cuando la unidad del XML no es pieza (litros,
kilos) o la cantidad trae decimales, se pregunta **cuánto trae cada pieza**: 10 L
de aceite en botes de 1 L son 10 piezas; en botes de 600 ml, contenido 0.6. Si no
salen piezas enteras, no se importa. El contenido se aprende con el número de
parte.

## El descuento

El CFDI trae el descuento por concepto; el sistema lo guarda por factura
(`descuento_pct`, 021).

- **Todos los conceptos con el mismo %** (incluida la mano de obra y los
  cargos): se guarda a precio de lista con ese descuento.
- **Si no es parejo** —típico: refacciones con 5% y mano de obra sin descuento—,
  cada concepto se guarda ya descontado y la factura sin descuento.

Con las facturas de octubre de 2026 el total que calcula el sistema da el del
papel, salvo un centavo en algunas por redondear a dos decimales precios que el
XML trae con seis.

## Revisión

Se importa con el **papel ya transcrito** (`facturas_renglones`, ligado a cada
lote): el cuadre sale sin diferencias de refacciones. **No se sella**: el admin
la mira, cuadra la cabecera y la sella, como cualquier otra. Las importadas
llevan la insignia **XML** en la lista.

## Endpoints

| Ruta | Rol | Qué hace |
|---|---|---|
| `POST /facturas/importar` | admin, editor | Importa una factura ya leída del XML, con lo decidido de cada concepto |
| `GET /proveedores/{id}/conceptos` | admin, editor | Lo aprendido de los números de parte de un proveedor |

## Lo que quedó fuera

- **Notas de crédito.** La devolución de cascos de Baterías & Lubricantes llega
  como nota de crédito y hoy se ignora; el cargo que devuelve sí queda como gasto
  en su factura.
- **Descarga automática del SAT o del correo.** Pide la e.firma en el servidor o
  acceso al buzón; por ahora la carpeta se descarga y se arrastra.
- **Fecha de llegada.** Lo importado entra como ya en el estante.
- **Los cargos en los reportes de costos** por vehículo y de gasto por
  proveedor: esos suman lotes. Los cargos solo cuentan en el total de la factura.
