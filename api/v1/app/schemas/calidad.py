
from pydantic import BaseModel
from typing import Optional
from enum import IntEnum


class ValorCalidad(IntEnum):
    sin_revisar = 0
    aprobado    = 1


class ActualizarCalidadSchema(BaseModel):
    campo: str
    valor: ValorCalidad


class ActualizarObservacionSchema(BaseModel):
    campo: str        # revisar_campo | revisar_fisica | revisar_juridica | revisar_sig
    texto: Optional[str] = None
