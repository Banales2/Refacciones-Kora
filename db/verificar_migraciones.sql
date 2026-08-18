-- Estado de las migraciones aplicadas. No modifica nada: solo reporta que
-- existe y que no. Correr entero, sin seleccionar.
--
-- Cada renglon debe decir 'OK'. Los que digan 'FALTA' indican que esa parte de
-- la migracion no llego a aplicarse.

SELECT '001 lotes_pieza.sucursal_id' AS objeto,
       CASE WHEN COL_LENGTH('dbo.lotes_pieza', 'sucursal_id') IS NULL THEN 'FALTA' ELSE 'OK' END AS estado
UNION ALL SELECT '001 detalle_mtto_pieza.sucursal_id',
       CASE WHEN COL_LENGTH('dbo.detalle_mtto_pieza', 'sucursal_id') IS NULL THEN 'FALTA' ELSE 'OK' END
UNION ALL SELECT '001 piezas_vehiculo.lote_id',
       CASE WHEN COL_LENGTH('dbo.piezas_vehiculo', 'lote_id') IS NULL THEN 'FALTA' ELSE 'OK' END
UNION ALL SELECT '001 tabla instalaciones_pieza',
       CASE WHEN OBJECT_ID('dbo.instalaciones_pieza', 'U') IS NULL THEN 'FALTA' ELSE 'OK' END
UNION ALL SELECT '002 tabla existencias_lote',
       CASE WHEN OBJECT_ID('dbo.existencias_lote', 'U') IS NULL THEN 'FALTA' ELSE 'OK' END
UNION ALL SELECT '002 tabla traspasos_pieza',
       CASE WHEN OBJECT_ID('dbo.traspasos_pieza', 'U') IS NULL THEN 'FALTA' ELSE 'OK' END
UNION ALL SELECT '002 tabla minimos_sucursal',
       CASE WHEN OBJECT_ID('dbo.minimos_sucursal', 'U') IS NULL THEN 'FALTA' ELSE 'OK' END
UNION ALL SELECT '003 tipos_pieza_modelo.etiqueta',
       CASE WHEN COL_LENGTH('dbo.tipos_pieza_modelo', 'etiqueta') IS NULL THEN 'FALTA' ELSE 'OK' END
UNION ALL SELECT '003 tipos_pieza_vehiculo.etiqueta',
       CASE WHEN COL_LENGTH('dbo.tipos_pieza_vehiculo', 'etiqueta') IS NULL THEN 'FALTA' ELSE 'OK' END
UNION ALL SELECT '003 piezas_vehiculo.etiqueta',
       CASE WHEN COL_LENGTH('dbo.piezas_vehiculo', 'etiqueta') IS NULL THEN 'FALTA' ELSE 'OK' END
UNION ALL SELECT '003 instalaciones_pieza.etiqueta',
       CASE WHEN COL_LENGTH('dbo.instalaciones_pieza', 'etiqueta') IS NULL THEN 'FALTA' ELSE 'OK' END
-- Las claves unicas viejas (dueno, tipo) tienen que haber cedido su lugar a las
-- que llevan etiqueta: si no, la BD sigue impidiendo repetir un tipo.
UNION ALL SELECT '003 UX tipos_pieza_modelo con etiqueta',
       CASE WHEN EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_tipos_pieza_modelo_tipo_etiqueta')
            THEN 'OK' ELSE 'FALTA' END
UNION ALL SELECT '003 UX tipos_pieza_vehiculo con etiqueta',
       CASE WHEN EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_tipos_pieza_vehiculo_tipo_etiqueta')
            THEN 'OK' ELSE 'FALTA' END
UNION ALL SELECT '003 UX piezas_vehiculo con etiqueta',
       CASE WHEN EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_piezas_vehiculo_tipo_etiqueta')
            THEN 'OK' ELSE 'FALTA' END
UNION ALL SELECT '003 UX instalaciones_pieza vigente por etiqueta',
       CASE WHEN EXISTS (
                SELECT 1 FROM sys.indexes i
                WHERE i.name = 'UX_instalaciones_pieza_vigente'
                  AND (SELECT COUNT(*) FROM sys.index_columns ic
                       WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id
                         AND ic.is_included_column = 0) = 3)
            THEN 'OK' ELSE 'FALTA' END;
GO

-- Restricciones unicas que sobrevivan sobre (dueno, tipo_pieza_id) sin etiqueta.
-- Debe salir vacio: cualquier renglon aqui es una regla vieja que sigue
-- bloqueando el segundo filtro de aire. Las PK entran a proposito - la 003 no
-- las toca, y si alguna de estas tablas tuviera su clave primaria sobre ese par
-- habria que resolverlo a mano antes de que el codigo nuevo sirva.
SELECT OBJECT_NAME(i.object_id) AS tabla, i.name AS indice, i.is_primary_key AS es_pk
FROM sys.indexes i
WHERE i.object_id IN (OBJECT_ID('dbo.tipos_pieza_modelo'),
                      OBJECT_ID('dbo.tipos_pieza_vehiculo'),
                      OBJECT_ID('dbo.piezas_vehiculo'))
  AND i.is_unique = 1
  AND (SELECT COUNT(*) FROM sys.index_columns ic
       WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id
         AND ic.is_included_column = 0) = 2
  AND EXISTS (
      SELECT 1 FROM sys.index_columns ic
      JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
      WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id
        AND ic.is_included_column = 0 AND c.name = 'tipo_pieza_id');
GO

-- Cuanto hay que migrar y cuanto se migro. `piezas_antes` y `piezas_ahora`
-- deben coincidir una vez corrido el backfill de la 002.
SELECT
    (SELECT COUNT(*) FROM dbo.sucursales)                                AS sucursales,
    (SELECT COUNT(*) FROM dbo.lotes_pieza)                               AS lotes,
    (SELECT COALESCE(SUM(cantidad_disponible), 0) FROM dbo.lotes_pieza)  AS piezas_antes,
    (SELECT COUNT(*) FROM dbo.existencias_lote)                          AS filas_de_existencia,
    (SELECT COALESCE(SUM(cantidad), 0) FROM dbo.existencias_lote)        AS piezas_ahora;
GO
