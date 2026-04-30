-- Migración 003 — tabla de auditoría para sincronizaciones offline.
--
-- Cada sync registra: hash del paquete (idempotencia), estado,
-- estrategia detectada, transición de estado de la asignación,
-- resumen agregado por capa, fotos procesadas y errores/advertencias.
--
-- Aplicar después de la migración 002.

CREATE TABLE IF NOT EXISTS public.sync_history (
  id              serial PRIMARY KEY,
  asignacion_id   integer REFERENCES public.admin_asignacion(id),
  fecha_sync      timestamp DEFAULT now(),
  usuario         text,
  paquete_nombre  text,
  paquete_hash    text,
  estado          text CHECK (estado IN ('encolado','corriendo','ok','error','parcial','idempotente')),
  estrategia_diff text,
  forzado         boolean DEFAULT false,
  origen          text DEFAULT 'manual',
  estado_anterior text,
  estado_nuevo    text,
  resumen         jsonb,
  fotos_resumen   jsonb,
  advertencias    jsonb,
  error_detalle   text
);

CREATE INDEX IF NOT EXISTS idx_sync_history_hash       ON public.sync_history(paquete_hash);
CREATE INDEX IF NOT EXISTS idx_sync_history_asignacion ON public.sync_history(asignacion_id);
CREATE INDEX IF NOT EXISTS idx_sync_history_fecha      ON public.sync_history(fecha_sync DESC);

COMMENT ON TABLE public.sync_history IS
  'Auditoría de sincronizaciones de paquetes offline → PostGIS. Una fila por sync intentado.';
