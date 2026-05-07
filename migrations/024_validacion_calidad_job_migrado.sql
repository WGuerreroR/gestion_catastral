-- ─────────────────────────────────────────────────────────────────────────────
-- 024_validacion_calidad_job_migrado.sql
--
-- Marca cuándo el usuario disparó manualmente la migración a validado.*
-- vía el botón "Migrar a validado". Una vez seteado, el botón desaparece
-- en la UI — para volver a migrar hay que crear un job nuevo. NULL si
-- nunca se migró manualmente (puede haberse migrado automáticamente al
-- finalizar el worker, esto solo trackea la acción explícita del usuario).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.validacion_calidad_job
  ADD COLUMN IF NOT EXISTS migrado_en timestamp;

COMMENT ON COLUMN public.validacion_calidad_job.migrado_en IS
  'Timestamp del último click en "Migrar a validado". NULL si el usuario nunca lo disparó.';
