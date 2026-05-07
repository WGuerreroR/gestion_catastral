-- ─────────────────────────────────────────────────────────────────────────────
-- 021_validacion_calidad_regla_actual.sql
--
-- Indicador de regla en ejecución para mostrar en la UI mientras el job corre.
-- El worker actualiza esta columna antes de cada regla y la limpia al
-- terminar el bucle. NULL si el job aún no empezó las reglas o ya terminó.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.validacion_calidad_job
  ADD COLUMN IF NOT EXISTS regla_actual text;

COMMENT ON COLUMN public.validacion_calidad_job.regla_actual IS
  'Código + nombre de la regla que el worker ejecuta en este momento (NULL si no aplica).';
