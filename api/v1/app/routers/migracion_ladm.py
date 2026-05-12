"""Router de migración LADM. Solo `administrador` puede crear/ejecutar."""
import csv
import io
import json
from typing import List

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from core.deps import get_current_user, require_roles
from db.database import get_db
from repositories import migracion_ladm_repo as repo
from services import migracion_ladm_service as service
from schemas.migracion_ladm import (
    ConexionCreate, ConexionUpdate, ConexionResponse, ConexionListItem,
    ConexionTestRequest, ConexionTestResponse,
    JobCreate, JobResponse, JobListItem, JobCreateResponse,
    LogErroresPaginados,
)


router = APIRouter(prefix="/migracion-ladm", tags=["migración-ladm"])


# ── Conexiones ─────────────────────────────────────────────────────────────

@router.get("/conexiones", response_model=List[ConexionListItem])
def listar_conexiones(
    db: Session = Depends(get_db),
    user=Depends(require_roles("administrador")),
):
    return repo.listar_conexiones(db)


@router.get("/conexiones/{conexion_id}", response_model=ConexionResponse)
def obtener_conexion(
    conexion_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_roles("administrador")),
):
    c = repo.obtener_conexion(db, conexion_id)
    if not c:
        raise HTTPException(404, "Perfil de conexión no encontrado")
    return c


@router.post("/conexiones", status_code=201, response_model=ConexionResponse)
def crear_conexion(
    data: ConexionCreate,
    db: Session = Depends(get_db),
    user=Depends(require_roles("administrador")),
):
    if repo.existe_nombre_conexion(db, data.nombre):
        raise HTTPException(409, f"Ya existe un perfil con nombre '{data.nombre}'")
    cid = repo.crear_conexion(db, data.model_dump(), usuario=user.get("nombre", "?"))
    return repo.obtener_conexion(db, cid)


@router.put("/conexiones/{conexion_id}", response_model=ConexionResponse)
def actualizar_conexion(
    conexion_id: int,
    data: ConexionUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_roles("administrador")),
):
    actual = repo.obtener_conexion(db, conexion_id)
    if not actual:
        raise HTTPException(404, "Perfil de conexión no encontrado")
    if data.nombre and data.nombre != actual["nombre"]:
        if repo.existe_nombre_conexion(db, data.nombre, excluir_id=conexion_id):
            raise HTTPException(409, f"Ya existe un perfil con nombre '{data.nombre}'")
    repo.actualizar_conexion(
        db, conexion_id, data.model_dump(exclude_unset=True),
        usuario=user.get("nombre", "?"),
    )
    return repo.obtener_conexion(db, conexion_id)


@router.delete("/conexiones/{conexion_id}", status_code=204)
def borrar_conexion(
    conexion_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_roles("administrador")),
):
    if not repo.borrar_conexion(db, conexion_id):
        raise HTTPException(404, "Perfil de conexión no encontrado")
    return None


@router.post("/conexiones/probar", response_model=ConexionTestResponse)
def probar_conexion_adhoc(
    data: ConexionTestRequest,
    user=Depends(require_roles("administrador")),
):
    ok, mensaje = service.probar_conexion(
        data.host, data.port, data.dbname, data.usuario, data.password,
    )
    return ConexionTestResponse(
        ok=ok,
        mensaje=mensaje if ok else "No se pudo conectar",
        error=None if ok else mensaje,
    )


@router.post("/conexiones/local/probar", response_model=ConexionTestResponse)
def probar_conexion_local(
    user=Depends(require_roles("administrador")),
):
    """Prueba conexión usando el DATABASE_URL del backend."""
    import os
    from sqlalchemy.engine.url import make_url
    url = make_url(os.getenv("DATABASE_URL"))
    ok, mensaje = service.probar_conexion(
        url.host, url.port or 5432, url.database,
        url.username, url.password,
    )
    return ConexionTestResponse(
        ok=ok,
        mensaje=mensaje if ok else "No se pudo conectar",
        error=None if ok else mensaje,
    )


@router.post("/conexiones/{conexion_id}/probar", response_model=ConexionTestResponse)
def probar_conexion_perfil(
    conexion_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_roles("administrador")),
):
    params = repo.obtener_conexion_descifrada(db, conexion_id)
    if not params:
        raise HTTPException(404, "Perfil de conexión no encontrado")
    ok, mensaje = service.probar_conexion(
        params["host"], params["port"], params["dbname"],
        params["user"], params["password"],
    )
    return ConexionTestResponse(
        ok=ok,
        mensaje=mensaje if ok else "No se pudo conectar",
        error=None if ok else mensaje,
    )


# ── Jobs ────────────────────────────────────────────────────────────────────

@router.post("/jobs", status_code=201, response_model=JobCreateResponse)
def crear_job(
    data: JobCreate,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    user=Depends(require_roles("administrador")),
):
    if data.conexion_id is not None and not repo.obtener_conexion(db, data.conexion_id):
        raise HTTPException(404, "Perfil de conexión no encontrado")

    job_id = repo.crear_job(
        db,
        conexion_id=data.conexion_id,
        esquema_origen=data.esquema_origen,
        esquema_destino=data.esquema_destino,
        tabla_dominios=data.tabla_dominios,
        usuario=user.get("nombre", "?"),
    )
    background.add_task(service.ejecutar_job, job_id)
    return {"job_id": job_id}


@router.get("/jobs", response_model=List[JobListItem])
def listar_jobs(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    user=Depends(require_roles("administrador")),
):
    return repo.listar_jobs(db, limit=limit, offset=offset)


@router.get("/jobs/{job_id}", response_model=JobResponse)
def obtener_job(
    job_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_roles("administrador")),
):
    job = repo.obtener_job(db, job_id)
    if not job:
        raise HTTPException(404, "Job no encontrado")
    return job


@router.post("/jobs/{job_id}/cancelar", status_code=200)
def cancelar_job(
    job_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_roles("administrador")),
):
    if not repo.solicitar_cancelacion(db, job_id):
        raise HTTPException(409, "El job no se puede cancelar (no existe o ya finalizó)")
    return {"ok": True}


@router.get("/jobs/{job_id}/errores", response_model=LogErroresPaginados)
def listar_errores_job(
    job_id: int,
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    user=Depends(require_roles("administrador")),
):
    if not repo.obtener_job(db, job_id):
        raise HTTPException(404, "Job no encontrado")
    total, items = repo.listar_errores(db, job_id, limit=limit, offset=offset)
    return {"total": total, "items": items}


@router.get("/jobs/{job_id}/reporte.log")
def descargar_reporte(
    job_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_roles("administrador")),
):
    if not repo.obtener_job(db, job_id):
        raise HTTPException(404, "Job no encontrado")

    def generar():
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(["id", "tabla", "fila_json", "error_reason", "fecha_registro"])
        yield buf.getvalue()
        buf.seek(0); buf.truncate(0)

        for row in repo.iter_errores_para_reporte(db, job_id):
            fila = row.fila_json
            if isinstance(fila, dict):
                fila = json.dumps(fila, default=str, ensure_ascii=False)
            writer.writerow([
                row.id,
                row.tabla or "",
                (fila or "").replace("\n", " ").replace("\r", " "),
                (row.error_reason or "").replace("\n", " ").replace("\r", " "),
                row.fecha_registro.isoformat() if row.fecha_registro else "",
            ])
            yield buf.getvalue()
            buf.seek(0); buf.truncate(0)

    filename = f"migracion_ladm_job_{job_id}.log"
    return StreamingResponse(
        generar(),
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
