-- ============================================================================
-- 002 - Inventario por sucursal
-- ----------------------------------------------------------------------------
-- Hasta ahora el stock de un lote era un solo numero: lotes_pieza.cantidad_
-- disponible. Eso deja de servir en cuanto las piezas de un mismo lote pueden
-- estar en sucursales distintas. La existencia pasa a ser por (lote, sucursal).
--
-- Esta migracion agrega:
--   1. existencias_lote  - cuantas piezas del lote hay en cada sucursal.
--   2. traspasos_pieza   - bitacora de piezas movidas entre sucursales.
--   3. minimos_sucursal  - minimo exigido de una refaccion en una sucursal.
--
-- EXPAND / CONTRACT. `lotes_pieza.cantidad_disponible` NO se borra aqui a
-- proposito. Despues de esta migracion el codigo deja de leerla y todo el stock
-- sale de `existencias_lote`, pero la columna se queda como red de seguridad
-- hasta comprobar que el corte quedo bien. Una migracion 003 la dropea cuando
-- ya no haya duda. Mientras tanto: la columna esta OBSOLETA, no la leas.
--
-- Requiere el admin del servidor: `app_user` no tiene permisos de DDL.
-- El script es idempotente - se puede volver a correr sin efecto.
-- Depende de 001_trazabilidad_lote.sql.
-- ============================================================================

SET XACT_ABORT ON;
GO


-- ---------------------------------------------------------------------------
-- 1. Existencias por (lote, sucursal).
--
-- Nueva fuente de verdad del stock. La suma de las filas de un lote es lo que
-- antes era su `cantidad_disponible`.
--
-- ON DELETE CASCADE: las existencias no tienen sentido sin su lote, y borrar
-- una refaccion ya arrastra sus lotes (refaccionesRepo.remove).
--
-- El CHECK de cantidad >= 0 es la ultima linea de defensa contra un consumo mal
-- calculado: preferimos que el mantenimiento falle a que el inventario quede en
-- negativo y nadie se entere.
-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.existencias_lote', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.existencias_lote (
        lote_id     INT NOT NULL,
        sucursal_id INT NOT NULL,
        cantidad    INT NOT NULL,

        CONSTRAINT PK_existencias_lote PRIMARY KEY (lote_id, sucursal_id),
        CONSTRAINT FK_existencias_lote_lote
            FOREIGN KEY (lote_id)     REFERENCES dbo.lotes_pieza (id) ON DELETE CASCADE,
        CONSTRAINT FK_existencias_lote_sucursal
            FOREIGN KEY (sucursal_id) REFERENCES dbo.sucursales (id),
        CONSTRAINT CK_existencias_lote_no_negativa CHECK (cantidad >= 0)
    );
END
GO

-- "Que hay en esta sucursal" es la consulta principal de la pantalla nueva, y
-- la PK no sirve para eso porque empieza por lote_id.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_existencias_lote_sucursal')
BEGIN
    CREATE INDEX IX_existencias_lote_sucursal
        ON dbo.existencias_lote (sucursal_id) INCLUDE (lote_id, cantidad);
END
GO


-- ---------------------------------------------------------------------------
-- 2. Traspasos entre sucursales.
--
-- Append-only. El movimiento del stock lo hace la aplicacion sobre
-- `existencias_lote` en la misma transaccion que inserta aqui; esta tabla es el
-- registro de por que una sucursal tiene lo que tiene.
-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.traspasos_pieza', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.traspasos_pieza (
        id                  INT IDENTITY(1,1) NOT NULL,
        lote_id             INT NOT NULL,
        origen_sucursal_id  INT NOT NULL,
        destino_sucursal_id INT NOT NULL,
        cantidad            INT NOT NULL,
        fecha               DATE NOT NULL,
        usuario_email       NVARCHAR(255) NULL,
        observaciones       NVARCHAR(300)  NULL,
        fecha_alta          DATETIME2 NOT NULL
                            CONSTRAINT DF_traspasos_pieza_fecha_alta
                            DEFAULT SYSUTCDATETIME(),

        CONSTRAINT PK_traspasos_pieza PRIMARY KEY (id),

        -- Sin cascada: el traspaso explica un movimiento que ya ocurrio y no
        -- debe desaparecer porque despues se borre el lote.
        CONSTRAINT FK_traspasos_pieza_lote
            FOREIGN KEY (lote_id)             REFERENCES dbo.lotes_pieza (id),
        CONSTRAINT FK_traspasos_pieza_origen
            FOREIGN KEY (origen_sucursal_id)  REFERENCES dbo.sucursales (id),
        CONSTRAINT FK_traspasos_pieza_destino
            FOREIGN KEY (destino_sucursal_id) REFERENCES dbo.sucursales (id),

        CONSTRAINT CK_traspasos_pieza_cantidad CHECK (cantidad > 0),
        -- Un traspaso a la misma sucursal no mueve nada y solo ensucia el
        -- historial.
        CONSTRAINT CK_traspasos_pieza_distintas CHECK (origen_sucursal_id <> destino_sucursal_id)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_traspasos_pieza_fecha')
BEGIN
    CREATE INDEX IX_traspasos_pieza_fecha
        ON dbo.traspasos_pieza (fecha DESC, id DESC);
END
GO


-- ---------------------------------------------------------------------------
-- 3. Minimos por sucursal.
--
-- Van por refaccion y no por tipo de pieza: el minimo existe para tener una
-- pieza concreta lista ante una emergencia, y "un motor cualquiera" no resuelve
-- lo que resuelve el motor que ese equipo usa. Exigir la refaccion exacta es el
-- punto.
-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.minimos_sucursal', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.minimos_sucursal (
        id            INT IDENTITY(1,1) NOT NULL,
        sucursal_id   INT NOT NULL,
        pieza_id      INT NOT NULL,
        minimo        INT NOT NULL,
        observaciones NVARCHAR(300) NULL,

        CONSTRAINT PK_minimos_sucursal PRIMARY KEY (id),
        CONSTRAINT FK_minimos_sucursal_sucursal
            FOREIGN KEY (sucursal_id) REFERENCES dbo.sucursales (id) ON DELETE CASCADE,
        CONSTRAINT FK_minimos_sucursal_pieza
            FOREIGN KEY (pieza_id)    REFERENCES dbo.piezas (id) ON DELETE CASCADE,

        CONSTRAINT CK_minimos_sucursal_minimo CHECK (minimo > 0),
        -- Un solo minimo por refaccion y sucursal: dos filas competirian por
        -- decir cual es el minimo real.
        CONSTRAINT UQ_minimos_sucursal UNIQUE (sucursal_id, pieza_id)
    );
END
GO


-- ---------------------------------------------------------------------------
-- 4. Backfill de las existencias.
--
-- Todo el stock actual entra a UNA sucursal, porque no hay dato de donde esta
-- realmente cada pieza: nunca se registro. Repartirlo es trabajo de captura, y
-- para eso estan los traspasos - desde la pantalla de inventario se mueve lo
-- que este mal ubicado.
--
-- >>> REVISA @sucursalPorDefecto ANTES DE CORRER ESTO. <<<
-- Por omision toma la sucursal de id mas bajo. Si la matriz no es esa, cambia
-- la linea por el id que corresponda: es mas facil traspasar desde la sucursal
-- correcta que desde una que nunca tuvo nada.
-- ---------------------------------------------------------------------------
DECLARE @sucursalPorDefecto INT = (SELECT MIN(id) FROM dbo.sucursales);

-- El nombre se resuelve a una variable antes de imprimirlo: PRINT solo admite
-- expresiones escalares, una subconsulta dentro rompe el lote entero.
DECLARE @nombreSucursal NVARCHAR(200) =
    (SELECT nombre FROM dbo.sucursales WHERE id = @sucursalPorDefecto);

IF @sucursalPorDefecto IS NULL
BEGIN
    RAISERROR('No hay sucursales dadas de alta: registra al menos una antes de correr esta migracion.', 16, 1);
END
ELSE
BEGIN
    PRINT 'Sucursal por defecto del backfill: ' + @nombreSucursal;

    -- Una fila por lote con existencia. Los lotes ya agotados no generan fila:
    -- una existencia de cero en una sucursal donde nunca hubo nada seria ruido.
    INSERT INTO dbo.existencias_lote (lote_id, sucursal_id, cantidad)
    SELECT l.id, @sucursalPorDefecto, l.cantidad_disponible
    FROM dbo.lotes_pieza l
    WHERE l.cantidad_disponible > 0
      AND NOT EXISTS (SELECT 1 FROM dbo.existencias_lote e WHERE e.lote_id = l.id);

    -- La sucursal de recepcion que 001 dejo en NULL. A partir de aqui la manda
    -- el alta del lote.
    UPDATE dbo.lotes_pieza
       SET sucursal_id = @sucursalPorDefecto
     WHERE sucursal_id IS NULL;
END
GO

-- `detalle_mtto_pieza.sucursal_id` se queda en NULL en lo historico a
-- proposito: esos consumos ocurrieron antes de que hubiera sucursales y
-- ponerles una seria inventar de donde salieron. Ya estan reflejados en el
-- backfill, porque `cantidad_disponible` venia descontada.
GO


-- ---------------------------------------------------------------------------
-- 5. Verificacion.
--
-- Primero el resumen: cero filas en la comparacion de abajo no distingue "todo
-- cuadro" de "no habia nada que migrar", y son dos situaciones muy distintas.
-- ---------------------------------------------------------------------------
SELECT
    (SELECT COUNT(*) FROM dbo.lotes_pieza)                              AS lotes,
    (SELECT COUNT(*) FROM dbo.lotes_pieza WHERE cantidad_disponible > 0) AS lotes_con_stock,
    (SELECT COUNT(*) FROM dbo.existencias_lote)                          AS filas_de_existencia,
    (SELECT COALESCE(SUM(cantidad_disponible), 0) FROM dbo.lotes_pieza)  AS piezas_antes,
    (SELECT COALESCE(SUM(cantidad), 0) FROM dbo.existencias_lote)        AS piezas_ahora;
GO

-- Y el detalle: los lotes cuyo stock no coincide. Debe salir vacio.
SELECT
    l.id                                AS lote_id,
    l.cantidad_disponible               AS antes,
    COALESCE(SUM(e.cantidad), 0)        AS ahora
FROM dbo.lotes_pieza l
LEFT JOIN dbo.existencias_lote e ON e.lote_id = l.id
GROUP BY l.id, l.cantidad_disponible
HAVING l.cantidad_disponible <> COALESCE(SUM(e.cantidad), 0);
GO
