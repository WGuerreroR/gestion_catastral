from sqlalchemy.orm import Session
from sqlalchemy import text

def get_all(db: Session, persona_id: int = None, es_admin: bool = False):
    if es_admin:
        filtro = ""
        params = {}
    else:
        filtro = "WHERE ap.persona_id = :pid"
        params = {"pid": persona_id}

    resultado = db.execute(text(f"""
        SELECT 
            ap.id, ap.id_operacion, ap.tipo_asignacion,
            ap.estado, ap.fecha_asignacion, ap.fecha_actualizacion,
            p.primer_nombre || ' ' || p.primer_apellido AS persona,
            a.primer_nombre || ' ' || a.primer_apellido AS asignado_por
        FROM admin_persona_predio ap
        JOIN admin_personas p ON ap.persona_id = p.id
        LEFT JOIN admin_personas a ON ap.asignado_por = a.id
        {filtro}
        ORDER BY ap.fecha_asignacion DESC
    """), params).fetchall()
    return [dict(r._mapping) for r in resultado]

def get_by_predio(db: Session, id_operacion: str):
    resultado = db.execute(text("""
        SELECT 
            ap.id, ap.estado, ap.tipo_asignacion,
            ap.fecha_asignacion, ap.fecha_actualizacion,
            p.primer_nombre || ' ' || p.primer_apellido AS persona,
            r.nombre AS rol
        FROM admin_persona_predio ap
        JOIN admin_personas p ON ap.persona_id = p.id
        LEFT JOIN admin_rol_persona rp ON p.id = rp.persona_id AND rp.activo = true
        LEFT JOIN admin_rol r ON rp.rol_id = r.id
        WHERE ap.id_operacion = :id
        ORDER BY ap.fecha_asignacion DESC
    """), {"id": id_operacion}).fetchall()
    return [dict(r._mapping) for r in resultado]

def exists(db: Session, persona_id: int, id_operacion: str):
    return db.execute(text("""
        SELECT id FROM admin_persona_predio
        WHERE persona_id = :pid
          AND id_operacion = :id_op
          AND estado NOT IN ('completado', 'rechazado')
    """), {"pid": persona_id, "id_op": id_operacion}).fetchone()

def create(db: Session, persona_id: int, asignado_por: int, id_operacion: str, tipo: str):
    db.execute(text("""
        INSERT INTO admin_persona_predio
            (persona_id, asignado_por, id_operacion, tipo_asignacion, estado)
        VALUES
            (:persona_id, :asignado_por, :id_op, :tipo, 'campo')
    """), {
        "persona_id":   persona_id,
        "asignado_por": asignado_por,
        "id_op":        id_operacion,
        "tipo":         tipo
    })
    db.commit()

def update_estado(db: Session, asignacion_id: int, estado: str):
    db.execute(text("""
        UPDATE admin_persona_predio
        SET estado = :estado, fecha_actualizacion = NOW()
        WHERE id = :id
    """), {"estado": estado, "id": asignacion_id})
    db.commit()

def delete(db: Session, asignacion_id: int):
    db.execute(
        text("DELETE FROM admin_persona_predio WHERE id = :id"),
        {"id": asignacion_id}
    )
    db.commit()