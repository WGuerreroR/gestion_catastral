-- ─────────────────────────────────────────────────────────────────────────────
-- 020_validacion_calidad_regla_solo_select.sql
--
-- Cambio de seguridad: las reglas ahora deben definir SOLO el cuerpo SELECT
-- (o WITH ... SELECT) que produce las 4 columnas del log. El servicio
-- envuelve con `INSERT INTO validacion_calidad_log (...)` antes de ejecutar.
--
-- Esto evita que una regla maliciosa pueda escribir un INSERT en otra tabla
-- (p.ej. INSERT INTO admin_personas ...) o ejecutar DDL.
--
-- Esta migración strippea el prefijo INSERT de las reglas ya almacenadas
-- (las 20 seed más cualquiera creada manualmente). Idempotente:
--   - Si la regla ya está en formato SELECT-only, no la toca.
--   - Si empieza con INSERT INTO validacion_calidad_log (...), elimina el prefijo.
--   - Si empieza con cualquier otro INSERT (no debería pasar por la validación
--     anterior), tampoco la toca — el endpoint de actualizar regla la rechazará
--     en el próximo guardado.
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE public.validacion_calidad_regla
   SET sql_template = regexp_replace(
         sql_template,
         '^\s*INSERT\s+INTO\s+validacion_calidad_log\s*\([^)]+\)\s*',
         '',
         'i'
       )
 WHERE sql_template ~* '^\s*INSERT\s+INTO\s+validacion_calidad_log\s*\(';
