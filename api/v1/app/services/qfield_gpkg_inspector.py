"""
app/services/qfield_gpkg_inspector.py

Inspector read-only de paquetes offline de QField (zip con data.gpkg + DCIM/).

Detecta la estrategia de aplicación de cambios (logs de QGIS Offline Editing
vs diff por PK), mapea las tablas con sufijo UUID a su nombre PostGIS,
extrae el schema de cada capa, cuenta cuántas features se agregaron,
modificaron, borraron o tienen geometría editada.

Sin dependencias de QgsApplication ni de FastAPI: usa solo sqlite3 + stdlib.
Esto permite reutilizarlo desde el CLI scripts/inspect_gpkg.py y desde el
servicio FastAPI por igual.
"""

from __future__ import annotations

import os
import re
import sqlite3
import zipfile
from dataclasses import dataclass, field
from typing import Optional

# ── Whitelist de tablas editables (deben coincidir con qfield_upsert_service) ──
TABLAS_EDITABLES: set[str] = {
    "lc_predio_p",
    "cr_terreno",
    "cr_unidadconstruccion",
    "cr_caracteristicasunidadconstruccion",
    "cr_interesado",
    "lc_derecho",
}

# Sufijo UUID que QField Cloud agrega a las tablas: _XXXXXXXX_XXXX_XXXX_XXXX_XXXXXXXXXXXX
_UUID_SUFFIX_RE = re.compile(
    r"_[a-f0-9]{8}_[a-f0-9]{4}_[a-f0-9]{4}_[a-f0-9]{4}_[a-f0-9]{12}$"
)

ESTRATEGIA_LOG = "log_qgis_offline_editing"
ESTRATEGIA_DIFF = "diff_por_pk"


@dataclass
class CapaInfo:
    """Información de una capa (tabla) detectada en el GPKG."""
    layer_id: int                       # id en log_layer_ids
    qgis_table: str                     # nombre con sufijo UUID
    postgis_table: str                  # nombre limpio (sin UUID)
    is_editable: bool                   # está en TABLAS_EDITABLES
    schema: list[tuple[int, str, str]]  # [(cid, nombre, tipo), ...]
    geom_col: Optional[str]             # nombre de columna geom o None
    feature_count: int                  # filas en la tabla


@dataclass
class PreviewCapa:
    """Conteos de cambios pendientes por capa según los logs."""
    added: int = 0
    updated_attrs_features: int = 0  # distinct fids con cambios de atributos
    updated_geom_features: int = 0   # distinct fids con cambios de geometría
    removed: int = 0


@dataclass
class InspeccionPaquete:
    """Resultado de inspeccionar un ZIP."""
    valido: bool
    archivo_zip: str
    gpkg_path: Optional[str] = None
    dcim_path: Optional[str] = None
    fotos_en_paquete: list[str] = field(default_factory=list)
    extra_files: list[str] = field(default_factory=list)  # qgs, attachments, basemap
    advertencias: list[str] = field(default_factory=list)
    errores: list[str] = field(default_factory=list)
    estrategia: Optional[str] = None
    capas: dict[int, CapaInfo] = field(default_factory=dict)  # layer_id → CapaInfo
    preview: dict[str, PreviewCapa] = field(default_factory=dict)  # postgis_table → PreviewCapa


# ── Utilidades de nombres ────────────────────────────────────────────────────

def quitar_uuid(nombre_tabla: str) -> str:
    """`lc_predio_p_2dc9463c_9a05_44c4_85cc_f2821b5522c9` → `lc_predio_p`."""
    return _UUID_SUFFIX_RE.sub("", nombre_tabla)


def normalizar_codigo_manzana(s: str) -> str:
    """
    Normaliza códigos de manzana para comparación flexible:
      `MZ_19` ↔ `MZ_019`     → `MZ_19`
      `MZ_019_qfield_cloud`  → `MZ_19`
    Quita leading zeros del número y sufijos como `_qfield_cloud`.
    """
    if not s:
        return ""
    base = os.path.splitext(os.path.basename(s))[0]
    # quitar sufijo _qfield_cloud / _qfield / etc.
    base = re.sub(r"_qfield(_cloud)?$", "", base, flags=re.IGNORECASE)
    # normalizar leading zeros: MZ_019 → MZ_19
    m = re.match(r"^([A-Za-z]+_)0*(\d+)$", base)
    if m:
        return f"{m.group(1)}{m.group(2)}"
    return base


# ── Inspección del ZIP ───────────────────────────────────────────────────────

def listar_contenido_zip(zip_path: str) -> dict:
    """
    Inspecciona un ZIP sin extraerlo todavía: detecta qué archivos relevantes
    contiene (data.gpkg, zonas.gpkg/shp, DCIM/, qgs).
    """
    info: dict = {
        "gpkg_principal": None,
        "zonas": None,
        "dcim_existe": False,
        "dcim_archivos": [],
        "qgs_archivos": [],
        "otros": [],
    }
    if not os.path.isfile(zip_path):
        info["error"] = f"Archivo no encontrado: {zip_path}"
        return info

    try:
        with zipfile.ZipFile(zip_path, "r") as zf:
            for name in zf.namelist():
                # ignorar metadata de macOS
                if name.startswith("__MACOSX/") or "/__MACOSX/" in name or "/.DS_Store" in name:
                    continue
                if name.endswith("/"):  # directorio vacío
                    if name.rstrip("/").endswith("DCIM"):
                        info["dcim_existe"] = True
                    continue

                base = os.path.basename(name)
                if name.startswith("DCIM/") or "/DCIM/" in name:
                    info["dcim_existe"] = True
                    if base:
                        info["dcim_archivos"].append(name)
                elif base == "data.gpkg":
                    info["gpkg_principal"] = name
                elif base == "zonas.gpkg" or base == "zonas.shp":
                    info["zonas"] = name
                elif base.endswith(".gpkg") and info["gpkg_principal"] is None:
                    # fallback: primer .gpkg que no sea zonas.gpkg
                    info["gpkg_principal"] = name
                elif base.endswith(".qgs") or base.endswith(".qgz"):
                    info["qgs_archivos"].append(name)
                else:
                    info["otros"].append(name)
    except zipfile.BadZipFile:
        info["error"] = "Archivo ZIP corrupto o inválido"

    return info


def extraer_zip(zip_path: str, dest_dir: str) -> None:
    """Extrae el ZIP a dest_dir, ignorando entradas de __MACOSX/."""
    with zipfile.ZipFile(zip_path, "r") as zf:
        for member in zf.namelist():
            if member.startswith("__MACOSX/") or "/__MACOSX/" in member:
                continue
            if "/.DS_Store" in member or member.endswith("/.DS_Store"):
                continue
            zf.extract(member, dest_dir)


# ── Inspección del GPKG ──────────────────────────────────────────────────────

def _detectar_geom_col(conn: sqlite3.Connection, tabla: str) -> Optional[str]:
    """Lee gpkg_geometry_columns para identificar la columna de geometría."""
    try:
        cur = conn.execute(
            "SELECT column_name FROM gpkg_geometry_columns WHERE table_name = ?",
            (tabla,),
        )
        row = cur.fetchone()
        return row[0] if row else None
    except sqlite3.OperationalError:
        return None


def _table_exists(conn: sqlite3.Connection, name: str) -> bool:
    cur = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name = ? LIMIT 1",
        (name,),
    )
    return cur.fetchone() is not None


def detectar_estrategia(conn: sqlite3.Connection) -> str:
    """
    Estrategia A solo si las tablas de log de QGIS Offline Editing tienen
    ediciones registradas. En la práctica, paquetes que vienen de QField
    Cloud traen `log_layer_ids` y `log_fids` poblados pero los logs de
    cambios (`log_added_features`, `log_feature_updates`, etc.) vacíos —
    porque QField mobile NO usa el sistema de Offline Editing del plugin
    desktop. En ese caso, la única ruta confiable es comparar el GPKG
    contra PostGIS por PK de negocio (Estrategia B).
    """
    if not (_table_exists(conn, "log_layer_ids") and _table_exists(conn, "log_fids")):
        return ESTRATEGIA_DIFF

    # Verificar si hay ediciones reales registradas
    for tabla in ("log_added_features", "log_feature_updates",
                  "log_geometry_updates", "log_removed_features"):
        if _table_exists(conn, tabla):
            cur = conn.execute(f"SELECT COUNT(*) FROM {tabla}")
            if cur.fetchone()[0] > 0:
                return ESTRATEGIA_LOG

    # Tablas log presentes pero vacías → caso QField, usar diff por PK
    return ESTRATEGIA_DIFF


def mapear_capas(conn: sqlite3.Connection) -> dict[int, CapaInfo]:
    """
    Para cada `layer_id` en `log_layer_ids`, construye una `CapaInfo`.
    Si la base no tiene `log_layer_ids` (no fue offline-editing), enumera
    `gpkg_contents` como fallback para Estrategia B.
    """
    capas: dict[int, CapaInfo] = {}

    if _table_exists(conn, "log_layer_ids"):
        cur = conn.execute("SELECT id, qgis_id FROM log_layer_ids ORDER BY id")
        for layer_id, qgis_table in cur.fetchall():
            capas[layer_id] = _construir_capa_info(conn, layer_id, qgis_table)
    else:
        # Fallback: enumerar tablas de gpkg_contents
        try:
            cur = conn.execute(
                "SELECT table_name FROM gpkg_contents WHERE data_type IN ('features','attributes')"
            )
            for i, (qgis_table,) in enumerate(cur.fetchall()):
                capas[i] = _construir_capa_info(conn, i, qgis_table)
        except sqlite3.OperationalError:
            pass

    return capas


def _construir_capa_info(conn: sqlite3.Connection, layer_id: int, qgis_table: str) -> CapaInfo:
    postgis_table = quitar_uuid(qgis_table)
    is_editable = postgis_table in TABLAS_EDITABLES

    # schema: [(cid, name, type), ...]
    schema: list[tuple[int, str, str]] = []
    try:
        cur = conn.execute(f'PRAGMA table_info("{qgis_table}")')
        for row in cur.fetchall():
            schema.append((row[0], row[1], row[2]))
    except sqlite3.OperationalError:
        pass

    geom_col = _detectar_geom_col(conn, qgis_table)

    feature_count = 0
    try:
        cur = conn.execute(f'SELECT COUNT(*) FROM "{qgis_table}"')
        feature_count = cur.fetchone()[0]
    except sqlite3.OperationalError:
        pass

    return CapaInfo(
        layer_id=layer_id,
        qgis_table=qgis_table,
        postgis_table=postgis_table,
        is_editable=is_editable,
        schema=schema,
        geom_col=geom_col,
        feature_count=feature_count,
    )


def preview_cambios(conn: sqlite3.Connection, capas: dict[int, CapaInfo]) -> dict[str, PreviewCapa]:
    """
    Cuenta features nuevos, modificados, con geom modificada, y borrados,
    por capa editable. Si no hay logs de offline editing, devuelve dict vacío
    (la estrategia B no tiene "preview" sin comparar contra PostGIS).
    """
    preview: dict[str, PreviewCapa] = {}

    if not _table_exists(conn, "log_layer_ids"):
        return preview

    # Inicializar contadores en 0 para cada capa editable
    for capa in capas.values():
        if capa.is_editable:
            preview[capa.postgis_table] = PreviewCapa()

    # log_added_features
    if _table_exists(conn, "log_added_features"):
        cur = conn.execute("SELECT layer_id, COUNT(*) FROM log_added_features GROUP BY layer_id")
        for layer_id, count in cur.fetchall():
            capa = capas.get(layer_id)
            if capa and capa.is_editable:
                preview[capa.postgis_table].added = count

    # log_feature_updates: distinct (fid) por layer_id
    if _table_exists(conn, "log_feature_updates"):
        cur = conn.execute(
            "SELECT layer_id, COUNT(DISTINCT fid) FROM log_feature_updates GROUP BY layer_id"
        )
        for layer_id, count in cur.fetchall():
            capa = capas.get(layer_id)
            if capa and capa.is_editable:
                preview[capa.postgis_table].updated_attrs_features = count

    # log_geometry_updates
    if _table_exists(conn, "log_geometry_updates"):
        cur = conn.execute(
            "SELECT layer_id, COUNT(DISTINCT fid) FROM log_geometry_updates GROUP BY layer_id"
        )
        for layer_id, count in cur.fetchall():
            capa = capas.get(layer_id)
            if capa and capa.is_editable:
                preview[capa.postgis_table].updated_geom_features = count

    # log_removed_features
    if _table_exists(conn, "log_removed_features"):
        cur = conn.execute("SELECT layer_id, COUNT(*) FROM log_removed_features GROUP BY layer_id")
        for layer_id, count in cur.fetchall():
            capa = capas.get(layer_id)
            if capa and capa.is_editable:
                preview[capa.postgis_table].removed = count

    return preview


# ── API pública ──────────────────────────────────────────────────────────────

def inspeccionar_paquete(zip_path: str, extract_to: Optional[str] = None) -> InspeccionPaquete:
    """
    Punto de entrada: dado un ZIP, lo extrae a `extract_to` (o un temp dir
    interno si es None — en cuyo caso el caller debe limpiar), abre el GPKG
    y devuelve la inspección completa.

    NO modifica nada en PostGIS. NO requiere QgsApplication.

    Si `extract_to` es None, crea un tempdir y lo deja para que el caller lo
    limpie cuando termine. Devuelve el path en `inspeccion.gpkg_path`.
    """
    inspeccion = InspeccionPaquete(valido=False, archivo_zip=zip_path)

    # 1. Listado del ZIP
    info_zip = listar_contenido_zip(zip_path)
    if "error" in info_zip:
        inspeccion.errores.append(info_zip["error"])
        return inspeccion

    if not info_zip["gpkg_principal"]:
        inspeccion.errores.append("El ZIP no contiene data.gpkg ni ningún *.gpkg en raíz")
        return inspeccion

    if not info_zip["dcim_existe"]:
        inspeccion.advertencias.append("El ZIP no contiene carpeta DCIM/ — fotos no se procesarán")

    # 2. Extraer
    if extract_to is None:
        import tempfile
        extract_to = tempfile.mkdtemp(prefix="qfield_inspect_")

    extraer_zip(zip_path, extract_to)

    inspeccion.gpkg_path = os.path.join(extract_to, info_zip["gpkg_principal"])
    if info_zip["dcim_existe"]:
        # Buscar la primera carpeta DCIM en el extract
        for root, dirs, _ in os.walk(extract_to):
            if "DCIM" in dirs:
                inspeccion.dcim_path = os.path.join(root, "DCIM")
                break
        if inspeccion.dcim_path:
            inspeccion.fotos_en_paquete = sorted(
                os.path.join(inspeccion.dcim_path, f)
                for f in os.listdir(inspeccion.dcim_path)
                if os.path.isfile(os.path.join(inspeccion.dcim_path, f))
                and not f.startswith(".")  # ignorar .DS_Store, .keep, etc.
            )

    inspeccion.extra_files = info_zip["qgs_archivos"] + info_zip["otros"]
    if info_zip["zonas"]:
        inspeccion.extra_files.append(info_zip["zonas"])

    if not os.path.isfile(inspeccion.gpkg_path):
        inspeccion.errores.append(f"data.gpkg no encontrado tras extraer: {inspeccion.gpkg_path}")
        return inspeccion

    # 3. Abrir GPKG y analizar
    try:
        conn = sqlite3.connect(f"file:{inspeccion.gpkg_path}?mode=ro", uri=True)
    except sqlite3.OperationalError as exc:
        inspeccion.errores.append(f"No se pudo abrir el GPKG: {exc}")
        return inspeccion

    try:
        inspeccion.estrategia = detectar_estrategia(conn)
        inspeccion.capas = mapear_capas(conn)
        inspeccion.preview = preview_cambios(conn, inspeccion.capas)

        # capas editables presentes
        editables_presentes = [c.postgis_table for c in inspeccion.capas.values() if c.is_editable]
        if not editables_presentes:
            inspeccion.advertencias.append(
                "Ninguna de las tablas editables (lc_predio_p, cr_terreno, cr_unidadconstruccion, "
                "cr_caracteristicasunidadconstruccion, cr_interesado) está presente en el GPKG"
            )

        # En estrategia diff_por_pk el preview por logs queda vacío por diseño;
        # la cuenta real de cambios la calcula qfield_upsert_service.comparar_capa
        # contra PostGIS. No es una advertencia, es lo normal en QField.

        inspeccion.valido = len(inspeccion.errores) == 0
    finally:
        conn.close()

    return inspeccion


# ── Helper de serialización para JSON output ────────────────────────────────

def to_dict(inspeccion: InspeccionPaquete) -> dict:
    """Convierte InspeccionPaquete a dict serializable a JSON."""
    return {
        "valido": inspeccion.valido,
        "archivo_zip": inspeccion.archivo_zip,
        "gpkg_path": inspeccion.gpkg_path,
        "dcim_path": inspeccion.dcim_path,
        "fotos_en_paquete": len(inspeccion.fotos_en_paquete),
        "extra_files": inspeccion.extra_files,
        "estrategia": inspeccion.estrategia,
        "capas": {
            str(c.layer_id): {
                "layer_id": c.layer_id,
                "qgis_table": c.qgis_table,
                "postgis_table": c.postgis_table,
                "is_editable": c.is_editable,
                "geom_col": c.geom_col,
                "feature_count": c.feature_count,
                "schema_cols": len(c.schema),
            }
            for c in inspeccion.capas.values()
        },
        "preview": {
            tabla: {
                "added": p.added,
                "updated_attrs_features": p.updated_attrs_features,
                "updated_geom_features": p.updated_geom_features,
                "removed": p.removed,
            }
            for tabla, p in inspeccion.preview.items()
        },
        "advertencias": inspeccion.advertencias,
        "errores": inspeccion.errores,
    }
