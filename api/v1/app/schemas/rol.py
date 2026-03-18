from pydantic import BaseModel, field_validator

class RolCreate(BaseModel):
    nombre: str

    @field_validator("nombre")
    def nombre_valido(cls, v):
        if not v.strip():
            raise ValueError("El nombre no puede estar vacío")
        return v.strip().lower()

class RolResponse(BaseModel):
    id: int
    nombre: str

    class Config:
        from_attributes = True

class AsignarRol(BaseModel):
    persona_id: int
    rol_id: int