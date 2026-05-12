"""Cifrado simétrico para credenciales sensibles (Fernet).

Deriva una clave de 32 bytes desde el SECRET_KEY del backend con HKDF-SHA256
y la codifica en urlsafe-base64 — formato que Fernet exige.
"""
import base64
import os

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF


_SALT = b"chiquinquira-migracion-ladm-v1"
_INFO = b"fernet-key"


def _derivar_key() -> bytes:
    secret = os.getenv("SECRET_KEY", "clave_secreta_por_defecto").encode("utf-8")
    raw = HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=_SALT,
        info=_INFO,
    ).derive(secret)
    return base64.urlsafe_b64encode(raw)


_fernet: Fernet | None = None


def _get_fernet() -> Fernet:
    global _fernet
    if _fernet is None:
        _fernet = Fernet(_derivar_key())
    return _fernet


def encrypt(plain: str) -> str:
    return _get_fernet().encrypt(plain.encode("utf-8")).decode("utf-8")


def decrypt(token: str) -> str:
    try:
        return _get_fernet().decrypt(token.encode("utf-8")).decode("utf-8")
    except InvalidToken as e:
        raise ValueError("Token de cifrado inválido o clave cambió") from e
