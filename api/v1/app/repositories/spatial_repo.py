from sqlalchemy.orm import Session
from sqlalchemy import text

def predios_por_poligono(db: Session, geojson: dict):
    """Paso 1 — busca predios + retorna geom de cr_terreno para preview"""
    resultado = db.execute(text("""
        SELECT
            p.id_operacion,
            p.npn,
            p.npn_etiqueta,
            p.nombre_predio,
            p.municipio,
            p.numero_predial,
            p.avaluo_catastral,
            t.area_terreno,
            t.etiqueta,
            ST_AsGeoJSON(
                ST_Transform(t.geometry, 4326)
            )::json AS geom
        FROM lc_predio_p p
        LEFT JOIN cr_terreno t ON p.numero_predial = t.npn
        WHERE ST_Within(
            p.geometry,
            ST_Transform(
                ST_SetSRID(ST_GeomFromGeoJSON(:geojson), 4326),
                9377
            )
        )
        AND p.geometry IS NOT NULL
        ORDER BY p.npn
    """), {"geojson": str(geojson)}).fetchall()
    return [dict(r._mapping) for r in resultado]

def predios_por_manzana(db: Session, codigo_manzana: str):
    """Paso 1 — busca predios + retorna geom de cr_terreno para preview"""
    resultado = db.execute(text("""
        SELECT
            p.id_operacion,
            p.npn,
            p.npn_etiqueta,
            p.nombre_predio,
            p.municipio,
            p.numero_predial,
            p.avaluo_catastral,
            t.area_terreno,
            t.etiqueta,
            ST_AsGeoJSON(
                ST_Transform(t.geometry, 4326)
            )::json AS geom
        FROM lc_predio_p p
        LEFT JOIN cr_terreno t ON p.numero_predial = t.npn
        WHERE LEFT(p.numero_predial, 17) = :codigo
        AND p.geometry IS NOT NULL
        ORDER BY p.npn
    """), {"codigo": codigo_manzana}).fetchall()
    return [dict(r._mapping) for r in resultado]

def get_manzana_geojson(db: Session, codigo: str):
    """Retorna geometría de manzana + buffer para mostrar en mapa"""
    resultado = db.execute(text("""
        SELECT
            m.codigo,
            m.barrio_cod,
            m.codigo_ant,
            ST_AsGeoJSON(
                ST_Transform(m.geom, 4326)
            )::json AS geom,
            ST_AsGeoJSON(
                ST_Transform(ST_Buffer(m.geom, 0.5), 4326)
            )::json AS geom_buffer
        FROM manzana m
        WHERE m.codigo = :codigo
    """), {"codigo": codigo}).fetchone()
    return dict(resultado._mapping) if resultado else None

def buscar_manzanas(db: Session, texto: str):
    """Autocomplete de manzanas por código parcial"""
    resultado = db.execute(text("""
        SELECT codigo, barrio_cod, codigo_ant
        FROM manzana
        WHERE codigo ILIKE :texto
        ORDER BY codigo
        LIMIT 20
    """), {"texto": f"%{texto}%"}).fetchall()
    return [dict(r._mapping) for r in resultado]