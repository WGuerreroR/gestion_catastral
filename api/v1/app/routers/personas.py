from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from db.database import get_db
from core.deps import get_current_user, require_roles
from core.security import verify_password, hash_password
from repositories import persona_repo
from schemas.persona import (
    PersonaCreate, PersonaUpdate,
    CambioPassword, PersonaResponse,SetPasswordAdmin
)

router = APIRouter(prefix="/personas", tags=["personas"])

@router.get("/", response_model=List[PersonaResponse])
def listar_personas(
    db: Session = Depends(get_db),
    user=Depends(require_roles("administrador"))
):
    return persona_repo.get_all(db)

@router.get("/{persona_id}", response_model=PersonaResponse)
def obtener_persona(
    persona_id: int,
    db: Session = Depends(get_db),
    user=Depends(get_current_user)
):
    persona = persona_repo.get_by_id(db, persona_id)
    if not persona:
        raise HTTPException(status_code=404, detail="Persona no encontrada")
    return persona

@router.post("/", status_code=201)
def crear_persona(
    data: PersonaCreate,
    db: Session = Depends(get_db),
    #user=Depends(require_roles("administrador"))
):
    if persona_repo.get_by_identificacion(db, data.identificacion):
        raise HTTPException(status_code=400, detail="Identificación ya registrada")
    id_ = persona_repo.create(db, data.model_dump())
    return {"id": id_, "mensaje": "Persona creada exitosamente"}

@router.put("/{persona_id}")
def actualizar_persona(
    persona_id: int,
    data: PersonaUpdate,
    db: Session = Depends(get_db),
    #user=Depends(require_roles("administrador"))
):
    campos = {k: v for k, v in data.model_dump().items() if v is not None}
    if not campos:
        raise HTTPException(status_code=400, detail="No hay campos para actualizar")
    if not persona_repo.get_by_id(db, persona_id):
        raise HTTPException(status_code=404, detail="Persona no encontrada")
    persona_repo.update(db, persona_id, campos)
    return {"mensaje": "Persona actualizada exitosamente"}

@router.delete("/{persona_id}")
def desactivar_persona(
    persona_id: int,
    db: Session = Depends(get_db),
    #user=Depends(require_roles("administrador"))
):
    if not persona_repo.get_by_id(db, persona_id):
        raise HTTPException(status_code=404, detail="Persona no encontrada")
    persona_repo.deactivate(db, persona_id)
    return {"mensaje": "Persona desactivada"}

@router.put("/{persona_id}/password")
def cambiar_password(
    persona_id: int,
    data: CambioPassword,
    db: Session = Depends(get_db),
    user=Depends(get_current_user)
):
    user_id = int(user.get("sub", 0))
    roles   = user.get("roles", [])

    if user_id != persona_id and "admin" not in roles:
        raise HTTPException(status_code=403, detail="Sin permiso para cambiar esta contraseña")

    # Verificar que existe la persona
    if not persona_repo.get_by_id(db, persona_id):
        raise HTTPException(status_code=404, detail="Persona no encontrada")

    # Traer solo el hash
    password_hash = persona_repo.get_password_hash(db, persona_id)
    if not password_hash:
        raise HTTPException(status_code=400, detail="Esta persona no tiene contraseña configurada")

    if not verify_password(data.password_actual, password_hash):
        raise HTTPException(status_code=400, detail="Contraseña actual incorrecta")

    persona_repo.update_password(db, persona_id, hash_password(data.password_nueva))
    return {"mensaje": "Contraseña actualizada exitosamente"}


@router.get("/{persona_id}/predios")
def predios_de_persona(
    persona_id: int,
    db: Session = Depends(get_db),
    user=Depends(get_current_user)
):
    return persona_repo.get_predios(db, persona_id)



@router.put("/{persona_id}/set-password")
def set_password_admin(
    persona_id: int,
    data: SetPasswordAdmin,
    db: Session = Depends(get_db),
    user=Depends(require_roles("admin"))  # solo admin
):
    if not persona_repo.get_by_id(db, persona_id):
        raise HTTPException(status_code=404, detail="Persona no encontrada")
    persona_repo.set_password_admin(db, persona_id, data.password_nueva)
    return {"mensaje": "Contraseña actualizada por administrador"}


@router.put("/{persona_id}/activar")
def activar_persona(
    persona_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_roles("administrador"))
):
    if not persona_repo.get_by_id(db, persona_id):
        raise HTTPException(status_code=404, detail="Persona no encontrada")
    persona_repo.activate(db, persona_id)
    return {"mensaje": "Persona activada exitosamente"}