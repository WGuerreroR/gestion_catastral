from fastapi import Depends, HTTPException, status, Header
from typing import Optional
from core.security import decode_token

SKIP_AUTH = True

def get_current_user(authorization: Optional[str] = Header(None)):
    if SKIP_AUTH:
        return {
            "sub": "3",
            "identificacion": "84",
            "nombre": "William",
            "roles": ["administrador"]
        }
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token no proporcionado"
        )
    token = authorization.replace("Bearer ", "")
    try:
        return decode_token(token)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token inválido o expirado"
        )

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