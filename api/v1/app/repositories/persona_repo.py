from sqlalchemy.orm import Session
from sqlalchemy import text
from core.security import hash_password

def get_all(db: Session):
    resultado = db.execute(text("""
        SELECT 
            p.id, p.identificacion, p.primer_nombre, p.segundo_nombre,
            p.primer_apellido, p.segundo_apellido, p.activo,
            COALESCE(
                json_agg(r.nombre) FILTER (WHERE r.nombre IS NOT NULL), '[]'
            ) AS roles
        FROM admin_personas p
        LEFT JOIN admin_rol_persona rp ON p.id = rp.persona_id AND rp.activo = true
        LEFT JOIN admin_rol r ON rp.rol_id = r.id
        GROUP BY p.id
        ORDER BY p.primer_apellido
    """)).fetchall()
    return [dict(r._mapping) for r in resultado]

def get_by_id(db: Session, persona_id: int):
    resultado = db.execute(text("""
        SELECT 
            p.id, p.identificacion, p.primer_nombre, p.segundo_nombre,
            p.primer_apellido, p.segundo_apellido, p.activo,
            COALESCE(
                json_agg(r.nombre) FILTER (WHERE r.nombre IS NOT NULL), '[]'
            ) AS roles
        FROM admin_personas p
        LEFT JOIN admin_rol_persona rp ON p.id = rp.persona_id AND rp.activo = true
        LEFT JOIN admin_rol r ON rp.rol_id = r.id
        WHERE p.id = :id
        GROUP BY p.id
    """), {"id": persona_id}).fetchone()
    return dict(resultado._mapping) if resultado else None

def get_password_hash(db: Session, persona_id: int):
    resultado = db.execute(
        text("SELECT password_hash FROM admin_personas WHERE id = :id"),
        {"id": persona_id}
    ).fetchone()
    return resultado.password_hash if resultado else None

def get_by_identificacion(db: Session, identificacion: int):
    resultado = db.execute(
        text("SELECT * FROM admin_personas WHERE identificacion = :id"),
        {"id": identificacion}
    ).fetchone()
    return resultado

def create(db: Session, data: dict):
    resultado = db.execute(text("""
        INSERT INTO admin_personas 
            (identificacion, primer_nombre, segundo_nombre,
             primer_apellido, segundo_apellido, password_hash, activo)
        VALUES 
            (:identificacion, :primer_nombre, :segundo_nombre,
             :primer_apellido, :segundo_apellido, :password_hash, true)
        RETURNING id
    """), {
        "identificacion":   data["identificacion"],
        "primer_nombre":    data["primer_nombre"],
        "segundo_nombre":   data.get("segundo_nombre"),
        "primer_apellido":  data["primer_apellido"],
        "segundo_apellido": data.get("segundo_apellido"),
        "password_hash":    hash_password(data["password"])
    })
    db.commit()
    return resultado.fetchone()[0]

def update(db: Session, persona_id: int, campos: dict):
    set_clause = ", ".join([f"{k} = :{k}" for k in campos])
    campos["id"] = persona_id
    db.execute(text(f"UPDATE admin_personas SET {set_clause} WHERE id = :id"), campos)
    db.commit()

def deactivate(db: Session, persona_id: int):
    db.execute(
        text("UPDATE admin_personas SET activo = false WHERE id = :id"),
        {"id": persona_id}
    )
    db.commit()

def update_password(db: Session, persona_id: int, new_hash: str):
    db.execute(
        text("UPDATE admin_personas SET password_hash = :hash WHERE id = :id"),
        {"hash": new_hash, "id": persona_id}
    )
    db.commit()

def get_predios(db: Session, persona_id: int):
    resultado = db.execute(text("""
        SELECT 
            ap.id, ap.id_operacion, ap.tipo_asignacion,
            ap.estado, ap.fecha_asignacion, ap.fecha_actualizacion,
            pr.npn, pr.npn_etiqueta, pr.nombre_predio,
            pr.municipio, pr.area_total_terreno, pr.avaluo_catastral,
            a.primer_nombre || ' ' || a.primer_apellido AS asignado_por
        FROM admin_persona_predio ap
        JOIN lc_predio_p pr ON ap.id_operacion = pr.id_operacion
        LEFT JOIN admin_personas a ON ap.asignado_por = a.id
        WHERE ap.persona_id = :pid
        ORDER BY ap.fecha_asignacion DESC
    """), {"pid": persona_id}).fetchall()
    return [dict(r._mapping) for r in resultado]

def set_password_admin(db: Session, persona_id: int, nueva_password: str):
    db.execute(
        text("UPDATE admin_personas SET password_hash = :hash WHERE id = :id"),
        {"hash": hash_password(nueva_password), "id": persona_id}
    )
    db.commit()

def activate(db: Session, persona_id: int):
    db.execute(
        text("UPDATE admin_personas SET activo = true WHERE id = :id"),
        {"id": persona_id}
    )
    db.commit()
    
def get_by_identificacion(db: Session, identificacion: str):
    resultado = db.execute(text("""
        SELECT id, password_hash FROM admin_personas
        WHERE identificacion::text = :identificacion AND activo = true
    """), {"identificacion": identificacion}).fetchone()
    return dict(resultado._mapping) if resultado else None