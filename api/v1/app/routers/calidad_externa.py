"""
app/routers/calidad_externa.py
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from db.database import get_db
from core.deps import get_current_user
from repositories import calidad_externa_repo
from schemas.calidad_proyecto import CalidadExternaCrearSchema

router = APIRouter(prefix="/calidad-externa", tags=["Calidad Externa"])


# ── Utilidades de búsqueda ────────────────────────────────────────────────────

@router.get("/barrios")
def listar_barrios(
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user)
):
    return calidad_externa_repo.get_barrios(db)


@router.get("/manzanas/{codigo_parcial}")
def buscar_manzanas(
    codigo_parcial: str,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user)
):
    if len(codigo_parcial) < 4:
        raise HTTPException(status_code=400, detail="Ingresa al menos 4 caracteres")
    return calidad_externa_repo.get_manzanas(db, codigo_parcial)


# ── Preview de predios (antes de crear) ──────────────────────────────────────

@router.post("/predios-por-poligono")
def predios_por_poligono(
    body: dict,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """
    Recibe { geojson: GeoJSON Polygon en EPSG:4326 }.
    Retorna predios que intersectan con el área dibujada.
    """
    geojson = body.get("geojson")
    if not geojson:
        raise HTTPException(status_code=400, detail="Se requiere el campo geojson")
    return calidad_externa_repo.predios_por_poligono(db, geojson)


@router.post("/predios-por-manzanas")
def predios_por_manzanas(
    body: dict,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """
    Recibe { codigos_manzana: [str] }.
    Retorna predios + convex hull de las manzanas.
    """
    codigos = body.get("codigos_manzana", [])
    if not codigos:
        raise HTTPException(status_code=400, detail="Se requieren códigos de manzana")
    return calidad_externa_repo.predios_por_manzanas(db, codigos)


@router.post("/predios-por-barrio")
def predios_por_barrio(
    body: dict,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """
    Recibe { barrio_cod: str }.
    Retorna predios del barrio + convex hull editable.
    """
    barrio_cod = body.get("barrio_cod")
    if not barrio_cod:
        raise HTTPException(status_code=400, detail="Se requiere barrio_cod")
    return calidad_externa_repo.predios_por_barrio(db, barrio_cod)


# ── CRUD proyectos de calidad externa ────────────────────────────────────────

@router.post("/")
def crear_proyecto(
    body: CalidadExternaCrearSchema,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user)
):
    if not body.id_operaciones:
        raise HTTPException(status_code=400, detail="No hay predios seleccionados")
    if not body.area_geojson:
        raise HTTPException(status_code=400, detail="Se requiere el área geográfica")

    resultado = calidad_externa_repo.crear_proyecto_externa(
        db,
        nombre=body.nombre,
        descripcion=body.descripcion,
        area_geojson=body.area_geojson,
        id_operaciones=body.id_operaciones,
        muestra_calculada=body.muestra_calculada
    )
    return resultado


@router.get("/")
def listar_proyectos(
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user)
):
    return calidad_externa_repo.get_lista(db)


@router.get("/{pc_id}")
def detalle_proyecto(
    pc_id: int,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user)
):
    proyecto = calidad_externa_repo.get_by_id(db, pc_id)
    if not proyecto:
        raise HTTPException(status_code=404, detail="Proyecto de calidad externa no encontrado")
    return proyecto


@router.post("/{pc_id}/rerandomizar")
def rerandomizar(
    pc_id: int,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user)
):
    try:
        calidad_externa_repo.rerandomizar(db, pc_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {"ok": True, "mensaje": "Muestra rerandomizada exitosamente"}


@router.get("/{pc_id}/predios")
def predios_proyecto(
    pc_id: int,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user)
):
    return calidad_externa_repo.get_predios(db, pc_id)


@router.get("/{pc_id}/geojson")
def geojson_proyecto(
    pc_id: int,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user)
):
    return calidad_externa_repo.get_geojson(db, pc_id)