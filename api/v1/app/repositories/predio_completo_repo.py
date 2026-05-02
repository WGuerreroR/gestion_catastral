"""
Carga jerárquica de un predio completo (LADM-COL):

  lc_predio_p
    ├── cr_terreno (1:1 por id_operacion_predio)
    ├── cr_unidadconstruccion (1:N por id_operacion_predio)
    │     └── cr_caracteristicasunidadconstruccion (1:1 por
    │         id_operacion_unidad_cons → cr_unidadconstruccion.id_operacion_unidad_const)
    └── cr_interesado (1:N por id_operacion_predio)

Geometrías se transforman a EPSG:4326 para transporte (el frontend
proyecta a 9377 con proj4 cuando hace falta).
"""
import json
import re
from sqlalchemy.orm import Session
from sqlalchemy import text


_NUMERO_PREDIAL_RE = re.compile(r"^\d{17,30}$")


def detectar_tipo_busqueda(busqueda: str) -> str:
    """`numero_predial` si son solo dígitos y largo ≥ 17, si no `id_operacion`."""
    return "numero_predial" if _NUMERO_PREDIAL_RE.match(busqueda) else "id_operacion"


def get_completo(
    db: Session,
    busqueda: str,
    incluir_geometrias: bool = True,
    incluir_fotos_metadata: bool = True,
) -> dict | None:
    tipo = detectar_tipo_busqueda(busqueda)
    where_predio = (
        "p.numero_predial = :busqueda" if tipo == "numero_predial"
        else "p.id_operacion = :busqueda"
    )

    geom_predio = (
        "ST_AsGeoJSON(ST_Transform(p.geometry, 4326))::json AS geometry"
        if incluir_geometrias else "NULL::json AS geometry"
    )

    predio_row = db.execute(text(f"""
        SELECT
            p.*,
            {geom_predio}
        FROM lc_predio_p p
        WHERE {where_predio}
        LIMIT 1
    """), {"busqueda": busqueda}).fetchone()

    if not predio_row:
        return None

    predio = _normalizar_row(predio_row, geom_field="geometry")
    id_operacion = predio["id_operacion"]

    geom_terreno = (
        "ST_AsGeoJSON(ST_Transform(t.geometry, 4326))::json AS geometry"
        if incluir_geometrias else "NULL::json AS geometry"
    )
    terreno_row = db.execute(text(f"""
        SELECT
            t.*,
            {geom_terreno}
        FROM cr_terreno t
        WHERE t.id_operacion_predio = :id
        LIMIT 1
    """), {"id": id_operacion}).fetchone()
    terreno = _normalizar_row(terreno_row, geom_field="geometry") if terreno_row else None

    geom_unidad = (
        "ST_AsGeoJSON(ST_Transform(u.geometry, 4326))::json AS geometry"
        if incluir_geometrias else "NULL::json AS geometry"
    )
    unidades_rows = db.execute(text(f"""
        SELECT
            u.*,
            {geom_unidad}
        FROM cr_unidadconstruccion u
        WHERE u.id_operacion_unidad_const IN (
            SELECT c.id_operacion_unidad_cons
            FROM cr_caracteristicasunidadconstruccion c
            WHERE c.id_operacion_predio = :id
        )
        ORDER BY u.id_operacion_unidad_const
    """), {"id": id_operacion}).fetchall()

    caracteristicas_rows = db.execute(text("""
        SELECT c.*
        FROM cr_caracteristicasunidadconstruccion c
        WHERE c.id_operacion_predio = :id
    """), {"id": id_operacion}).fetchall()

    caracteristicas_por_unidad = {
        row._mapping["id_operacion_unidad_cons"]: dict(row._mapping)
        for row in caracteristicas_rows
    }

    unidades = []
    for u in unidades_rows:
        unidad = _normalizar_row(u, geom_field="geometry")
        unidad_id = unidad.get("id_operacion_unidad_const")
        unidad["caracteristicas"] = caracteristicas_por_unidad.get(unidad_id)
        unidades.append(unidad)

    interesados_rows = db.execute(text("""
        SELECT i.*
        FROM cr_interesado i
        WHERE i.id_operacion_predio = :id
        ORDER BY i.globalid
    """), {"id": id_operacion}).fetchall()
    interesados = [dict(r._mapping) for r in interesados_rows]

    fotos_referenciadas = 0
    if incluir_fotos_metadata:
        fotos_referenciadas += sum(
            1 for k in ("foto", "foto_2") if predio.get(k)
        )
        for u in unidades:
            c = u.get("caracteristicas") or {}
            fotos_referenciadas += sum(
                1 for k in (
                    "foto_fachada", "foto_banio", "foto_cocina",
                    "foto_acabados", "foto_anexo", "foto_industrial",
                ) if c.get(k)
            )

    return {
        "predio": predio,
        "terreno": terreno,
        "unidades": unidades,
        "interesados": interesados,
        "_meta": {
            "encontrado_por": tipo,
            "total_unidades": len(unidades),
            "total_interesados": len(interesados),
            "tiene_geometria_terreno": bool(terreno and terreno.get("geometry")),
            "fotos_referenciadas": fotos_referenciadas,
        },
    }


def _normalizar_row(row, geom_field: str | None = None) -> dict:
    """Convierte Row → dict y deserializa el campo de geometría si vino como string."""
    d = dict(row._mapping)
    if geom_field and d.get(geom_field) and isinstance(d[geom_field], str):
        d[geom_field] = json.loads(d[geom_field])
    return d
