-- ─────────────────────────────────────────────────────────────────────────────
-- 019_validacion_calidad_marcas_y_gate.sql
--
-- Tres ajustes a Validación de Calidad para integrarla con el flujo de marcas
-- y respetar el quality gate de equipo:
--
--   1. validacion_calidad_regla.tipo_marca_id (FK admin_tipo_marca):
--      cada regla declara qué tipo de marca se crea cuando un revisor
--      convierte el error en marca. NULL = la regla no es convertible.
--
--   2. validacion_calidad_job.aplicar_filtro_calidad (boolean, default TRUE):
--      si TRUE, un predio solo se promueve a validado.lc_predio_p si las 6
--      columnas calidad_* están en 1 (campo, sig, fisica, juridica, economica,
--      identificacion). Si FALSE, el gate se ignora — útil para auditorías
--      sobre datos sin revisar.
--
--   3. validacion_calidad_log.marca_id (FK admin_marca_predio ON DELETE SET NULL):
--      cuando el revisor convierte un error en marca, anotamos el id. Permite
--      mostrar en el reporte un chip "marca creada" y evitar re-conversiones.
--      Si la marca se borra, el log queda con marca_id=NULL y puede convertirse
--      de nuevo.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.validacion_calidad_regla
  ADD COLUMN IF NOT EXISTS tipo_marca_id integer
    REFERENCES public.admin_tipo_marca(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_vc_regla_tipo_marca
  ON public.validacion_calidad_regla(tipo_marca_id);

COMMENT ON COLUMN public.validacion_calidad_regla.tipo_marca_id IS
  'Tipo de marca (admin_tipo_marca) que se crea cuando el revisor convierte el error en marca. Obligatorio en reglas nuevas; las seed quedan NULL hasta backfill.';


ALTER TABLE public.validacion_calidad_job
  ADD COLUMN IF NOT EXISTS aplicar_filtro_calidad boolean NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN public.validacion_calidad_job.aplicar_filtro_calidad IS
  'Si TRUE (default), exige calidad_*=1 (las 6 columnas) en lc_predio_p para promover predio a validado.lc_predio_p.';


ALTER TABLE public.validacion_calidad_log
  ADD COLUMN IF NOT EXISTS marca_id integer
    REFERENCES public.admin_marca_predio(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_vc_log_marca
  ON public.validacion_calidad_log(marca_id);

COMMENT ON COLUMN public.validacion_calidad_log.marca_id IS
  'Marca creada a partir de este error vía POST /jobs/{id}/predios/{np}/marcas. NULL = aún no convertido.';


-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill de tipo_marca_id para las 20 reglas seed
-- ─────────────────────────────────────────────────────────────────────────────
-- Asigna un tipo de marca a cada regla seed (creada por
-- scripts/seed_validacion_calidad_reglas.py) según semántica:
--
--   Reglas 01, 02, 03, 04, 06 → IDE-NUM_PRED   (IDENTIFICACION)
--   Reglas 05, 14, 15, 18, 19 → FIS-OMISION    (FISICA)
--   Reglas 07, 08, 13         → JUR-FMI-DIF    (JURIDICA)
--   Reglas 09, 10, 11, 12     → IDE-DIR-DUP    (IDENTIFICACION)
--   Reglas 16, 17             → SIG-GEO-SOLAPE (SIG)
--   Reglas 20                 → JUR-POSESION   (JURIDICA)
--
-- Idempotente: solo actualiza reglas existentes que aún no tengan tipo asignado.
-- Si el seed de reglas no se ha corrido, este UPDATE es un no-op (0 filas).
-- Si el catálogo admin_tipo_marca no tiene alguno de estos códigos, esa regla
-- queda sin tipo y debe asignarse manualmente desde la UI.
WITH mapeo(codigo_regla, codigo_tipo) AS (VALUES
  ('Regla 01', 'IDE-NUM_PRED'),
  ('Regla 02', 'IDE-NUM_PRED'),
  ('Regla 03', 'IDE-NUM_PRED'),
  ('Regla 04', 'IDE-NUM_PRED'),
  ('Regla 06', 'IDE-NUM_PRED'),
  ('Regla 05', 'FIS-OMISION'),
  ('Regla 14', 'FIS-OMISION'),
  ('Regla 15', 'FIS-OMISION'),
  ('Regla 18', 'FIS-OMISION'),
  ('Regla 19', 'FIS-OMISION'),
  ('Regla 07', 'JUR-FMI-DIF'),
  ('Regla 08', 'JUR-FMI-DIF'),
  ('Regla 13', 'JUR-FMI-DIF'),
  ('Regla 09', 'IDE-DIR-DUP'),
  ('Regla 10', 'IDE-DIR-DUP'),
  ('Regla 11', 'IDE-DIR-DUP'),
  ('Regla 12', 'IDE-DIR-DUP'),
  ('Regla 16', 'SIG-GEO-SOLAPE'),
  ('Regla 17', 'SIG-GEO-SOLAPE'),
  ('Regla 20', 'JUR-POSESION')
)
UPDATE public.validacion_calidad_regla r
   SET tipo_marca_id = tm.id
  FROM mapeo m
  JOIN public.admin_tipo_marca tm ON tm.codigo = m.codigo_tipo
 WHERE r.codigo = m.codigo_regla
   AND r.tipo_marca_id IS NULL;
