# La API no expone el verbo DELETE

Ninguna ruta de `api/src/functions` registra `methods: ['DELETE']`, y el cliente
(`src/src/lib/api.ts`) no tiene un `api.delete`. Lo que antes era un `DELETE` hoy
es un `POST` a una acción con nombre: `/quitar`, `/deshacer`, `/archivar`,
`/restaurar`, `/descontinuar`, `/revivir`.

## Por qué

**No es por el verbo en sí.** Quien tenga una sesión válida puede llamar a un
`POST` tan fácil como a un `DELETE`; cambiarle el nombre a la puerta no la
cierra. Los frenos que de verdad limitan el daño de una cuenta comprometida
están en otro lado y no dependen de esto:

- `requireRole(req, 'admin')` en las rutas destructivas.
- El límite de escritura de `shared/rateLimit.ts`: 60 por minuto y por usuario,
  contando `POST`, `PUT`, `PATCH` y `DELETE` por igual. Es lo que corta una
  ráfaga automatizada, y por eso pasar de `DELETE` a `POST` no lo debilita.
- La bitácora: toda operación destructiva pasa por `audit()` con el snapshot de
  antes, así que un borrado en masa queda registrado renglón por renglón.

Lo que sí gana la regla es **poder bloquear el verbo entero en el borde** —una
regla de WAF, de Front Door o de la propia Static Web App que rechace `DELETE`
antes de llegar a la función— sin miedo a tumbar algo que funcionaba. Esa
barrera no depende de que ningún endpoint esté bien escrito, que es justo lo
valioso: sigue en pie aunque mañana alguien agregue una ruta descuidada.

El segundo beneficio es que la regla se verifica con un `grep`:

```
grep -rn "'DELETE'" api/src/functions/   # no debe devolver nada
grep -rn "api\.delete"  src/src/         # no debe devolver nada
```

## Qué queda borrando de verdad

El verbo desapareció; el borrado de filas no, y no son lo mismo. Desde la
aplicación ya no se borra ninguna **entidad** —vehículos, modelos y los ocho
catálogos se archivan o se dan de baja, ver migraciones 032 y 033—, pero los
**vínculos de configuración** sí siguen borrando su renglón:

- qué tipo de pieza pide un modelo o lleva una unidad,
- qué refacción está montada en un renglón,
- las operaciones y fases de un programa,
- garantías, precios de proveedor, mínimos de inventario, agendas,
- el detalle de refacciones de un mantenimiento en captura.

Son decisiones de armado, no historia, y bloquearlas volvería impracticable
configurar un modelo. Todas piden confirmación antes (`ConfirmarQuitar`).

Borrar una entidad de la base es, a propósito, una operación manual por SQL.
