-- Tipos de pieza que necesita un vehículo en particular y su modelo no pide:
-- una unidad puede requerir aceite de transmisión aunque el resto del modelo no.
-- Se suman a los del modelo (tipos_pieza_modelo); no lo reemplazan ni lo tocan,
-- así que quitar el tipo aquí no afecta a los demás vehículos del modelo.
--
-- Va después de 2026-07-16_tipos_pieza.sql.
IF OBJECT_ID('dbo.tipos_pieza_vehiculo', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.tipos_pieza_vehiculo (
    id            INT IDENTITY(1,1) NOT NULL CONSTRAINT pk_tipos_pieza_vehiculo PRIMARY KEY,
    vehiculo_id   INT NOT NULL CONSTRAINT fk_tpv_vehiculo REFERENCES dbo.vehiculos (id) ON DELETE CASCADE,
    tipo_pieza_id INT NOT NULL CONSTRAINT fk_tpv_tipo     REFERENCES dbo.tipos_pieza (id),
    CONSTRAINT uq_tipos_pieza_vehiculo UNIQUE (vehiculo_id, tipo_pieza_id)
  );
END
GO
