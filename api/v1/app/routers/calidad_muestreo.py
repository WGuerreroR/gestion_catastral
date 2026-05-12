"""
Router del muestreo de calidad por asignación operativa.
Espejo del flujo viejo /calidad-externa pero el universo se construye
seleccionando proyectos de asignación en estado 'validacion'.
"""

import re

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session

from core.deps import get_current_user, require_roles
from db.database import get_db
from repositories import calidad_muestreo_repo
from services import qgis_export_service
from schemas.calidad_muestreo import (
    ActualizarProyectoRequest,
    AsignacionDeProyecto,
    AsignacionDisponible,
    CerrarProyectoResponse,
    CrearProyectoRequest,
    MarcarValidadoRequest,
    MarcarValidadoResponse,
    ReabrirProyectoRequest,
    ReabrirProyectoResponse,
    PredioDeProyecto,
    PreviewRequest,
    PreviewResponse,
    ProyectoDetalle,
    ProyectoResumen,
    RerandomizarRequest,
    SincronizarResponse,
)


router = APIRouter(prefix="/calidad-muestreo", tags=["Calidad por asignación"])


# ── Universo de asignaciones disponibles ─────────────────────────────────────

@router.get("/asignaciones-disponibles", response_model=list[AsignacionDisponible])
def asignaciones_disponibles(
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    return calidad_muestreo_repo.get_asignaciones_disponibles(db)


# ── Preview ──────────────────────────────────────────────────────────────────

@router.post("/preview", response_model=PreviewResponse)
def preview(
    body: PreviewRequest,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    if not body.asignacion_ids:
        raise HTTPException(400, "Se requiere al menos una asignación")
    try:
        return calidad_muestreo_repo.preview_predios_por_asignaciones(
            db, body.asignacion_ids, margen_error=body.margen_error
        )
    except ValueError as e:
        raise HTTPException(400, str(e))


# ── CRUD del proyecto ────────────────────────────────────────────────────────

@router.post("/", status_code=201)
def crear_proyecto(
    body: CrearProyectoRequest,
    db: Session = Depends(get_db),
    user=Depends(require_roles("administrador", "supervisor")),
):
    if not body.asignacion_ids:
        raise HTTPException(400, "Se requiere al menos una asignación")
    if not body.id_operaciones:
        raise HTTPException(400, "El universo de predios está vacío")

    creado_por = int(user.get("sub") or 0) or None
    try:
        return calidad_muestreo_repo.crear_proyecto(
            db,
            nombre=body.nombre,
            descripcion=body.descripcion,
            asignacion_ids=body.asignacion_ids,
            id_operaciones=body.id_operaciones,
            muestra_calculada=body.muestra_calculada,
            creado_por=creado_por,
            margen_error=body.margen_error,
            nivel_confianza=body.nivel_confianza,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/", response_model=list[ProyectoResumen])
def listar_proyectos(
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    return calidad_muestreo_repo.get_lista(db)


@router.get("/{pc_id}", response_model=ProyectoDetalle)
def detalle_proyecto(
    pc_id: int,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    proyecto = calidad_muestreo_repo.get_by_id(db, pc_id)
    if not proyecto:
        raise HTTPException(404, "Proyecto de muestreo no encontrado")
    return proyecto


@router.get("/{pc_id}/predios", response_model=list[PredioDeProyecto])
def predios_proyecto(
    pc_id: int,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    return calidad_muestreo_repo.get_predios(db, pc_id)


@router.get("/{pc_id}/asignaciones", response_model=list[AsignacionDeProyecto])
def asignaciones_proyecto(
    pc_id: int,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    return calidad_muestreo_repo.get_asignaciones_de_proyecto(db, pc_id)


@router.get("/{pc_id}/geojson")
def geojson_proyecto(
    pc_id: int,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    return calidad_muestreo_repo.get_geojson(db, pc_id)


@router.post("/{pc_id}/rerandomizar")
def rerandomizar(
    pc_id: int,
    body: RerandomizarRequest = RerandomizarRequest(),
    db: Session = Depends(get_db),
    user=Depends(require_roles("administrador", "supervisor")),
):
    try:
        out = calidad_muestreo_repo.rerandomizar(
            db, pc_id, nuevo_margen_error=body.margen_error
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"ok": True, "mensaje": "Muestra rerandomizada exitosamente", **out}


@router.put("/{pc_id}")
def actualizar_proyecto(
    pc_id: int,
    body: ActualizarProyectoRequest,
    db: Session = Depends(get_db),
    user=Depends(require_roles("administrador", "supervisor")),
):
    try:
        calidad_muestreo_repo.actualizar_proyecto(
            db, pc_id, body.model_dump(exclude_none=True)
        )
    except ValueError as e:
        # 404 si no existe, 400 si está cerrado
        if "no encontrado" in str(e):
            raise HTTPException(404, str(e))
        raise HTTPException(400, str(e))
    return {"ok": True, "mensaje": "Proyecto actualizado"}


@router.delete("/{pc_id}")
def eliminar_proyecto(
    pc_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_roles("administrador", "supervisor")),
):
    try:
        calidad_muestreo_repo.eliminar_proyecto(db, pc_id)
    except ValueError as e:
        raise HTTPException(404, str(e))
    return {"ok": True, "mensaje": "Proyecto de muestreo eliminado"}


@router.patch(
    "/{pc_id}/predios/{id_operacion}/validacion",
    response_model=MarcarValidadoResponse,
)
def marcar_predio_validado(
    pc_id: int,
    id_operacion: str,
    body: MarcarValidadoRequest,
    db: Session = Depends(get_db),
    user=Depends(require_roles("administrador", "supervisor")),
):
    try:
        return calidad_muestreo_repo.marcar_predio_validado(
            db, pc_id, id_operacion,
            validado=body.validado,
            validado_por=int(user.get("sub") or 0) or None,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))


def _slug(s: str, maxlen: int = 40) -> str:
    s = (s or "").strip().lower()
    s = re.sub(r"[^a-z0-9]+", "_", s).strip("_")
    return (s or "proyecto")[:maxlen]


@router.get("/{pc_id}/descargar-qgis")
def descargar_qgis(
    pc_id: int,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """
    Descarga un .zip con un proyecto QGIS centrado en el área del proyecto
    de calidad. Capas en vivo a PostGIS. Capa adicional 'Predios muestra'
    destacada en naranja con etiqueta de id_operacion.
    """
    proyecto = calidad_muestreo_repo.get_by_id(db, pc_id)
    if not proyecto:
        raise HTTPException(404, "Proyecto no encontrado")
    if not proyecto.get("area_geojson"):
        raise HTTPException(
            400, "El proyecto no tiene área (sin asignaciones con geometría)"
        )

    clave = f"calidad_{pc_id}_{_slug(proyecto['nombre'])}"
    try:
        zip_bytes = qgis_export_service.generar_paquete_calidad_muestreo(
            db, pc_id, clave,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"Error generando proyecto QGIS: {e}")

    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{clave}.zip"'},
    )


@router.post("/{pc_id}/reabrir", response_model=ReabrirProyectoResponse)
def reabrir_proyecto(
    pc_id: int,
    body: ReabrirProyectoRequest,
    db: Session = Depends(get_db),
    user=Depends(require_roles("administrador")),
):
    """
    Reabre un proyecto cerrado: revierte calidad_campo=0 en todos los
    predios del universo y vuelve estado a 'activo'. Solo administrador.
    Conserva las marcas validado=true en los predios muestra.
    """
    if not body.motivo or not body.motivo.strip():
        raise HTTPException(400, "El motivo es obligatorio")
    try:
        out = calidad_muestreo_repo.reabrir_proyecto(
            db, pc_id, body.motivo.strip(),
            int(user.get("sub") or 0) or None,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    return out


@router.post("/{pc_id}/cerrar", response_model=CerrarProyectoResponse)
def cerrar_proyecto(
    pc_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_roles("administrador", "supervisor")),
):
    try:
        return calidad_muestreo_repo.cerrar_proyecto(
            db, pc_id, cerrado_por=int(user.get("sub") or 0) or None,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/{pc_id}/sincronizar", response_model=SincronizarResponse)
async def sincronizar_proyecto(
    pc_id: int,
    paquete_zip: UploadFile = File(...),
    db: Session = Depends(get_db),
    user=Depends(require_roles("administrador", "supervisor")),
):
    """
    Carga un ZIP de proyecto offline sincronizado desde campo, lee
    `lc_predio_p` del data.gpkg y propaga `calidad_campo` y `revisar_campo`
    a PostGIS para los predios del universo. Adicionalmente marca
    `validado=TRUE` en el muestreo a los predios EN MUESTRA cuyo
    `calidad_campo=1`.
    """
    print(f"[calidad-sync] proyecto={pc_id} archivo={paquete_zip.filename!r}", flush=True)
    nombre = (paquete_zip.filename or "").lower()
    if not (nombre.endswith(".zip") or nombre.endswith(".gpkg")):
        msg = f"El archivo debe ser .zip o .gpkg (recibido: {paquete_zip.filename!r})"
        print(f"[calidad-sync] 400: {msg}", flush=True)
        raise HTTPException(400, msg)
    contenido = await paquete_zip.read()
    if not contenido:
        print(f"[calidad-sync] 400: archivo vacío", flush=True)
        raise HTTPException(400, "El archivo está vacío")
    print(f"[calidad-sync] tamaño={len(contenido)} bytes", flush=True)

    try:
        out = calidad_muestreo_repo.sincronizar_desde_paquete(
            db, pc_id, contenido,
            sincronizado_por=int(user.get("sub") or 0) or None,
        )
        print(f"[calidad-sync] OK {out}", flush=True)
        return out
    except ValueError as e:
        print(f"[calidad-sync] 400: {e}", flush=True)
        raise HTTPException(400, str(e))
    except Exception as e:
        import traceback
        print(f"[calidad-sync] 500: {e}\n{traceback.format_exc()}", flush=True)
        raise HTTPException(500, f"Error al sincronizar: {e}")
