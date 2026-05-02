from pydantic import BaseModel
from typing import List


class DominioItem(BaseModel):
    code: str
    description: str


class DominioResponse(BaseModel):
    domain: str
    items: List[DominioItem]
