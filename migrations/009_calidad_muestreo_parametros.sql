-- Parametriza el cálculo de muestra del módulo /calidad-asignaciones.
-- Hasta ahora la muestra se calculaba con e=5% hardcodeado, lo que para
-- universos chicos (~60 predios) da muestras del ~85%. Con e=10% baja a
-- ~62%, con e=15% a ~43%.
-- Z queda fijo en 1.96 (IC 95%) — se persiste igual para auditoría futura.

ALTER TABLE admin_proyecto_calidad_muestreo
    ADD COLUMN IF NOT EXISTS nivel_confianza numeric NOT NULL DEFAULT 0.95
        CHECK (nivel_confianza IN (0.90, 0.95, 0.99)),
    ADD COLUMN IF NOT EXISTS margen_error    numeric NOT NULL DEFAULT 0.10
        CHECK (margen_error IN (0.05, 0.10, 0.15));
