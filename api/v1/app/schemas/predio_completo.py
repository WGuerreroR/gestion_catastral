from pydantic import BaseModel, ConfigDict
from typing import Any, Optional, List, Dict


class _Permissive(BaseModel):
    """Base permissiva: aceptamos columnas extras del modelo LADM sin
    listar cada una en el schema (LADM-COL tiene cientos)."""
    model_config = ConfigDict(extra="allow")


class CaracteristicasUnidad(_Permissive):
    pass


class Unidad(_Permissive):
    geometry: Optional[Dict[str, Any]] = None
    caracteristicas: Optional[CaracteristicasUnidad] = None


class Terreno(_Permissive):
    geometry: Optional[Dict[str, Any]] = None


class Predio(_Permissive):
    geometry: Optional[Dict[str, Any]] = None


class Interesado(_Permissive):
    pass


class PredioCompletoMeta(BaseModel):
    encontrado_por: str
    total_unidades: int
    total_interesados: int
    tiene_geometria_terreno: bool
    fotos_referenciadas: int


class PredioCompletoResponse(BaseModel):
    predio: Predio
    terreno: Optional[Terreno] = None
    unidades: List[Unidad] = []
    interesados: List[Interesado] = []
    meta: PredioCompletoMeta

    model_config = ConfigDict(populate_by_name=True)
