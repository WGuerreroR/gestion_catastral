"""
app/repositories/calidad_repo.py
"""
import json
from sqlalchemy.orm import Session
from sqlalchemy import text

def get_by_numero_predial(db: Session, busqueda: str):
    """
    Busca un predio por numero_predial o id_operacion (lo que matchee primero).
    El nombre del parámetro 'busqueda' permite cualquiera de los dos formatos.
    """
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
            p.calidad_identificacion,
            p.calidad_sig,
            p.calidad_fisica,
            p.calidad_juridica,
            p.calidad_economica,
            p.revisar_campo,
            p.revisar_identificacion,
            p.revisar_sig,
            p.revisar_fisica,
            p.revisar_juridica,
            p.revisar_economica,
            ST_AsGeoJSON(ST_Transform(t.geometry, 4326)) AS geom_geojson
        FROM lc_predio_p p
        LEFT JOIN cr_terreno t ON t.npn = p.numero_predial
        WHERE p.numero_predial = :q OR p.id_operacion = :q
        LIMIT 1
    """), {"q": busqueda}).fetchone()
 
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
    CAMPOS_PERMITIDOS = {
        "calidad_campo", "calidad_identificacion", "calidad_sig",
        "calidad_fisica", "calidad_juridica", "calidad_economica",
    }
    if campo not in CAMPOS_PERMITIDOS:
        raise ValueError(f"Campo no permitido: {campo}")

    db.execute(text(f"""
        UPDATE lc_predio_p
        SET {campo} = :valor, last_edited_date = NOW()
        WHERE id_operacion = :id_operacion
    """), {"valor": valor, "id_operacion": id_operacion})
    db.commit()


def recalcular_total_calificacion_predio(db: Session, id_operacion: str) -> int:
    """
    Recalcula total_calificacion de cada cr_caracteristicasunidadconstruccion
    del predio según IGAC Res. 070/2011 (Estructura 35 + Acabados 30 +
    Baño 17 + Cocina 18). Lee los puntos por componente desde
    admin_puntaje_calificacion y los suma, con cap por componente.
    Retorna cuántas UCs actualizó.
    """
    res = db.execute(text("""
        WITH p AS (
          SELECT
            c.id_operacion_unidad_cons AS uc,
            LEAST(35,
              COALESCE((SELECT puntos FROM admin_puntaje_calificacion WHERE componente='armazon'  AND tipo_id=c.armazon),  0) +
              COALESCE((SELECT puntos FROM admin_puntaje_calificacion WHERE componente='muros'    AND tipo_id=c.muros),    0) +
              COALESCE((SELECT puntos FROM admin_puntaje_calificacion WHERE componente='cubierta' AND tipo_id=c.cubierta), 0) +
              COALESCE((SELECT puntos FROM admin_puntaje_calificacion WHERE componente='piso'     AND tipo_id=c.piso),     0)
            ) AS estructura,
            LEAST(30,
              COALESCE((SELECT puntos FROM admin_puntaje_calificacion WHERE componente='fachada'           AND tipo_id=c.fachada),           0) +
              COALESCE((SELECT puntos FROM admin_puntaje_calificacion WHERE componente='cubrimiento_muros' AND tipo_id=c.cubrimiento_muros), 0)
            ) AS acabados,
            LEAST(17,
              COALESCE((SELECT puntos FROM admin_puntaje_calificacion WHERE componente='tamanio_banio'    AND tipo_id=c.tamanio_banio),    0) +
              COALESCE((SELECT puntos FROM admin_puntaje_calificacion WHERE componente='enchape_banio'    AND tipo_id=c.enchape_banio),    0) +
              COALESCE((SELECT puntos FROM admin_puntaje_calificacion WHERE componente='mobiliario_banio' AND tipo_id=c.mobiliario_banio), 0)
            ) AS banio,
            LEAST(18,
              COALESCE((SELECT puntos FROM admin_puntaje_calificacion WHERE componente='tamanio_cocina'    AND tipo_id=c.tamanio_cocina),    0) +
              COALESCE((SELECT puntos FROM admin_puntaje_calificacion WHERE componente='enchape_cocina'    AND tipo_id=c.enchape_cocina),    0) +
              COALESCE((SELECT puntos FROM admin_puntaje_calificacion WHERE componente='mobiliario_cocina' AND tipo_id=c.mobiliario_cocina), 0)
            ) AS cocina
          FROM cr_caracteristicasunidadconstruccion c
          WHERE c.id_operacion_predio = :id
        )
        UPDATE cr_caracteristicasunidadconstruccion c
           SET total_calificacion = p.estructura + p.acabados + p.banio + p.cocina
          FROM p
         WHERE c.id_operacion_unidad_cons = p.uc
    """), {"id": id_operacion})
    db.commit()
    return res.rowcount or 0


def actualizar_observacion(db: Session, id_operacion: str, campo: str, texto: str):
    """Actualiza un campo de observación (revisar_campo, revisar_fisica, etc.)"""
    CAMPOS_PERMITIDOS = {
        "revisar_campo", "revisar_identificacion", "revisar_sig",
        "revisar_fisica", "revisar_juridica", "revisar_economica",
    }
    if campo not in CAMPOS_PERMITIDOS:
        raise ValueError(f"Campo no permitido: {campo}")

    db.execute(text(f"""
        UPDATE lc_predio_p
        SET {campo} = :texto, last_edited_date = NOW()
        WHERE id_operacion = :id_operacion
    """), {"texto": texto or None, "id_operacion": id_operacion})
    db.commit()