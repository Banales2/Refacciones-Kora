-- Año del modelo. Vive en el modelo para poder distinguir dos modelos con el
-- mismo marca/nombre pero años distintos (que pueden tener requerimientos
-- diferentes). Nullable para no romper los modelos ya existentes.

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.modelos') AND name = 'anio'
)
BEGIN
  ALTER TABLE dbo.modelos ADD anio INT NULL;
END
GO
