from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
from db.database import get_db
from core.deps import get_current_user, require_roles
from repositories import asignacion_proyecto_repo
from schemas.asignacion_proyecto import (
    AsignacionProyectoCreate, AsignacionProyectoUpdate,
    AsignacionProyectoResponse, CambioResponsable
)
from pydantic import BaseModel
import json

router = APIRouter(prefix="/proyectos", tags=["proyectos"])

class ConfirmarAsignacion(BaseModel):
    proyecto_id:     int
    persona_id:      int
    id_operaciones:  List[str]
    tipo_asignacion: str = "espacial"
    geojson:         Optional[dict] = None  # viene de polígono o shapefile
    codigo_manzana:  Optional[str]  = None  # viene de búsqueda por manzana

class CambioEstadoPredio(BaseModel):
    estado: str

@router.get("/", response_model=List[AsignacionProyectoResponse])
def listar_proyectos(
    db: Session = Depends(get_db),
    user=Depends(get_current_user)
):
    return asignacion_proyecto_repo.get_all(db)

@router.get("/{proyecto_id}", response_model=AsignacionProyectoResponse)
def obtener_proyecto(
    proyecto_id: int,
    db: Session = Depends(get_db),
    user=Depends(get_current_user)
):
    proyecto = asignacion_proyecto_repo.get_by_id(db, proyecto_id)
    if not proyecto:
        raise HTTPException(status_code=404, detail="Proyecto no encontrado")
    return proyecto

@router.get("/{proyecto_id}/predios")
def predios_del_proyecto(
    proyecto_id: int,
    db: Session = Depends(get_db),
    user=Depends(get_current_user)
):
    return asignacion_proyecto_repo.get_predios(db, proyecto_id)

@router.get("/{proyecto_id}/geojson")
def geojson_proyecto(
    proyecto_id: int,
    db: Session = Depends(get_db),
    user=Depends(get_current_user)
):
    return asignacion_proyecto_repo.get_geojson(db, proyecto_id)

@router.post("/", status_code=201)
def crear_proyecto(
    data: AsignacionProyectoCreate,
    db: Session = Depends(get_db),
    user=Depends(require_roles("administrador", "supervisor"))
):
    if asignacion_proyecto_repo.get_by_clave(db, data.clave_proyecto):
        raise HTTPException(status_code=400, detail="Ya existe un proyecto con esa clave")
    id_ = asignacion_proyecto_repo.create(db, data.model_dump())
    return {"id": id_, "mensaje": "Proyecto creado exitosamente"}

@router.put("/{proyecto_id}")
def actualizar_proyecto(
    proyecto_id: int,
    data: AsignacionProyectoUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_roles("administrador", "supervisor"))
):
    if not asignacion_proyecto_repo.get_by_id(db, proyecto_id):
        raise HTTPException(status_code=404, detail="Proyecto no encontrado")
    campos = {k: v for k, v in data.model_dump().items() if v is not None}
    if not campos:
        raise HTTPException(status_code=400, detail="No hay campos para actualizar")
    asignacion_proyecto_repo.update(db, proyecto_id, campos)
    return {"mensaje": "Proyecto actualizado exitosamente"}

@router.put("/{proyecto_id}/responsable")
def cambiar_responsable(
    proyecto_id: int,
    data: CambioResponsable,
    db: Session = Depends(get_db),
    user=Depends(require_roles("administrador", "supervisor"))
):
    if not asignacion_proyecto_repo.get_by_id(db, proyecto_id):
        raise HTTPException(status_code=404, detail="Proyecto no encontrado")
    asignacion_proyecto_repo.update_responsable(db, proyecto_id, data.responsable_id)
    return {"mensaje": "Responsable actualizado. Todos los predios fueron reasignados"}

@router.post("/confirmar-asignacion")
def confirmar_asignacion(
    data: ConfirmarAsignacion,
    db: Session = Depends(get_db),
    user=Depends(require_roles("administrador", "supervisor"))
):
    if not data.id_operaciones:
        raise HTTPException(status_code=400, detail="No hay predios para asignar")

    if not asignacion_proyecto_repo.get_by_id(db, data.proyecto_id):
        raise HTTPException(status_code=404, detail="Proyecto no encontrado")

    # Guardar área según el método usado
    if data.geojson:
        asignacion_proyecto_repo.guardar_area_poligono(
            db, data.proyecto_id, json.dumps(data.geojson)
        )
    elif data.codigo_manzana:
        asignacion_proyecto_repo.guardar_area_manzana(
            db, data.proyecto_id, data.codigo_manzana
        )

    # Insertar predios
    insertados = asignacion_proyecto_repo.asignar_predios(
        db,
        proyecto_id=data.proyecto_id,
        persona_id=data.persona_id,
        asignado_por=int(user.get("sub", 0)),
        predios=data.id_operaciones,
        tipo=data.tipo_asignacion
    )

    return {
        "mensaje":    f"{insertados} predios asignados exitosamente",
        "insertados": insertados,
        "duplicados": len(data.id_operaciones) - insertados
    }

@router.put("/{proyecto_id}/predios/{asignacion_id}/estado")
def cambiar_estado_predio(
    proyecto_id: int,
    asignacion_id: int,
    data: CambioEstadoPredio,
    db: Session = Depends(get_db),
    user=Depends(get_current_user)
):
    estados_validos = ("campo", "validacion", "completado")
    if data.estado not in estados_validos:
        raise HTTPException(
            status_code=400,
            detail=f"Estado inválido. Use: {estados_validos}"
        )
    from sqlalchemy import text
    db.execute(text("""
        UPDATE admin_persona_predio
        SET estado = :estado, fecha_actualizacion = NOW()
        WHERE id = :id AND proyecto_id = :pid
    """), {"estado": data.estado, "id": asignacion_id, "pid": proyecto_id})
    db.commit()
    return {"mensaje": f"Estado actualizado a '{data.estado}'"}

@router.delete("/{proyecto_id}/area")
def limpiar_area(
    proyecto_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_roles("administrador", "supervisor"))
):
    asignacion_proyecto_repo.limpiar_area(db, proyecto_id)
    return {"mensaje": "Área del proyecto limpiada"}

@router.delete("/{proyecto_id}")
def eliminar_proyecto(
    proyecto_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_roles("administrador"))
):
    if not asignacion_proyecto_repo.get_by_id(db, proyecto_id):
        raise HTTPException(status_code=404, detail="Proyecto no encontrado")
    asignacion_proyecto_repo.delete(db, proyecto_id)
    return {"mensaje": "Proyecto eliminado"}

@router.get("/{proyecto_id}/area")
def get_area_proyecto(
    proyecto_id: int,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """Devuelve el área del proyecto como GeoJSON Feature"""
    area = asignacion_proyecto_repo.get_area_geojson(db, proyecto_id)
    if not area:
        raise HTTPException(status_code=404, detail="El proyecto no tiene área definida")
    return area
 