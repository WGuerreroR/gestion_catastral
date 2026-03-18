from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from db.database import get_db
from core.deps import get_current_user
from repositories import spatial_repo
from pydantic import BaseModel

router = APIRouter(prefix="/spatial", tags=["spatial"])

class PoligonoBody(BaseModel):
    geojson: dict

@router.post("/buscar-por-poligono")
def buscar_por_poligono(
    body: PoligonoBody,
    db: Session = Depends(get_db),
    user=Depends(get_current_user)
):
    predios = spatial_repo.predios_por_poligono(db, body.geojson)
    return {
        "total":   len(predios),
        "predios": predios
    }

@router.get("/buscar-por-manzana/{codigo}")
def buscar_por_manzana(
    codigo: str,
    db: Session = Depends(get_db),
    user=Depends(get_current_user)
):
    if len(codigo) < 6:
        raise HTTPException(status_code=400, detail="Mínimo 6 caracteres")

    manzana = spatial_repo.get_manzana_geojson(db, codigo)
    if not manzana:
        raise HTTPException(status_code=404, detail="Manzana no encontrada")

    predios = spatial_repo.predios_por_manzana(db, codigo)
    return {
        "manzana": manzana,
        "total":   len(predios),
        "predios": predios
    }

@router.get("/manzanas/{texto}")
def buscar_manzanas(
    texto: str,
    db: Session = Depends(get_db),
    user=Depends(get_current_user)
):
    if len(texto) < 6:
        raise HTTPException(status_code=400, detail="Mínimo 6 caracteres")
    return spatial_repo.buscar_manzanas(db, texto)