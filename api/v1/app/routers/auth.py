from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from db.database import get_db
from core.security import verify_password, create_token
from schemas.auth import LoginRequest, TokenResponse
from repositories import persona_repo, rol_repo

router = APIRouter(prefix="/auth", tags=["auth"])

@router.post("/login", response_model=TokenResponse)
def login(data: LoginRequest, db: Session = Depends(get_db)):
    persona = persona_repo.get_by_identificacion(db, data.username)

    if not persona or not verify_password(data.password, persona.password_hash):
        raise HTTPException(status_code=401, detail="Credenciales incorrectas")

    if not persona.activo:
        raise HTTPException(status_code=403, detail="Usuario inactivo")

    roles = rol_repo.get_roles_by_persona(db, persona.id)

    token = create_token({
        "sub":              str(persona.id),
        "identificacion":   str(persona.identificacion),
        "nombre":           persona.primer_nombre,
        "segundo_nombre":   persona.segundo_nombre,   
        "primer_apellido":  persona.primer_apellido,   
        "segundo_apellido": persona.segundo_apellido,   
        "roles":            [r["nombre"] for r in roles]
    })
    return {"access_token": token, "token_type": "bearer"}
