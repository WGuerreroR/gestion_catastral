"""
app/routers/calidad.py
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from db.database import get_db
from core.deps import get_current_user
from repositories import calidad_repo, marca_predio_repo
from schemas.calidad import ActualizarCalidadSchema, ActualizarObservacionSchema

router = APIRouter(prefix="/calidad", tags=["Calidad"])

# Mapeo de campo de calidad → categoría de marca. Aprobar (valor=1)
# un campo con categoría asociada queda bloqueado si el predio tiene
# marcas abiertas en esa categoría. 'calidad_campo' no entra: no
# tiene categoría de marca.
CAMPO_A_CATEGORIA = {
    "calidad_identificacion": "IDENTIFICACION",
    "calidad_sig":            "SIG",
    "calidad_fisica":         "FISICA",
    "calidad_juridica":       "JURIDICA",
    "calidad_economica":      "ECONOMICA",
}


@router.get("/predio/{numero_predial}")
def buscar_predio(
    numero_predial: str,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user)
):
    predio = calidad_repo.get_by_numero_predial(db, numero_predial)
    if not predio:
        raise HTTPException(
            status_code=404,
            detail=f"No se encontró ningún predio con número predial: {numero_predial}"
        )
    return predio


@router.patch("/predio/{id_operacion}/calidad")
def actualizar_calidad(
    id_operacion: str,
    body: ActualizarCalidadSchema,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """Aprueba o revierte un aspecto de calidad"""
    if body.valor == 1 and body.campo in CAMPO_A_CATEGORIA:
        categoria = CAMPO_A_CATEGORIA[body.campo]
        if marca_predio_repo.tiene_marca_abierta_en_categoria(db, id_operacion, categoria):
            raise HTTPException(
                status_code=400,
                detail=(
                    f"No se puede aprobar '{body.campo}': el predio tiene "
                    f"marcas abiertas en categoría {categoria}."
                ),
            )
    try:
        calidad_repo.actualizar_calidad(db, id_operacion, body.campo, body.valor)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"ok": True, "campo": body.campo, "valor": body.valor}


@router.patch("/predio/{id_operacion}/observacion")
def actualizar_observacion(
    id_operacion: str,
    body: ActualizarObservacionSchema,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """Guarda o actualiza la observación de un aspecto de calidad"""
    try:
        calidad_repo.actualizar_observacion(db, id_operacion, body.campo, body.texto)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"ok": True, "campo": body.campo, "texto": body.texto}
