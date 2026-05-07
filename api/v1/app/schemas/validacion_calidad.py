from datetime import datetime
from typing import Literal, Optional, List
from pydantic import BaseModel, Field, field_validator


Entidad      = Literal['predio', 'terreno', 'interesado', 'unidad_construccion']
EstadoJob    = Literal['pending', 'running', 'done', 'error', 'cancelled']
AlcanceTipo  = Literal['todo', 'predios', 'manzanas']


# ── Reglas ──────────────────────────────────────────────────────────────────

class ReglaBase(BaseModel):
    codigo:       str = Field(..., min_length=1, max_length=50)
    nombre:       str = Field(..., min_length=1, max_length=200)
    descripcion:  Optional[str] = None
    entidad:      Entidad
    sql_template: str = Field(..., min_length=1)
    activa:       bool = True
    orden:        int  = 0

    @field_validator('codigo', 'nombre')
    def trim_no_vacio(cls, v):
        if not v or not v.strip():
            raise ValueError('No puede estar vacío')
        return v.strip()


class ReglaCreate(ReglaBase):
    # Obligatorio al crear: cada regla debe declarar el tipo de marca que se
    # crea cuando un revisor convierte el error en marca.
    tipo_marca_id: int = Field(..., description="ID de admin_tipo_marca; obligatorio al crear regla")


class ReglaUpdate(BaseModel):
    codigo:        Optional[str] = None
    nombre:        Optional[str] = None
    descripcion:   Optional[str] = None
    entidad:       Optional[Entidad] = None
    sql_template:  Optional[str] = None
    activa:        Optional[bool] = None
    orden:         Optional[int]  = None
    tipo_marca_id: Optional[int]  = None  # None = no cambiar (Pydantic exclude_unset)


class ReglaResponse(BaseModel):
    id:              int
    codigo:          str
    nombre:          str
    descripcion:     Optional[str] = None
    entidad:         Entidad
    sql_template:    str
    activa:          bool
    orden:           int
    tipo_marca_id:   Optional[int] = None
    tipo_marca_codigo:    Optional[str] = None
    tipo_marca_categoria: Optional[str] = None
    creado_en:       datetime
    creado_por:      Optional[str] = None
    actualizado_en:  datetime
    actualizado_por: Optional[str] = None

    class Config:
        from_attributes = True


class ReglaListItem(BaseModel):
    id:          int
    codigo:      str
    nombre:      str
    entidad:     Entidad
    activa:      bool
    orden:       int
    tipo_marca_id:        Optional[int] = None
    tipo_marca_codigo:    Optional[str] = None
    tipo_marca_categoria: Optional[str] = None

    class Config:
        from_attributes = True


# ── Jobs ────────────────────────────────────────────────────────────────────

class JobCreate(BaseModel):
    alcance_tipo:           AlcanceTipo
    alcance_valores:        List[str] = Field(default_factory=list)
    reglas_omitidas:        List[int] = Field(default_factory=list)
    # Si TRUE (default), un predio solo se promueve a validado.lc_predio_p
    # si las 6 columnas calidad_* están en 1.
    aplicar_filtro_calidad: bool = True

    @field_validator('alcance_valores')
    def valida_alcance(cls, v, info):
        tipo = info.data.get('alcance_tipo')
        if tipo == 'todo' and v:
            raise ValueError("alcance_valores debe ser vacío cuando alcance_tipo='todo'")
        if tipo in ('predios', 'manzanas') and not v:
            raise ValueError(f"alcance_valores requiere ≥1 elemento cuando alcance_tipo='{tipo}'")
        # normalizar (trim, dedupe, descartar vacíos)
        return list({s.strip() for s in v if s and s.strip()})


class JobResponse(BaseModel):
    id:                     int
    estado:                 EstadoJob
    alcance_tipo:           AlcanceTipo
    alcance_valores:        List[str]
    reglas_omitidas:        List[int]
    progreso:               int
    predios_total:          Optional[int] = None
    predios_validos:        Optional[int] = None
    errores_total:          Optional[int] = None
    iniciado_en:            datetime
    finalizado_en:          Optional[datetime] = None
    error_message:          Optional[str] = None
    cancelar_solicitado:    bool
    creado_por:             Optional[str] = None
    aplicar_filtro_calidad: bool = True
    regla_actual:           Optional[str] = None
    oculto:                 bool = False
    migrado_en:             Optional[datetime] = None

    class Config:
        from_attributes = True


class JobListItem(BaseModel):
    id:                     int
    estado:                 EstadoJob
    alcance_tipo:           AlcanceTipo
    alcance_valores:        List[str]
    progreso:               int
    predios_total:          Optional[int] = None
    predios_validos:        Optional[int] = None
    errores_total:          Optional[int] = None
    iniciado_en:            datetime
    finalizado_en:          Optional[datetime] = None
    creado_por:             Optional[str] = None
    aplicar_filtro_calidad: bool = True
    regla_actual:           Optional[str] = None
    oculto:                 bool = False
    migrado_en:             Optional[datetime] = None

    class Config:
        from_attributes = True


# ── Preview de calidad antes de crear job ──────────────────────────────────

class PreviewCalidadRequest(BaseModel):
    alcance_tipo:    AlcanceTipo
    alcance_valores: List[str] = Field(default_factory=list)


class PredioSinCalidad(BaseModel):
    numero_predial:      str
    id_operacion:        str
    columnas_pendientes: List[str]


class PreviewCalidadResponse(BaseModel):
    total_alcance:          int
    sin_calidad:            int
    items:                  List[PredioSinCalidad]
    overflow:               bool
    # Solo para alcance_tipo='predios': número de identificadores que el
    # usuario pegó vs los que efectivamente existen en lc_predio_p.
    solicitados:            Optional[int] = None
    valores_no_encontrados: List[str]     = Field(default_factory=list)


class JobCreateResponse(BaseModel):
    job_id: int


class CancelarJobResponse(BaseModel):
    """Response del endpoint POST /jobs/{id}/cancelar.
    El endpoint es autoritativo: cuando responde, el job ya está en estado
    terminal (`cancelled`)."""
    job:             JobResponse
    forzado:         bool
    query_cancelada: bool
    mensaje:         str


# ── Errores ─────────────────────────────────────────────────────────────────

class LogErrorResponse(BaseModel):
    id:             int
    numero_predial: Optional[str] = None
    regla:          Optional[str] = None
    descripcion:    Optional[str] = None
    fecha_registro: datetime

    class Config:
        from_attributes = True


class LogErroresPaginados(BaseModel):
    total: int
    items: List[LogErrorResponse]


# ── Excepciones (errores aceptados/justificados) ────────────────────────────

class ExcepcionCreate(BaseModel):
    numero_predial: str = Field(..., min_length=1, max_length=50)
    regla:          Optional[str] = Field(None, max_length=50)
    motivo:         Optional[str] = None

    @field_validator('numero_predial')
    def trim_np(cls, v):
        v = (v or '').strip()
        if not v:
            raise ValueError('numero_predial no puede estar vacío')
        return v


class ExcepcionResponse(BaseModel):
    id:             int
    job_id:         int
    numero_predial: str
    regla:          Optional[str] = None
    motivo:         Optional[str] = None
    creado_en:      datetime
    creado_por:     Optional[str] = None

    class Config:
        from_attributes = True


class MetricasJob(BaseModel):
    predios_total:   int
    predios_validos: int
    errores_total:   int


class ExcepcionCreateResponse(BaseModel):
    excepcion: ExcepcionResponse
    metricas:  MetricasJob


class ExcepcionDeleteResponse(BaseModel):
    ok:       bool
    metricas: MetricasJob


# ── Errores agrupados por predio ────────────────────────────────────────────

class ErrorEnPredio(BaseModel):
    id:               int
    regla:            Optional[str] = None
    descripcion:      Optional[str] = None
    fecha_registro:   datetime
    excluido:         bool
    marca_id:         Optional[int] = None  # marca creada desde este error
    tiene_tipo_marca: bool = False          # ¿la regla tiene tipo_marca configurado?


class PredioConErrores(BaseModel):
    numero_predial:        str
    id_operacion:          Optional[str] = None
    errores_total:         int
    errores_activos:       int
    predio_excluido_total: bool
    errores:               List[ErrorEnPredio]


class ErroresAgrupadosResponse(BaseModel):
    total_predios:    int
    items:            List[PredioConErrores]
    errores_globales: List[LogErrorResponse]


# ── Conversión de errores a marcas ──────────────────────────────────────────

EstadoConversion = Literal['creada', 'duplicada', 'sin_tipo', 'error']


class CrearMarcasResultadoItem(BaseModel):
    log_id:   int
    regla:    Optional[str] = None
    estado:   EstadoConversion
    marca_id: Optional[int] = None
    motivo:   Optional[str] = None


class CrearMarcasResponse(BaseModel):
    creadas:    int
    duplicadas: int
    sin_tipo:   int
    errores:    int
    items:      List[CrearMarcasResultadoItem]


class CrearMarcasMasivoResponse(BaseModel):
    """Resumen de la creación masiva de marcas a nivel job."""
    predios_procesados: int
    creadas:            int
    duplicadas:         int
    sin_tipo:           int
    errores:            int


class ExclusionMasivaRequest(BaseModel):
    motivo: Optional[str] = None


class ExclusionMasivaResponse(BaseModel):
    predios_excluidos: int
    metricas:          MetricasJob
