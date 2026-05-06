from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional

from db.database import get_db
from core.deps import get_current_user, require_roles
from repositories import marca_predio_repo, tipo_marca_repo
from schemas.marca_predio import (
    MarcaPredioCreate,
    MarcaPredioCambioEstadoInput,
    MarcaPredioResponse,
    MarcaEventoResponse,
)

router = APIRouter(prefix="/predios/{id_operacion}/marcas", tags=["marcas-predio"])
router_global = APIRouter(prefix="/marcas", tags=["marcas-predio"])

CATEGORIAS_VALIDAS = {'FISICA', 'JURIDICA', 'ECONOMICA', 'IDENTIFICACION', 'SIG'}
ESTADOS_VALIDOS    = {'ABIERTA', 'CERRADA'}
PRIORIDADES_VALIDAS = {'ALTA', 'MEDIA', 'BAJA'}
ROLES_ADMIN_LISTADO = {'administrador', 'supervisor', 'coordinador'}


@router.get("/", response_model=List[MarcaPredioResponse])
def listar_marcas(
    id_operacion: str,
    categoria: Optional[str] = Query(None),
    estado:    Optional[str] = Query(None),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    if categoria is not None:
        categoria = categoria.strip().upper()
        if categoria not in CATEGORIAS_VALIDAS:
            raise HTTPException(status_code=400, detail="Categoría no válida")
    if estado is not None:
        estado = estado.strip().upper()
        if estado not in ESTADOS_VALIDOS:
            raise HTTPException(status_code=400, detail="Estado no válido")
    return marca_predio_repo.listar_por_predio(db, id_operacion, categoria=categoria, estado=estado)


@router.post("/", status_code=201, response_model=MarcaPredioResponse)
def crear_marca(
    id_operacion: str,
    data: MarcaPredioCreate,
    db: Session = Depends(get_db),
    user=Depends(require_roles("administrador", "supervisor")),
):
    tipo = tipo_marca_repo.get_by_id(db, data.tipo_marca_id)
    if not tipo or not tipo["activo"]:
        raise HTTPException(status_code=400, detail="Tipo de marca no encontrado o inactivo")
    if tipo["categoria"] != data.categoria:
        raise HTTPException(
            status_code=400,
            detail=f"El tipo de marca pertenece a la categoría {tipo['categoria']}, no a {data.categoria}"
        )

    marca_id = marca_predio_repo.crear(db, id_operacion, data.model_dump(), user_id=int(user["sub"]))
    return marca_predio_repo.get_by_id(db, marca_id)


@router.get("/{marca_id}/eventos", response_model=List[MarcaEventoResponse])
def listar_eventos_marca(
    id_operacion: str,
    marca_id: int,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    marca = marca_predio_repo.get_by_id(db, marca_id)
    if not marca or marca["id_operacion"] != id_operacion:
        raise HTTPException(status_code=404, detail="Marca no encontrada")
    return marca_predio_repo.listar_eventos(db, marca_id)


@router.patch("/{marca_id}/cerrar", response_model=MarcaPredioResponse)
def cerrar_marca(
    id_operacion: str,
    marca_id: int,
    data: MarcaPredioCambioEstadoInput,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    marca = marca_predio_repo.get_by_id(db, marca_id)
    if not marca or marca["id_operacion"] != id_operacion:
        raise HTTPException(status_code=404, detail="Marca no encontrada")

    roles_usuario = set(user.get("roles") or [])
    es_admin = bool(roles_usuario & {"administrador", "supervisor"})
    es_responsable = (
        marca.get("responsable_id") is not None
        and int(marca["responsable_id"]) == int(user["sub"])
    )
    if not (es_admin or es_responsable):
        raise HTTPException(
            status_code=403,
            detail="Solo un administrador, supervisor o el responsable de la marca puede cerrarla",
        )

    ok = marca_predio_repo.cambiar_estado(
        db, marca_id, "CERRADA", "CIERRE",
        user_id=int(user["sub"]), observacion=data.observacion,
    )
    if not ok:
        raise HTTPException(status_code=400, detail="La marca no está abierta")
    return marca_predio_repo.get_by_id(db, marca_id)


@router.patch("/{marca_id}/reabrir", response_model=MarcaPredioResponse)
def reabrir_marca(
    id_operacion: str,
    marca_id: int,
    data: MarcaPredioCambioEstadoInput,
    db: Session = Depends(get_db),
    user=Depends(require_roles("administrador", "supervisor")),
):
    marca = marca_predio_repo.get_by_id(db, marca_id)
    if not marca or marca["id_operacion"] != id_operacion:
        raise HTTPException(status_code=404, detail="Marca no encontrada")
    ok = marca_predio_repo.cambiar_estado(
        db, marca_id, "ABIERTA", "REAPERTURA",
        user_id=int(user["sub"]), observacion=data.observacion,
    )
    if not ok:
        raise HTTPException(status_code=400, detail="La marca no está cerrada")
    return marca_predio_repo.get_by_id(db, marca_id)


# ── Listado global de marcas (cross-predio) ────────────────────────────────

@router_global.get("/", response_model=List[MarcaPredioResponse])
def listar_marcas_global(
    solo_mias: bool = Query(True),
    estado:    Optional[str] = Query("ABIERTA"),
    categoria: Optional[str] = Query(None),
    prioridad: Optional[str] = Query(None),
    q:         Optional[str] = Query(None),
    limit:     int = Query(200, ge=1, le=500),
    offset:    int = Query(0,   ge=0),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """Listado global de marcas. Por defecto devuelve solo las del usuario
    autenticado (`solo_mias=True`). Para listar todas, el usuario debe tener
    rol administrador, supervisor o coordinador."""
    roles_usuario = set(user.get("roles") or [])

    if not solo_mias and not (roles_usuario & ROLES_ADMIN_LISTADO):
        raise HTTPException(
            status_code=403,
            detail="Requiere rol administrador, supervisor o coordinador para listar todas las marcas",
        )

    if categoria is not None:
        categoria = categoria.strip().upper() or None
        if categoria and categoria not in CATEGORIAS_VALIDAS:
            raise HTTPException(status_code=400, detail="Categoría no válida")
    if estado is not None:
        estado = estado.strip().upper() or None
        if estado and estado not in ESTADOS_VALIDOS:
            raise HTTPException(status_code=400, detail="Estado no válido")
    if prioridad is not None:
        prioridad = prioridad.strip().upper() or None
        if prioridad and prioridad not in PRIORIDADES_VALIDAS:
            raise HTTPException(status_code=400, detail="Prioridad no válida")

    responsable_id = None
    if solo_mias:
        try:
            responsable_id = int(user["sub"])
        except (KeyError, TypeError, ValueError):
            raise HTTPException(status_code=401, detail="Usuario sin identificador válido")

    return marca_predio_repo.listar_marcas_global(
        db,
        responsable_id=responsable_id,
        estado=estado,
        categoria=categoria,
        prioridad=prioridad,
        q=(q.strip() or None) if q else None,
        limit=limit,
        offset=offset,
    )


@router_global.get("/count")
def contar_marcas_global(
    solo_mias: bool = Query(True),
    estado:    Optional[str] = Query("ABIERTA"),
    categoria: Optional[str] = Query(None),
    prioridad: Optional[str] = Query(None),
    q:         Optional[str] = Query(None),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    roles_usuario = set(user.get("roles") or [])
    if not solo_mias and not (roles_usuario & ROLES_ADMIN_LISTADO):
        raise HTTPException(status_code=403, detail="Requiere rol administrador, supervisor o coordinador")

    responsable_id = int(user["sub"]) if solo_mias else None
    total = marca_predio_repo.count_marcas_global(
        db,
        responsable_id=responsable_id,
        estado=(estado.strip().upper() if estado else None) or None,
        categoria=(categoria.strip().upper() if categoria else None) or None,
        prioridad=(prioridad.strip().upper() if prioridad else None) or None,
        q=(q.strip() or None) if q else None,
    )
    return {"total": total}
