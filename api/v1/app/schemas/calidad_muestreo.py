"""
Schemas Pydantic del muestreo de calidad por asignación.
Modelo simplificado, espejo de schemas/calidad_proyecto.py (flujo viejo).
"""

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel


class AsignacionDisponible(BaseModel):
    id: int
    clave_proyecto: str
    descripcion: Optional[str] = None
    responsable_id: Optional[int] = None
    responsable: Optional[str] = None
    fecha_entrada_validacion: Optional[datetime] = None
    total_predios: int


class PreviewRequest(BaseModel):
    asignacion_ids: list[int]
    margen_error: float = 0.10


class PreviewPredio(BaseModel):
    id_operacion: str
    npn: Optional[str] = None
    nombre_predio: Optional[str] = None
    municipio: Optional[str] = None


class PreviewResponse(BaseModel):
    total_predios: int
    muestra_calculada: int
    id_operaciones: list[str]
    geojson_predios: dict[str, Any]
    area_geojson: Optional[dict[str, Any]] = None


class ActualizarProyectoRequest(BaseModel):
    nombre: Optional[str] = None
    descripcion: Optional[str] = None


class CrearProyectoRequest(BaseModel):
    nombre: str
    descripcion: Optional[str] = None
    asignacion_ids: list[int]
    id_operaciones: list[str]
    muestra_calculada: int
    margen_error: float = 0.10
    nivel_confianza: float = 0.95


class RerandomizarRequest(BaseModel):
    margen_error: Optional[float] = None


class MarcarValidadoRequest(BaseModel):
    validado: bool


class MarcarValidadoResponse(BaseModel):
    validados: int
    total_muestra: int
    todos_validados: bool


class CerrarProyectoResponse(BaseModel):
    predios_marcados: int
    fecha_cierre: datetime


class ProyectoResumen(BaseModel):
    id: int
    nombre: str
    descripcion: Optional[str] = None
    estado: str
    total_predios: int
    muestra_calculada: int
    margen_error: Optional[float] = None
    nivel_confianza: Optional[float] = None
    fecha_creacion: datetime
    fecha_actualizacion: datetime
    fecha_cierre: Optional[datetime] = None
    cerrado_por: Optional[int] = None
    creado_por: Optional[int] = None
    creado_por_nombre: Optional[str] = None
    asignaciones_count: int = 0
    validados_count: int = 0


class ProyectoDetalle(ProyectoResumen):
    area_geojson: Optional[dict[str, Any]] = None


class AsignacionDeProyecto(BaseModel):
    asignacion_id: int
    clave_proyecto: str
    descripcion: Optional[str] = None
    responsable: Optional[str] = None
    estado_asignacion: str
    total_predios: int


class PredioDeProyecto(BaseModel):
    id_operacion: str
    npn: Optional[str] = None
    npn_etiqueta: Optional[str] = None
    nombre_predio: Optional[str] = None
    municipio: Optional[str] = None
    en_muestra: bool
    validado: bool = False
    fecha_validacion: Optional[datetime] = None
    validado_por: Optional[int] = None
