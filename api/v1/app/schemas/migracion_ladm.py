from datetime import datetime
from typing import Literal, Optional, List
from pydantic import BaseModel, Field, field_validator


EstadoJob = Literal['pending', 'running', 'done', 'error', 'cancelled']


# ── Conexiones ─────────────────────────────────────────────────────────────

class ConexionBase(BaseModel):
    nombre:  str = Field(..., min_length=1, max_length=100)
    host:    str = Field(..., min_length=1, max_length=255)
    port:    int = Field(5432, ge=1, le=65535)
    dbname:  str = Field(..., min_length=1, max_length=100)
    usuario: str = Field(..., min_length=1, max_length=100)
    notas:   Optional[str] = None

    @field_validator('nombre', 'host', 'dbname', 'usuario')
    def trim_no_vacio(cls, v):
        if not v or not v.strip():
            raise ValueError('No puede estar vacío')
        return v.strip()


class ConexionCreate(ConexionBase):
    password: str = Field(..., min_length=1)


class ConexionUpdate(BaseModel):
    nombre:   Optional[str] = None
    host:     Optional[str] = None
    port:     Optional[int] = Field(None, ge=1, le=65535)
    dbname:   Optional[str] = None
    usuario:  Optional[str] = None
    password: Optional[str] = None
    notas:    Optional[str] = None


class ConexionResponse(BaseModel):
    id:              int
    nombre:          str
    host:            str
    port:            int
    dbname:          str
    usuario:         str
    notas:           Optional[str] = None
    creado_en:       datetime
    creado_por:      Optional[str] = None
    actualizado_en:  datetime
    actualizado_por: Optional[str] = None

    class Config:
        from_attributes = True


class ConexionListItem(BaseModel):
    id:      int
    nombre:  str
    host:    str
    port:    int
    dbname:  str
    usuario: str

    class Config:
        from_attributes = True


# ── Test de conexión ───────────────────────────────────────────────────────

class ConexionTestRequest(BaseModel):
    host:     str
    port:     int = 5432
    dbname:   str
    usuario:  str
    password: str


class ConexionTestResponse(BaseModel):
    ok:      bool
    mensaje: str
    error:   Optional[str] = None


# ── Jobs ────────────────────────────────────────────────────────────────────

class JobCreate(BaseModel):
    conexion_id:     Optional[int] = None  # None ⇒ usar DATABASE_URL del backend
    esquema_origen:  str = Field('validado', min_length=1, max_length=63)
    esquema_destino: str = Field('ladm',     min_length=1, max_length=63)
    tabla_dominios:  str = Field('homologacion1_0_1_2', min_length=1, max_length=100)


class JobResponse(BaseModel):
    id:                  int
    conexion_id:         Optional[int] = None
    conexion_nombre:     Optional[str] = None
    esquema_origen:      str
    esquema_destino:     str
    tabla_dominios:      str
    estado:              EstadoJob
    progreso:            int
    tabla_actual:        Optional[str] = None
    tabla_actual_idx:    Optional[int] = None
    total_tablas:        Optional[int] = None
    iniciado_en:         datetime
    finalizado_en:       Optional[datetime] = None
    error_message:       Optional[str] = None
    cancelar_solicitado: bool
    creado_por:          Optional[str] = None

    class Config:
        from_attributes = True


class JobListItem(BaseModel):
    id:               int
    conexion_nombre:  Optional[str] = None
    esquema_origen:   str
    esquema_destino:  str
    estado:           EstadoJob
    progreso:         int
    tabla_actual:     Optional[str] = None
    tabla_actual_idx: Optional[int] = None
    total_tablas:     Optional[int] = None
    iniciado_en:      datetime
    finalizado_en:    Optional[datetime] = None
    creado_por:       Optional[str] = None

    class Config:
        from_attributes = True


class JobCreateResponse(BaseModel):
    job_id: int


# ── Errores ─────────────────────────────────────────────────────────────────

class LogErrorResponse(BaseModel):
    id:             int
    tabla:          Optional[str] = None
    fila_json:      Optional[dict] = None
    error_reason:   Optional[str] = None
    fecha_registro: datetime

    class Config:
        from_attributes = True


class LogErroresPaginados(BaseModel):
    total: int
    items: List[LogErrorResponse]
