-- ============================================================================
-- 001 - Trazabilidad de lote en las piezas montadas
-- ----------------------------------------------------------------------------
-- Hoy `piezas_vehiculo` guarda solo el presente: al cambiar una pieza, el
-- UPDATE sobreescribe la fila y la pieza anterior desaparece. No queda de que
-- compra salio, cuanto duro ni por que se quito.
--
-- Esta migracion agrega:
--   1. lotes_pieza.sucursal_id        - sucursal de recepcion del lote.
--   2. detalle_mtto_pieza.sucursal_id - de que sucursal salio el stock.
--   3. piezas_vehiculo.lote_id        - de que compra salio lo que trae puesto.
--   4. instalaciones_pieza            - la bitacora que no se sobreescribe.
--
-- Dos decisiones de diseno que conviene no perder de vista:
--
-- GRANO. Una fila de `instalaciones_pieza` = una pieza fisica. No lleva ni
-- llevara columna `cantidad`. Gracias a eso, identificar cada pieza
-- individualmente (fase 2) sera agregar una columna `unidad_id` nullable, no
-- reestructurar la tabla. Si aqui se guardaran cantidades, habria que partir
-- filas retroactivamente y seria imposible saber cual unidad fue cual.
--
-- UBICACION. Las columnas `sucursal_id` se agregan aunque el inventario por
-- sucursal todavia no exista. La ubicacion en el momento de un evento NO se
-- puede reconstruir despues: si la columna se agrega dentro de seis meses,
-- todo lo anterior queda en NULL para siempre.
--
-- Requiere el admin del servidor: `app_user` no tiene permisos de DDL.
-- El script es idempotente - se puede volver a correr sin efecto.
--
-- Los comentarios van con `--` a proposito: un comentario de bloque se rompe si
-- el cliente corta los lotes por dentro o si se ejecuta solo una seleccion.
-- ============================================================================

SET XACT_ABORT ON;
GO

-- ---------------------------------------------------------------------------
-- 1. Sucursal de recepcion del lote.
--
-- No la lee nadie todavia. Es la semilla del inventario por sucursal: cuando
-- llegue `existencias_lote (lote_id, sucursal_id, cantidad)`, el backfill es
-- una fila por lote con todo su `cantidad_disponible` en esta sucursal. Sin
-- esta columna, ese backfill es adivinanza.
--
-- Queda NULL en los lotes existentes: no hay de donde sacarlo.
--
-- OJO: como las piezas de un mismo lote van a poder estar regadas entre
-- sucursales, `lotes_pieza.cantidad_disponible` (un solo escalar por lote) ya
-- es una forma condenada. No agregar logica nueva que dependa de ella.
-- ---------------------------------------------------------------------------
IF COL_LENGTH('dbo.lotes_pieza', 'sucursal_id') IS NULL
BEGIN
    ALTER TABLE dbo.lotes_pieza ADD sucursal_id INT NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_lotes_pieza_sucursal')
BEGIN
    ALTER TABLE dbo.lotes_pieza
        ADD CONSTRAINT FK_lotes_pieza_sucursal
        FOREIGN KEY (sucursal_id) REFERENCES dbo.sucursales (id);
END
GO


-- ---------------------------------------------------------------------------
-- 2. Sucursal de la que salio el stock consumido en un mantenimiento.
--
-- Mismo argumento que arriba: irreconstruible despues del hecho.
-- ---------------------------------------------------------------------------
IF COL_LENGTH('dbo.detalle_mtto_pieza', 'sucursal_id') IS NULL
BEGIN
    ALTER TABLE dbo.detalle_mtto_pieza ADD sucursal_id INT NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_detalle_mtto_pieza_sucursal')
BEGIN
    ALTER TABLE dbo.detalle_mtto_pieza
        ADD CONSTRAINT FK_detalle_mtto_pieza_sucursal
        FOREIGN KEY (sucursal_id) REFERENCES dbo.sucursales (id);
END
GO


-- ---------------------------------------------------------------------------
-- 3. De que lote salio la pieza que el vehiculo trae puesta.
--
-- NULL en las filas existentes: nadie registro el lote cuando se asignaron.
-- ---------------------------------------------------------------------------
IF COL_LENGTH('dbo.piezas_vehiculo', 'lote_id') IS NULL
BEGIN
    ALTER TABLE dbo.piezas_vehiculo ADD lote_id INT NULL;
END
GO

-- ON DELETE SET NULL: borrar una refaccion arrastra sus lotes
-- (refaccionesRepo.remove), y eso no debe tumbar la asignacion vigente.
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_piezas_vehiculo_lote')
BEGIN
    ALTER TABLE dbo.piezas_vehiculo
        ADD CONSTRAINT FK_piezas_vehiculo_lote
        FOREIGN KEY (lote_id) REFERENCES dbo.lotes_pieza (id)
        ON DELETE SET NULL;
END
GO


-- ---------------------------------------------------------------------------
-- 4. La bitacora de instalaciones.
--
-- Append-only: cada montaje abre un renglon, cada desmontaje lo cierra con
-- fecha, km y motivo. `piezas_vehiculo` sigue respondiendo "que trae puesto
-- ahora"; esta tabla responde "que ha traido puesto y que le paso".
-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.instalaciones_pieza', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.instalaciones_pieza (
        id                INT IDENTITY(1,1) NOT NULL,

        vehiculo_id       INT NOT NULL,
        tipo_pieza_id     INT NOT NULL,

        -- El SKU se guarda aparte del lote a proposito: `refaccionesRepo.remove`
        -- borra los lotes en cascada al eliminar una refaccion. Sin esta
        -- columna, ese borrado dejaria historial sin identificar. Con ella,
        -- `lote_id` se va a NULL y el renglon sigue diciendo que pieza fue.
        pieza_id          INT NOT NULL,

        -- NULL = instalacion historica (sembrada abajo) o pieza que no vino de
        -- un lote registrado.
        lote_id           INT NULL,

        -- Donde se hizo el trabajo. Se deriva del vehiculo cuando su tipo la
        -- tiene (camiones y montacargas); en tractocamiones, cajas de trailer y
        -- utilitarios queda NULL porque esas tablas hijas no llevan sucursal.
        sucursal_id       INT NULL,

        -- El mantenimiento en el que se hizo el cambio, si se capturo ahi.
        mantenimiento_id  INT NULL,

        fecha_instalacion DATE NULL,   -- NULL solo en los renglones sembrados
        km_instalacion    INT  NULL,

        fecha_retiro      DATE NULL,   -- NULL = montada ahora mismo
        km_retiro         INT  NULL,

        -- 'robo' y 'venta' entran desde ahora aunque todavia no se identifique
        -- cada pieza: son el gancho de la fase 2, y agregarlos despues obligaria
        -- a reclasificar retiros viejos a mano.
        motivo_retiro     NVARCHAR(30) NULL,
        destino           NVARCHAR(30) NULL,

        usuario_email     NVARCHAR(255) NULL,
        fecha_alta        DATETIME2 NOT NULL
                          CONSTRAINT DF_instalaciones_pieza_fecha_alta
                          DEFAULT SYSUTCDATETIME(),

        CONSTRAINT PK_instalaciones_pieza PRIMARY KEY (id),

        CONSTRAINT FK_instalaciones_pieza_vehiculo
            FOREIGN KEY (vehiculo_id)      REFERENCES dbo.vehiculos (id),
        CONSTRAINT FK_instalaciones_pieza_tipo
            FOREIGN KEY (tipo_pieza_id)    REFERENCES dbo.tipos_pieza (id),
        CONSTRAINT FK_instalaciones_pieza_pieza
            FOREIGN KEY (pieza_id)         REFERENCES dbo.piezas (id),
        CONSTRAINT FK_instalaciones_pieza_lote
            FOREIGN KEY (lote_id)          REFERENCES dbo.lotes_pieza (id)
            ON DELETE SET NULL,
        CONSTRAINT FK_instalaciones_pieza_sucursal
            FOREIGN KEY (sucursal_id)      REFERENCES dbo.sucursales (id),
        CONSTRAINT FK_instalaciones_pieza_mantenimiento
            FOREIGN KEY (mantenimiento_id) REFERENCES dbo.mantenimiento (id),

        CONSTRAINT CK_instalaciones_pieza_motivo CHECK (
            motivo_retiro IS NULL OR motivo_retiro IN
            ('desgaste','falla','robo','siniestro','preventivo','garantia')
        ),
        CONSTRAINT CK_instalaciones_pieza_destino CHECK (
            destino IS NULL OR destino IN
            ('desecho','reacondicionar','devolucion_proveedor','venta','stock')
        ),

        -- El motivo pertenece al retiro: no puede haber uno sin el otro.
        CONSTRAINT CK_instalaciones_pieza_retiro_coherente CHECK (
            (fecha_retiro IS NOT NULL) OR (motivo_retiro IS NULL AND km_retiro IS NULL)
        ),

        -- Una pieza no puede retirarse antes de instalarse. Los renglones
        -- sembrados (fecha_instalacion NULL) quedan fuera del chequeo.
        CONSTRAINT CK_instalaciones_pieza_fechas CHECK (
            fecha_instalacion IS NULL OR fecha_retiro IS NULL
            OR fecha_retiro >= fecha_instalacion
        )
    );
END
GO

-- Una sola pieza montada por (vehiculo, tipo) en un momento dado: es la misma
-- regla que ya impone `piezas_vehiculo`, y aqui evita que la bitacora se
-- desincronice del estado actual. Cuando se modelen posiciones (4 llantas
-- distinguibles en un mismo camion), este indice se dropea - tirar un indice
-- es gratis, reconstruir historial perdido no.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_instalaciones_pieza_vigente')
BEGIN
    CREATE UNIQUE INDEX UX_instalaciones_pieza_vigente
        ON dbo.instalaciones_pieza (vehiculo_id, tipo_pieza_id)
        WHERE fecha_retiro IS NULL;
END
GO

-- Lote defectuoso: "en que otros vehiculos siguen montadas piezas del lote 88?"
-- El filtro por vigencia es el uso dominante.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_instalaciones_pieza_lote')
BEGIN
    CREATE INDEX IX_instalaciones_pieza_lote
        ON dbo.instalaciones_pieza (lote_id)
        INCLUDE (vehiculo_id, tipo_pieza_id, fecha_retiro);
END
GO

-- Historial de un vehiculo, en orden.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_instalaciones_pieza_vehiculo')
BEGIN
    CREATE INDEX IX_instalaciones_pieza_vehiculo
        ON dbo.instalaciones_pieza (vehiculo_id, fecha_instalacion);
END
GO

-- Vida util real por tipo de pieza: promedio de (km_retiro - km_instalacion)
-- sobre los renglones cerrados.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_instalaciones_pieza_tipo')
BEGIN
    CREATE INDEX IX_instalaciones_pieza_tipo
        ON dbo.instalaciones_pieza (tipo_pieza_id, fecha_retiro)
        INCLUDE (km_instalacion, km_retiro, lote_id);
END
GO


-- ---------------------------------------------------------------------------
-- 5. Siembra de lo que ya esta montado.
--
-- Un renglon abierto por cada fila de `piezas_vehiculo`, con
-- `fecha_instalacion` NULL: nadie registro cuando se puso, y eso ya era
-- irrecuperable. Sirve para que "que trae montado" se consulte en un solo
-- lugar y no en dos segun la antiguedad del registro.
--
-- `lote_id` queda NULL porque no se registro de que compra salio.
-- La sucursal se toma de la tabla hija del vehiculo, cuando su tipo la tiene.
-- ---------------------------------------------------------------------------
INSERT INTO dbo.instalaciones_pieza
    (vehiculo_id, tipo_pieza_id, pieza_id, lote_id, sucursal_id, fecha_instalacion)
SELECT
    pv.vehiculo_id,
    pv.tipo_pieza_id,
    pv.pieza_id,
    NULL,
    COALESCE(c.sucursal_id, mc.sucursal_id),
    NULL
FROM dbo.piezas_vehiculo pv
LEFT JOIN dbo.camiones    c  ON c.vehiculo_id  = pv.vehiculo_id
LEFT JOIN dbo.montacargas mc ON mc.vehiculo_id = pv.vehiculo_id
WHERE pv.pieza_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM dbo.instalaciones_pieza i
      WHERE i.vehiculo_id   = pv.vehiculo_id
        AND i.tipo_pieza_id = pv.tipo_pieza_id
        AND i.fecha_retiro IS NULL
  );
GO
