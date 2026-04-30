from pydantic import BaseModel, field_validator
from typing import Optional
from datetime import datetime

class AsignacionCreate(BaseModel):
    persona_id: int
    id_operacion: str
    tipo_asignacion: str = "alfanumerica"

    @field_validator("tipo_asignacion")
    def tipo_valido(cls, v):
        if v not in ("espacial", "alfanumerica"):
            raise ValueError("tipo_asignacion debe ser 'espacial' o 'alfanumerica'")
        return v

class CambioEstado(BaseModel):
    estado: str

    @field_validator("estado")
    def estado_valido(cls, v):
        validos = ("campo", "sincronizado", "validacion", "completado")
        if v not in validos:
            raise ValueError(f"Estado inválido. Use: {validos}")
        return v

class AsignacionResponse(BaseModel):
    id: int
    id_operacion: str
    tipo_asignacion: str
    estado: str
    fecha_asignacion: datetime
    fecha_actualizacion: Optional[datetime] = None
    persona: Optional[str] = None
    asignado_por: Optional[str] = None

    class Config:
        from_attributes = True