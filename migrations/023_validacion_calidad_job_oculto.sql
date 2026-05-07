-- ─────────────────────────────────────────────────────────────────────────────
-- 023_validacion_calidad_job_oculto.sql
--
-- Soft delete reversible para el histórico de jobs de validación de calidad.
-- Permite limpiar la lista en /validacion-calidad sin perder los datos del
-- log/exclusiones/marcas creadas a partir de ese job.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.validacion_calidad_job
  ADD COLUMN IF NOT EXISTS oculto boolean NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_vc_job_no_oculto
  ON public.validacion_calidad_job (iniciado_en DESC)
  WHERE oculto = FALSE;

COMMENT ON COLUMN public.validacion_calidad_job.oculto IS
  'Si TRUE, el job no aparece en el listado de ejecuciones a menos que el usuario active "mostrar ocultos". Reversible.';
