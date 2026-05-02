-- 006: Migra estado legacy 'pendiente' a 'campo' en admin_persona_predio.
--      'pendiente' fue un valor de facto introducido por
--      asignacion_proyecto_repo.crear_asignacion_predios; ahora se inserta
--      directamente como 'campo'.
UPDATE admin_persona_predio
   SET estado = 'campo',
       fecha_actualizacion = NOW()
 WHERE estado = 'pendiente';

-- Backfill: predios que ya fueron sincronizados desde QField
-- (lc_predio_p.ultima_sync_offline IS NOT NULL) pero cuyo estado en
-- admin_persona_predio no se actualizó (porque la lógica de
-- qfield_sync_service.py para marcar 'sincronizado' por predio es nueva).
-- Guardia IN ('campo','sincronizado') para no pisar 'validacion'/'completado'.
UPDATE admin_persona_predio AS app
   SET estado = 'sincronizado',
       fecha_actualizacion = NOW()
  FROM lc_predio_p AS p
 WHERE app.id_operacion = p.id_operacion
   AND p.ultima_sync_offline IS NOT NULL
   AND app.estado IN ('campo', 'sincronizado');
