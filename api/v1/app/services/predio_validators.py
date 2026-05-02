"""
Validadores server-side del visor de predios.

Espejo de `webapp/src/components/predio-visor/validators.js` y
`visibility.js`. La regla del sistema es: NO confiar en validaciones
del cliente — el backend re-aplica las mismas reglas declaradas en el
form JSON.

Validaciones soportadas: required, required_if, required_unless,
min, max, minLength, maxLength, regex, custom.

Operadores de condición: ==, !=, in, not_in, >, <, >=, <=, truthy, falsy.
"""
import re
from typing import Any, Callable, Optional


_CUSTOM_REGISTRY: dict[str, Callable[[Any, dict], Optional[str]]] = {}


def registrar_validador(nombre: str, fn: Callable[[Any, dict], Optional[str]]) -> None:
    _CUSTOM_REGISTRY[nombre] = fn


def evaluar_condicion(condicion: dict, form_data: dict) -> bool:
    if not condicion or not form_data:
        return True
    field    = condicion.get("field")
    operator = condicion.get("operator", "==")
    value    = condicion.get("value")
    actual   = form_data.get(field)

    if operator in ("truthy", "falsy"):
        return bool(actual) and actual != "" if operator == "truthy" else (not actual or actual == "")
    if operator == "==":
        return _coerce_eq(actual, value)
    if operator == "!=":
        return not _coerce_eq(actual, value)
    if operator == "in":
        return isinstance(value, list) and str(actual) in [str(v) for v in value]
    if operator == "not_in":
        return not (isinstance(value, list) and str(actual) in [str(v) for v in value])
    try:
        a = float(actual) if actual is not None and actual != "" else 0.0
        b = float(value)  if value  is not None and value  != "" else 0.0
    except (TypeError, ValueError):
        return False
    if operator == ">":  return a >  b
    if operator == "<":  return a <  b
    if operator == ">=": return a >= b
    if operator == "<=": return a <= b
    return True   # operador desconocido → permisivo


def _coerce_eq(a, b) -> bool:
    if a == b:
        return True
    # Comparación cross-type relajada (números vs strings) — espejo del
    # `==` no estricto de JS que usa el frontend.
    try:
        return str(a) == str(b)
    except Exception:
        return False


def es_visible(visible_if: Optional[dict], form_data: dict) -> bool:
    return True if not visible_if else evaluar_condicion(visible_if, form_data)


def _es_vacio(v) -> bool:
    return v is None or v == ""


def validar_campo(campo: dict, valor, registro: dict) -> Optional[str]:
    v = campo.get("validations")
    if not v:
        return None

    requerido = bool(v.get("required"))
    if v.get("required_if") and evaluar_condicion(v["required_if"], registro):
        requerido = True
    if v.get("required_unless") and not evaluar_condicion(v["required_unless"], registro):
        requerido = True

    if requerido and _es_vacio(valor):
        return "Este campo es obligatorio"
    if _es_vacio(valor):
        return None

    s = str(valor)
    if isinstance(v.get("minLength"), int) and len(s) < v["minLength"]:
        return f"Mínimo {v['minLength']} caracteres"
    if isinstance(v.get("maxLength"), int) and len(s) > v["maxLength"]:
        return f"Máximo {v['maxLength']} caracteres"

    if v.get("regex"):
        try:
            if not re.search(v["regex"], s):
                return v.get("regex_mensaje", "Formato inválido")
        except re.error:
            pass   # regex inválido → ignorar para no bloquear

    if isinstance(v.get("min"), (int, float)):
        try:
            if float(valor) < float(v["min"]): return f"Mínimo {v['min']}"
        except (TypeError, ValueError):
            pass
    if isinstance(v.get("max"), (int, float)):
        try:
            if float(valor) > float(v["max"]): return f"Máximo {v['max']}"
        except (TypeError, ValueError):
            pass

    if v.get("custom"):
        fn = _CUSTOM_REGISTRY.get(v["custom"])
        if fn:
            r = fn(valor, registro)
            if r:
                return r

    return None


def validar_seccion(campos: list[dict], registro: dict) -> dict[str, str]:
    """Valida todos los campos visibles. Devuelve { field: mensaje }."""
    errores: dict[str, str] = {}
    for c in campos:
        if not es_visible(c.get("visible_if"), registro):
            continue
        e = validar_campo(c, registro.get(c["field"]), registro)
        if e:
            errores[c["field"]] = e
    return errores
