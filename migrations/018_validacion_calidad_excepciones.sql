-- ─────────────────────────────────────────────────────────────────────────────
-- 018_validacion_calidad_excepciones.sql
--
-- Excepciones (errores aceptados/justificados) por job para el módulo
-- Validación de Calidad. Cada fila marca:
--   · regla = 'COD' → un único error (predio × regla) queda excluido.
--   · regla = NULL  → wildcard: TODOS los errores actuales y futuros del
--                     predio en ese job quedan excluidos.
--
-- Las exclusiones son por job (decisión de diseño): re-ejecutar la validación
-- crea un nuevo job sin exclusiones — empieza limpio.
--
-- También añade un índice único en validado.lc_predio_p(id_operacion) para
-- soportar re-ejecuciones idempotentes (CREATE TABLE AS SELECT no preserva
-- la PK del schema original).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.validacion_calidad_excepcion (
    id              serial      PRIMARY KEY,
    job_id          integer     NOT NULL REFERENCES public.validacion_calidad_job(id) ON DELETE CASCADE,
    numero_predial  varchar(50) NOT NULL,
    regla           varchar(50),
    motivo          text,
    creado_en       timestamp   NOT NULL DEFAULT now(),
    creado_por      varchar(100)
);

-- Idempotencia ante doble click en la UI.
-- Requiere PostgreSQL 15+ (NULLS NOT DISTINCT).
-- Si el clúster es <15, sustituir por dos índices únicos parciales:
--   CREATE UNIQUE INDEX ... ON ... (job_id, numero_predial, regla) WHERE regla IS NOT NULL;
--   CREATE UNIQUE INDEX ... ON ... (job_id, numero_predial)        WHERE regla IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_vc_excepcion
  ON public.validacion_calidad_excepcion (job_id, numero_predial, regla)
  NULLS NOT DISTINCT;

CREATE INDEX IF NOT EXISTS idx_vc_excepcion_job_pred
  ON public.validacion_calidad_excepcion (job_id, numero_predial);

COMMENT ON TABLE  public.validacion_calidad_excepcion IS
  'Errores aceptados/justificados por job. regla=NULL = wildcard del predio.';
COMMENT ON COLUMN public.validacion_calidad_excepcion.regla IS
  'Código de la regla excluida; NULL = todas las reglas del predio quedan excluidas para este job.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Índice único sobre validado.lc_predio_p para soportar re-ejecuciones.
-- Solo lo creamos si el esquema/tabla ya existen (en instalaciones nuevas
-- el esquema validado se crea desde el servicio en el primer job).
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'validado' AND table_name = 'lc_predio_p'
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS uq_validado_lc_predio_p_idop
      ON validado.lc_predio_p (id_operacion);
  END IF;
END $$;
