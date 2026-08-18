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
       CASE WHEN OBJECT_ID('dbo.minimos_sucursal', 'U') IS NULL THEN 'FALTA' ELSE 'OK' END;
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
