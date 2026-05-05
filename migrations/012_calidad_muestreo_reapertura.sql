-- Habilita la reapertura de proyectos de calidad por asignación cerrados.
-- Tres columnas nuevas para auditoría. Si se reabre múltiples veces se
-- sobreescriben (siempre reflejan la última reapertura).

ALTER TABLE admin_proyecto_calidad_muestreo
    ADD COLUMN IF NOT EXISTS fecha_reapertura  timestamp,
    ADD COLUMN IF NOT EXISTS reabierto_por     int REFERENCES admin_personas(id),
    ADD COLUMN IF NOT EXISTS motivo_reapertura text;
