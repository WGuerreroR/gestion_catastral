from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional

from db.database import get_db
from core.deps import get_current_user, require_roles
from repositories import tipo_marca_repo
from schemas.tipo_marca import TipoMarcaCreate, TipoMarcaUpdate, TipoMarcaResponse

router = APIRouter(prefix="/tipos-marca", tags=["tipos-marca"])

CATEGORIAS_VALIDAS = {'FISICA', 'JURIDICA', 'ECONOMICA', 'IDENTIFICACION', 'SIG'}

PREFIJO_POR_CATEGORIA = {
    'FISICA':         'FIS',
    'JURIDICA':       'JUR',
    'ECONOMICA':      'ECO',
    'IDENTIFICACION': 'IDE',
    'SIG':            'SIG',
}


def _aplicar_prefijo(categoria: str, codigo: str) -> str:
    """Devuelve el código con el prefijo de la categoría. Si el código ya
    trae cualquier prefijo conocido, lo quita antes de re-aplicar el correcto.
    Ej: ('FISICA', '01') -> 'FIS-01' ; ('JURIDICA', 'FIS-01') -> 'JUR-01'."""
    prefijo = PREFIJO_POR_CATEGORIA[categoria]
    sufijo = codigo.strip().upper()
    for p in PREFIJO_POR_CATEGORIA.values():
        if sufijo.startswith(f"{p}-"):
            sufijo = sufijo[len(p) + 1:]
            break
    if not sufijo:
        raise HTTPException(status_code=400, detail="El código no puede contener solo el prefijo")
    return f"{prefijo}-{sufijo}"


@router.get("/", response_model=List[TipoMarcaResponse])
def listar_tipos_marca(
    categoria: Optional[str] = Query(None),
    incluir_inactivas: bool = Query(False),
    db: Session = Depends(get_db),
    user=Depends(get_current_user)
):
    if categoria is not None:
        categoria = categoria.strip().upper()
        if categoria not in CATEGORIAS_VALIDAS:
            raise HTTPException(status_code=400, detail="Categoría no válida")
    return tipo_marca_repo.get_all(db, categoria=categoria, incluir_inactivas=incluir_inactivas)


@router.post("/", status_code=201)
def crear_tipo_marca(
    data: TipoMarcaCreate,
    db: Session = Depends(get_db),
    user=Depends(require_roles("administrador"))
):
    codigo_final = _aplicar_prefijo(data.categoria, data.codigo)
    if tipo_marca_repo.get_by_codigo(db, codigo_final):
        raise HTTPException(status_code=400, detail="Ya existe un tipo de marca con ese código")
    id_ = tipo_marca_repo.create(db, data.categoria, codigo_final, data.significado)
    return {"id": id_, "mensaje": "Tipo de marca creado exitosamente"}


@router.put("/{tipo_marca_id}")
def actualizar_tipo_marca(
    tipo_marca_id: int,
    data: TipoMarcaUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_roles("administrador"))
):
    actual = tipo_marca_repo.get_by_id(db, tipo_marca_id)
    if not actual:
        raise HTTPException(status_code=404, detail="Tipo de marca no encontrado")

    # Si cambia categoria o codigo, recalcular el código final con el prefijo correcto.
    codigo_final = None
    if data.categoria is not None or data.codigo is not None:
        nueva_categoria = data.categoria if data.categoria is not None else actual["categoria"]
        codigo_base     = data.codigo    if data.codigo    is not None else actual["codigo"]
        codigo_final = _aplicar_prefijo(nueva_categoria, codigo_base)
        if codigo_final != actual["codigo"]:
            otro = tipo_marca_repo.get_by_codigo(db, codigo_final)
            if otro and otro["id"] != tipo_marca_id:
                raise HTTPException(status_code=400, detail="Ya existe otro tipo de marca con ese código")

    tipo_marca_repo.update(
        db,
        tipo_marca_id,
        categoria=data.categoria,
        codigo=codigo_final,
        significado=data.significado,
        activo=data.activo,
    )
    return {"mensaje": "Tipo de marca actualizado exitosamente"}


@router.delete("/{tipo_marca_id}")
def eliminar_tipo_marca(
    tipo_marca_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_roles("administrador"))
):
    actual = tipo_marca_repo.get_by_id(db, tipo_marca_id)
    if not actual:
        raise HTTPException(status_code=404, detail="Tipo de marca no encontrado")
    tipo_marca_repo.delete_logico(db, tipo_marca_id)
    return {"mensaje": "Tipo de marca eliminado exitosamente"}
