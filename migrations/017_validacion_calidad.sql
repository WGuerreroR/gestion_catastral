-- Migración 017 — Validación de calidad de datos catastrales.
--
-- Reemplaza la herramienta Tkinter de ETL/validacion/ por un módulo web:
--   - Reglas SQL editables desde la UI (tabla validacion_calidad_regla).
--   - Ejecución como job asíncrono con seguimiento (validacion_calidad_job).
--   - Errores aislados por job (validacion_calidad_log).
--
-- El esquema `validado` (donde aterrizan los predios que cumplen) se crea
-- on-demand desde el service en Python — no se toca aquí.

CREATE TABLE IF NOT EXISTS public.validacion_calidad_regla (
    id              serial       PRIMARY KEY,
    codigo          varchar(50)  NOT NULL UNIQUE,
    nombre          varchar(200) NOT NULL,
    descripcion     text,
    entidad         varchar(30)  NOT NULL,
    sql_template    text         NOT NULL,
    activa          boolean      NOT NULL DEFAULT TRUE,
    orden           integer      NOT NULL DEFAULT 0,
    creado_en       timestamp    NOT NULL DEFAULT now(),
    creado_por      varchar(100),
    actualizado_en  timestamp    NOT NULL DEFAULT now(),
    actualizado_por varchar(100),
    CONSTRAINT chk_vc_regla_entidad
        CHECK (entidad IN ('predio', 'terreno', 'interesado', 'unidad_construccion'))
);

CREATE INDEX IF NOT EXISTS idx_vc_regla_activa ON public.validacion_calidad_regla(activa);
CREATE INDEX IF NOT EXISTS idx_vc_regla_orden  ON public.validacion_calidad_regla(orden);

COMMENT ON TABLE  public.validacion_calidad_regla IS
    'Reglas SQL dinámicas de validación de calidad. Editables desde la UI.';
COMMENT ON COLUMN public.validacion_calidad_regla.entidad IS
    'Entidad objetivo de la regla: predio (lc_predio_p), terreno (cr_terreno), interesado (cr_interesado), unidad_construccion (cr_unidadconstruccion)';
COMMENT ON COLUMN public.validacion_calidad_regla.sql_template IS
    'SQL con placeholder {{filtro_alcance}} que se sustituye por JOIN al alcance del job';

CREATE TABLE IF NOT EXISTS public.validacion_calidad_job (
    id                  serial       PRIMARY KEY,
    estado              varchar(20)  NOT NULL DEFAULT 'pending',
    alcance_tipo        varchar(20)  NOT NULL,
    alcance_valores     text[]       NOT NULL DEFAULT '{}',
    reglas_omitidas     integer[]    NOT NULL DEFAULT '{}',
    progreso            integer      NOT NULL DEFAULT 0,
    predios_total       integer,
    predios_validos     integer,
    errores_total       integer,
    iniciado_en         timestamp    NOT NULL DEFAULT now(),
    finalizado_en       timestamp,
    error_message       text,
    cancelar_solicitado boolean      NOT NULL DEFAULT FALSE,
    creado_por          varchar(100),
    CONSTRAINT chk_vc_job_estado
        CHECK (estado IN ('pending', 'running', 'done', 'error', 'cancelled')),
    CONSTRAINT chk_vc_job_alcance_tipo
        CHECK (alcance_tipo IN ('todo', 'predios', 'manzanas')),
    CONSTRAINT chk_vc_job_progreso
        CHECK (progreso BETWEEN 0 AND 100)
);

CREATE INDEX IF NOT EXISTS idx_vc_job_estado     ON public.validacion_calidad_job(estado);
CREATE INDEX IF NOT EXISTS idx_vc_job_iniciado   ON public.validacion_calidad_job(iniciado_en DESC);

COMMENT ON TABLE  public.validacion_calidad_job IS
    'Jobs asíncronos de validación. Cada job persiste su alcance, reglas omitidas y resultados agregados.';

CREATE TABLE IF NOT EXISTS public.validacion_calidad_log (
    id              serial      PRIMARY KEY,
    job_id          integer     NOT NULL REFERENCES public.validacion_calidad_job(id) ON DELETE CASCADE,
    numero_predial  varchar(50),
    regla           varchar(50),
    descripcion     text,
    fecha_registro  timestamp   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vc_log_job ON public.validacion_calidad_log(job_id);
CREATE INDEX IF NOT EXISTS idx_vc_log_np  ON public.validacion_calidad_log(numero_predial);

COMMENT ON TABLE  public.validacion_calidad_log IS
    'Errores detectados por las reglas de validación, aislados por job_id.';
