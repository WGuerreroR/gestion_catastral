-- Migración 019 — Migración LADM (port del ETL PyQt5 a job web).
--
-- Reemplaza la herramienta ETL/ladm/main/src/ por un módulo web:
--   - Perfiles de conexión reutilizables (migracion_ladm_conexion)
--   - Jobs asíncronos con progreso (migracion_ladm_job)
--   - Errores fila por fila aislados por job (migracion_ladm_log)
--
-- Las contraseñas se cifran con Fernet (clave derivada del SECRET_KEY del backend).

CREATE TABLE IF NOT EXISTS public.migracion_ladm_conexion (
    id              serial       PRIMARY KEY,
    nombre          varchar(100) NOT NULL UNIQUE,
    host            varchar(255) NOT NULL,
    port            integer      NOT NULL DEFAULT 5432,
    dbname          varchar(100) NOT NULL,
    usuario         varchar(100) NOT NULL,
    password_cif    text         NOT NULL,
    notas           text,
    creado_en       timestamp    NOT NULL DEFAULT now(),
    creado_por      varchar(100),
    actualizado_en  timestamp    NOT NULL DEFAULT now(),
    actualizado_por varchar(100)
);

COMMENT ON TABLE  public.migracion_ladm_conexion IS
    'Perfiles reutilizables de conexión a BDs (locales o remotas) para la migración LADM.';
COMMENT ON COLUMN public.migracion_ladm_conexion.password_cif IS
    'Token Fernet (cryptography). Clave derivada del SECRET_KEY del backend.';

CREATE TABLE IF NOT EXISTS public.migracion_ladm_job (
    id                  serial       PRIMARY KEY,
    conexion_id         integer      REFERENCES public.migracion_ladm_conexion(id) ON DELETE SET NULL,
    esquema_origen      varchar(63)  NOT NULL,
    esquema_destino     varchar(63)  NOT NULL,
    tabla_dominios      varchar(100) NOT NULL DEFAULT 'homologacion1_0_1_2',
    estado              varchar(20)  NOT NULL DEFAULT 'pending',
    progreso            integer      NOT NULL DEFAULT 0,
    tabla_actual        varchar(100),
    tabla_actual_idx    integer,
    total_tablas        integer,
    iniciado_en         timestamp    NOT NULL DEFAULT now(),
    finalizado_en       timestamp,
    error_message       text,
    cancelar_solicitado boolean      NOT NULL DEFAULT FALSE,
    creado_por          varchar(100),
    CONSTRAINT chk_ml_job_estado
        CHECK (estado IN ('pending', 'running', 'done', 'error', 'cancelled')),
    CONSTRAINT chk_ml_job_progreso
        CHECK (progreso BETWEEN 0 AND 100)
);

CREATE INDEX IF NOT EXISTS idx_ml_job_estado    ON public.migracion_ladm_job(estado);
CREATE INDEX IF NOT EXISTS idx_ml_job_iniciado  ON public.migracion_ladm_job(iniciado_en DESC);

COMMENT ON TABLE  public.migracion_ladm_job IS
    'Jobs asíncronos de migración LADM. conexion_id NULL ⇒ usa el DATABASE_URL del backend.';

CREATE TABLE IF NOT EXISTS public.migracion_ladm_log (
    id              serial      PRIMARY KEY,
    job_id          integer     NOT NULL REFERENCES public.migracion_ladm_job(id) ON DELETE CASCADE,
    tabla           varchar(100),
    fila_json       jsonb,
    error_reason    text,
    fecha_registro  timestamp   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ml_log_job ON public.migracion_ladm_log(job_id);

COMMENT ON TABLE  public.migracion_ladm_log IS
    'Errores fila por fila durante la migración (reemplaza los .json sueltos del ETL viejo).';
