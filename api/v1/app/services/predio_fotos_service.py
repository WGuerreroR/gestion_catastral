"""
Resolución de fotos del predio sin contexto de proyecto.

El visor de predios entra por id_operacion sin saber a qué proyecto
pertenece. Como las fotos físicamente viven bajo
`EXPORTS_DIR / {clave_proyecto} / DCIM/...`, el servicio resuelve
internamente "el último proyecto activo del predio" y construye el
path absoluto con la misma defensa contra path traversal que el
endpoint scoped por proyecto.
"""
from pathlib import Path

from sqlalchemy.orm import Session
from sqlalchemy import text


# Estados que se consideran "activos" (todavía vigentes) — se ordenan
# después por fecha_actualizacion para tomar el más reciente.
_ESTADOS_ACTIVOS = ("campo", "validacion", "completado")


def resolver_proyecto_activo(db: Session, id_operacion: str) -> dict | None:
    """
    Devuelve `{ proyecto_id, clave_proyecto }` del proyecto más
    reciente que contiene a este predio. None si no hay ninguno.
    """
    row = db.execute(text("""
        SELECT a.id AS proyecto_id, a.clave_proyecto
        FROM admin_persona_predio ap
        JOIN admin_asignacion a ON a.id = ap.proyecto_id
        WHERE ap.id_operacion = :id
        ORDER BY
            CASE WHEN ap.estado = ANY(:activos) THEN 0 ELSE 1 END,
            ap.fecha_actualizacion DESC NULLS LAST,
            ap.fecha_asignacion DESC NULLS LAST
        LIMIT 1
    """), {"id": id_operacion, "activos": list(_ESTADOS_ACTIVOS)}).fetchone()
    return dict(row._mapping) if row else None


def resolver_path_foto(clave_proyecto: str, ruta_relativa: str) -> Path:
    """
    Resuelve la ruta absoluta de una foto del paquete offline aplicando
    la misma defensa contra path traversal que usa el endpoint
    `/proyectos/{id}/offline/fotos/{ruta}`.

    Lanza ValueError si la ruta es inválida.
    """
    if (
        not ruta_relativa
        or ".." in ruta_relativa.split("/")
        or ruta_relativa.startswith("/")
        or ruta_relativa.startswith("\\")
    ):
        raise ValueError("Ruta inválida")

    # Import diferido para evitar inicializar QGIS al importar este módulo
    from services.qgis_export_service import EXPORTS_DIR

    return Path(EXPORTS_DIR) / clave_proyecto / ruta_relativa
