-- Fecha en que se emitió (se sacó) el permiso de circulación. Varios permisos
-- pueden ser de la misma zona, pero nunca se sacan dos de la misma zona el
-- mismo día (unicidad zona_circulacion + fecha_emision, validada en el backend).
-- Nullable para no romper los permisos ya existentes.

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.permisos_circulacion') AND name = 'fecha_emision'
)
BEGIN
  ALTER TABLE dbo.permisos_circulacion ADD fecha_emision DATE NULL;
END
GO
