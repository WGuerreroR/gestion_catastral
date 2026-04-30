-- Permite el nuevo estado 'sincronizado' en admin_asignacion.estado.
-- El CHECK previo solo aceptaba ('campo','validacion','finalizado'); tras un
-- sync ok la asignación pasa a 'sincronizado' y puede re-sincronizarse N veces
-- antes de pasar manualmente a 'validacion'.

DO $$
DECLARE
    cons_name text;
BEGIN
    -- Busca cualquier CHECK existente sobre la columna 'estado' de admin_asignacion
    SELECT con.conname
      INTO cons_name
      FROM pg_constraint con
      JOIN pg_class      rel ON rel.oid = con.conrelid
      JOIN pg_namespace  nsp ON nsp.oid = rel.relnamespace
      JOIN pg_attribute  att ON att.attrelid = rel.oid
                            AND att.attnum  = ANY(con.conkey)
     WHERE nsp.nspname = 'public'
       AND rel.relname = 'admin_asignacion'
       AND att.attname = 'estado'
       AND con.contype = 'c'
     LIMIT 1;

    IF cons_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE public.admin_asignacion DROP CONSTRAINT %I', cons_name);
    END IF;
END$$;

ALTER TABLE public.admin_asignacion
  ADD CONSTRAINT admin_asignacion_estado_check
  CHECK (estado IN ('campo', 'sincronizado', 'validacion', 'finalizado'));
