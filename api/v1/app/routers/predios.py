from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import Optional, List
from db.database import get_db
from core.deps import get_current_user
from repositories import predio_repo
from schemas.predio import PredioResponse

router = APIRouter(prefix="/predios", tags=["predios"])

@router.get("/", response_model=List[PredioResponse])
def listar_predios(
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
    estado: Optional[str]     = Query(None),
    persona_id: Optional[int] = Query(None),
    municipio: Optional[str]  = Query(None),
    npn: Optional[str]        = Query(None)
):
    return predio_repo.get_all(db, estado, persona_id, municipio, npn)

@router.get("/geojson")
def predios_geojson(
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
    persona_id: Optional[int] = Query(None)
):
    roles    = user.get("roles", [])
    es_admin = "admin" in roles or "gerente" in roles
    uid      = int(user["sub"])
    return predio_repo.get_geojson(db, persona_id, es_admin, uid)