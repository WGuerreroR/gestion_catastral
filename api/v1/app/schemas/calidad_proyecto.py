from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime


# ── Calidad Externa ───────────────────────────────────────────────────────────

class CalidadExternaCrearSchema(BaseModel):
    nombre:            str
    descripcion:       Optional[str] = None
    area_geojson:      dict           # GeoJSON Polygon/MultiPolygon en EPSG:4326
    id_operaciones:    List[str]
    muestra_calculada: int


class CalidadExternaRespuestaSchema(BaseModel):
    id:                 int
    nombre:             str
    descripcion:        Optional[str]
    estado:             str
    total_predios:      int
    muestra_calculada:  int
    fecha_creacion:     datetime
    fecha_actualizacion: datetime


# ── Compartidos ───────────────────────────────────────────────────────────────

class PreviewMuestraSchema(BaseModel):
    """Respuesta al consultar predios antes de crear el proyecto"""
    total_predios:     int
    muestra_calculada: int
    id_operaciones:    List[str]


class PreviewMuestraConGeomSchema(PreviewMuestraSchema):
    """Igual pero incluye GeoJSON de los predios y el área"""
    geojson_predios: Optional[dict] = None
    hull_geojson:    Optional[dict] = None