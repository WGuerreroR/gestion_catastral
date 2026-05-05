-- Migración 013 — agrega los pares de columnas calidad/observación para
-- las dos categorías nuevas de validación de predio: Identificación y
-- Económica. Complementa los bloques existentes (Campo, SIG, Física,
-- Jurídica) usados en la página /validacion.
--
-- calidad_*  : smallint 0/1 (0 = sin revisar, 1 = aprobado)
-- revisar_*  : text libre con la observación del revisor

ALTER TABLE public.lc_predio_p
    ADD COLUMN IF NOT EXISTS calidad_identificacion smallint NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS revisar_identificacion text,
    ADD COLUMN IF NOT EXISTS calidad_economica      smallint NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS revisar_economica      text;

COMMENT ON COLUMN public.lc_predio_p.calidad_identificacion IS
    'Estado de aprobación del bloque Identificación (0 = sin revisar, 1 = aprobado)';
COMMENT ON COLUMN public.lc_predio_p.revisar_identificacion IS
    'Observaciones del revisor para el bloque Identificación';
COMMENT ON COLUMN public.lc_predio_p.calidad_economica IS
    'Estado de aprobación del bloque Económica (0 = sin revisar, 1 = aprobado)';
COMMENT ON COLUMN public.lc_predio_p.revisar_economica IS
    'Observaciones del revisor para el bloque Económica';
