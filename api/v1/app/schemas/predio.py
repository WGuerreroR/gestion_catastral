from pydantic import BaseModel
from typing import Optional

class PredioResponse(BaseModel):
    id_operacion: str
    npn: Optional[str] = None
    npn_etiqueta: Optional[str] = None
    nombre_predio: Optional[str] = None
    municipio: Optional[str] = None
    departamento: Optional[str] = None
    numero_predial: Optional[str] = None
    matricula_inmobiliaria: Optional[str] = None
    area_total_terreno: Optional[float] = None
    avaluo_catastral: Optional[float] = None
    estado: Optional[str] = None
    tipo_asignacion: Optional[str] = None
    asignado_a: Optional[str] = None

    class Config:
        from_attributes = True