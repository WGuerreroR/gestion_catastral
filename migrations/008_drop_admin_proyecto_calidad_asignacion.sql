-- Elimina admin_proyecto_calidad_asignacion: tabla huérfana sin referencias
-- en el código del repo (verificado por grep en .py/.sql/.jsx/.js/.md).
-- El nombre además genera ruido con admin_proyecto_calidad_muestreo_asignacion
-- creada en la migración 007.
--
-- Defensivo: aborta si la tabla cobró filas o adquirió FKs entrantes desde
-- la verificación inicial.

DO $$
DECLARE
    filas        bigint;
    fk_entrantes int;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = 'admin_proyecto_calidad_asignacion'
          AND c.relkind = 'r'
    ) THEN
        RAISE NOTICE 'admin_proyecto_calidad_asignacion no existe; nada que hacer.';
        RETURN;
    END IF;

    EXECUTE 'SELECT COUNT(*) FROM admin_proyecto_calidad_asignacion' INTO filas;
    IF filas > 0 THEN
        RAISE EXCEPTION
          'No se puede dropear admin_proyecto_calidad_asignacion: contiene % filas. Investigar antes de continuar.', filas;
    END IF;

    SELECT COUNT(*) INTO fk_entrantes
      FROM pg_constraint c
      JOIN pg_class      r ON r.oid = c.confrelid
      JOIN pg_namespace  n ON n.oid = r.relnamespace
     WHERE c.contype = 'f'
       AND n.nspname = 'public'
       AND r.relname = 'admin_proyecto_calidad_asignacion';
    IF fk_entrantes > 0 THEN
        RAISE EXCEPTION
          'admin_proyecto_calidad_asignacion tiene % FK entrantes. Listarlas y decidir antes de dropear.', fk_entrantes;
    END IF;
END$$;

DROP TABLE IF EXISTS admin_proyecto_calidad_asignacion;
