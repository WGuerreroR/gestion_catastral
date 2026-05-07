import csv
import io
import logging
import time
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

from db.database import get_db
from core.deps import get_current_user, require_roles
from repositories import validacion_calidad_repo as repo
from services import validacion_calidad_service as service
from schemas.validacion_calidad import (
    ReglaCreate, ReglaUpdate, ReglaResponse, ReglaListItem,
    JobCreate, JobResponse, JobListItem, JobCreateResponse,
    LogErrorResponse, LogErroresPaginados,
    ExcepcionCreate, ExcepcionResponse,
    ExcepcionCreateResponse, ExcepcionDeleteResponse,
    MetricasJob,
    ErroresAgrupadosResponse,
    CrearMarcasResponse,
    CrearMarcasMasivoResponse,
    ExclusionMasivaRequest, ExclusionMasivaResponse,
    PreviewCalidadRequest, PreviewCalidadResponse,
    CancelarJobResponse,
)


router = APIRouter(prefix="/validacion-calidad", tags=["validación-calidad"])


# ── Reglas (CRUD dinámico) ──────────────────────────────────────────────────

@router.get("/reglas", response_model=List[ReglaListItem])
def listar_reglas(
    solo_activas: bool = Query(False),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    return repo.listar_reglas(db, solo_activas=solo_activas)


@router.get("/reglas/{regla_id}", response_model=ReglaResponse)
def obtener_regla(
    regla_id: int,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    regla = repo.obtener_regla(db, regla_id)
    if not regla:
        raise HTTPException(404, "Regla no encontrada")
    return regla


@router.post("/reglas", status_code=201, response_model=ReglaResponse)
def crear_regla(
    data: ReglaCreate,
    db: Session = Depends(get_db),
    user=Depends(require_roles("administrador", "supervisor")),
):
    if repo.existe_codigo(db, data.codigo):
        raise HTTPException(409, f"Ya existe una regla con código '{data.codigo}'")
    try:
        service.validar_sql_template(data.sql_template, data.entidad)
    except ValueError as e:
        raise HTTPException(400, str(e))
    ok, err = service.explain_sql(db, data.sql_template, data.entidad)
    if not ok:
        raise HTTPException(400, f"El SQL no se puede ejecutar: {err}")

    regla_id = repo.crear_regla(db, data.model_dump(), usuario=user.get("nombre", "?"))
    return repo.obtener_regla(db, regla_id)


@router.put("/reglas/{regla_id}", response_model=ReglaResponse)
def actualizar_regla(
    regla_id: int,
    data: ReglaUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_roles("administrador", "supervisor")),
):
    actual = repo.obtener_regla(db, regla_id)
    if not actual:
        raise HTTPException(404, "Regla no encontrada")

    if data.codigo and data.codigo != actual["codigo"]:
        if repo.existe_codigo(db, data.codigo, excluir_id=regla_id):
            raise HTTPException(409, f"Ya existe una regla con código '{data.codigo}'")

    nuevo_sql = data.sql_template if data.sql_template is not None else actual["sql_template"]
    nueva_entidad = data.entidad if data.entidad is not None else actual["entidad"]
    if data.sql_template is not None or data.entidad is not None:
        try:
            service.validar_sql_template(nuevo_sql, nueva_entidad)
        except ValueError as e:
            raise HTTPException(400, str(e))
        ok, err = service.explain_sql(db, nuevo_sql, nueva_entidad)
        if not ok:
            raise HTTPException(400, f"El SQL no se puede ejecutar: {err}")

    repo.actualizar_regla(db, regla_id, data.model_dump(exclude_unset=True),
                          usuario=user.get("nombre", "?"))
    return repo.obtener_regla(db, regla_id)


@router.delete("/reglas/{regla_id}", status_code=204)
def borrar_regla(
    regla_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_roles("administrador", "supervisor")),
):
    if not repo.borrar_regla(db, regla_id):
        raise HTTPException(404, "Regla no encontrada")
    return None


# ── Jobs ────────────────────────────────────────────────────────────────────

@router.post("/jobs/preview-calidad", response_model=PreviewCalidadResponse)
def preview_calidad(
    data: PreviewCalidadRequest,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """Devuelve qué predios del alcance NO tienen las 6 columnas calidad_*=1.
    Solo lectura — no crea nada. Útil antes de lanzar un job para advertir
    al usuario qué predios no se promoverán a validado.lc_predio_p si el gate
    de calidad está activo."""
    return service.preview_calidad_alcance(
        db, data.alcance_tipo, list(data.alcance_valores or []),
    )


@router.post("/jobs", status_code=201, response_model=JobCreateResponse)
def crear_job(
    data: JobCreate,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    user=Depends(require_roles("administrador", "supervisor", "coordinador")),
):
    job_id = repo.crear_job(
        db,
        alcance_tipo=data.alcance_tipo,
        alcance_valores=data.alcance_valores,
        reglas_omitidas=data.reglas_omitidas,
        aplicar_filtro_calidad=data.aplicar_filtro_calidad,
        usuario=user.get("nombre", "?"),
    )
    background.add_task(service.ejecutar_job, job_id)
    return {"job_id": job_id}


@router.get("/jobs", response_model=List[JobListItem])
def listar_jobs(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    incluir_ocultos: bool = Query(False, description="Si true, incluye jobs marcados como ocultos."),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    return repo.listar_jobs(db, limit=limit, offset=offset,
                            incluir_ocultos=incluir_ocultos)


@router.patch("/jobs/{job_id}/visibilidad", response_model=JobResponse)
def cambiar_visibilidad_job(
    job_id: int,
    oculto: bool = Query(..., description="true = ocultar; false = restaurar."),
    db: Session = Depends(get_db),
    user=Depends(require_roles("administrador", "supervisor", "coordinador")),
):
    if not repo.actualizar_visibilidad(db, job_id, oculto):
        raise HTTPException(404, "Job no encontrado")
    return repo.obtener_job(db, job_id)


@router.get("/jobs/{job_id}", response_model=JobResponse)
def obtener_job(
    job_id: int,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    job = repo.obtener_job(db, job_id)
    if not job:
        raise HTTPException(404, "Job no encontrado")
    return job


def _limpiar_recursos_residuales(db: Session, job_id: int) -> None:
    """Borra la tabla temporal _vc_alcance_<job_id> si quedó huérfana
    (worker muerto antes de llegar a su finally). Defensivo, no lanza."""
    try:
        db.execute(text(f"DROP TABLE IF EXISTS public._vc_alcance_{int(job_id)}"))
        db.commit()
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass


@router.post("/jobs/{job_id}/cancelar", response_model=CancelarJobResponse)
def cancelar_job(
    job_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_roles("administrador", "supervisor", "coordinador")),
):
    """Cancela el job de forma autoritativa: cuando responde, el job ya está
    en estado terminal. Estrategia:
      1. Marca el flag cooperativo `cancelar_solicitado=true`.
      2. Si hay PID registrado y está vivo en pg_stat_activity → manda
         pg_cancel_backend y espera hasta 3s a que el worker propague el cancel.
      3. Si el worker no responde (huérfano, o demoró más de 3s), fuerza la
         cancelación marcando el job directamente como `cancelled` y limpia
         recursos residuales (tabla temp _vc_alcance_*).
    """
    job = repo.obtener_job(db, job_id)
    if not job:
        raise HTTPException(404, "Job no encontrado")
    if job["estado"] not in ("pending", "running"):
        raise HTTPException(409, "El job ya finalizó")

    # 1. Flag cooperativo (lo lee el worker en _check_cancel)
    repo.solicitar_cancelacion(db, job_id)

    # 2. ¿Worker vivo?
    pid = job.get("worker_pid")
    worker_vivo = False
    if pid:
        row = db.execute(
            text("SELECT 1 FROM pg_stat_activity WHERE pid = :p"), {"p": pid}
        ).fetchone()
        worker_vivo = row is not None

    query_cancelada = False
    if worker_vivo:
        try:
            r = db.execute(
                text("SELECT pg_cancel_backend(:p) AS ok"), {"p": pid}
            ).fetchone()
            db.commit()
            query_cancelada = bool(r and r.ok)
        except Exception as e:
            logger.warning(
                f"[cancelar_job {job_id}] pg_cancel_backend falló (pid={pid}): {e}"
            )

        # 3. Esperar hasta 3s a que el worker propague el cancel
        for _ in range(10):  # 10 * 300ms = 3s
            time.sleep(0.3)
            j = repo.obtener_job(db, job_id)
            if j and j["estado"] in ("cancelled", "done", "error"):
                _limpiar_recursos_residuales(db, job_id)
                return CancelarJobResponse(
                    job=j,
                    forzado=False,
                    query_cancelada=query_cancelada,
                    mensaje="Job cancelado por el worker",
                )

    # 4. Worker huérfano o no respondió en 3s → forzar
    if not worker_vivo:
        motivo = " | Cancelado por el usuario (worker no disponible)"
        mensaje = "Cancelación forzada (worker no disponible)"
    else:
        motivo = " | Cancelado por el usuario (forzado tras 3s sin respuesta del worker)"
        mensaje = "Cancelación forzada tras 3s sin respuesta del worker"

    repo.forzar_cancelacion(db, job_id, motivo)
    _limpiar_recursos_residuales(db, job_id)

    j = repo.obtener_job(db, job_id)
    return CancelarJobResponse(
        job=j,
        forzado=True,
        query_cancelada=query_cancelada,
        mensaje=mensaje,
    )


@router.get("/jobs/{job_id}/errores", response_model=LogErroresPaginados)
def listar_errores_job(
    job_id: int,
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    if not repo.obtener_job(db, job_id):
        raise HTTPException(404, "Job no encontrado")
    total, items = repo.listar_errores(db, job_id, limit=limit, offset=offset)
    return {"total": total, "items": items}


@router.get("/jobs/{job_id}/errores-agrupados", response_model=ErroresAgrupadosResponse)
def listar_errores_agrupados(
    job_id: int,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    if not repo.obtener_job(db, job_id):
        raise HTTPException(404, "Job no encontrado")
    return {
        "total_predios":    repo.contar_predios_con_errores(db, job_id),
        "items":            repo.listar_errores_agrupados(db, job_id, limit=limit, offset=offset),
        "errores_globales": repo.listar_errores_sin_predial(db, job_id),
    }


# ── Conversión de errores en marcas (admin_marca_predio) ───────────────────

@router.post("/jobs/{job_id}/predios/{numero_predial}/marcas",
             response_model=CrearMarcasResponse, status_code=201)
def crear_marcas_desde_errores(
    job_id: int,
    numero_predial: str,
    regla: Optional[str] = Query(
        None,
        description="Si se da, solo convierte ese error; si no, todos los activos del predio.",
    ),
    db: Session = Depends(get_db),
    user=Depends(require_roles("administrador", "supervisor")),
):
    try:
        return service.crear_marcas_desde_errores(
            db, job_id, numero_predial, regla=regla,
            usuario_id=int(user["sub"]),
        )
    except service.JobOcupado as e:
        raise HTTPException(409, str(e))
    except ValueError as e:
        raise HTTPException(404, str(e))


@router.post("/jobs/{job_id}/marcas-masivo",
             response_model=CrearMarcasMasivoResponse, status_code=201)
def crear_marcas_masivo(
    job_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_roles("administrador", "supervisor")),
):
    """Convierte en marcas TODOS los errores activos no excluidos del job
    (de todos los predios). Atómico-ish: cada predio se procesa con la lógica
    existente; si un predio falla, los demás continúan."""
    try:
        return service.crear_marcas_masivo_job(
            db, job_id, usuario_id=int(user["sub"]),
        )
    except service.JobOcupado as e:
        raise HTTPException(409, str(e))
    except ValueError as e:
        raise HTTPException(404, str(e))


@router.post("/jobs/{job_id}/migrar-validado", response_model=MetricasJob)
def migrar_a_validado(
    job_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_roles("administrador", "supervisor", "coordinador")),
):
    """Aplica el estado actual de exclusiones al esquema `validado.*`:
    elimina los predios del alcance, re-inserta los elegibles, repuebla las
    relacionadas. Las exclusiones por sí solas no migran — esta acción es
    explícita para que el usuario controle cuándo actualizar `validado.*`."""
    try:
        return service.migrar_a_validado_job(db, job_id)
    except service.JobOcupado as e:
        raise HTTPException(409, str(e))
    except ValueError as e:
        raise HTTPException(404, str(e))


@router.post("/jobs/{job_id}/exclusiones-masivas",
             response_model=ExclusionMasivaResponse, status_code=201)
def excluir_todos_los_errores(
    job_id: int,
    data: ExclusionMasivaRequest,
    db: Session = Depends(get_db),
    user=Depends(require_roles("administrador", "supervisor", "coordinador")),
):
    """Excluye TODOS los errores activos del job (wildcard regla=NULL por
    cada predio). Recalcula validez una vez al final — los predios sin
    errores activos restantes se promueven a validado.lc_predio_p."""
    try:
        return service.excluir_todos_los_errores_job(
            db, job_id, motivo=data.motivo,
            usuario=user.get("nombre", "?"),
        )
    except service.JobOcupado as e:
        raise HTTPException(409, str(e))
    except ValueError as e:
        raise HTTPException(404, str(e))


# ── Excepciones (errores aceptados/justificados por job) ────────────────────

@router.get("/jobs/{job_id}/exclusiones", response_model=List[ExcepcionResponse])
def listar_exclusiones(
    job_id: int,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    if not repo.obtener_job(db, job_id):
        raise HTTPException(404, "Job no encontrado")
    return repo.listar_excepciones(db, job_id)


@router.post("/jobs/{job_id}/exclusiones", status_code=201,
             response_model=ExcepcionCreateResponse)
def crear_exclusion(
    job_id: int,
    data: ExcepcionCreate,
    db: Session = Depends(get_db),
    user=Depends(require_roles("administrador", "supervisor", "coordinador")),
):
    job = repo.obtener_job(db, job_id)
    if not job:
        raise HTTPException(404, "Job no encontrado")
    if job["estado"] in ("pending", "running"):
        raise HTTPException(409, "El job aún corre; espere a que termine para excluir errores")
    if not repo.predio_tiene_errores(db, job_id, data.numero_predial):
        raise HTTPException(404, "El predio no tiene errores en este job")

    exc = repo.crear_excepcion(
        db, job_id, data.numero_predial, data.regla,
        data.motivo, user.get("nombre", "?"),
    )
    try:
        metricas = service.recalcular_metricas_job(db, job_id)
    except service.JobOcupado as e:
        raise HTTPException(409, str(e))
    return {"excepcion": exc, "metricas": metricas}


@router.delete("/jobs/{job_id}/exclusiones", response_model=ExcepcionDeleteResponse)
def borrar_exclusion(
    job_id: int,
    numero_predial: str = Query(..., min_length=1, max_length=50),
    regla: Optional[str] = Query(None, max_length=50),
    db: Session = Depends(get_db),
    user=Depends(require_roles("administrador", "supervisor", "coordinador")),
):
    job = repo.obtener_job(db, job_id)
    if not job:
        raise HTTPException(404, "Job no encontrado")
    if job["estado"] in ("pending", "running"):
        raise HTTPException(409, "El job aún corre; espere a que termine")

    if not repo.borrar_excepcion(db, job_id, numero_predial, regla):
        raise HTTPException(404, "Exclusión no encontrada")
    try:
        metricas = service.recalcular_metricas_job(db, job_id)
    except service.JobOcupado as e:
        raise HTTPException(409, str(e))
    return {"ok": True, "metricas": metricas}


@router.get("/jobs/{job_id}/reporte.log")
def descargar_reporte(
    job_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_roles("administrador", "supervisor", "coordinador")),
):
    job = repo.obtener_job(db, job_id)
    if not job:
        raise HTTPException(404, "Job no encontrado")

    def generar():
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow([
            "id", "numero_predial", "regla", "descripcion", "fecha_registro",
            "excluido", "motivo_exclusion",
        ])
        yield buf.getvalue()
        buf.seek(0); buf.truncate(0)

        for row in repo.iter_errores_para_reporte(db, job_id):
            writer.writerow([
                row.id,
                row.numero_predial or "",
                row.regla or "",
                (row.descripcion or "").replace("\n", " ").replace("\r", " "),
                row.fecha_registro.isoformat() if row.fecha_registro else "",
                "true" if row.excluido else "false",
                (row.motivo_exclusion or "").replace("\n", " ").replace("\r", " "),
            ])
            yield buf.getvalue()
            buf.seek(0); buf.truncate(0)

    filename = f"validacion_calidad_job_{job_id}.log"
    return StreamingResponse(
        generar(),
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
