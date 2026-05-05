from datetime import datetime
from typing import Literal, Optional, List
from pydantic import BaseModel, field_validator


Categoria      = Literal['FISICA', 'JURIDICA', 'ECONOMICA', 'IDENTIFICACION', 'SIG']
Prioridad      = Literal['ALTA', 'MEDIA', 'BAJA']
EstadoEsperado = Literal['AJUSTE', 'ANALISIS', 'CAMPO', 'DOCUMENTAL', 'OFICINA', 'VERIFICACION']
EstadoMarca    = Literal['ABIERTA', 'CERRADA']
TipoEvento     = Literal['CREACION', 'CIERRE', 'REAPERTURA']


class MarcaPredioCreate(BaseModel):
    categoria:           Categoria
    tipo_marca_id:       int
    descripcion_novedad: str
    fuente_deteccion:    Optional[str] = None
    prioridad:           Prioridad
    accion_sugerida:     Optional[str] = None
    responsable_id:      Optional[int] = None
    estado_esperado:     EstadoEsperado
    observacion:         Optional[str] = None

    @field_validator('descripcion_novedad')
    def descripcion_no_vacia(cls, v):
        if not v or not v.strip():
            raise ValueError('La descripción de la novedad es obligatoria')
        return v.strip()


class MarcaPredioCambioEstadoInput(BaseModel):
    observacion: Optional[str] = None


class MarcaPredioResponse(BaseModel):
    id:                     int
    id_operacion:           str
    categoria:              Categoria
    tipo_marca_id:          int
    tipo_marca_codigo:      str
    tipo_marca_significado: str
    descripcion_novedad:    str
    fuente_deteccion:       Optional[str] = None
    prioridad:              Prioridad
    accion_sugerida:        Optional[str] = None
    responsable_id:         Optional[int] = None
    responsable_nombre:     Optional[str] = None
    estado_esperado:        EstadoEsperado
    observacion:            Optional[str] = None
    estado:                 EstadoMarca
    fecha_creacion:         datetime
    creado_por:             int
    creado_por_nombre:      Optional[str] = None

    class Config:
        from_attributes = True


class MarcaEventoResponse(BaseModel):
    id:             int
    tipo_evento:    TipoEvento
    fecha:          datetime
    usuario_id:     int
    usuario_nombre: Optional[str] = None
    observacion:    Optional[str] = None

    class Config:
        from_attributes = True
