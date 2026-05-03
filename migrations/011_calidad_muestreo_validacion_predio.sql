-- Habilita el flujo de validación predio×proyecto y cierre del proyecto
-- de calidad. Cuando todos los predios muestra están marcados como
-- validados, el supervisor cierra el proyecto y eso propaga
-- lc_predio_p.calidad_campo = 1 a todos los predios del universo.

ALTER TABLE admin_proyecto_calidad_muestreo_predio
    ADD COLUMN IF NOT EXISTS validado         boolean   NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS fecha_validacion timestamp,
    ADD COLUMN IF NOT EXISTS validado_por     int REFERENCES admin_personas(id);

ALTER TABLE admin_proyecto_calidad_muestreo
    ADD COLUMN IF NOT EXISTS fecha_cierre timestamp,
    ADD COLUMN IF NOT EXISTS cerrado_por  int REFERENCES admin_personas(id);

CREATE INDEX IF NOT EXISTS idx_pcmp_validado
    ON admin_proyecto_calidad_muestreo_predio(proyecto_id, validado)
 WHERE en_muestra = TRUE;
