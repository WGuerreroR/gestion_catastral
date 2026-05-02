"""
Cargador de form-config JSON para el visor de predios.

Los forms son la fuente de verdad de qué se renderiza, qué se valida y
qué se permite editar. El frontend los carga via `import` estático
desde `webapp/src/config/predio-forms/`. El backend los lee desde
`api/v1/app/forms/{form_id}.json`. Los archivos deben mantenerse
sincronizados manualmente (idealmente por un test del repo).
"""
import json
from pathlib import Path
from threading import Lock
from typing import Optional

FORMS_DIR = Path(__file__).resolve().parent.parent / "forms"

_cache: dict[str, dict] = {}
_cache_lock = Lock()


def cargar_form(form_id: str) -> Optional[dict]:
    """Lee el JSON desde disco con caché en memoria. None si no existe."""
    with _cache_lock:
        cached = _cache.get(form_id)
    if cached is not None:
        return cached

    path = FORMS_DIR / f"{form_id}.json"
    if not path.exists():
        return None

    with path.open(encoding="utf-8") as f:
        data = json.load(f)
    with _cache_lock:
        _cache[form_id] = data
    return data


def secciones_por_tabla(form: dict) -> dict[str, dict]:
    """Indexa { tabla_origen → seccion } incluyendo subsecciones."""
    out: dict[str, dict] = {}
    for s in form.get("secciones", []):
        if s.get("tabla_origen"):
            out[s["tabla_origen"]] = s
        sub = s.get("subseccion")
        if sub and sub.get("tabla_origen"):
            out[sub["tabla_origen"]] = sub
    return out
