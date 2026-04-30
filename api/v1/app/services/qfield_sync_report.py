"""
app/services/qfield_sync_report.py

Genera un reporte en texto plano con el detalle de un sync — pensado
para que el operador lo descargue cuando hay errores y pueda saber
exactamente qué predio/tabla revisar.

El reporte parsea los `errores_detalle` que vienen de SQLAlchemy
(strings largos con stacktrace) y extrae info útil: tipo de error,
columna/valor que falló, y una sugerencia de cómo corregir según el
patrón.
"""

from __future__ import annotations

import json
import re
from datetime import datetime
from typing import Any


# ── Parsers de errores SQLAlchemy ─────────────────────────────────────────


_FK_RE = re.compile(
    r'ForeignKeyViolation.*?Key \(([^)]+)\)=\(([^)]+)\) is not present in table "([^"]+)"',
    re.DOTALL,
)
_NOT_NULL_RE = re.compile(
    r'NotNullViolation.*?column "([^"]+)" of relation "([^"]+)"',
    re.DOTALL,
)
_UNIQUE_RE = re.compile(
    r'UniqueViolation.*?Key \(([^)]+)\)=\(([^)]+)\) already exists',
    re.DOTALL,
)
_INVALID_TEXT_RE = re.compile(
    r'InvalidTextRepresentation.*?invalid input.*?for type ([\w ]+):\s*"([^"]+)"',
    re.DOTALL,
)
_DATA_TYPE_RE = re.compile(
    r'(?:DataError|StringDataRightTruncation).*?value too long.*?(?:column "([^"]+)")?',
    re.DOTALL,
)


def _interpretar_error(err_msg: str) -> dict:
    """
    Reconoce patrones comunes de SQLAlchemy/psycopg2 y devuelve un dict
    con { tipo, causa, sugerencia }. Si no encaja, devuelve un mensaje
    genérico con la primera línea del traceback.
    """
    # FK violation: la fila apunta a un valor que no existe en otra tabla
    m = _FK_RE.search(err_msg)
    if m:
        cols, vals, tabla_destino = m.group(1), m.group(2), m.group(3)
        sugerencia = _sugerencia_fk(cols, vals, tabla_destino)
        return {
            "tipo": "ForeignKeyViolation",
            "causa": f"{cols}={vals} no existe en {tabla_destino}",
            "sugerencia": sugerencia,
        }

    # NOT NULL: falta un valor obligatorio
    m = _NOT_NULL_RE.search(err_msg)
    if m:
        col, tabla = m.group(1), m.group(2)
        return {
            "tipo": "NotNullViolation",
            "causa": f"columna {col} de {tabla} está NULL pero es obligatoria",
            "sugerencia": (
                f"En QField, completar el campo '{col}' del registro y "
                f"re-sincronizar."
            ),
        }

    # UNIQUE: dos filas con la misma PK
    m = _UNIQUE_RE.search(err_msg)
    if m:
        cols, vals = m.group(1), m.group(2)
        return {
            "tipo": "UniqueViolation",
            "causa": f"ya existe una fila con {cols}={vals}",
            "sugerencia": (
                f"Conflicto de PK: revisar si {cols}={vals} fue creada "
                f"dos veces en QField. Eliminar la duplicada."
            ),
        }

    # Tipo de dato inválido
    m = _INVALID_TEXT_RE.search(err_msg)
    if m:
        tipo, valor = m.group(1).strip(), m.group(2)
        return {
            "tipo": "InvalidTextRepresentation",
            "causa": f"valor '{valor}' no es válido para el tipo {tipo}",
            "sugerencia": (
                f"Corregir el valor '{valor}' en QField — debe ser un "
                f"{tipo} válido."
            ),
        }

    # Texto/longitud
    m = _DATA_TYPE_RE.search(err_msg)
    if m:
        col = m.group(1) or "(columna no identificada)"
        return {
            "tipo": "DataTooLong",
            "causa": f"valor demasiado largo para columna {col}",
            "sugerencia": f"Acortar el contenido de '{col}' en QField.",
        }

    # Genérico
    primera_linea = err_msg.split("\n", 1)[0][:200]
    return {
        "tipo": "Error",
        "causa": primera_linea,
        "sugerencia": "Revisar el log del sync o contactar al equipo técnico.",
    }


def _sugerencia_fk(cols: str, vals: str, tabla_destino: str) -> str:
    """Sugerencias específicas según la tabla padre del FK."""
    # FK a tablas de dominio (catálogos): el operador puso un valor inválido
    DOMINIOS = {
        "campobooleano":              "Cambiar a un valor válido del catálogo (0/1).",
        "lc_prediotipo":              "Elegir un tipo de predio válido del listado.",
        "lc_condicionprediotipo":     "Elegir una condición de predio válida.",
        "lc_categoria_suelo":         "Elegir una categoría de suelo válida.",
        "lc_clasesuelotipo":          "Elegir una clase de suelo válida.",
        "lc_metodotipo":              "Elegir un método válido.",
        "lc_destinacioneconomicatipo":"Elegir una destinación económica válida.",
        "lc_resultadovisitatipo":     "Elegir un resultado de visita válido.",
        "lc_direcciontipo":           "Elegir un tipo de dirección válido.",
        "clase_viaprincipal":         "Elegir una clase de vía principal válida.",
        "lc_derechotipo":             "Elegir un tipo de derecho válido.",
        "tipo_fteadm":                "Elegir un tipo de fuente administrativa válido.",
        "cr_documentotipo":           "Elegir un tipo de documento válido.",
        "cr_grupoetnicotipo":         "Elegir un grupo étnico válido.",
        "cr_interesadotipo":          "Elegir un tipo de interesado válido.",
        "cr_unidadconstrucciontipo":  "Elegir un tipo de unidad de construcción válido.",
        "cr_usoconstipo":             "Elegir un uso de construcción válido.",
        "cr_construccion_planta":     "Elegir un tipo de planta válido.",
        "sexo":                       "Elegir un sexo válido del catálogo.",
        "sector":                     "Elegir un sector válido.",
        "restriccion":                "Elegir una restricción válida del catálogo.",
        "procedimiento_catresg":      "Elegir un procedimiento catastral válido.",
    }
    if tabla_destino in DOMINIOS:
        return f"En QField, abrir el registro y {DOMINIOS[tabla_destino]} (valor actual {vals!r})."

    # FK entre tablas de negocio: probablemente falta crear el row padre
    if tabla_destino == "lc_predio_p":
        return (
            f"El predio con id_operacion={vals!r} no existe en la base. "
            f"Crear el predio en QField (capa lc_predio_p) o eliminar el "
            f"registro huérfano que lo referencia."
        )
    if tabla_destino == "cr_caracteristicasunidadconstruccion":
        return (
            f"La unidad de construcción {vals!r} tiene geometría pero no "
            f"tiene formulario de características. Solución: en QField, "
            f"capa cr_caracteristicasunidadconstruccion, crear el registro "
            f"con id_operacion_unidad_cons={vals!r} y completar campos "
            f"básicos (id_operacion_predio, tipo_unidad_construccion, "
            f"area_construida, etc.)  —  o eliminar la geometría suelta."
        )
    if tabla_destino == "lc_derecho":
        return (
            f"El derecho con id_operacion_derecho={vals!r} no existe. Crear "
            f"el derecho en QField (capa lc_derecho) o eliminar el "
            f"interesado que lo referencia."
        )

    return (
        f"La fila padre con {cols}={vals} no existe en {tabla_destino}. "
        f"Crearla en QField o eliminar la fila hija que la referencia."
    )


# ── Generador de reporte ──────────────────────────────────────────────────


def generar_reporte_txt(sync: dict) -> str:
    """
    Construye el reporte en texto plano a partir de una fila de
    sync_history (dict). Maneja resumen y advertencias que pueden venir
    como string (jsonb sin deserializar) o como dict/list.
    """
    def _ensure(obj, default):
        if obj is None:
            return default
        if isinstance(obj, str):
            try:
                return json.loads(obj)
            except (ValueError, TypeError):
                return default
        return obj

    resumen      = _ensure(sync.get("resumen"), {})
    fotos        = _ensure(sync.get("fotos_resumen"), {})
    advertencias = _ensure(sync.get("advertencias"), [])
    error_global = sync.get("error_detalle") or ""
    fecha = sync.get("fecha_sync")
    if isinstance(fecha, datetime):
        fecha_str = fecha.strftime("%Y-%m-%d %H:%M:%S")
    else:
        fecha_str = str(fecha or "")

    lineas: list[str] = []
    lineas.append("=" * 72)
    lineas.append("REPORTE DE SINCRONIZACIÓN OFFLINE")
    lineas.append("=" * 72)
    lineas.append(f"Sync ID         : {sync.get('id')}")
    lineas.append(f"Asignación      : {sync.get('asignacion_id')}")
    lineas.append(f"Fecha           : {fecha_str}")
    lineas.append(f"Estado          : {sync.get('estado')}")
    lineas.append(f"Paquete         : {sync.get('paquete_nombre') or '—'}")
    lineas.append(f"Hash SHA-256    : {sync.get('paquete_hash') or '—'}")
    lineas.append(f"Estrategia      : {sync.get('estrategia_diff') or '—'}")
    lineas.append(f"Forzado         : {'sí' if sync.get('forzado') else 'no'}")
    if sync.get("estado_anterior") and sync.get("estado_nuevo"):
        lineas.append(
            f"Transición      : {sync['estado_anterior']} → {sync['estado_nuevo']}"
        )
    lineas.append("")

    # Resumen tabular
    if resumen:
        lineas.append("RESUMEN POR CAPA")
        lineas.append("-" * 72)
        lineas.append(f"{'Capa':<42} {'+nuev':>6} {'~upd':>6} {'-del':>6} {'err':>5}")
        lineas.append("-" * 72)
        for tabla, info in sorted(resumen.items()):
            lineas.append(
                f"{tabla:<42} "
                f"{info.get('added', 0):>6} "
                f"{info.get('updated', 0):>6} "
                f"{info.get('deleted', 0):>6} "
                f"{info.get('errors', 0):>5}"
            )
        lineas.append("")

    # Fotos
    if fotos:
        lineas.append("FOTOS")
        lineas.append("-" * 72)
        for k, v in fotos.items():
            if isinstance(v, (list, dict)):
                continue
            lineas.append(f"  {k:<32}: {v}")
        lineas.append("")

    # Errores detallados con interpretación
    errores_total: list[tuple[str, str, dict]] = []
    for tabla, info in (resumen or {}).items():
        for err_msg in (info.get("errores_detalle") or []):
            # Cada err viene como "PK: stacktrace_largo"
            pk, _, msg = err_msg.partition(":")
            interp = _interpretar_error(msg.strip() or err_msg)
            errores_total.append((tabla, pk.strip(), interp))

    if errores_total:
        lineas.append(f"ERRORES DETECTADOS ({len(errores_total)})")
        lineas.append("=" * 72)
        for i, (tabla, pk, info) in enumerate(errores_total, start=1):
            lineas.append("")
            lineas.append(f"[{i}] Capa: {tabla}")
            lineas.append(f"    PK  : {pk}")
            lineas.append(f"    Tipo: {info['tipo']}")
            lineas.append(f"    Causa: {info['causa']}")
            lineas.append(f"    Cómo corregir:")
            for sub in _wrap(info["sugerencia"], 64):
                lineas.append(f"      {sub}")
        lineas.append("")

    # Error global (excepción no manejada)
    if error_global:
        lineas.append("ERROR GLOBAL")
        lineas.append("=" * 72)
        for ln in error_global.split("\n")[:30]:
            lineas.append(ln)
        lineas.append("")

    # Advertencias
    if advertencias:
        lineas.append("ADVERTENCIAS")
        lineas.append("-" * 72)
        for a in advertencias:
            lineas.append(f"  • {a}")
        lineas.append("")

    if not errores_total and not error_global and sync.get("estado") == "ok":
        lineas.append("✓ Sincronización exitosa sin errores.")
        lineas.append("")

    return "\n".join(lineas)


def _wrap(text: str, width: int) -> list[str]:
    """Word-wrap simple para que las sugerencias largas queden legibles."""
    palabras = text.split()
    out: list[str] = []
    actual = ""
    for w in palabras:
        if len(actual) + len(w) + 1 > width:
            if actual:
                out.append(actual.rstrip())
            actual = w + " "
        else:
            actual += w + " "
    if actual:
        out.append(actual.rstrip())
    return out
