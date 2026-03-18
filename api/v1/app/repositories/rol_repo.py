from sqlalchemy.orm import Session
from sqlalchemy import text

def get_all(db: Session):
    resultado = db.execute(
        text("SELECT id, nombre FROM admin_rol ORDER BY nombre")
    ).fetchall()
    return [dict(r._mapping) for r in resultado]

def get_rol_persona(db: Session, persona_id: int, rol_id: int):
    return db.execute(text("""
        SELECT id FROM admin_rol_persona
        WHERE persona_id = :pid AND rol_id = :rid AND activo = true
    """), {"pid": persona_id, "rid": rol_id}).fetchone()

def asignar(db: Session, persona_id: int, rol_id: int):
    db.execute(text("""
        INSERT INTO admin_rol_persona (persona_id, rol_id)
        VALUES (:pid, :rid)
        ON CONFLICT (persona_id, rol_id)
        DO UPDATE SET activo = true, fecha_asignacion = NOW()
    """), {"pid": persona_id, "rid": rol_id})
    db.commit()

def revocar(db: Session, persona_id: int, rol_id: int):
    db.execute(text("""
        UPDATE admin_rol_persona SET activo = false
        WHERE persona_id = :pid AND rol_id = :rid
    """), {"pid": persona_id, "rid": rol_id})
    db.commit()

def get_roles_by_persona(db: Session, persona_id: int):
    resultado = db.execute(text("""
        SELECT r.id, r.nombre FROM admin_rol r
        JOIN admin_rol_persona rp ON r.id = rp.rol_id
        WHERE rp.persona_id = :pid AND rp.activo = true
    """), {"pid": persona_id}).fetchall()
    return [dict(r._mapping) for r in resultado]

def get_by_id(db: Session, rol_id: int):
    resultado = db.execute(
        text("SELECT id, nombre FROM admin_rol WHERE id = :id"),
        {"id": rol_id}
    ).fetchone()
    return dict(resultado._mapping) if resultado else None

def get_by_nombre(db: Session, nombre: str):
    resultado = db.execute(
        text("SELECT id, nombre FROM admin_rol WHERE nombre = :nombre"),
        {"nombre": nombre}
    ).fetchone()
    return resultado

def create(db: Session, nombre: str):
    resultado = db.execute(
        text("INSERT INTO admin_rol (nombre) VALUES (:nombre) RETURNING id"),
        {"nombre": nombre}
    )
    db.commit()
    return resultado.fetchone()[0]

def delete(db: Session, rol_id: int):
    db.execute(
        text("DELETE FROM admin_rol WHERE id = :id"),
        {"id": rol_id}
    )
    db.commit()

def tiene_personas(db: Session, rol_id: int):
    resultado = db.execute(
        text("SELECT COUNT(*) FROM admin_rol_persona WHERE rol_id = :id AND activo = true"),
        {"id": rol_id}
    ).scalar()
    return resultado > 0