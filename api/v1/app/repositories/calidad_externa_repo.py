"""
app/repositories/calidad_externa_repo.py
"""
import json
from sqlalchemy.orm import Session
from sqlalchemy import text
from utils.calidad import calcular_muestra_minima


# ── Preview: predios por polígono ─────────────────────────────────────────────

def predios_por_poligono(db: Session, geojson: dict) -> dict:
    geojson_str = json.dumps(geojson)
    rows = db.execute(text("""
        SELECT
            p.id_operacion,
            p.npn, p.npn_etiqueta, p.nombre_predio, p.municipio,
            ST_AsGeoJSON(ST_Transform(t.geometry, 4326)) AS geom_json
        FROM lc_predio_p p
        JOIN cr_terreno t ON t.npn = p.numero_predial
        WHERE ST_Intersects(
            t.geometry,
            ST_Transform(
                ST_SetSRID(ST_GeomFromGeoJSON(:geojson), 4326),
                9377
            )
        )
    """), {"geojson": geojson_str}).fetchall()

    id_operaciones = [r.id_operacion for r in rows]
    total          = len(id_operaciones)
    muestra        = calcular_muestra_minima(total)

    # Construir GeoJSON de los predios encontrados
    features = []
    for r in rows:
        if r.geom_json:
            features.append({
                "type": "Feature",
                "geometry": json.loads(r.geom_json),
                "properties": {
                    "id_operacion": r.id_operacion,
                    "npn":          r.npn,
                    "nombre_predio":r.nombre_predio,
                    "municipio":    r.municipio,
                }
            })

    return {
        "total_predios":     total,
        "muestra_calculada": muestra,
        "id_operaciones":    id_operaciones,
        "geojson_predios": {
            "type": "FeatureCollection",
            "features": features
        }
    }


# ── Preview: predios por manzanas ────────────────────────────────────────────

def predios_por_manzanas(db: Session, codigos_manzana: list) -> dict:
    rows_predios = db.execute(text("""
        SELECT
            p.id_operacion, p.npn, p.npn_etiqueta, p.nombre_predio, p.municipio,
            ST_AsGeoJSON(ST_Transform(t.geometry, 4326)) AS geom_json
        FROM lc_predio_p p
        JOIN cr_terreno t ON t.npn = p.numero_predial
        WHERE LEFT(p.numero_predial, 17) = ANY(:codigos)
    """), {"codigos": codigos_manzana}).fetchall()

    row_hull = db.execute(text("""
        SELECT ST_AsGeoJSON(ST_Transform(
            ST_ConvexHull(ST_Collect(m.geom)), 4326
        )) AS hull_json
        FROM manzana m
        WHERE m.codigo = ANY(:codigos)
    """), {"codigos": codigos_manzana}).fetchone()

    id_operaciones = [r.id_operacion for r in rows_predios]
    total          = len(id_operaciones)
    muestra        = calcular_muestra_minima(total)
    hull_geojson   = json.loads(row_hull.hull_json) if row_hull and row_hull.hull_json else None

    features = []
    for r in rows_predios:
        if r.geom_json:
            features.append({
                "type": "Feature",
                "geometry": json.loads(r.geom_json),
                "properties": {
                    "id_operacion": r.id_operacion,
                    "npn":          r.npn,
                    "nombre_predio":r.nombre_predio,
                    "municipio":    r.municipio,
                }
            })

    return {
        "total_predios":     total,
        "muestra_calculada": muestra,
        "id_operaciones":    id_operaciones,
        "hull_geojson":      hull_geojson,
        "geojson_predios": {
            "type": "FeatureCollection",
            "features": features
        }
    }


# ── Preview: predios por barrio ──────────────────────────────────────────────

def predios_por_barrio(db: Session, barrio_cod: str) -> dict:
    # Obtener codigos de manzanas del barrio
    rows_mz = db.execute(text("""
        SELECT codigo FROM manzana WHERE barrio_cod = :barrio
    """), {"barrio": barrio_cod}).fetchall()
    codigos = [r.codigo for r in rows_mz]

    if not codigos:
        return {
            "total_predios": 0, "muestra_calculada": 0,
            "id_operaciones": [], "hull_geojson": None,
            "manzanas_incluidas": [], "geojson_predios": {"type":"FeatureCollection","features":[]}
        }

    resultado = predios_por_manzanas(db, codigos)
    resultado["manzanas_incluidas"] = codigos
    return resultado


# ── Utilidades de consulta ────────────────────────────────────────────────────

def get_barrios(db: Session):
    rows = db.execute(text("""
        SELECT DISTINCT barrio_cod FROM manzana
        WHERE barrio_cod IS NOT NULL
        ORDER BY barrio_cod
    """)).fetchall()
    return [r.barrio_cod for r in rows]


def get_manzanas(db: Session, codigo_parcial: str):
    rows = db.execute(text("""
        SELECT codigo, barrio_cod FROM manzana
        WHERE codigo LIKE :patron
        LIMIT 20
    """), {"patron": f"{codigo_parcial}%"}).fetchall()
    return [dict(r._mapping) for r in rows]


# ── Crear proyecto de calidad externa ────────────────────────────────────────

def crear_proyecto_externa(db: Session, nombre: str, descripcion: str,
                            area_geojson: dict, id_operaciones: list,
                            muestra_calculada: int) -> dict:
    total_predios  = len(id_operaciones)
    area_geojson_str = json.dumps(area_geojson)

    # 1. Crear proyecto_calidad con área geométrica
    pc = db.execute(text("""
        INSERT INTO admin_proyecto_calidad
            (nombre, descripcion, tipo, total_predios, muestra_calculada, area_geom)
        VALUES (
            :nombre, :descripcion, 'externa', :total, :muestra,
            ST_Multi(ST_Transform(
                ST_SetSRID(ST_GeomFromGeoJSON(:area), 4326), 9377
            ))
        )
        RETURNING id
    """), {
        "nombre":      nombre,
        "descripcion": descripcion,
        "total":       total_predios,
        "muestra":     muestra_calculada,
        "area":        area_geojson_str
    }).fetchone()
    pc_id = pc.id

    # 2. Insertar universo
    for id_op in id_operaciones:
        db.execute(text("""
            INSERT INTO admin_proyecto_calidad_predio (proyecto_calidad_id, id_operacion)
            VALUES (:pc_id, :id_op)
        """), {"pc_id": pc_id, "id_op": id_op})

    # 3. Selección aleatoria inicial
    db.execute(text("""
        INSERT INTO admin_proyecto_calidad_muestra (proyecto_calidad_id, id_operacion)
        SELECT :pc_id, id_operacion
        FROM admin_proyecto_calidad_predio
        WHERE proyecto_calidad_id = :pc_id
        ORDER BY RANDOM()
        LIMIT :muestra
    """), {"pc_id": pc_id, "muestra": muestra_calculada})

    db.commit()
    return {"id": pc_id, "total_predios": total_predios, "muestra_calculada": muestra_calculada}


# ── Rerandomizar ──────────────────────────────────────────────────────────────

def rerandomizar(db: Session, pc_id: int):
    row = db.execute(text("""
        SELECT muestra_calculada FROM admin_proyecto_calidad WHERE id = :id AND tipo = 'externa'
    """), {"id": pc_id}).fetchone()
    if not row:
        raise ValueError(f"Proyecto de calidad externa {pc_id} no encontrado")

    db.execute(text("""
        DELETE FROM admin_proyecto_calidad_muestra WHERE proyecto_calidad_id = :id
    """), {"id": pc_id})

    db.execute(text("""
        INSERT INTO admin_proyecto_calidad_muestra (proyecto_calidad_id, id_operacion)
        SELECT :pc_id, id_operacion
        FROM admin_proyecto_calidad_predio
        WHERE proyecto_calidad_id = :pc_id
        ORDER BY RANDOM()
        LIMIT :muestra
    """), {"pc_id": pc_id, "muestra": row.muestra_calculada})

    db.execute(text("""
        UPDATE proyecto_calidad SET fecha_actualizacion = NOW() WHERE id = :id
    """), {"id": pc_id})

    db.commit()


# ── Listar y detalle ──────────────────────────────────────────────────────────

def get_lista(db: Session):
    rows = db.execute(text("""
        SELECT id, nombre, descripcion, estado, total_predios,
               muestra_calculada, fecha_creacion, fecha_actualizacion
        FROM admin_proyecto_calidad
        WHERE tipo = 'externa'
        ORDER BY fecha_creacion DESC
    """)).fetchall()
    return [dict(r._mapping) for r in rows]


def get_by_id(db: Session, pc_id: int):
    row = db.execute(text("""
        SELECT id, nombre, descripcion, estado, total_predios,
               muestra_calculada, fecha_creacion, fecha_actualizacion,
               ST_AsGeoJSON(ST_Transform(area_geom, 4326)) AS area_geojson
        FROM admin_proyecto_calidad
        WHERE id = :id AND tipo = 'externa'
    """), {"id": pc_id}).fetchone()
    if not row:
        return None
    result = dict(row._mapping)
    if result.get("area_geojson"):
        result["area_geojson"] = json.loads(result["area_geojson"])
    return result


# ── Predios y GeoJSON ─────────────────────────────────────────────────────────

def get_predios(db: Session, pc_id: int):
    rows = db.execute(text("""
        SELECT
            pcp.id_operacion,
            p.npn, p.npn_etiqueta, p.nombre_predio, p.municipio,
            CASE WHEN pcm.id_operacion IS NOT NULL THEN true ELSE false END AS en_muestra
        FROM admin_proyecto_calidad_predio pcp
        JOIN lc_predio_p p ON p.id_operacion = pcp.id_operacion
        LEFT JOIN admin_proyecto_calidad_muestra pcm
            ON pcm.id_operacion = pcp.id_operacion
            AND pcm.proyecto_calidad_id = :pc_id
        WHERE pcp.proyecto_calidad_id = :pc_id
        ORDER BY en_muestra DESC, p.npn
    """), {"pc_id": pc_id}).fetchall()
    return [dict(r._mapping) for r in rows]


def get_geojson(db: Session, pc_id: int):
    """GeoJSON de predios + área del proyecto"""
    row = db.execute(text("""
        SELECT json_build_object(
            'type', 'FeatureCollection',
            'features', COALESCE(json_agg(
                json_build_object(
                    'type', 'Feature',
                    'geometry', ST_AsGeoJSON(ST_Transform(t.geometry, 4326))::json,
                    'properties', json_build_object(
                        'id_operacion', pcp.id_operacion,
                        'npn',          p.npn,
                        'npn_etiqueta', p.npn_etiqueta,
                        'nombre_predio',p.nombre_predio,
                        'municipio',    p.municipio,
                        'en_muestra',   CASE WHEN pcm.id_operacion IS NOT NULL
                                        THEN true ELSE false END
                    )
                )
            ) FILTER (WHERE t.geometry IS NOT NULL), '[]')
        ) AS geojson
        FROM admin_proyecto_calidad_predio pcp
        JOIN lc_predio_p p ON p.id_operacion = pcp.id_operacion
        JOIN cr_terreno t  ON t.npn = p.numero_predial
        LEFT JOIN admin_proyecto_calidad_muestra pcm
            ON pcm.id_operacion = pcp.id_operacion
            AND pcm.proyecto_calidad_id = :pc_id
        WHERE pcp.proyecto_calidad_id = :pc_id
    """), {"pc_id": pc_id}).fetchone()

    # Incluir área del proyecto como feature separado
    row_area = db.execute(text("""
        SELECT ST_AsGeoJSON(ST_Transform(area_geom, 4326)) AS area_json
        FROM admin_proyecto_calidad WHERE id = :id AND area_geom IS NOT NULL
    """), {"id": pc_id}).fetchone()

    geojson = row.geojson if row else {"type": "FeatureCollection", "features": []}

    if row_area and row_area.area_json:
        geojson["area_proyecto"] = json.loads(row_area.area_json)

    return geojson