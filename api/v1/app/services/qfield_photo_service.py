"""
app/services/qfield_photo_service.py

Copia las fotos del DCIM/ del paquete offline al directorio
`EXPORTS_DIR/{clave_proyecto}/DCIM/` (carpeta por asignación).

Las rutas en PostGIS quedan en formato relativo (`DCIM/foto.jpg`) — el
mismo que viene del GPKG y el mismo que QField espera al regenerar el
paquete offline. La resolución a archivo físico se hace en el endpoint
de recuperación de fotos, que combina la clave del proyecto con la
ruta relativa para construir el path completo.

Maneja colisiones (mismo nombre, contenido distinto), fotos huérfanas
(en paquete pero no referenciadas en BD) y faltantes (referenciadas en
BD pero no en paquete).
"""

from __future__ import annotations

import hashlib
import os
import shutil
import sqlite3
from dataclasses import dataclass, field
from typing import Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from services.qfield_upsert_service import CAPAS_EDITABLES
from services.qgis_export_service import EXPORTS_DIR


DCIM_SUBDIR = "DCIM"


@dataclass
class ResumenFotos:
    encontradas_en_paquete:   int = 0
    referenciadas_en_bd:      int = 0
    copiadas_nuevas:          int = 0
    skip_idem:                int = 0  # archivo ya existía con mismo contenido
    colisiones_nombre:        int = 0
    huerfanas_copiadas:       int = 0
    faltantes_referenciadas:  int = 0
    fallidas:                 int = 0
    advertencias:             list[str] = field(default_factory=list)
    errores:                  list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "encontradas_en_paquete":   self.encontradas_en_paquete,
            "referenciadas_en_bd":      self.referenciadas_en_bd,
            "copiadas_nuevas":          self.copiadas_nuevas,
            "skip_idem":                self.skip_idem,
            "colisiones_nombre":        self.colisiones_nombre,
            "huerfanas_copiadas":       self.huerfanas_copiadas,
            "faltantes_referenciadas":  self.faltantes_referenciadas,
            "fallidas":                 self.fallidas,
            "advertencias":             self.advertencias,
            "errores":                  self.errores,
        }


# ── Helpers ──────────────────────────────────────────────────────────────────

def _solo_basename(ruta: str) -> str:
    """`DCIM/IMG_xxx.jpg` → `IMG_xxx.jpg`. Acepta path absoluto o relativo."""
    if not ruta:
        return ""
    return os.path.basename(ruta.replace("\\", "/"))


def _aplicar_sufijo_colision(nombre: str, sync_id: int) -> str:
    """`IMG_xxx.jpg` → `IMG_xxx_collision_42.jpg`."""
    base, ext = os.path.splitext(nombre)
    return f"{base}_collision_{sync_id}{ext}"


def _archivos_son_iguales(a: str, b: str) -> bool:
    """Compara dos archivos por tamaño + hash SHA-256."""
    try:
        if os.path.getsize(a) != os.path.getsize(b):
            return False

        def _hash(path: str) -> str:
            h = hashlib.sha256()
            with open(path, "rb") as f:
                for chunk in iter(lambda: f.read(64 * 1024), b""):
                    h.update(chunk)
            return h.hexdigest()

        return _hash(a) == _hash(b)
    except OSError:
        return False


# ── Lectura de referencias en GPKG (fuente de verdad del paquete actual) ────

def _referencias_gpkg(
    conn_gpkg: sqlite3.Connection,
    capas_info: dict,
) -> dict[str, list[tuple[str, str, str]]]:
    """
    Lee los campos foto de cada capa editable presente en el GPKG.

    Devuelve `{ basename_archivo: [(qgis_table, pk_value, campo), ...] }`,
    es decir un mapa del nombre de archivo a las celdas que lo referencian
    (puede ser >1 si la misma foto se usa en varias filas/campos).

    Las claves usan basename (sin "DCIM/") porque eso es lo que tienen los
    archivos físicamente en disco.
    """
    referencias: dict[str, list[tuple[str, str, str]]] = {}

    for capa in capas_info.values():
        if not getattr(capa, "is_editable", False):
            continue
        cfg = CAPAS_EDITABLES.get(capa.postgis_table)
        if not cfg:
            continue
        campos = cfg.get("campos_foto") or []
        if not campos:
            continue

        pk = cfg["pk_negocio"]
        cols_q = ", ".join('"' + c + '"' for c in [pk] + campos)
        try:
            cur = conn_gpkg.execute(
                f'SELECT {cols_q} FROM "{capa.qgis_table}" WHERE "{pk}" IS NOT NULL'
            )
        except sqlite3.OperationalError:
            continue

        for fila in cur.fetchall():
            pk_val = fila[0]
            for i, campo in enumerate(campos, start=1):
                ruta = fila[i]
                if not ruta:
                    continue
                nombre = _solo_basename(ruta)
                if not nombre:
                    continue
                referencias.setdefault(nombre, []).append(
                    (capa.qgis_table, pk_val, campo)
                )

    return referencias


# ── Reescritura de rutas en BD ──────────────────────────────────────────────

def _reescribir_referencias_bd(
    db: Session,
    celdas: list[tuple[str, str, str]],
    ruta_nueva: str,
    res: ResumenFotos,
) -> None:
    """
    Para cada celda (qgis_table, pk_value, campo), actualiza el campo
    correspondiente en PostGIS con `ruta_nueva` (path relativo al
    EXPORTS_DIR, ej. "MZ_019/DCIM/foto.jpg").

    Idempotente: si la fila ya tiene ese valor, el UPDATE no cambia nada.
    """
    from services.qfield_gpkg_inspector import quitar_uuid

    for qgis_table, pk_val, campo in celdas:
        postgis_table = quitar_uuid(qgis_table)
        cfg = CAPAS_EDITABLES.get(postgis_table)
        if not cfg:
            res.errores.append(
                f"reescritura ruta foto: capa no editable {postgis_table}"
            )
            continue
        pk_col = cfg["pk_negocio"]
        try:
            db.execute(
                text(
                    f'UPDATE {postgis_table} '
                    f'SET "{campo}" = :ruta '
                    f'WHERE "{pk_col}" = :pk'
                ),
                {"ruta": ruta_nueva, "pk": pk_val},
            )
        except Exception as exc:
            res.errores.append(
                f"reescritura ruta {postgis_table}.{campo} pk={pk_val}: {exc}"
            )


# ── API pública ──────────────────────────────────────────────────────────────

def procesar_dcim(
    carpeta_dcim_paquete: Optional[str],
    sync_id: int,
    conn_gpkg: sqlite3.Connection,
    capas_info: dict,
    db: Session,
    clave_proyecto: str,
) -> ResumenFotos:
    """
    Copia las fotos del DCIM del paquete a `EXPORTS_DIR/{clave_proyecto}/DCIM/`
    y reescribe las rutas en PostGIS al formato `{clave_proyecto}/DCIM/{file}`.

    Args:
        carpeta_dcim_paquete: ruta absoluta al DCIM/ extraído del ZIP.
            Si es None o no existe, se reporta sin error y no se hace nada.
        sync_id: id de la sync_history actual; se usa para sufijo de colisión.
        conn_gpkg: conexión sqlite3 read-only al data.gpkg del paquete.
        capas_info: dict {layer_id: CapaInfo} del inspector.
        db: sesión SQLAlchemy.
        clave_proyecto: clave de la asignación (ej. "MZ_019"). Se usa como
            subdirectorio destino y como prefijo de la ruta en BD.

    Returns:
        ResumenFotos con conteos detallados.
    """
    res = ResumenFotos()

    if not carpeta_dcim_paquete or not os.path.isdir(carpeta_dcim_paquete):
        res.advertencias.append(
            "El paquete no contiene carpeta DCIM/ — fotos no procesadas"
        )
        return res

    if not clave_proyecto:
        res.errores.append("clave_proyecto vacía — no se puede determinar destino")
        return res

    destino_dir = os.path.join(EXPORTS_DIR, clave_proyecto, DCIM_SUBDIR)
    try:
        os.makedirs(destino_dir, exist_ok=True)
    except Exception as exc:
        res.errores.append(f"No se pudo crear/acceder a {destino_dir}: {exc}")
        return res

    # 1. Listar archivos del paquete (ignorar hidden)
    archivos_paquete: dict[str, str] = {}  # basename → path completo
    for nombre in os.listdir(carpeta_dcim_paquete):
        if nombre.startswith("."):
            continue
        ruta = os.path.join(carpeta_dcim_paquete, nombre)
        if os.path.isfile(ruta):
            archivos_paquete[nombre] = ruta
    res.encontradas_en_paquete = len(archivos_paquete)

    # 2. Leer referencias del GPKG
    referencias = _referencias_gpkg(conn_gpkg, capas_info)
    res.referenciadas_en_bd = sum(len(v) for v in referencias.values())

    # 3. Procesar cada foto referenciada: copiar al destino + reescribir BD
    procesados: set[str] = set()
    for nombre_ref, celdas in referencias.items():
        procesados.add(nombre_ref)
        ruta_origen = archivos_paquete.get(nombre_ref)
        if not ruta_origen:
            res.faltantes_referenciadas += 1
            res.advertencias.append(
                f"Foto referenciada en BD pero no presente en el paquete: {nombre_ref}"
            )
            continue

        ruta_destino = os.path.join(destino_dir, nombre_ref)

        try:
            if not os.path.exists(ruta_destino):
                shutil.copy2(ruta_origen, ruta_destino)
                res.copiadas_nuevas += 1
            elif _archivos_son_iguales(ruta_origen, ruta_destino):
                # El archivo ya está en destino con el mismo contenido — típico
                # de un re-sync del mismo paquete. Skip silencioso.
                res.skip_idem += 1
            else:
                # Colisión real: nombre igual, contenido distinto. Copiar con
                # sufijo y reescribir BD apuntando al archivo renombrado
                # (manteniendo el formato relativo "DCIM/{nombre_colision}").
                nombre_colision = _aplicar_sufijo_colision(nombre_ref, sync_id)
                shutil.copy2(ruta_origen, os.path.join(destino_dir, nombre_colision))
                res.colisiones_nombre += 1
                ruta_relativa_nueva = f"{DCIM_SUBDIR}/{nombre_colision}"
                _reescribir_referencias_bd(db, celdas, ruta_relativa_nueva, res)
                res.advertencias.append(
                    f"Colisión: {nombre_ref} ya existía con contenido distinto. "
                    f"Copiado como {nombre_colision}; campos en BD reescritos a "
                    f"{ruta_relativa_nueva}"
                )
        except Exception as exc:
            res.fallidas += 1
            res.errores.append(f"{nombre_ref}: {exc}")

    # 4. Huérfanas: archivos en el paquete que no aparecen en ninguna referencia
    for nombre, ruta_origen in archivos_paquete.items():
        if nombre in procesados:
            continue
        ruta_destino = os.path.join(destino_dir, nombre)
        try:
            if os.path.exists(ruta_destino):
                if _archivos_son_iguales(ruta_origen, ruta_destino):
                    res.skip_idem += 1
                    continue
                nombre_colision = _aplicar_sufijo_colision(nombre, sync_id)
                shutil.copy2(ruta_origen, os.path.join(destino_dir, nombre_colision))
                res.huerfanas_copiadas += 1
            else:
                shutil.copy2(ruta_origen, ruta_destino)
                res.huerfanas_copiadas += 1
        except Exception as exc:
            res.fallidas += 1
            res.errores.append(f"huérfana {nombre}: {exc}")

    return res
