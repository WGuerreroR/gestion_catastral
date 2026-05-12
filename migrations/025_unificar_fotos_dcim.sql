-- Migración 025 — Unificación de rutas de fotos al prefijo DCIM/.
--
-- Antes: las rutas de fotos en BD podían tener dos prefijos:
--   * 'imgs/X.jpg' → resolvía al repo central /app/data/imgs/X.jpg
--   * 'DCIM/X.jpg' → resolvía al scoped /app/data/exports/{clave}/DCIM/X.jpg
--
-- Después: una sola convención (la estándar QField/Android):
--   * 'DCIM/X.jpg' → resuelve al repo central /app/data/DCIM/X.jpg
--
-- La consolidación física (mover archivos de imgs/ + exports/*/DCIM/ a
-- DCIM/) la hace scripts/migrar_imgs_a_dcim.py y debe correrse ANTES
-- que este SQL.
--
-- Idempotente: LIKE 'imgs/%' deja de matchear tras la primera corrida.

BEGIN;

UPDATE lc_predio_p
   SET foto = 'DCIM/' || substring(foto from 6)
 WHERE foto LIKE 'imgs/%';

UPDATE lc_predio_p
   SET foto_2 = 'DCIM/' || substring(foto_2 from 6)
 WHERE foto_2 LIKE 'imgs/%';

UPDATE cr_caracteristicasunidadconstruccion
   SET foto_fachada = 'DCIM/' || substring(foto_fachada from 6)
 WHERE foto_fachada LIKE 'imgs/%';

UPDATE cr_caracteristicasunidadconstruccion
   SET foto_banio = 'DCIM/' || substring(foto_banio from 6)
 WHERE foto_banio LIKE 'imgs/%';

UPDATE cr_caracteristicasunidadconstruccion
   SET foto_cocina = 'DCIM/' || substring(foto_cocina from 6)
 WHERE foto_cocina LIKE 'imgs/%';

UPDATE cr_caracteristicasunidadconstruccion
   SET foto_acabados = 'DCIM/' || substring(foto_acabados from 6)
 WHERE foto_acabados LIKE 'imgs/%';

UPDATE cr_caracteristicasunidadconstruccion
   SET foto_anexo = 'DCIM/' || substring(foto_anexo from 6)
 WHERE foto_anexo LIKE 'imgs/%';

UPDATE cr_caracteristicasunidadconstruccion
   SET foto_industrial = 'DCIM/' || substring(foto_industrial from 6)
 WHERE foto_industrial LIKE 'imgs/%';

COMMIT;
