"""
app/routers/revision_masiva.py

Listado masivo de predios listos para revisión post-campo:
predios pertenecientes a asignaciones cuyo proyecto de calidad
(admin_proyecto_calidad_muestreo) ya fue cerrado.
"""
from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from db.database import get_db
from core.deps import get_current_user

router = APIRouter(prefix="/revision-masiva", tags=["Revisión masiva"])


@router.get("/predios")
def listar_predios_revision_masiva(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    rows = db.execute(text("""
        SELECT DISTINCT ON (lp.id_operacion)
               lp.id_operacion,
               lp.numero_predial,
               lp.npn,
               lp.npn_etiqueta,
               lp.nombre_predio,
               lp.municipio,
               COALESCE(lp.calidad_campo, 0)          AS calidad_campo,
               COALESCE(lp.calidad_sig, 0)            AS calidad_sig,
               COALESCE(lp.calidad_identificacion, 0) AS calidad_identificacion,
               COALESCE(lp.calidad_fisica, 0)         AS calidad_fisica,
               COALESCE(lp.calidad_juridica, 0)       AS calidad_juridica,
               COALESCE(lp.calidad_economica, 0)      AS calidad_economica,
               COALESCE(mc.marcas_sig, 0)            AS marcas_abiertas_sig,
               COALESCE(mc.marcas_identificacion, 0) AS marcas_abiertas_identificacion,
               COALESCE(mc.marcas_fisica, 0)         AS marcas_abiertas_fisica,
               COALESCE(mc.marcas_juridica, 0)       AS marcas_abiertas_juridica,
               COALESCE(mc.marcas_economica, 0)      AS marcas_abiertas_economica,
               a.id             AS asignacion_id,
               a.clave_proyecto AS asignacion_clave,
               pcm.id           AS muestreo_id,
               pcm.nombre       AS muestreo_nombre,
               pcm.fecha_cierre
          FROM admin_proyecto_calidad_muestreo pcm
          JOIN admin_proyecto_calidad_muestreo_asignacion pcma
            ON pcma.proyecto_id = pcm.id
          JOIN admin_asignacion a
            ON a.id = pcma.asignacion_id
          JOIN admin_persona_predio ap
            ON ap.proyecto_id = a.id
          JOIN lc_predio_p lp
            ON lp.id_operacion = ap.id_operacion
          LEFT JOIN LATERAL (
            SELECT
              COUNT(*) FILTER (WHERE categoria = 'SIG')            AS marcas_sig,
              COUNT(*) FILTER (WHERE categoria = 'IDENTIFICACION') AS marcas_identificacion,
              COUNT(*) FILTER (WHERE categoria = 'FISICA')         AS marcas_fisica,
              COUNT(*) FILTER (WHERE categoria = 'JURIDICA')       AS marcas_juridica,
              COUNT(*) FILTER (WHERE categoria = 'ECONOMICA')      AS marcas_economica
            FROM admin_marca_predio mp
            WHERE mp.id_operacion = lp.id_operacion
              AND mp.estado = 'ABIERTA'
          ) mc ON TRUE
         WHERE pcm.estado = 'cerrado'
         ORDER BY lp.id_operacion, pcm.fecha_cierre DESC NULLS LAST
    """)).fetchall()

    return [dict(r._mapping) for r in rows]
