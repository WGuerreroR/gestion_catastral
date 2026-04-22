from pydantic import BaseModel, field_validator
from typing import Optional
from datetime import datetime

ESTADOS = ("campo", "validacion", "finalizado")

class AsignacionProyectoCreate(BaseModel):
    clave_proyecto: str
    descripcion:    Optional[str] = None
    estado:         str = "campo"
    responsable_id: int

    @field_validator("clave_proyecto")
    def clave_valida(cls, v):
        if not v.strip():
            raise ValueError("La clave no puede estar vacía")
        return v.strip().upper()

    @field_validator("estado")
    def estado_valido(cls, v):
        if v not in ESTADOS:
            raise ValueError(f"Estado inválido. Use: {ESTADOS}")
        return v

class AsignacionProyectoUpdate(BaseModel):
    descripcion:    Optional[str] = None
    estado:         Optional[str] = None
    responsable_id: Optional[int] = None

    @field_validator("estado")
    def estado_valido(cls, v):
        if v and v not in ESTADOS:
            raise ValueError(f"Estado inválido. Use: {ESTADOS}")
        return v

class AsignacionProyectoResponse(BaseModel):
    id:                  int
    clave_proyecto:      str
    descripcion:         Optional[str] = None
    estado:              str
    responsable_id:      Optional[int] = None
    responsable:         Optional[str] = None
    total_predios:       Optional[int] = 0
    fecha_creacion:      Optional[datetime] = None
    fecha_actualizacion: Optional[datetime] = None

    class Config:
        from_attributes = True

class CambioResponsable(BaseModel):
    responsable_id: int


class QFieldStatusResponse(BaseModel):
    proyecto_id:       int
    cloud_project_id:  Optional[str] = None
    nombre:            str
    estado:            str            # "sincronizado" | "desactualizado" | "sin_cloud"
    url_cloud:         Optional[str] = None


class QFieldSincronizarResponse(BaseModel):
    mensaje:           str
    cloud_project_id:  str
    url_cloud:         str