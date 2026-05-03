"""
Repositorio del muestreo de calidad por asignación operativa.

Tablas: admin_proyecto_calidad_muestreo (cabecera),
        admin_proyecto_calidad_muestreo_asignacion (N:N con admin_asignacion),
        admin_proyecto_calidad_muestreo_predio (universo + flag muestra).

Espejo del flujo viejo /calidad-externa, pero el universo se construye
seleccionando asignaciones en estado 'validacion' en lugar de un área
geográfica dibujada.
"""

import json
from typing import Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from utils.calidad import calcular_muestra


# ── Universo: asignaciones disponibles ────────────────────────────────────────

def get_asignaciones_disponibles(db: Session) -> list[dict]:
    """Asignaciones en estado 'validacion' con conteo de predios y responsable."""
    rows = db.execute(text("""
        SELECT a.id,
               a.clave_proyecto,
               a.descripcion,
               a.responsable_id,
               p.primer_nombre || ' ' || p.primer_apellido AS responsable,
               a.fecha_entrada_validacion,
               COUNT(ap.id) AS total_predios
          FROM admin_asignacion a
          LEFT JOIN admin_personas p        ON a.responsable_id = p.id
          LEFT JOIN admin_persona_predio ap ON a.id = ap.proyecto_id
         WHERE a.estado = 'validacion'
         GROUP BY a.id, p.id
         ORDER BY a.clave_proyecto
    """)).fetchall()
    return [dict(r._mapping) for r in rows]


# ── Preview: predios + área de las asignaciones seleccionadas ────────────────

def preview_predios_por_asignaciones(
    db: Session, asignacion_ids: list[int],
    margen_error: float = 0.10, nivel_confianza: float = 0.95,
) -> dict:
    """
    Para un set de asignaciones devuelve: total_predios, muestra_calculada,
    id_operaciones (deduplicados), geojson_predios y area_geojson (ST_Union
    de las áreas de las asignaciones).
    """
    if not asignacion_ids:
        return {
            "total_predios":     0,
            "muestra_calculada": 0,
            "id_operaciones":    [],
            "geojson_predios":   {"type": "FeatureCollection", "features": []},
            "area_geojson":      None,
        }

    # Predios + geometría de su terreno. DISTINCT por id_operacion (un mismo
    # predio podría estar asignado en más de un proyecto, aunque es raro).
    rows = db.execute(text("""
        SELECT DISTINCT ON (p.id_operacion)
               p.id_operacion,
               p.npn, p.npn_etiqueta, p.nombre_predio, p.municipio,
               ST_AsGeoJSON(ST_Transform(t.geometry, 4326)) AS geom_json
          FROM admin_persona_predio ap
          JOIN lc_predio_p p ON ap.id_operacion = p.id_operacion
          LEFT JOIN cr_terreno t ON t.npn = p.numero_predial
         WHERE ap.proyecto_id = ANY(:ids)
    """), {"ids": asignacion_ids}).fetchall()

    id_operaciones = [r.id_operacion for r in rows]
    total          = len(id_operaciones)
    muestra        = calcular_muestra(total, margen_error, nivel_confianza)

    features = []
    for r in rows:
        if r.geom_json:
            features.append({
                "type": "Feature",
                "geometry": json.loads(r.geom_json),
                "properties": {
                    "id_operacion":  r.id_operacion,
                    "npn":           r.npn,
                    "nombre_predio": r.nombre_predio,
                    "municipio":     r.municipio,
                },
            })

    # Área = ST_Union de los area_geom de las asignaciones (las que tengan).
    row_area = db.execute(text("""
        SELECT ST_AsGeoJSON(ST_Transform(
                   ST_Multi(ST_Union(area_geom)), 4326
               )) AS area_json
          FROM admin_asignacion
         WHERE id = ANY(:ids) AND area_geom IS NOT NULL
    """), {"ids": asignacion_ids}).fetchone()
    area_geojson = json.loads(row_area.area_json) if row_area and row_area.area_json else None

    return {
        "total_predios":     total,
        "muestra_calculada": muestra,
        "id_operaciones":    id_operaciones,
        "geojson_predios": {
            "type":     "FeatureCollection",
            "features": features,
        },
        "area_geojson":      area_geojson,
    }


# ── Crear proyecto ────────────────────────────────────────────────────────────

def crear_proyecto(
    db: Session,
    *,
    nombre: str,
    descripcion: Optional[str],
    asignacion_ids: list[int],
    id_operaciones: list[str],
    muestra_calculada: int,
    creado_por: Optional[int],
    margen_error: float = 0.10,
    nivel_confianza: float = 0.95,
) -> dict:
    """Inserta cabecera + N:N de asignaciones + universo de predios + selección
    aleatoria inicial. Todo en una sola transacción."""
    total_predios = len(id_operaciones)

    pc = db.execute(text("""
        INSERT INTO admin_proyecto_calidad_muestreo
            (nombre, descripcion, total_predios, muestra_calculada,
             area_geom, creado_por, margen_error, nivel_confianza)
        VALUES
            (:nombre, :descripcion, :total, :muestra,
             (SELECT ST_Multi(ST_Union(area_geom))
                FROM admin_asignacion
               WHERE id = ANY(:ids) AND area_geom IS NOT NULL),
             :creado_por, :margen_error, :nivel_confianza)
        RETURNING id
    """), {
        "nombre":          nombre,
        "descripcion":     descripcion,
        "total":           total_predios,
        "muestra":         muestra_calculada,
        "ids":             asignacion_ids,
        "creado_por":      creado_por,
        "margen_error":    margen_error,
        "nivel_confianza": nivel_confianza,
    }).fetchone()
    pc_id = pc.id

    # N:N proyecto ↔ asignación
    for asig_id in asignacion_ids:
        db.execute(text("""
            INSERT INTO admin_proyecto_calidad_muestreo_asignacion
                (proyecto_id, asignacion_id)
            VALUES (:pc_id, :asig_id)
            ON CONFLICT DO NOTHING
        """), {"pc_id": pc_id, "asig_id": asig_id})

    # Universo de predios (en_muestra=false)
    for id_op in id_operaciones:
        db.execute(text("""
            INSERT INTO admin_proyecto_calidad_muestreo_predio
                (proyecto_id, id_operacion, en_muestra)
            VALUES (:pc_id, :id_op, false)
            ON CONFLICT DO NOTHING
        """), {"pc_id": pc_id, "id_op": id_op})

    # Selección aleatoria inicial
    db.execute(text("""
        UPDATE admin_proyecto_calidad_muestreo_predio
           SET en_muestra = true
         WHERE id IN (
             SELECT id FROM admin_proyecto_calidad_muestreo_predio
              WHERE proyecto_id = :pc_id
              ORDER BY RANDOM()
              LIMIT :muestra
         )
    """), {"pc_id": pc_id, "muestra": muestra_calculada})

    db.commit()
    return {
        "id": pc_id,
        "total_predios": total_predios,
        "muestra_calculada": muestra_calculada,
    }


# ── Eliminar / rerandomizar ───────────────────────────────────────────────────

def eliminar_proyecto(db: Session, pc_id: int) -> None:
    row = db.execute(text("""
        SELECT id FROM admin_proyecto_calidad_muestreo WHERE id = :id
    """), {"id": pc_id}).fetchone()
    if not row:
        raise ValueError(f"Proyecto de muestreo {pc_id} no encontrado")
    # Cascade desde admin_proyecto_calidad_muestreo borra _asignacion y _predio.
    db.execute(text("""
        DELETE FROM admin_proyecto_calidad_muestreo WHERE id = :id
    """), {"id": pc_id})
    db.commit()


def rerandomizar(
    db: Session, pc_id: int,
    nuevo_margen_error: Optional[float] = None,
) -> dict:
    """
    Re-sortea la muestra del proyecto. Si se pasa nuevo_margen_error, recalcula
    muestra_calculada con el nuevo valor y lo persiste en la cabecera.
    """
    row = db.execute(text("""
        SELECT total_predios, muestra_calculada, margen_error, nivel_confianza
          FROM admin_proyecto_calidad_muestreo WHERE id = :id
    """), {"id": pc_id}).fetchone()
    if not row:
        raise ValueError(f"Proyecto de muestreo {pc_id} no encontrado")

    if nuevo_margen_error is not None and float(nuevo_margen_error) != float(row.margen_error):
        nuevo_margen = float(nuevo_margen_error)
        nueva_muestra = calcular_muestra(
            int(row.total_predios), nuevo_margen, float(row.nivel_confianza)
        )
        db.execute(text("""
            UPDATE admin_proyecto_calidad_muestreo
               SET margen_error      = :margen,
                   muestra_calculada = :muestra,
                   fecha_actualizacion = NOW()
             WHERE id = :id
        """), {"margen": nuevo_margen, "muestra": nueva_muestra, "id": pc_id})
        muestra_a_seleccionar = nueva_muestra
        margen_final = nuevo_margen
    else:
        muestra_a_seleccionar = int(row.muestra_calculada)
        margen_final = float(row.margen_error)

    # Limpiar marca de muestra actual y resetear validaciones (al recalcular,
    # la muestra cambia y el proceso de validación arranca de cero).
    db.execute(text("""
        UPDATE admin_proyecto_calidad_muestreo_predio
           SET en_muestra       = false,
               validado         = false,
               fecha_validacion = NULL,
               validado_por     = NULL
         WHERE proyecto_id = :pc_id
    """), {"pc_id": pc_id})

    db.execute(text("""
        UPDATE admin_proyecto_calidad_muestreo_predio
           SET en_muestra = true
         WHERE id IN (
             SELECT id FROM admin_proyecto_calidad_muestreo_predio
              WHERE proyecto_id = :pc_id
              ORDER BY RANDOM()
              LIMIT :muestra
         )
    """), {"pc_id": pc_id, "muestra": muestra_a_seleccionar})

    db.execute(text("""
        UPDATE admin_proyecto_calidad_muestreo
           SET fecha_actualizacion = NOW()
         WHERE id = :id
    """), {"id": pc_id})
    db.commit()
    return {"muestra_calculada": muestra_a_seleccionar, "margen_error": margen_final}


# ── Listar / detalle ──────────────────────────────────────────────────────────

def get_lista(db: Session) -> list[dict]:
    rows = db.execute(text("""
        SELECT m.id, m.nombre, m.descripcion, m.estado,
               m.total_predios, m.muestra_calculada,
               m.margen_error, m.nivel_confianza,
               m.fecha_creacion, m.fecha_actualizacion,
               m.fecha_cierre,
               m.creado_por,
               p.primer_nombre || ' ' || p.primer_apellido AS creado_por_nombre,
               COUNT(DISTINCT mca.id) AS asignaciones_count,
               COUNT(DISTINCT mcp.id) FILTER (
                   WHERE mcp.en_muestra = TRUE AND mcp.validado = TRUE
               ) AS validados_count
          FROM admin_proyecto_calidad_muestreo m
          LEFT JOIN admin_personas p ON m.creado_por = p.id
          LEFT JOIN admin_proyecto_calidad_muestreo_asignacion mca
                 ON mca.proyecto_id = m.id
          LEFT JOIN admin_proyecto_calidad_muestreo_predio mcp
                 ON mcp.proyecto_id = m.id
         GROUP BY m.id, p.id
         ORDER BY m.fecha_creacion DESC
    """)).fetchall()
    return [dict(r._mapping) for r in rows]


def get_by_id(db: Session, pc_id: int) -> Optional[dict]:
    row = db.execute(text("""
        SELECT m.id, m.nombre, m.descripcion, m.estado,
               m.total_predios, m.muestra_calculada,
               m.margen_error, m.nivel_confianza,
               m.fecha_creacion, m.fecha_actualizacion,
               m.fecha_cierre, m.cerrado_por,
               m.creado_por,
               p.primer_nombre || ' ' || p.primer_apellido AS creado_por_nombre,
               (SELECT COUNT(*) FROM admin_proyecto_calidad_muestreo_asignacion
                 WHERE proyecto_id = m.id) AS asignaciones_count,
               (SELECT COUNT(*) FROM admin_proyecto_calidad_muestreo_predio
                 WHERE proyecto_id = m.id
                   AND en_muestra = TRUE AND validado = TRUE) AS validados_count,
               ST_AsGeoJSON(ST_Transform(m.area_geom, 4326)) AS area_json
          FROM admin_proyecto_calidad_muestreo m
          LEFT JOIN admin_personas p ON m.creado_por = p.id
         WHERE m.id = :id
    """), {"id": pc_id}).fetchone()
    if not row:
        return None
    out = dict(row._mapping)
    area_json = out.pop("area_json", None)
    out["area_geojson"] = json.loads(area_json) if area_json else None
    return out


def get_predios(db: Session, pc_id: int) -> list[dict]:
    rows = db.execute(text("""
        SELECT mcp.id_operacion,
               p.npn, p.npn_etiqueta, p.nombre_predio, p.municipio,
               mcp.en_muestra,
               mcp.validado, mcp.fecha_validacion, mcp.validado_por
          FROM admin_proyecto_calidad_muestreo_predio mcp
          JOIN lc_predio_p p ON p.id_operacion = mcp.id_operacion
         WHERE mcp.proyecto_id = :pc_id
         ORDER BY mcp.en_muestra DESC, p.npn
    """), {"pc_id": pc_id}).fetchall()
    return [dict(r._mapping) for r in rows]


def get_asignaciones_de_proyecto(db: Session, pc_id: int) -> list[dict]:
    rows = db.execute(text("""
        SELECT mca.asignacion_id,
               a.clave_proyecto, a.descripcion, a.estado AS estado_asignacion,
               per.primer_nombre || ' ' || per.primer_apellido AS responsable,
               COUNT(ap.id) AS total_predios
          FROM admin_proyecto_calidad_muestreo_asignacion mca
          JOIN admin_asignacion a       ON a.id = mca.asignacion_id
          LEFT JOIN admin_personas per  ON per.id = a.responsable_id
          LEFT JOIN admin_persona_predio ap ON ap.proyecto_id = a.id
         WHERE mca.proyecto_id = :pc_id
         GROUP BY mca.asignacion_id, a.id, per.id
         ORDER BY a.clave_proyecto
    """), {"pc_id": pc_id}).fetchall()
    return [dict(r._mapping) for r in rows]


_CAMPOS_EDITABLES_PROYECTO = {"nombre", "descripcion"}


def actualizar_proyecto(db: Session, pc_id: int, campos: dict) -> None:
    """
    UPDATE acotado de campos editables del proyecto. Whitelist: nombre,
    descripcion. Falla si el proyecto no existe o si está cerrado (los
    proyectos cerrados son solo lectura).
    """
    cab = db.execute(text("""
        SELECT estado FROM admin_proyecto_calidad_muestreo WHERE id = :id
    """), {"id": pc_id}).fetchone()
    if not cab:
        raise ValueError(f"Proyecto de muestreo {pc_id} no encontrado")
    if cab.estado == "cerrado":
        raise ValueError("El proyecto está cerrado y no admite cambios")

    set_pairs = {
        k: v for k, v in campos.items()
        if k in _CAMPOS_EDITABLES_PROYECTO and v is not None
    }
    if not set_pairs:
        return
    set_clause = ", ".join(f"{k} = :{k}" for k in set_pairs)
    params = {**set_pairs, "id": pc_id}
    db.execute(text(f"""
        UPDATE admin_proyecto_calidad_muestreo
           SET {set_clause},
               fecha_actualizacion = NOW()
         WHERE id = :id
    """), params)
    db.commit()


def marcar_predio_validado(
    db: Session, pc_id: int, id_operacion: str,
    validado: bool, validado_por: Optional[int],
) -> dict:
    """
    Marca un predio muestra como validado/no validado dentro del proyecto.
    Falla si el proyecto está cerrado o si el predio no es muestra.
    Devuelve {validados, total_muestra, todos_validados}.
    """
    cab = db.execute(text("""
        SELECT estado FROM admin_proyecto_calidad_muestreo WHERE id = :id
    """), {"id": pc_id}).fetchone()
    if not cab:
        raise ValueError(f"Proyecto de muestreo {pc_id} no encontrado")
    if cab.estado == "cerrado":
        raise ValueError("El proyecto ya está cerrado y no admite más cambios")

    res = db.execute(text("""
        UPDATE admin_proyecto_calidad_muestreo_predio
           SET validado         = :v,
               fecha_validacion = CASE WHEN :v THEN NOW() ELSE NULL END,
               validado_por     = CASE WHEN :v THEN :user ELSE NULL END
         WHERE proyecto_id = :pc
           AND id_operacion = :id_op
           AND en_muestra = TRUE
        RETURNING id
    """), {"v": validado, "user": validado_por, "pc": pc_id, "id_op": id_operacion})
    if res.rowcount == 0:
        raise ValueError(
            "Predio no encontrado en la muestra del proyecto"
        )

    conteo = db.execute(text("""
        SELECT
          COUNT(*) FILTER (WHERE en_muestra = TRUE)                       AS total_muestra,
          COUNT(*) FILTER (WHERE en_muestra = TRUE AND validado = TRUE)   AS validados
          FROM admin_proyecto_calidad_muestreo_predio
         WHERE proyecto_id = :pc
    """), {"pc": pc_id}).fetchone()
    db.commit()
    total      = int(conteo.total_muestra or 0)
    validados  = int(conteo.validados     or 0)
    return {
        "validados":       validados,
        "total_muestra":   total,
        "todos_validados": (total > 0 and validados == total),
    }


def cerrar_proyecto(
    db: Session, pc_id: int, cerrado_por: Optional[int],
) -> dict:
    """
    Cierra el proyecto: propaga calidad_campo=1 a TODOS los predios del
    universo (no solo los muestra), marca el proyecto como 'cerrado'.
    Aborta si algún predio muestra no está validado.
    """
    cab = db.execute(text("""
        SELECT estado, total_predios FROM admin_proyecto_calidad_muestreo
         WHERE id = :id
    """), {"id": pc_id}).fetchone()
    if not cab:
        raise ValueError(f"Proyecto de muestreo {pc_id} no encontrado")
    if cab.estado == "cerrado":
        raise ValueError("El proyecto ya está cerrado")

    conteo = db.execute(text("""
        SELECT
          COUNT(*) FILTER (WHERE en_muestra = TRUE)                       AS total_muestra,
          COUNT(*) FILTER (WHERE en_muestra = TRUE AND validado = TRUE)   AS validados
          FROM admin_proyecto_calidad_muestreo_predio
         WHERE proyecto_id = :pc
    """), {"pc": pc_id}).fetchone()
    total_muestra = int(conteo.total_muestra or 0)
    validados     = int(conteo.validados     or 0)
    if total_muestra == 0:
        raise ValueError("El proyecto no tiene predios en muestra")
    if validados < total_muestra:
        raise ValueError(
            f"Faltan validar {total_muestra - validados} predio(s) "
            f"de la muestra antes de cerrar"
        )

    # Propagar calidad_campo=1 a todos los predios del universo
    res = db.execute(text("""
        UPDATE lc_predio_p
           SET calidad_campo    = 1,
               last_edited_date = NOW()
         WHERE id_operacion IN (
             SELECT id_operacion
               FROM admin_proyecto_calidad_muestreo_predio
              WHERE proyecto_id = :pc
         )
    """), {"pc": pc_id})
    predios_marcados = res.rowcount or 0

    # Cerrar el proyecto
    cierre = db.execute(text("""
        UPDATE admin_proyecto_calidad_muestreo
           SET estado              = 'cerrado',
               fecha_cierre        = NOW(),
               cerrado_por         = :user,
               fecha_actualizacion = NOW()
         WHERE id = :pc
        RETURNING fecha_cierre
    """), {"user": cerrado_por, "pc": pc_id}).fetchone()
    db.commit()

    return {
        "predios_marcados": predios_marcados,
        "fecha_cierre":     cierre.fecha_cierre,
    }


def get_geojson(db: Session, pc_id: int) -> dict:
    """GeoJSON FeatureCollection de los predios del universo + área."""
    row = db.execute(text("""
        SELECT json_build_object(
            'type', 'FeatureCollection',
            'features', COALESCE(json_agg(
                json_build_object(
                    'type', 'Feature',
                    'geometry', ST_AsGeoJSON(ST_Transform(t.geometry, 4326))::json,
                    'properties', json_build_object(
                        'id_operacion',  mcp.id_operacion,
                        'npn',           p.npn,
                        'npn_etiqueta',  p.npn_etiqueta,
                        'nombre_predio', p.nombre_predio,
                        'municipio',     p.municipio,
                        'en_muestra',    mcp.en_muestra
                    )
                )
            ) FILTER (WHERE t.geometry IS NOT NULL), '[]')
        ) AS geojson
          FROM admin_proyecto_calidad_muestreo_predio mcp
          JOIN lc_predio_p p ON p.id_operacion = mcp.id_operacion
          JOIN cr_terreno t  ON t.npn = p.numero_predial
         WHERE mcp.proyecto_id = :pc_id
    """), {"pc_id": pc_id}).fetchone()

    row_area = db.execute(text("""
        SELECT ST_AsGeoJSON(ST_Transform(area_geom, 4326)) AS area_json
          FROM admin_proyecto_calidad_muestreo
         WHERE id = :id AND area_geom IS NOT NULL
    """), {"id": pc_id}).fetchone()

    geojson = row.geojson if row else {"type": "FeatureCollection", "features": []}
    if row_area and row_area.area_json:
        geojson["area_proyecto"] = json.loads(row_area.area_json)
    return geojson
