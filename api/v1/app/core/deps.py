from fastapi import Depends, HTTPException, status, Header, Query
from typing import Optional
from core.security import decode_token

SKIP_AUTH = False

_USUARIO_MOCK = {
    "sub": "3",
    "identificacion": "84",
    "nombre": "William",
    "roles": ["administrador"],
}


def _validar_jwt(token: str) -> dict:
    """Valida un JWT y devuelve el payload decodificado, o levanta 401."""
    try:
        return decode_token(token)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token inválido o expirado"
        )


def get_current_user(authorization: Optional[str] = Header(None)):
    if SKIP_AUTH:
        return _USUARIO_MOCK
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token no proporcionado"
        )
    return _validar_jwt(authorization.replace("Bearer ", ""))


def get_user_from_token_or_header(
    authorization: Optional[str] = Header(None),
    token: Optional[str] = Query(None),
):
    """Variante permisiva de get_current_user que también acepta el JWT
    como query param `?token=...`. Necesario para endpoints invocados
    directamente por `<img src>` o `<a href>` desde el navegador, donde no
    se pueden añadir headers Authorization. Solo se debe usar en endpoints
    que sirven binarios (fotos, descargas) — el resto debe seguir usando
    get_current_user para mantener token fuera de los logs."""
    if SKIP_AUTH:
        return _USUARIO_MOCK
    raw_token: Optional[str] = None
    if authorization and authorization.startswith("Bearer "):
        raw_token = authorization.replace("Bearer ", "")
    elif token:
        raw_token = token
    if not raw_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token no proporcionado"
        )
    return _validar_jwt(raw_token)

def require_roles(*roles_permitidos):
    def verificar(user: dict = Depends(get_current_user)):
        if SKIP_AUTH:
            return user
        roles_usuario = user.get("roles", [])
        if not any(r in roles_usuario for r in roles_permitidos):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Se requiere uno de estos roles: {list(roles_permitidos)}"
            )
        return user
    return verificar


ROLES_ADMIN_PROYECTO = {"administrador", "supervisor", "coordinador"}


def es_admin_proyecto(user: dict) -> bool:
    return any(r in ROLES_ADMIN_PROYECTO for r in user.get("roles", []))


def filtro_responsable(user: dict) -> Optional[int]:
    if es_admin_proyecto(user):
        return None
    return int(user["sub"])