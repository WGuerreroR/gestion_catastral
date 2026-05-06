from sqlalchemy.orm import Session
from sqlalchemy import text


_NOMBRE_PERSONA = "TRIM(COALESCE(p.primer_nombre,'') || ' ' || COALESCE(p.primer_apellido,''))"


def _select_marca_sql(where_extra: str = "") -> str:
    return f"""
        SELECT
            m.id,
            m.id_operacion,
            m.categoria,
            m.tipo_marca_id,
            tm.codigo       AS tipo_marca_codigo,
            tm.significado  AS tipo_marca_significado,
            m.descripcion_novedad,
            m.fuente_deteccion,
            m.prioridad,
            m.accion_sugerida,
            m.responsable_id,
            {_NOMBRE_PERSONA.replace('p.', 'r.')} AS responsable_nombre,
            m.estado_esperado,
            m.observacion,
            m.estado,
            m.fecha_creacion,
            m.creado_por,
            {_NOMBRE_PERSONA.replace('p.', 'c.')} AS creado_por_nombre
        FROM admin_marca_predio m
        JOIN admin_tipo_marca   tm ON tm.id = m.tipo_marca_id
        LEFT JOIN admin_personas r ON r.id = m.responsable_id
        LEFT JOIN admin_personas c ON c.id = m.creado_por
        {where_extra}
    """


def listar_por_predio(db: Session, id_operacion: str, categoria: str | None = None, estado: str | None = None):
    where = ["m.id_operacion = :id_op"]
    params = {"id_op": id_operacion}
    if categoria:
        where.append("m.categoria = :categoria")
        params["categoria"] = categoria
    if estado:
        where.append("m.estado = :estado")
        params["estado"] = estado
    sql = _select_marca_sql("WHERE " + " AND ".join(where)) + " ORDER BY m.fecha_creacion DESC"
    resultado = db.execute(text(sql), params).fetchall()
    return [dict(r._mapping) for r in resultado]


def get_by_id(db: Session, marca_id: int):
    sql = _select_marca_sql("WHERE m.id = :id")
    resultado = db.execute(text(sql), {"id": marca_id}).fetchone()
    return dict(resultado._mapping) if resultado else None


def crear(db: Session, id_operacion: str, data: dict, user_id: int) -> int:
    """Inserta marca + evento CREACION en una transacción."""
    fila = db.execute(text("""
        INSERT INTO admin_marca_predio (
            id_operacion, categoria, tipo_marca_id,
            descripcion_novedad, fuente_deteccion, prioridad,
            accion_sugerida, responsable_id, estado_esperado, observacion,
            creado_por
        ) VALUES (
            :id_operacion, :categoria, :tipo_marca_id,
            :descripcion_novedad, :fuente_deteccion, :prioridad,
            :accion_sugerida, :responsable_id, :estado_esperado, :observacion,
            :creado_por
        )
        RETURNING id, fecha_creacion
    """), {
        "id_operacion":        id_operacion,
        "categoria":           data["categoria"],
        "tipo_marca_id":       data["tipo_marca_id"],
        "descripcion_novedad": data["descripcion_novedad"],
        "fuente_deteccion":    data.get("fuente_deteccion"),
        "prioridad":           data["prioridad"],
        "accion_sugerida":     data.get("accion_sugerida"),
        "responsable_id":      data.get("responsable_id"),
        "estado_esperado":     data["estado_esperado"],
        "observacion":         data.get("observacion"),
        "creado_por":          user_id,
    }).fetchone()
    marca_id = fila.id
    fecha = fila.fecha_creacion

    db.execute(text("""
        INSERT INTO admin_marca_predio_evento (marca_id, tipo_evento, fecha, usuario_id, observacion)
        VALUES (:marca_id, 'CREACION', :fecha, :usuario_id, NULL)
    """), {"marca_id": marca_id, "fecha": fecha, "usuario_id": user_id})

    db.commit()
    return marca_id


def cambiar_estado(db: Session, marca_id: int, nuevo_estado: str, tipo_evento: str,
                   user_id: int, observacion: str | None) -> bool:
    """Cambia el estado de la marca y registra el evento. Devuelve False si la
    marca no existe o si su estado actual no permite la transición."""
    actual = db.execute(
        text("SELECT estado FROM admin_marca_predio WHERE id = :id"),
        {"id": marca_id}
    ).fetchone()
    if not actual:
        return False
    if tipo_evento == "CIERRE" and actual.estado != "ABIERTA":
        return False
    if tipo_evento == "REAPERTURA" and actual.estado != "CERRADA":
        return False

    db.execute(
        text("UPDATE admin_marca_predio SET estado = :estado WHERE id = :id"),
        {"estado": nuevo_estado, "id": marca_id}
    )
    db.execute(text("""
        INSERT INTO admin_marca_predio_evento (marca_id, tipo_evento, usuario_id, observacion)
        VALUES (:marca_id, :tipo, :usuario_id, :obs)
    """), {
        "marca_id": marca_id, "tipo": tipo_evento,
        "usuario_id": user_id, "obs": (observacion or None)
    })
    db.commit()
    return True


_PRIORIDAD_ORDER = "CASE m.prioridad WHEN 'ALTA' THEN 1 WHEN 'MEDIA' THEN 2 ELSE 3 END"


def _filtros_global(responsable_id, estado, categoria, prioridad, q):
    where = []
    params: dict = {}
    if responsable_id is not None:
        where.append("m.responsable_id = :responsable_id")
        params["responsable_id"] = responsable_id
    if estado:
        where.append("m.estado = :estado")
        params["estado"] = estado
    if categoria:
        where.append("m.categoria = :categoria")
        params["categoria"] = categoria
    if prioridad:
        where.append("m.prioridad = :prioridad")
        params["prioridad"] = prioridad
    if q:
        where.append("(m.id_operacion ILIKE :q OR lc.numero_predial ILIKE :q)")
        params["q"] = f"%{q}%"
    return where, params


def listar_marcas_global(
    db: Session,
    responsable_id: int | None = None,
    estado: str | None = None,
    categoria: str | None = None,
    prioridad: str | None = None,
    q: str | None = None,
    limit: int = 100,
    offset: int = 0,
):
    where, params = _filtros_global(responsable_id, estado, categoria, prioridad, q)
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""
    sql = f"""
        SELECT
            m.id,
            m.id_operacion,
            m.categoria,
            m.tipo_marca_id,
            tm.codigo       AS tipo_marca_codigo,
            tm.significado  AS tipo_marca_significado,
            m.descripcion_novedad,
            m.fuente_deteccion,
            m.prioridad,
            m.accion_sugerida,
            m.responsable_id,
            {_NOMBRE_PERSONA.replace('p.', 'r.')} AS responsable_nombre,
            m.estado_esperado,
            m.observacion,
            m.estado,
            m.fecha_creacion,
            m.creado_por,
            {_NOMBRE_PERSONA.replace('p.', 'c.')} AS creado_por_nombre,
            lc.numero_predial AS npn
        FROM admin_marca_predio m
        JOIN admin_tipo_marca   tm ON tm.id = m.tipo_marca_id
        LEFT JOIN admin_personas r  ON r.id = m.responsable_id
        LEFT JOIN admin_personas c  ON c.id = m.creado_por
        LEFT JOIN lc_predio_p    lc ON lc.id_operacion = m.id_operacion
        {where_sql}
        ORDER BY (m.estado='ABIERTA') DESC,
                 {_PRIORIDAD_ORDER},
                 m.fecha_creacion DESC
        LIMIT :limit OFFSET :offset
    """
    params["limit"] = limit
    params["offset"] = offset
    resultado = db.execute(text(sql), params).fetchall()
    return [dict(r._mapping) for r in resultado]


def count_marcas_global(
    db: Session,
    responsable_id: int | None = None,
    estado: str | None = None,
    categoria: str | None = None,
    prioridad: str | None = None,
    q: str | None = None,
) -> int:
    where, params = _filtros_global(responsable_id, estado, categoria, prioridad, q)
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""
    sql = f"""
        SELECT COUNT(*) AS total
        FROM admin_marca_predio m
        LEFT JOIN lc_predio_p lc ON lc.id_operacion = m.id_operacion
        {where_sql}
    """
    fila = db.execute(text(sql), params).fetchone()
    return int(fila.total) if fila else 0


def has_marca_abierta_como_responsable(db: Session, id_operacion: str, persona_id: int) -> bool:
    fila = db.execute(text("""
        SELECT 1
        FROM admin_marca_predio
        WHERE id_operacion = :id_op
          AND responsable_id = :persona_id
          AND estado = 'ABIERTA'
        LIMIT 1
    """), {"id_op": id_operacion, "persona_id": persona_id}).fetchone()
    return fila is not None


def tiene_marca_abierta_en_categoria(db: Session, id_operacion: str, categoria: str) -> bool:
    fila = db.execute(text("""
        SELECT 1
        FROM admin_marca_predio
        WHERE id_operacion = :id_op
          AND categoria = :categoria
          AND estado = 'ABIERTA'
        LIMIT 1
    """), {"id_op": id_operacion, "categoria": categoria}).fetchone()
    return fila is not None


def listar_eventos(db: Session, marca_id: int):
    resultado = db.execute(text(f"""
        SELECT
            e.id,
            e.tipo_evento,
            e.fecha,
            e.usuario_id,
            {_NOMBRE_PERSONA} AS usuario_nombre,
            e.observacion
        FROM admin_marca_predio_evento e
        LEFT JOIN admin_personas p ON p.id = e.usuario_id
        WHERE e.marca_id = :marca_id
        ORDER BY e.fecha ASC, e.id ASC
    """), {"marca_id": marca_id}).fetchall()
    return [dict(r._mapping) for r in resultado]
