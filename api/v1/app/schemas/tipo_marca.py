from typing import Literal, Optional
from pydantic import BaseModel, field_validator

Categoria = Literal['FISICA', 'JURIDICA', 'ECONOMICA', 'IDENTIFICACION', 'SIG']


class TipoMarcaCreate(BaseModel):
    categoria: Categoria
    codigo: str
    significado: str

    @field_validator('codigo')
    def codigo_valido(cls, v):
        v = v.strip().upper()
        if not v:
            raise ValueError('El código no puede estar vacío')
        return v

    @field_validator('significado')
    def significado_valido(cls, v):
        if not v.strip():
            raise ValueError('El significado no puede estar vacío')
        return v.strip()


class TipoMarcaUpdate(BaseModel):
    categoria: Optional[Categoria] = None
    codigo: Optional[str] = None
    significado: Optional[str] = None
    activo: Optional[bool] = None

    @field_validator('codigo')
    def codigo_valido(cls, v):
        if v is None:
            return v
        v = v.strip().upper()
        if not v:
            raise ValueError('El código no puede estar vacío')
        return v

    @field_validator('significado')
    def significado_valido(cls, v):
        if v is None:
            return v
        if not v.strip():
            raise ValueError('El significado no puede estar vacío')
        return v.strip()


class TipoMarcaResponse(BaseModel):
    id: int
    categoria: str
    codigo: str
    significado: str
    activo: bool

    class Config:
        from_attributes = True
