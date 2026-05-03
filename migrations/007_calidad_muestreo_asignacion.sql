-- Muestreo de calidad por asignación operativa.
-- Flujo paralelo a /calidad-externa (que sigue intacto y operativo). El
-- universo aquí se construye eligiendo manualmente proyectos de asignación
-- (admin_asignacion) en estado 'validacion'.
--
-- Nota: si una versión previa de esta migración llegó a aplicarse y dejó
-- tablas con nombres similares pero con columnas obsoletas (veredicto,
-- parametros_usados, seed_aleatorio, etc.), dropearlas antes de aplicar
-- esta. Las tablas creadas con la versión previa están vacías.

-- 1. fecha_entrada_validacion en admin_asignacion -----------------------------
-- Marca cuándo la asignación transicionó a estado='validacion'. Se setea
-- desde repositories/asignacion_proyecto_repo.actualizar_estado_asignacion.
ALTER TABLE admin_asignacion
    ADD COLUMN IF NOT EXISTS fecha_entrada_validacion timestamp NULL;

UPDATE admin_asignacion
   SET fecha_entrada_validacion = fecha_actualizacion
 WHERE estado = 'validacion'
   AND fecha_entrada_validacion IS NULL;

-- 2. Cabecera del proyecto de muestreo ----------------------------------------
CREATE TABLE IF NOT EXISTS admin_proyecto_calidad_muestreo (
    id                  serial PRIMARY KEY,
    nombre              text   NOT NULL,
    descripcion         text,
    estado              text   NOT NULL DEFAULT 'activo'
                        CHECK (estado IN ('activo','cerrado')),
    total_predios       int    NOT NULL,
    muestra_calculada   int    NOT NULL,
    area_geom           geometry(MultiPolygon, 9377),
    creado_por          int REFERENCES admin_personas(id),
    fecha_creacion      timestamp DEFAULT NOW(),
    fecha_actualizacion timestamp DEFAULT NOW(),
    CHECK (muestra_calculada <= total_predios)
);

CREATE INDEX IF NOT EXISTS idx_pcm_creado_por
    ON admin_proyecto_calidad_muestreo(creado_por);

-- 3. Asignaciones que componen el universo (N:N) -----------------------------
CREATE TABLE IF NOT EXISTS admin_proyecto_calidad_muestreo_asignacion (
    id            serial PRIMARY KEY,
    proyecto_id   int NOT NULL REFERENCES admin_proyecto_calidad_muestreo(id) ON DELETE CASCADE,
    asignacion_id int NOT NULL REFERENCES admin_asignacion(id),
    UNIQUE (proyecto_id, asignacion_id)
);

CREATE INDEX IF NOT EXISTS idx_pcma_asignacion
    ON admin_proyecto_calidad_muestreo_asignacion(asignacion_id);

-- 4. Universo de predios + flag muestra --------------------------------------
CREATE TABLE IF NOT EXISTS admin_proyecto_calidad_muestreo_predio (
    id           serial PRIMARY KEY,
    proyecto_id  int  NOT NULL REFERENCES admin_proyecto_calidad_muestreo(id) ON DELETE CASCADE,
    id_operacion text NOT NULL,
    en_muestra   boolean NOT NULL DEFAULT false,
    UNIQUE (proyecto_id, id_operacion)
);

CREATE INDEX IF NOT EXISTS idx_pcmp_id_operacion
    ON admin_proyecto_calidad_muestreo_predio(id_operacion);
CREATE INDEX IF NOT EXISTS idx_pcmp_muestra
    ON admin_proyecto_calidad_muestreo_predio(proyecto_id, en_muestra);
