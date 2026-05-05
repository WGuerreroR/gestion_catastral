-- Migración 016 — Marcas por predio (módulo de validación).
--
-- Una marca es una novedad detectada por categoría (FISICA, JURIDICA,
-- ECONOMICA, IDENTIFICACION o SIG) durante la validación de un predio.
-- El catálogo de tipos vive en `admin_tipo_marca` (migración 014); aquí
-- se guarda la instancia aplicada al predio.
--
-- Modelo:
--   admin_marca_predio          — datos de la marca + estado actual (ABIERTA/CERRADA)
--   admin_marca_predio_evento   — historial completo (CREACION, CIERRE, REAPERTURA)
--
-- La tabla principal denormaliza `fecha_creacion` y `creado_por` por
-- conveniencia de ordenamiento. El resto del ciclo de vida vive en la
-- tabla de eventos (no se pierde nada al reabrir/cerrar varias veces).

CREATE TABLE IF NOT EXISTS public.admin_marca_predio (
    id                  serial      PRIMARY KEY,
    id_operacion        varchar(50) NOT NULL REFERENCES public.lc_predio_p(id_operacion) ON DELETE CASCADE,
    categoria           varchar(20) NOT NULL,
    tipo_marca_id       integer     NOT NULL REFERENCES public.admin_tipo_marca(id),
    descripcion_novedad text        NOT NULL,
    fuente_deteccion    text,
    prioridad           varchar(10) NOT NULL,
    accion_sugerida     text,
    responsable_id      integer     REFERENCES public.admin_personas(id),
    estado_esperado     varchar(20) NOT NULL,
    observacion         text,
    estado              varchar(10) NOT NULL DEFAULT 'ABIERTA',
    fecha_creacion      timestamp   NOT NULL DEFAULT now(),
    creado_por          integer     NOT NULL REFERENCES public.admin_personas(id),
    CONSTRAINT chk_marca_categoria
        CHECK (categoria IN ('FISICA','JURIDICA','ECONOMICA','IDENTIFICACION','SIG')),
    CONSTRAINT chk_marca_prioridad
        CHECK (prioridad IN ('ALTA','MEDIA','BAJA')),
    CONSTRAINT chk_marca_estado_esperado
        CHECK (estado_esperado IN ('AJUSTE','ANALISIS','CAMPO','DOCUMENTAL','OFICINA','VERIFICACION')),
    CONSTRAINT chk_marca_estado
        CHECK (estado IN ('ABIERTA','CERRADA'))
);

CREATE INDEX IF NOT EXISTS idx_marca_predio_idop   ON public.admin_marca_predio(id_operacion);
CREATE INDEX IF NOT EXISTS idx_marca_predio_cat    ON public.admin_marca_predio(id_operacion, categoria);
CREATE INDEX IF NOT EXISTS idx_marca_predio_estado ON public.admin_marca_predio(estado);

COMMENT ON TABLE  public.admin_marca_predio IS
    'Marcas (novedades detectadas) por predio durante validación, agrupadas por categoría';
COMMENT ON COLUMN public.admin_marca_predio.estado IS
    'Estado actual de la marca: ABIERTA (pendiente) o CERRADA. La trazabilidad completa vive en admin_marca_predio_evento';
COMMENT ON COLUMN public.admin_marca_predio.estado_esperado IS
    'Estado esperado de la gestión: AJUSTE, ANALISIS, CAMPO, DOCUMENTAL, OFICINA o VERIFICACION';
COMMENT ON COLUMN public.admin_marca_predio.prioridad IS
    'Prioridad de atención: ALTA, MEDIA o BAJA';

CREATE TABLE IF NOT EXISTS public.admin_marca_predio_evento (
    id          serial      PRIMARY KEY,
    marca_id    integer     NOT NULL REFERENCES public.admin_marca_predio(id) ON DELETE CASCADE,
    tipo_evento varchar(20) NOT NULL,
    fecha       timestamp   NOT NULL DEFAULT now(),
    usuario_id  integer     NOT NULL REFERENCES public.admin_personas(id),
    observacion text,
    CONSTRAINT chk_marca_evento_tipo
        CHECK (tipo_evento IN ('CREACION','CIERRE','REAPERTURA'))
);

CREATE INDEX IF NOT EXISTS idx_marca_evento_marca ON public.admin_marca_predio_evento(marca_id, fecha);

COMMENT ON TABLE  public.admin_marca_predio_evento IS
    'Historial de eventos del ciclo de vida de cada marca (creación, cierre, reapertura)';
COMMENT ON COLUMN public.admin_marca_predio_evento.tipo_evento IS
    'CREACION (al crear), CIERRE (al cerrar), REAPERTURA (al volver a abrir una cerrada)';
