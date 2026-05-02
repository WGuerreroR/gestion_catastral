"""
Catálogos LADM (tablas *tipo) para llenar widgets `select` del visor de
predios.

Whitelist explícita: solo las tablas listadas en `DOMINIOS_PERMITIDOS`
se pueden consultar; cualquier otra devuelve 400. Esto evita inyección
por nombre de tabla y limita la superficie a catálogos reales.

Caché en memoria con TTL de 1 hora porque estos catálogos cambian muy
poco y los widgets `select` los piden con alta frecuencia.
"""
import time
from threading import Lock

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from db.database import get_db
from core.deps import get_current_user
from repositories import dominio_repo
from schemas.dominio import DominioResponse


router = APIRouter(prefix="/dominios", tags=["dominios"])


DOMINIOS_PERMITIDOS: set[str] = {
    "lc_prediotipo",
    "lc_condicionprediotipo",
    "lc_categoria_suelo",
    "lc_clasesuelotipo",
    "lc_metodotipo",
    "lc_destinacioneconomicatipo",
    "lc_resultadovisitatipo",
    "lc_direcciontipo",
    "lc_derechotipo",
    "clase_viaprincipal",
    "tipo_fteadm",
    "cr_documentotipo",
    "cr_grupoetnicotipo",
    "cr_interesadotipo",
    "cr_unidadconstrucciontipo",
    "cr_usoconstipo",
    "cr_construccion_planta",
    "sexo",
    "sector",
    "restriccion",
    "procedimiento_catresg",
}


_TTL_SEGUNDOS = 3600
_cache: dict[str, tuple[float, list[dict]]] = {}
_cache_lock = Lock()


def _get_cached(tabla: str):
    entry = _cache.get(tabla)
    if entry and (time.time() - entry[0]) < _TTL_SEGUNDOS:
        return entry[1]
    return None


def _set_cached(tabla: str, items: list[dict]) -> None:
    with _cache_lock:
        _cache[tabla] = (time.time(), items)


@router.get("/{nombre_tabla}", response_model=DominioResponse)
def get_dominio(
    nombre_tabla: str,
    db: Session = Depends(get_db),
    _user=Depends(get_current_user),
):
    if nombre_tabla not in DOMINIOS_PERMITIDOS:
        raise HTTPException(
            status_code=400,
            detail=f"Dominio '{nombre_tabla}' no permitido",
        )

    cached = _get_cached(nombre_tabla)
    if cached is not None:
        return {"domain": nombre_tabla, "items": cached}

    items = dominio_repo.get_catalogo(db, nombre_tabla)
    _set_cached(nombre_tabla, items)
    return {"domain": nombre_tabla, "items": items}
