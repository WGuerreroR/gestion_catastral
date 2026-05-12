"""Repositorio de migración LADM: perfiles de conexión, jobs y logs."""
import json
from typing import Optional, List
from sqlalchemy.orm import Session
from sqlalchemy import text

from core import crypto


# ── Conexiones ─────────────────────────────────────────────────────────────

def listar_conexiones(db: Session) -> list[dict]:
    rows = db.execute(text("""
        SELECT id, nombre, host, port, dbname, usuario
        FROM migracion_ladm_conexion
        ORDER BY nombre ASC
    """)).fetchall()
    return [dict(r._mapping) for r in rows]


def obtener_conexion(db: Session, conexion_id: int) -> Optional[dict]:
    row = db.execute(text("""
        SELECT id, nombre, host, port, dbname, usuario, notas,
               creado_en, creado_por, actualizado_en, actualizado_por
        FROM migracion_ladm_conexion
        WHERE id = :id
    """), {"id": conexion_id}).fetchone()
    return dict(row._mapping) if row else None


def obtener_conexion_descifrada(db: Session, conexion_id: int) -> Optional[dict]:
    """Devuelve dict con `password` en claro listo para psycopg2.connect()."""
    row = db.execute(text("""
        SELECT host, port, dbname, usuario, password_cif
        FROM migracion_ladm_conexion
        WHERE id = :id
    """), {"id": conexion_id}).fetchone()
    if not row:
        return None
    m = dict(row._mapping)
    return {
        "host":     m["host"],
        "port":     m["port"],
        "dbname":   m["dbname"],
        "user":     m["usuario"],
        "password": crypto.decrypt(m["password_cif"]),
    }


def existe_nombre_conexion(db: Session, nombre: str, excluir_id: Optional[int] = None) -> bool:
    sql = "SELECT 1 FROM migracion_ladm_conexion WHERE nombre = :n"
    params = {"n": nombre}
    if excluir_id is not None:
        sql += " AND id <> :id"
        params["id"] = excluir_id
    return db.execute(text(sql), params).fetchone() is not None


def crear_conexion(db: Session, data: dict, usuario: str) -> int:
    row = db.execute(text("""
        INSERT INTO migracion_ladm_conexion
          (nombre, host, port, dbname, usuario, password_cif, notas,
           creado_por, actualizado_por)
        VALUES
          (:nombre, :host, :port, :dbname, :usuario, :password_cif, :notas,
           :creado_por, :creado_por)
        RETURNING id
    """), {
        "nombre":       data["nombre"],
        "host":         data["host"],
        "port":         data.get("port", 5432),
        "dbname":       data["dbname"],
        "usuario":      data["usuario"],
        "password_cif": crypto.encrypt(data["password"]),
        "notas":        data.get("notas"),
        "creado_por":   usuario,
    }).fetchone()
    db.commit()
    return row.id


def actualizar_conexion(db: Session, conexion_id: int, data: dict, usuario: str) -> bool:
    sets, params = [], {"id": conexion_id, "usuario": usuario}
    mapeo = {
        "nombre": "nombre", "host": "host", "port": "port", "dbname": "dbname",
        "usuario": "usuario", "notas": "notas",
    }
    for campo_in, campo_sql in mapeo.items():
        if data.get(campo_in) is not None:
            sets.append(f"{campo_sql} = :{campo_sql}")
            params[campo_sql] = data[campo_in]
    if data.get("password"):
        sets.append("password_cif = :password_cif")
        params["password_cif"] = crypto.encrypt(data["password"])
    if not sets:
        return True
    sets.append("actualizado_por = :usuario")
    sets.append("actualizado_en = NOW()")
    sql = f"UPDATE migracion_ladm_conexion SET {', '.join(sets)} WHERE id = :id"
    res = db.execute(text(sql), params)
    db.commit()
    return res.rowcount > 0


def borrar_conexion(db: Session, conexion_id: int) -> bool:
    res = db.execute(
        text("DELETE FROM migracion_ladm_conexion WHERE id = :id"),
        {"id": conexion_id},
    )
    db.commit()
    return res.rowcount > 0


# ── Jobs ────────────────────────────────────────────────────────────────────

def crear_job(db: Session, conexion_id: Optional[int], esquema_origen: str,
              esquema_destino: str, tabla_dominios: str, usuario: str) -> int:
    row = db.execute(text("""
        INSERT INTO migracion_ladm_job
          (conexion_id, esquema_origen, esquema_destino, tabla_dominios, creado_por)
        VALUES
          (:conexion_id, :esquema_origen, :esquema_destino, :tabla_dominios, :usuario)
        RETURNING id
    """), {
        "conexion_id":     conexion_id,
        "esquema_origen":  esquema_origen,
        "esquema_destino": esquema_destino,
        "tabla_dominios":  tabla_dominios,
        "usuario":         usuario,
    }).fetchone()
    db.commit()
    return row.id


def obtener_job(db: Session, job_id: int) -> Optional[dict]:
    row = db.execute(text("""
        SELECT j.id, j.conexion_id, c.nombre AS conexion_nombre,
               j.esquema_origen, j.esquema_destino, j.tabla_dominios,
               j.estado, j.progreso, j.tabla_actual, j.tabla_actual_idx,
               j.total_tablas, j.iniciado_en, j.finalizado_en,
               j.error_message, j.cancelar_solicitado, j.creado_por
        FROM migracion_ladm_job j
        LEFT JOIN migracion_ladm_conexion c ON c.id = j.conexion_id
        WHERE j.id = :id
    """), {"id": job_id}).fetchone()
    return dict(row._mapping) if row else None


def listar_jobs(db: Session, limit: int = 50, offset: int = 0) -> list[dict]:
    rows = db.execute(text("""
        SELECT j.id, c.nombre AS conexion_nombre,
               j.esquema_origen, j.esquema_destino,
               j.estado, j.progreso, j.tabla_actual, j.tabla_actual_idx,
               j.total_tablas, j.iniciado_en, j.finalizado_en, j.creado_por
        FROM migracion_ladm_job j
        LEFT JOIN migracion_ladm_conexion c ON c.id = j.conexion_id
        ORDER BY j.iniciado_en DESC
        LIMIT :limit OFFSET :offset
    """), {"limit": limit, "offset": offset}).fetchall()
    return [dict(r._mapping) for r in rows]


def actualizar_estado_job(db: Session, job_id: int, estado: str,
                          error_message: Optional[str] = None) -> None:
    finalizar = estado in ("done", "error", "cancelled")
    sql = """
        UPDATE migracion_ladm_job
        SET estado = :estado,
            error_message = COALESCE(:error_message, error_message)
            {finalizado}
        WHERE id = :id
    """.format(finalizado=", finalizado_en = NOW()" if finalizar else "")
    db.execute(text(sql), {
        "id":            job_id,
        "estado":        estado,
        "error_message": error_message,
    })
    db.commit()


def actualizar_progreso(db: Session, job_id: int, progreso: int,
                        tabla: Optional[str], idx: Optional[int],
                        total: Optional[int]) -> None:
    db.execute(text("""
        UPDATE migracion_ladm_job
        SET progreso = :progreso,
            tabla_actual = :tabla,
            tabla_actual_idx = :idx,
            total_tablas = COALESCE(:total, total_tablas)
        WHERE id = :id
    """), {
        "id":       job_id,
        "progreso": progreso,
        "tabla":    tabla,
        "idx":      idx,
        "total":    total,
    })
    db.commit()


def solicitar_cancelacion(db: Session, job_id: int) -> bool:
    """Marca el flag. Retorna False si el job no existe o ya finalizó."""
    res = db.execute(text("""
        UPDATE migracion_ladm_job
        SET cancelar_solicitado = TRUE
        WHERE id = :id
          AND estado IN ('pending', 'running')
    """), {"id": job_id})
    db.commit()
    return res.rowcount > 0


def cancelacion_solicitada(db: Session, job_id: int) -> bool:
    row = db.execute(
        text("SELECT cancelar_solicitado FROM migracion_ladm_job WHERE id = :id"),
        {"id": job_id},
    ).fetchone()
    return bool(row.cancelar_solicitado) if row else False


# ── Logs de error fila por fila ────────────────────────────────────────────

def registrar_error_log(db: Session, job_id: int, tabla: str,
                        fila_dict: dict, error_str: str) -> None:
    db.execute(text("""
        INSERT INTO migracion_ladm_log (job_id, tabla, fila_json, error_reason)
        VALUES (:job_id, :tabla, CAST(:fila AS jsonb), :error)
    """), {
        "job_id": job_id,
        "tabla":  tabla,
        "fila":   json.dumps(fila_dict, default=str),
        "error":  error_str,
    })
    db.commit()


def listar_errores(db: Session, job_id: int, limit: int = 100,
                   offset: int = 0) -> tuple[int, list[dict]]:
    total = db.execute(
        text("SELECT count(*) FROM migracion_ladm_log WHERE job_id = :id"),
        {"id": job_id},
    ).scalar() or 0
    rows = db.execute(text("""
        SELECT id, tabla, fila_json, error_reason, fecha_registro
        FROM migracion_ladm_log
        WHERE job_id = :id
        ORDER BY id ASC
        LIMIT :limit OFFSET :offset
    """), {"id": job_id, "limit": limit, "offset": offset}).fetchall()
    return total, [dict(r._mapping) for r in rows]


def iter_errores_para_reporte(db: Session, job_id: int):
    """Iterador para StreamingResponse — no carga todo en memoria."""
    return db.execute(text("""
        SELECT id, tabla, fila_json, error_reason, fecha_registro
        FROM migracion_ladm_log
        WHERE job_id = :id
        ORDER BY id ASC
    """), {"id": job_id})
