-- Amplía el CHECK constraint de margen_error en admin_proyecto_calidad_muestreo
-- para incluir 20% y 25% (antes solo 5/10/15%). Para universos chicos
-- (~60 predios) los nuevos valores bajan la muestra de ~38 a ~18 / ~13.

DO $$
DECLARE
    cons_name text;
BEGIN
    -- Buscar el CHECK existente sobre margen_error (PG le dio nombre auto)
    SELECT con.conname
      INTO cons_name
      FROM pg_constraint con
      JOIN pg_class      rel ON rel.oid = con.conrelid
      JOIN pg_namespace  nsp ON nsp.oid = rel.relnamespace
      JOIN pg_attribute  att ON att.attrelid = rel.oid
                            AND att.attnum  = ANY(con.conkey)
     WHERE nsp.nspname = 'public'
       AND rel.relname = 'admin_proyecto_calidad_muestreo'
       AND att.attname = 'margen_error'
       AND con.contype = 'c'
     LIMIT 1;

    IF cons_name IS NOT NULL THEN
        EXECUTE format(
          'ALTER TABLE public.admin_proyecto_calidad_muestreo DROP CONSTRAINT %I',
          cons_name
        );
    END IF;
END$$;

ALTER TABLE admin_proyecto_calidad_muestreo
    ADD CONSTRAINT admin_proyecto_calidad_muestreo_margen_error_check
    CHECK (margen_error IN (0.05, 0.10, 0.15, 0.20, 0.25));
