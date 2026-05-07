-- ─────────────────────────────────────────────────────────────────────────────
-- 022_validacion_calidad_worker_pid.sql
--
-- PID del backend PostgreSQL que ejecuta el worker del job. Permite
-- cancelación agresiva: cuando el usuario cancela un job, el endpoint
-- llama a pg_cancel_backend(worker_pid) para matar la query activa.
-- Sin esto, la cancelación es cooperativa y no aborta queries pesadas
-- (p.ej. Regla 17 espacial puede tardar horas).
--
-- NULL si el job aún no ha empezado, ya terminó, o el worker se actualizó
-- y aún no registró su PID.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.validacion_calidad_job
  ADD COLUMN IF NOT EXISTS worker_pid integer;

COMMENT ON COLUMN public.validacion_calidad_job.worker_pid IS
  'PID PostgreSQL del worker; usado por pg_cancel_backend en cancelaciones.';
