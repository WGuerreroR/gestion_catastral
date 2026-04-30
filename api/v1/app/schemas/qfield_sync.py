"""
app/schemas/qfield_sync.py

Schemas Pydantic v2 para los endpoints de sincronización offline.
Estilo consistente con schemas/asignacion_proyecto.py: from_attributes=True
en los Response, separación de Request/Response, validators con
@field_validator.
"""

from pydantic import BaseModel, Field
from typing import Optional, Any
from datetime import datetime


class CapaPreview(BaseModel):
    """Conteos de cambios pendientes por capa (preview, sin aplicar)."""
    added: int = 0
    updated_attrs_features: int = 0
    updated_geom_features: int = 0
    removed: int = 0


class CapaInspeccionada(BaseModel):
    """Resumen de una capa detectada en el GPKG."""
    layer_id: int
    qgis_table: str
    postgis_table: str
    is_editable: bool
    geom_col: Optional[str] = None
    feature_count: int
    schema_cols: int


class InspeccionResponse(BaseModel):
    """Respuesta de POST /offline/inspeccionar-paquete (síncrono)."""
    valido: bool
    archivo_zip: str
    estrategia: Optional[str] = None
    fotos_en_paquete: int = 0
    capas: dict[str, CapaInspeccionada] = Field(default_factory=dict)
    preview: dict[str, CapaPreview] = Field(default_factory=dict)
    extra_files: list[str] = Field(default_factory=list)
    advertencias: list[str] = Field(default_factory=list)
    errores: list[str] = Field(default_factory=list)


# ── Resultado de aplicar el sync (vendrá del Iter 3 en adelante) ────────────

class ResumenCapa(BaseModel):
    added: int = 0
    updated: int = 0
    deleted: int = 0
    errors: int = 0


class ResumenFotos(BaseModel):
    encontradas_en_paquete: int = 0
    referenciadas_en_bd: int = 0
    copiadas_nuevas: int = 0
    skip_idem: int = 0
    colisiones_nombre: int = 0
    huerfanas_copiadas: int = 0
    faltantes_referenciadas: int = 0
    fallidas: int = 0


class TransicionEstado(BaseModel):
    anterior: Optional[str] = None
    nuevo: Optional[str] = None
    aplicada: bool = False
    motivo: Optional[str] = None


class EncolarResponse(BaseModel):
    """Respuesta 202 de POST /offline/aplicar-cambios."""
    sync_id: int
    asignacion_id: int
    estado: str  # 'encolado'
    mensaje: str


# ── Historial ───────────────────────────────────────────────────────────────

class SyncHistoryItem(BaseModel):
    """Fila de la lista paginada de historial."""
    id: int
    fecha_sync: Optional[datetime] = None
    usuario: Optional[str] = None
    paquete_nombre: Optional[str] = None
    paquete_hash: Optional[str] = None
    estado: Optional[str] = None
    estrategia_diff: Optional[str] = None
    forzado: bool = False
    origen: Optional[str] = None
    estado_anterior: Optional[str] = None
    estado_nuevo: Optional[str] = None

    class Config:
        from_attributes = True


class SyncHistoryDetalle(SyncHistoryItem):
    """Detalle completo: incluye resumen, fotos_resumen, advertencias, errores."""
    asignacion_id: Optional[int] = None
    resumen: Optional[Any] = None         # jsonb → dict | list
    fotos_resumen: Optional[Any] = None
    advertencias: Optional[Any] = None    # lista de strings
    error_detalle: Optional[str] = None
