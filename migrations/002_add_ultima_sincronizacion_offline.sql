-- Migración 002 — agrega columna para trackear sincronización vía paquete
-- offline manual. Distinta de ultima_sincronizacion_cloud (que la actualiza
-- el flujo de QField Cloud).
--
-- Aplicar antes de habilitar los endpoints /proyectos/{id}/offline/*.

ALTER TABLE public.admin_asignacion
  ADD COLUMN IF NOT EXISTS ultima_sincronizacion_offline timestamp;

COMMENT ON COLUMN public.admin_asignacion.ultima_sincronizacion_offline IS
  'Timestamp de la última sincronización exitosa vía paquete offline manual';
