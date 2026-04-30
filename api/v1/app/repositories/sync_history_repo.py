"""
app/repositories/sync_history_repo.py

CRUD de la tabla sync_history (auditoría de sincronizaciones offline).
Sigue el patrón de los demás repos: funciones sueltas con db: Session,
SQL crudo vía text(), commit explícito.

Requiere migración 003_create_sync_history.sql.
"""

from sqlalchemy.orm import Session
from sqlalchemy import text
import json
from typing import Optional


def create(
    db: Session,
    asignacion_id: int,
    paquete_nombre: str,
    paquete_hash: str,
    usuario: Optional[str],
    forzado: bool = False,
    origen: str = "manual",
    estado: str = "encolado",
) -> int:
    """
    Inserta un registro inicial de sincronización en estado 'encolado'.
    Devuelve el sync_id generado.
    """
    row = db.execute(text("""
        INSERT INTO sync_history
            (asignacion_id, paquete_nombre, paquete_hash, usuario,
             forzado, origen, estado)
        VALUES
            (:asignacion_id, :paquete_nombre, :paquete_hash, :usuario,
             :forzado, :origen, :estado)
        RETURNING id
    """), {
        "asignacion_id": asignacion_id,
        "paquete_nombre": paquete_nombre,
        "paquete_hash": paquete_hash,
        "usuario": usuario,
        "forzado": forzado,
        "origen": origen,
        "estado": estado,
    }).fetchone()
    db.commit()
    return row[0]


def update(db: Session, sync_id: int, campos: dict) -> None:
    """
    Actualiza columnas arbitrarias de un sync. Los valores que sean dict/list
    se serializan a JSON automáticamente para columnas jsonb.
    """
    if not campos:
        return
    payload = dict(campos)
    for k, v in list(payload.items()):
        if isinstance(v, (dict, list)):
            payload[k] = json.dumps(v)

    set_clause = ", ".join(f"{k} = :{k}" for k in payload)
    payload["id"] = sync_id
    db.execute(
        text(f"UPDATE sync_history SET {set_clause} WHERE id = :id"),
        payload,
    )
    db.commit()


def find_by_hash_ok(db: Session, asignacion_id: int, paquete_hash: str) -> Optional[dict]:
    """
    Busca un sync previo exitoso (estado 'ok') con el mismo hash de paquete.
    Sirve para idempotencia: si el mismo zip fue aplicado antes con éxito,
    devolvemos su resumen sin repetir el trabajo.
    """
    row = db.execute(text("""
        SELECT id, fecha_sync, usuario, paquete_nombre, paquete_hash,
               estado, estrategia_diff, forzado, estado_anterior, estado_nuevo,
               resumen, fotos_resumen, advertencias, error_detalle
        FROM sync_history
        WHERE asignacion_id = :asignacion_id
          AND paquete_hash = :hash
          AND estado = 'ok'
        ORDER BY fecha_sync DESC
        LIMIT 1
    """), {"asignacion_id": asignacion_id, "hash": paquete_hash}).fetchone()

    return dict(row._mapping) if row else None


def list_by_asignacion(
    db: Session,
    asignacion_id: int,
    limit: int = 20,
    offset: int = 0,
) -> list[dict]:
    """Lista paginada del historial de sincronizaciones de una asignación."""
    resultado = db.execute(text("""
        SELECT id, fecha_sync, usuario, paquete_nombre, paquete_hash,
               estado, estrategia_diff, forzado, origen,
               estado_anterior, estado_nuevo
        FROM sync_history
        WHERE asignacion_id = :asignacion_id
        ORDER BY fecha_sync DESC
        LIMIT :limit OFFSET :offset
    """), {
        "asignacion_id": asignacion_id,
        "limit": limit,
        "offset": offset,
    }).fetchall()
    return [dict(r._mapping) for r in resultado]


def get_by_id(db: Session, sync_id: int) -> Optional[dict]:
    """Detalle completo de un sync, incluyendo resumen y fotos (jsonb)."""
    row = db.execute(text("""
        SELECT id, asignacion_id, fecha_sync, usuario,
               paquete_nombre, paquete_hash,
               estado, estrategia_diff, forzado, origen,
               estado_anterior, estado_nuevo,
               resumen, fotos_resumen, advertencias, error_detalle
        FROM sync_history
        WHERE id = :id
    """), {"id": sync_id}).fetchone()
    return dict(row._mapping) if row else None
