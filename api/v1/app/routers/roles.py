from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from db.database import get_db
from core.deps import get_current_user, require_roles
from repositories import rol_repo
from schemas.rol import AsignarRol, RolResponse, RolCreate  # ← agregar RolCreate

router = APIRouter(prefix="/roles", tags=["roles"])

@router.get("/", response_model=List[RolResponse])
def listar_roles(
    db: Session = Depends(get_db),
    user=Depends(get_current_user)
):
    return rol_repo.get_all(db)

@router.get("/persona/{persona_id}")
def roles_de_persona(
    persona_id: int,
    db: Session = Depends(get_db),
    user=Depends(get_current_user)
):
    return rol_repo.get_roles_by_persona(db, persona_id)

@router.post("/asignar")
def asignar_rol(
    data: AsignarRol,
    db: Session = Depends(get_db),
    user=Depends(require_roles("administrador"))
):
    if rol_repo.get_rol_persona(db, data.persona_id, data.rol_id):
        raise HTTPException(status_code=400, detail="La persona ya tiene ese rol")
    rol_repo.asignar(db, data.persona_id, data.rol_id)
    return {"mensaje": "Rol asignado exitosamente"}

@router.delete("/revocar")
def revocar_rol(
    data: AsignarRol,
    db: Session = Depends(get_db),
    user=Depends(require_roles("administrador"))
):
    if not rol_repo.get_rol_persona(db, data.persona_id, data.rol_id):
        raise HTTPException(status_code=404, detail="La persona no tiene ese rol")
    rol_repo.revocar(db, data.persona_id, data.rol_id)
    return {"mensaje": "Rol revocado exitosamente"}

# ── Endpoints nuevos ────────────────────────────────────
@router.post("/", status_code=201)
def crear_rol(
    data: RolCreate,
    db: Session = Depends(get_db),
    user=Depends(require_roles("administrador"))
):
    if rol_repo.get_by_nombre(db, data.nombre):
        raise HTTPException(status_code=400, detail="Ya existe un rol con ese nombre")
    id_ = rol_repo.create(db, data.nombre)
    return {"id": id_, "mensaje": "Rol creado exitosamente"}

@router.delete("/{rol_id}")
def eliminar_rol(
    rol_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_roles("administrador"))
):
    if not rol_repo.get_by_id(db, rol_id):
        raise HTTPException(status_code=404, detail="Rol no encontrado")
    if rol_repo.tiene_personas(db, rol_id):
        raise HTTPException(status_code=400, detail="No se puede eliminar un rol con personas asignadas")
    rol_repo.delete(db, rol_id)
    return {"mensaje": "Rol eliminado exitosamente"}