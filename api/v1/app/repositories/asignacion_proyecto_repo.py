from sqlalchemy.orm import Session
from sqlalchemy import text
import json

def get_all(db: Session):
    resultado = db.execute(text("""
        SELECT
            a.id, a.clave_proyecto, a.descripcion,
            a.estado, a.fecha_creacion, a.fecha_actualizacion,
            a.codigo_manzana,
            p.id AS responsable_id,
            p.primer_nombre || ' ' || p.primer_apellido AS responsable,
            COUNT(ap.id) AS total_predios
        FROM admin_asignacion a
        LEFT JOIN admin_personas p ON a.responsable_id = p.id
        LEFT JOIN admin_persona_predio ap ON a.id = ap.proyecto_id
        GROUP BY a.id, p.id
        ORDER BY a.fecha_creacion DESC
    """)).fetchall()
    return [dict(r._mapping) for r in resultado]

def get_by_id(db: Session, proyecto_id: int):
    resultado = db.execute(text("""
        SELECT
            a.id, a.clave_proyecto, a.descripcion,
            a.estado, a.fecha_creacion, a.fecha_actualizacion,
            a.codigo_manzana,
            a.ultima_sincronizacion_cloud,
            a.ultima_sincronizacion_offline,
            p.id AS responsable_id,
            p.primer_nombre || ' ' || p.primer_apellido AS responsable
        FROM admin_asignacion a
        LEFT JOIN admin_personas p ON a.responsable_id = p.id
        WHERE a.id = :id
    """), {"id": proyecto_id}).fetchone()
    return dict(resultado._mapping) if resultado else None

def get_by_clave(db: Session, clave: str):
    return db.execute(
        text("SELECT id FROM admin_asignacion WHERE clave_proyecto = :clave"),
        {"clave": clave}
    ).fetchone()

def create(db: Session, data: dict):
    resultado = db.execute(text("""
        INSERT INTO admin_asignacion
            (clave_proyecto, descripcion, estado, responsable_id)
        VALUES
            (:clave_proyecto, :descripcion, :estado, :responsable_id)
        RETURNING id
    """), data)
    db.commit()
    return resultado.fetchone()[0]

def update(db: Session, proyecto_id: int, campos: dict):
    set_clause = ", ".join([f"{k} = :{k}" for k in campos])
    campos["id"] = proyecto_id
    db.execute(text(f"""
        UPDATE admin_asignacion
        SET {set_clause}, fecha_actualizacion = NOW()
        WHERE id = :id
    """), campos)
    db.commit()

def update_responsable(db: Session, proyecto_id: int, responsable_id: int):
    """Cambia responsable del proyecto y reasigna todos sus predios"""
    db.execute(text("""
        UPDATE admin_asignacion
        SET responsable_id = :rid, fecha_actualizacion = NOW()
        WHERE id = :id
    """), {"rid": responsable_id, "id": proyecto_id})
    db.execute(text("""
        UPDATE admin_persona_predio
        SET persona_id = :rid, fecha_actualizacion = NOW()
        WHERE proyecto_id = :id
    """), {"rid": responsable_id, "id": proyecto_id})
    db.commit()

def delete(db: Session, proyecto_id: int):
    # Primero eliminar los predios asignados al proyecto (FK constraint)
    db.execute(
        text("DELETE FROM admin_persona_predio WHERE proyecto_id = :id"),
        {"id": proyecto_id}
    )
    # Luego eliminar el proyecto
    db.execute(
        text("DELETE FROM admin_asignacion WHERE id = :id"),
        {"id": proyecto_id}
    )
    db.commit()

def guardar_area_poligono(db: Session, proyecto_id: int, geojson: str):
    """Reemplaza el área del proyecto con el polígono dado."""
    db.execute(text("""
        UPDATE admin_asignacion SET
            area_geom = ST_Multi(ST_Transform(
                ST_SetSRID(ST_GeomFromGeoJSON(:geojson), 4326),
                9377
            )),
            codigo_manzana      = NULL,
            fecha_actualizacion = NOW()
        WHERE id = :id
    """), {"geojson": geojson, "id": proyecto_id})
    db.commit()

def guardar_area_manzana(db: Session, proyecto_id: int, codigo_manzana: str):
    """Reemplaza el área del proyecto con el buffer 0.5m de la manzana."""
    db.execute(text("""
        UPDATE admin_asignacion SET
            area_geom = ST_Multi((
                SELECT ST_Buffer(geom, 0.5)
                FROM manzana WHERE codigo = :codigo
            )),
            codigo_manzana      = :codigo,
            fecha_actualizacion = NOW()
        WHERE id = :id
    """), {"codigo": codigo_manzana, "id": proyecto_id})
    db.commit()

def agregar_area_poligono(db: Session, proyecto_id: int, geojson: str, estrategia: str):
    """
    Agrega un polígono al área existente del proyecto.
      - 'union'       → ST_Multi(ST_Union(vieja, nueva))
      - 'convex_hull' → ST_Multi(ST_ConvexHull(ST_Union(vieja, nueva)))
    Setea codigo_manzana = NULL (el área compuesta ya no representa una sola manzana).
    """
    if estrategia not in ("union", "convex_hull"):
        raise ValueError(f"estrategia_area inválida: {estrategia}")

    nueva_expr = """ST_Multi(ST_Transform(
        ST_SetSRID(ST_GeomFromGeoJSON(:geojson), 4326),
        9377
    ))"""

    if estrategia == "union":
        combinada_expr = f"ST_Multi(ST_Union(area_geom, {nueva_expr}))"
    else:  # convex_hull
        combinada_expr = f"ST_Multi(ST_ConvexHull(ST_Union(area_geom, {nueva_expr})))"

    db.execute(text(f"""
        UPDATE admin_asignacion SET
            area_geom = CASE
                WHEN area_geom IS NOT NULL THEN {combinada_expr}
                ELSE {nueva_expr}
            END,
            codigo_manzana      = NULL,
            fecha_actualizacion = NOW()
        WHERE id = :id
    """), {"geojson": geojson, "id": proyecto_id})
    db.commit()


def agregar_area_manzana(db: Session, proyecto_id: int, codigo_manzana: str, estrategia: str):
    """Agrega el buffer 0.5m de la manzana al área existente, según estrategia."""
    if estrategia not in ("union", "convex_hull"):
        raise ValueError(f"estrategia_area inválida: {estrategia}")

    nueva_expr = """ST_Multi((
        SELECT ST_Buffer(geom, 0.5)
        FROM manzana WHERE codigo = :codigo
    ))"""

    if estrategia == "union":
        combinada_expr = f"ST_Multi(ST_Union(area_geom, {nueva_expr}))"
    else:  # convex_hull
        combinada_expr = f"ST_Multi(ST_ConvexHull(ST_Union(area_geom, {nueva_expr})))"

    db.execute(text(f"""
        UPDATE admin_asignacion SET
            area_geom = CASE
                WHEN area_geom IS NOT NULL THEN {combinada_expr}
                ELSE {nueva_expr}
            END,
            codigo_manzana      = NULL,
            fecha_actualizacion = NOW()
        WHERE id = :id
    """), {"codigo": codigo_manzana, "id": proyecto_id})
    db.commit()


def borrar_predios_proyecto(db: Session, proyecto_id: int):
    """Borra todas las asignaciones de predios del proyecto."""
    db.execute(
        text("DELETE FROM admin_persona_predio WHERE proyecto_id = :id"),
        {"id": proyecto_id}
    )
    db.commit()


def limpiar_area(db: Session, proyecto_id: int):
    db.execute(text("""
        UPDATE admin_asignacion
        SET area_geom = NULL, codigo_manzana = NULL,
            fecha_actualizacion = NOW()
        WHERE id = :id
    """), {"id": proyecto_id})
    db.commit()

def asignar_predios(db: Session, proyecto_id: int, persona_id: int,
                    asignado_por: int, predios: list, tipo: str):
    """Inserta predios en admin_persona_predio sin duplicar"""
    insertados = 0
    for id_operacion in predios:
        existe = db.execute(text("""
            SELECT id FROM admin_persona_predio
            WHERE id_operacion = :id_op
              AND proyecto_id  = :pid
        """), {"id_op": id_operacion, "pid": proyecto_id}).fetchone()

        if not existe:
            db.execute(text("""
                INSERT INTO admin_persona_predio
                    (persona_id, asignado_por, id_operacion,
                     tipo_asignacion, estado, proyecto_id)
                VALUES
                    (:persona_id, :asignado_por, :id_op,
                     :tipo, 'pendiente', :proyecto_id)
            """), {
                "persona_id":   persona_id,
                "asignado_por": asignado_por,
                "id_op":        id_operacion,
                "tipo":         tipo,
                "proyecto_id":  proyecto_id
            })
            insertados += 1
    db.commit()
    return insertados

def get_predios(db: Session, proyecto_id: int):
    """Recupera predios asignados con datos de lc_predio_p y cr_terreno"""
    resultado = db.execute(text("""
        SELECT
            ap.id,
            ap.id_operacion,
            ap.tipo_asignacion,
            ap.estado,
            ap.fecha_asignacion,
            ap.fecha_actualizacion,
            per.id                                           AS persona_id,
            per.primer_nombre || ' ' || per.primer_apellido AS responsable,
            p.npn,
            p.npn_etiqueta,
            p.nombre_predio,
            p.municipio,
            p.numero_predial,
            p.matricula_inmobiliaria,
            p.avaluo_catastral,
            p.ultima_sync_offline,
            t.area_terreno,
            t.etiqueta
        FROM admin_persona_predio ap
        JOIN admin_personas per ON ap.persona_id   = per.id
        JOIN lc_predio_p p      ON ap.id_operacion = p.id_operacion
        LEFT JOIN cr_terreno t  ON p.numero_predial = t.npn
        WHERE ap.proyecto_id = :pid
        ORDER BY ap.fecha_asignacion DESC
    """), {"pid": proyecto_id}).fetchall()
    return [dict(r._mapping) for r in resultado]

def get_geojson(db: Session, proyecto_id: int):
    """GeoJSON de terrenos asignados al proyecto para visualización"""
    resultado = db.execute(text("""
        SELECT json_build_object(
            'type', 'FeatureCollection',
            'features', COALESCE(json_agg(
                json_build_object(
                    'type',     'Feature',
                    'geometry', ST_AsGeoJSON(
                                    ST_Transform(t.geometry, 4326)
                                )::json,
                    'properties', json_build_object(
                        'id',            ap.id,
                        'id_operacion',  p.id_operacion,
                        'npn',           p.npn,
                        'npn_etiqueta',  p.npn_etiqueta,
                        'nombre_predio', p.nombre_predio,
                        'municipio',     p.municipio,
                        'numero_predial',p.numero_predial,
                        'matricula',     p.matricula_inmobiliaria,
                        'avaluo',        p.avaluo_catastral,
                        'area_terreno',  t.area_terreno,
                        'estado',        ap.estado,
                        'responsable',   per.primer_nombre || ' ' || per.primer_apellido
                    )
                )
            ) FILTER (WHERE t.geometry IS NOT NULL), '[]')
        ) AS geojson
        FROM admin_persona_predio ap
        JOIN lc_predio_p p      ON ap.id_operacion  = p.id_operacion
        JOIN cr_terreno t       ON p.numero_predial  = t.npn
        JOIN admin_personas per ON ap.persona_id     = per.id
        WHERE ap.proyecto_id = :pid
    """), {"pid": proyecto_id}).fetchone()
    return resultado.geojson if resultado and resultado.geojson else {
        "type": "FeatureCollection", "features": []
    }


def get_area_geojson(db: Session, proyecto_id: int):
    """GeoJSON del área del proyecto (area_geom MultiPolygon) para visualización"""
    resultado = db.execute(text("""
        SELECT ST_AsGeoJSON(
                   ST_Transform(area_geom, 4326)
               ) AS geojson
        FROM admin_asignacion
        WHERE id = :id
          AND area_geom IS NOT NULL
    """), {"id": proyecto_id}).fetchone()
 
    if not resultado or not resultado.geojson:
        return None

    # Devolver como Feature para que el frontend lo trate igual que el GeoJSON de predios
    return {
        "type": "Feature",
        "geometry": json.loads(resultado.geojson),
        "properties": {"proyecto_id": proyecto_id}
    }


def actualizar_estado_predio(db, asignacion_id: int, proyecto_id: int, estado: str):
    db.execute(text("""
        UPDATE admin_persona_predio
        SET estado = :estado, fecha_actualizacion = NOW()
        WHERE id = :id AND proyecto_id = :pid
    """), {"estado": estado, "id": asignacion_id, "pid": proyecto_id})
    db.commit()


def get_predios_ids(db, proyecto_id: int) -> list:
    """Devuelve la lista de id_operacion asignados al proyecto."""
    rows = db.execute(text("""
        SELECT id_operacion
        FROM admin_persona_predio
        WHERE proyecto_id = :id
    """), {"id": proyecto_id}).fetchall()
    return [r.id_operacion for r in rows]


def guardar_qfield_cloud_id(db, proyecto_id: int, cloud_id: str):
    """Persiste el ID del proyecto en QField Cloud."""
    db.execute(text("""
        UPDATE admin_asignacion
        SET qfield_cloud_project_id = :cloud_id
        WHERE id = :id
    """), {"cloud_id": cloud_id, "id": proyecto_id})
    db.commit()


def get_qfield_cloud_id(db, proyecto_id: int):
    """Devuelve el ID del proyecto en QField Cloud, o None si no existe."""
    row = db.execute(text("""
        SELECT qfield_cloud_project_id
        FROM admin_asignacion
        WHERE id = :id
    """), {"id": proyecto_id}).fetchone()
    return row.qfield_cloud_project_id if row else None


def actualizar_ultima_sincronizacion_cloud(db, proyecto_id: int):
    """Marca el momento actual como última sincronización con QField Cloud."""
    db.execute(text("""
        UPDATE admin_asignacion
        SET ultima_sincronizacion_cloud = NOW()
        WHERE id = :id
    """), {"id": proyecto_id})
    db.commit()


def get_ultima_sincronizacion_cloud(db, proyecto_id: int):
    """Devuelve el timestamp de la última sincronización con QField Cloud, o None."""
    row = db.execute(text("""
        SELECT ultima_sincronizacion_cloud
        FROM admin_asignacion
        WHERE id = :id
    """), {"id": proyecto_id}).fetchone()
    return row.ultima_sincronizacion_cloud if row else None


def actualizar_estado_generacion(db, proyecto_id: int, estado: str, error: str | None = None):
    db.execute(text("""
        UPDATE admin_asignacion
        SET estado_generacion = :estado, error_generacion = :error
        WHERE id = :id
    """), {"estado": estado, "error": error, "id": proyecto_id})
    db.commit()


def get_estado_generacion(db, proyecto_id: int) -> dict:
    row = db.execute(text("""
        SELECT id, clave_proyecto, estado_generacion, error_generacion
        FROM admin_asignacion
        WHERE id = :id
    """), {"id": proyecto_id}).fetchone()
    if not row:
        return None
    return {
        "proyecto_id":       row.id,
        "clave":             row.clave_proyecto,
        "estado_generacion": row.estado_generacion,
        "error_generacion":  row.error_generacion,
    }


def get_area_wkt_9377(db, proyecto_id: int) -> str | None:
    """Devuelve area_geom del proyecto como WKT en EPSG:9377, o None."""
    row = db.execute(text("""
        SELECT ST_AsText(area_geom) AS wkt
        FROM admin_asignacion
        WHERE id = :id AND area_geom IS NOT NULL
    """), {"id": proyecto_id}).fetchone()
    return row.wkt if row else None
