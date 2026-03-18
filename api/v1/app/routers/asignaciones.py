from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from db.database import get_db
from core.deps import get_current_user, require_roles
from repositories import asignacion_repo
from schemas.asignacion import (
    AsignacionCreate, CambioEstado, AsignacionResponse
)

router = APIRouter(prefix="/asignaciones", tags=["asignaciones"])

@router.get("/", response_model=List[AsignacionResponse])
def listar_asignaciones(
    db: Session = Depends(get_db),
    user=Depends(get_current_user)
):
    roles    = user.get("roles", [])
    es_admin = "admin" in roles or "gerente" in roles
    persona_id = int(user["sub"])
    return asignacion_repo.get_all(db, persona_id=persona_id, es_admin=es_admin)

@router.get("/predio/{id_operacion}")
def asignaciones_por_predio(
    id_operacion: str,
    db: Session = Depends(get_db),
    user=Depends(get_current_user)
):
    return asignacion_repo.get_by_predio(db, id_operacion)

@router.post("/", status_code=201)
def crear_asignacion(
    data: AsignacionCreate,
    db: Session = Depends(get_db),
    user=Depends(require_roles("administrador"))
):
    if asignacion_repo.exists(db, data.persona_id, data.id_operacion):
        raise HTTPException(status_code=400, detail="Este predio ya está asignado a esa persona")
    asignacion_repo.create(
        db,
        persona_id=data.persona_id,
        asignado_por=int(user["sub"]),
        id_operacion=data.id_operacion,
        tipo=data.tipo_asignacion
    )
    return {"mensaje": "Predio asignado exitosamente"}

@router.put("/{asignacion_id}/estado")
def cambiar_estado(
    asignacion_id: int,
    data: CambioEstado,
    db: Session = Depends(get_db),
    user=Depends(get_current_user)
):
    asignacion_repo.update_estado(db, asignacion_id, data.estado)
    return {"mensaje": f"Estado actualizado a '{data.estado}'"}

@router.delete("/{asignacion_id}")
def eliminar_asignacion(
    asignacion_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_roles("administrador"))
):
    asignacion_repo.delete(db, asignacion_id)
    return {"mensaje": "Asignación eliminada"}