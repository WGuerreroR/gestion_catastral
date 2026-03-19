"""
app/repositories/calidad_repo.py
"""
import json
from sqlalchemy.orm import Session
from sqlalchemy import text

def get_by_numero_predial(db: Session, numero_predial: str):
    resultado = db.execute(text("""
        SELECT
            p.id_operacion,
            p.numero_predial,
            p.npn,
            p.npn_etiqueta,
            p.nombre_predio,
            p.municipio,
            p.departamento,
            p.avaluo_catastral,
            p.area_total_terreno,
            p.area_total_construida,
            p.matricula_inmobiliaria,
            p.clase_via_principal,
            p.valor_via_principal,
            p.letra_via_principal,
            p.letra_via_generadora,
            p.valor_via_generadora,
            p.sector_ciudad,
            p.complemento,
            p.calidad_campo,
            p.calidad_fisica,
            p.calidad_juridica,
            p.calidad_sig,
            p.revisar_campo,
            p.revisar_fisica,
            p.revisar_juridica,
            p.revisar_sig,
            ST_AsGeoJSON(ST_Transform(t.geometry, 4326)) AS geom_geojson
        FROM lc_predio_p p
        LEFT JOIN cr_terreno t ON t.npn = p.numero_predial
        WHERE p.numero_predial = :numero_predial
        LIMIT 1
    """), {"numero_predial": numero_predial}).fetchone()
 
    if not resultado:
        return None
 
    row = dict(resultado._mapping)
    if row.get("geom_geojson"):
        row["geometry"] = json.loads(row["geom_geojson"])
    else:
        row["geometry"] = None
    del row["geom_geojson"]
    return row

def actualizar_calidad(db: Session, id_operacion: str, campo: str, valor: int):
    """Actualiza un campo de calidad (0 = sin revisar, 1 = aprobado)"""
    CAMPOS_PERMITIDOS = {"calidad_campo", "calidad_fisica", "calidad_juridica", "calidad_sig"}
    if campo not in CAMPOS_PERMITIDOS:
        raise ValueError(f"Campo no permitido: {campo}")

    db.execute(text(f"""
        UPDATE lc_predio_p
        SET {campo} = :valor, last_edited_date = NOW()
        WHERE id_operacion = :id_operacion
    """), {"valor": valor, "id_operacion": id_operacion})
    db.commit()


def actualizar_observacion(db: Session, id_operacion: str, campo: str, texto: str):
    """Actualiza un campo de observación (revisar_campo, revisar_fisica, etc.)"""
    CAMPOS_PERMITIDOS = {"revisar_campo", "revisar_fisica", "revisar_juridica", "revisar_sig"}
    if campo not in CAMPOS_PERMITIDOS:
        raise ValueError(f"Campo no permitido: {campo}")

    db.execute(text(f"""
        UPDATE lc_predio_p
        SET {campo} = :texto, last_edited_date = NOW()
        WHERE id_operacion = :id_operacion
    """), {"texto": texto or None, "id_operacion": id_operacion})
    db.commit()