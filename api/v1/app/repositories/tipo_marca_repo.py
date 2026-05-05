from sqlalchemy.orm import Session
from sqlalchemy import text


def get_all(db: Session, categoria: str | None = None, incluir_inactivas: bool = False):
    where = []
    params = {}
    if not incluir_inactivas:
        where.append("activo = true")
    if categoria:
        where.append("categoria = :categoria")
        params["categoria"] = categoria
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""
    sql = f"""
        SELECT id, categoria, codigo, significado, activo
        FROM admin_tipo_marca
        {where_sql}
        ORDER BY categoria, codigo
    """
    resultado = db.execute(text(sql), params).fetchall()
    return [dict(r._mapping) for r in resultado]


def get_by_id(db: Session, tipo_marca_id: int):
    resultado = db.execute(
        text("""
            SELECT id, categoria, codigo, significado, activo
            FROM admin_tipo_marca WHERE id = :id
        """),
        {"id": tipo_marca_id}
    ).fetchone()
    return dict(resultado._mapping) if resultado else None


def get_by_codigo(db: Session, codigo: str):
    resultado = db.execute(
        text("""
            SELECT id, categoria, codigo, significado, activo
            FROM admin_tipo_marca WHERE codigo = :codigo
        """),
        {"codigo": codigo}
    ).fetchone()
    return dict(resultado._mapping) if resultado else None


def create(db: Session, categoria: str, codigo: str, significado: str):
    resultado = db.execute(
        text("""
            INSERT INTO admin_tipo_marca (categoria, codigo, significado)
            VALUES (:categoria, :codigo, :significado)
            RETURNING id
        """),
        {"categoria": categoria, "codigo": codigo, "significado": significado}
    )
    db.commit()
    return resultado.fetchone()[0]


def update(db: Session, tipo_marca_id: int, **campos):
    campos_validos = {k: v for k, v in campos.items()
                      if k in ("categoria", "codigo", "significado", "activo") and v is not None}
    if not campos_validos:
        return
    set_sql = ", ".join(f"{k} = :{k}" for k in campos_validos.keys())
    params = {**campos_validos, "id": tipo_marca_id}
    db.execute(
        text(f"""
            UPDATE admin_tipo_marca
            SET {set_sql}, fecha_actualizacion = NOW()
            WHERE id = :id
        """),
        params
    )
    db.commit()


def delete_logico(db: Session, tipo_marca_id: int):
    db.execute(
        text("""
            UPDATE admin_tipo_marca
            SET activo = false, fecha_actualizacion = NOW()
            WHERE id = :id
        """),
        {"id": tipo_marca_id}
    )
    db.commit()
