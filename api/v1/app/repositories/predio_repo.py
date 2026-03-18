from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import Optional

def get_all(db: Session, estado: Optional[str], persona_id: Optional[int], 
            municipio: Optional[str], npn: Optional[str]):
    filtros = ["1=1"]
    params  = {}

    if estado:
        filtros.append("ap.estado = :estado")
        params["estado"] = estado
    if persona_id:
        filtros.append("ap.persona_id = :persona_id")
        params["persona_id"] = persona_id
    if municipio:
        filtros.append("pr.municipio ILIKE :municipio")
        params["municipio"] = f"%{municipio}%"
    if npn:
        filtros.append("pr.npn ILIKE :npn")
        params["npn"] = f"%{npn}%"

    where = "WHERE " + " AND ".join(filtros)

    resultado = db.execute(text(f"""
        SELECT 
            pr.id_operacion, pr.npn, pr.npn_etiqueta,
            pr.nombre_predio, pr.municipio, pr.departamento,
            pr.numero_predial, pr.matricula_inmobiliaria,
            pr.area_total_terreno, pr.avaluo_catastral,
            pr.destinacion_economica, pr.condicion_predio,
            COALESCE(ap.estado, 'sin_asignar') AS estado,
            ap.tipo_asignacion,
            per.primer_nombre || ' ' || per.primer_apellido AS asignado_a
        FROM lc_predio_p pr
        LEFT JOIN admin_persona_predio ap ON pr.id_operacion = ap.id_operacion
        LEFT JOIN admin_personas per ON ap.persona_id = per.id
        {where}
        ORDER BY pr.npn
        LIMIT 500
    """), params).fetchall()
    return [dict(r._mapping) for r in resultado]

def get_geojson(db: Session, persona_id: Optional[int], es_admin: bool, uid: int):
    if not es_admin:
        filtro = "AND ap.persona_id = :pid"
        params = {"pid": uid}
    else:
        filtro = ""
        params = {}

    if persona_id:
        filtro = "AND ap.persona_id = :pid"
        params = {"pid": persona_id}

    resultado = db.execute(text(f"""
        SELECT json_build_object(
            'type', 'FeatureCollection',
            'features', COALESCE(json_agg(
                json_build_object(
                    'type',     'Feature',
                    'geometry', ST_AsGeoJSON(pr.geometry)::json,
                    'properties', json_build_object(
                        'id_operacion',     pr.id_operacion,
                        'npn',              pr.npn,
                        'npn_etiqueta',     pr.npn_etiqueta,
                        'nombre_predio',    pr.nombre_predio,
                        'municipio',        pr.municipio,
                        'matricula',        pr.matricula_inmobiliaria,
                        'area_terreno',     pr.area_total_terreno,
                        'avaluo_catastral', pr.avaluo_catastral,
                        'estado',           COALESCE(ap.estado, 'sin_asignar'),
                        'asignado_a',       per.primer_nombre || ' ' || per.primer_apellido
                    )
                )
            ) FILTER (WHERE pr.geometry IS NOT NULL), '[]')
        ) AS geojson
        FROM lc_predio_p pr
        LEFT JOIN admin_persona_predio ap ON pr.id_operacion = ap.id_operacion
        LEFT JOIN admin_personas per ON ap.persona_id = per.id
        WHERE 1=1 {filtro}
    """), params).fetchone()

    return resultado.geojson if resultado and resultado.geojson else {
        "type": "FeatureCollection", "features": []
    }