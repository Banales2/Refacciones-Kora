-- Bitácora de cambios. Guarda quién tocó qué y cuándo.
--
-- Dos decisiones que conviene no deshacer sin pensarlo:
--
-- 1. No hay llave foránea contra `usuarios`. El registro debe sobrevivir a que
--    se dé de baja a la persona que lo generó — es justo entonces cuando más
--    falta hace. Por eso se copian el correo y el nombre al insertar, en lugar
--    de resolverlos por JOIN al consultar.
-- 2. `fecha_hora` va en UTC (SYSUTCDATETIME). La conversión a hora de México se
--    hace al mostrar. Guardar hora local haría ambiguo el registro dos veces al
--    año, en el cambio de horario.

IF OBJECT_ID('dbo.registros_cambios', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.registros_cambios (
    id             bigint         IDENTITY(1,1) NOT NULL,
    fecha_hora     datetime2(3)   NOT NULL
                   CONSTRAINT DF_registros_cambios_fecha DEFAULT SYSUTCDATETIME(),
    usuario_email  nvarchar(255)  NOT NULL,
    usuario_nombre nvarchar(100)  NULL,
    usuario_id     nvarchar(100)  NULL,
    accion         nvarchar(20)   NOT NULL,
    tabla          nvarchar(80)   NOT NULL,
    registro_id    nvarchar(60)   NULL,
    -- Frase legible ya resuelta: "Vehículo Nissan NP300 · serie 3N6 · placas
    -- ABC-123". Se arma al escribir porque tras un borrado ya no hay forma de
    -- reconstruirla.
    descripcion    nvarchar(max)  NULL,
    -- JSON con el diff campo a campo y el snapshot completo de lo eliminado.
    detalles       nvarchar(max)  NULL,
    ip             nvarchar(60)   NULL,
    CONSTRAINT PK_registros_cambios PRIMARY KEY (id),
    CONSTRAINT CK_registros_cambios_accion CHECK (
      accion IN ('CREAR', 'EDITAR', 'ELIMINAR', 'LOGIN', 'EXPORTAR', 'VER_SENSIBLE')
    )
  );

  -- La consulta por defecto es "lo último primero", sin filtro.
  CREATE INDEX IX_registros_cambios_fecha
    ON dbo.registros_cambios (fecha_hora DESC);

  -- "Todo lo que hizo esta persona", que es la segunda pregunta más frecuente.
  CREATE INDEX IX_registros_cambios_usuario
    ON dbo.registros_cambios (usuario_email, fecha_hora DESC);

  -- "Historial de este vehículo": el filtro llega por tabla + id.
  CREATE INDEX IX_registros_cambios_tabla
    ON dbo.registros_cambios (tabla, registro_id, fecha_hora DESC);
END
