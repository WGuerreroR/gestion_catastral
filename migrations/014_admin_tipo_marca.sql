-- Migración 014 — Catálogo de tipos de marca para el módulo de administración.
-- Cada tipo de marca tiene un código personalizado (único global), pertenece
-- a una de las 5 categorías fijas y tiene un significado libre.
--
-- Categorías permitidas: FISICA, JURIDICA, ECONOMICA, IDENTIFICACION, SIG.
-- Se usan los nombres SIN tilde en BD para evitar problemas de encoding en
-- el CHECK constraint; la UI muestra la versión con tildes.

CREATE TABLE IF NOT EXISTS public.admin_tipo_marca (
    id                  serial PRIMARY KEY,
    categoria           varchar(20) NOT NULL,
    codigo              varchar(50) NOT NULL,
    significado         text NOT NULL,
    activo              boolean NOT NULL DEFAULT true,
    fecha_creacion      timestamp NOT NULL DEFAULT now(),
    fecha_actualizacion timestamp NOT NULL DEFAULT now(),
    CONSTRAINT admin_tipo_marca_categoria_check
        CHECK (categoria IN ('FISICA','JURIDICA','ECONOMICA','IDENTIFICACION','SIG')),
    CONSTRAINT admin_tipo_marca_codigo_unico UNIQUE (codigo)
);

CREATE INDEX IF NOT EXISTS idx_admin_tipo_marca_categoria ON public.admin_tipo_marca(categoria);
CREATE INDEX IF NOT EXISTS idx_admin_tipo_marca_activo    ON public.admin_tipo_marca(activo);

COMMENT ON TABLE  public.admin_tipo_marca IS
    'Catálogo de tipos de marca administrables agrupados por categoría (FISICA, JURIDICA, ECONOMICA, IDENTIFICACION, SIG)';
COMMENT ON COLUMN public.admin_tipo_marca.codigo IS
    'Código corto y único del tipo de marca (ej. M01, JUR-12)';
COMMENT ON COLUMN public.admin_tipo_marca.significado IS
    'Descripción del significado del tipo de marca';
COMMENT ON COLUMN public.admin_tipo_marca.activo IS
    'Borrado lógico: false = inactivo (no aparece en listado por defecto)';
