from pydantic import BaseModel, field_validator
from typing import Optional, List

class PersonaCreate(BaseModel):
    identificacion: int
    primer_nombre: str
    segundo_nombre: Optional[str] = None
    primer_apellido: str
    segundo_apellido: Optional[str] = None
    password: str

    @field_validator("primer_nombre", "primer_apellido")
    def no_vacio(cls, v):
        if not v.strip():
            raise ValueError("No puede estar vacío")
        return v.strip().title()

    @field_validator("segundo_nombre", "segundo_apellido", mode="before")
    def limpiar_opcional(cls, v):
        if v:
            return v.strip().title()
        return v

class PersonaUpdate(BaseModel):
    primer_nombre: Optional[str] = None
    segundo_nombre: Optional[str] = None
    primer_apellido: Optional[str] = None
    segundo_apellido: Optional[str] = None
    activo: Optional[bool] = None

class CambioPassword(BaseModel):
    password_actual: str
    password_nueva: str

    @field_validator("password_nueva")
    def password_segura(cls, v):
        if len(v) < 8:
            raise ValueError("La contraseña debe tener al menos 8 caracteres")
        return v

class PersonaResponse(BaseModel):
    id: int
    identificacion: int
    primer_nombre: str
    segundo_nombre: Optional[str] = None
    primer_apellido: str
    segundo_apellido: Optional[str] = None
    activo: bool
    roles: List[str] = []

    class Config:
        from_attributes = True

class SetPasswordAdmin(BaseModel):
    password_nueva: str

    @field_validator("password_nueva")
    def password_segura(cls, v):
        if len(v) < 8:
            raise ValueError("Mínimo 8 caracteres")
        return v