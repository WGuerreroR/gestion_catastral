-- Migración 004 — agrega columna por predio para trackear la última vez
-- que fue tocado por un sync offline manual. Se actualiza al final de
-- qfield_sync_service.tarea_aplicar_paquete con NOW() para los id_operacion
-- afectados (added/updated en cualquier capa relacionada).
--
-- Aplicar antes de habilitar Iter 11.

ALTER TABLE public.lc_predio_p
  ADD COLUMN IF NOT EXISTS ultima_sync_offline timestamp;

COMMENT ON COLUMN public.lc_predio_p.ultima_sync_offline IS
  'Timestamp de la última vez que este predio fue tocado por un sync offline manual';
