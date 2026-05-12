"""Consolida todas las fotos del servidor en un único repo central /app/data/DCIM/.

Fuentes:
  1. /app/data/imgs/*        → repo central legacy
  2. /app/data/exports/*/DCIM/*  → scoped por proyecto (legacy del flujo QField)

Destino:
  /app/data/DCIM/<archivo>

Conflictos de nombre:
  - Mismo nombre + mismo SHA-256 → skip (idempotente).
  - Mismo nombre + contenido distinto → copiar como <base>_dup<N>.<ext> y log.

Después de correr este script con éxito, las carpetas fuente pueden borrarse
manualmente o dejarse hasta confirmar la migración completa. La migración SQL
025_unificar_fotos_dcim.sql actualiza las rutas en BD y debe correrse después.

Uso:
    docker exec aplicacion_v2-api_v1-1 python /app/scripts/migrar_imgs_a_dcim.py
    docker exec aplicacion_v2-api_v1-1 python /app/scripts/migrar_imgs_a_dcim.py --eliminar-fuentes
"""
from __future__ import annotations

import argparse
import hashlib
import os
import shutil
import sys


IMGS_DIR_LEGACY = os.getenv("IMGS_DIR_LEGACY", "/app/data/imgs")
EXPORTS_DIR     = os.getenv("EXPORTS_DIR",     "/app/data/exports")
DCIM_DIR        = os.getenv("DCIM_DIR",        "/app/data/DCIM")


def _sha256(path: str, chunk: int = 65536) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for buf in iter(lambda: f.read(chunk), b""):
            h.update(buf)
    return h.hexdigest()


def _copiar_seguro(origen: str, nombre: str, stats: dict) -> None:
    destino = os.path.join(DCIM_DIR, nombre)
    if not os.path.isfile(origen):
        return
    if os.path.isfile(destino):
        if _sha256(origen) == _sha256(destino):
            stats["skip_idem"] += 1
            return
        base, ext = os.path.splitext(nombre)
        i = 1
        while True:
            nombre_alt = f"{base}_dup{i}{ext}"
            destino_alt = os.path.join(DCIM_DIR, nombre_alt)
            if not os.path.exists(destino_alt):
                shutil.copy2(origen, destino_alt)
                stats["copiadas_dup"] += 1
                stats["advertencias"].append(
                    f"Colisión: {origen} → {nombre_alt} (sha distinto al destino existente)"
                )
                return
            i += 1
    try:
        os.link(origen, destino)
    except OSError:
        shutil.copy2(origen, destino)
    stats["copiadas_nuevas"] += 1


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--eliminar-fuentes", action="store_true",
        help="Tras consolidar, borrar imgs/ y exports/*/DCIM/. Por defecto las conserva.",
    )
    args = parser.parse_args()

    print(f"IMGS_DIR_LEGACY = {IMGS_DIR_LEGACY}")
    print(f"EXPORTS_DIR     = {EXPORTS_DIR}")
    print(f"DCIM_DIR        = {DCIM_DIR}")
    print()

    os.makedirs(DCIM_DIR, exist_ok=True)

    stats = {
        "copiadas_nuevas": 0,
        "copiadas_dup":    0,
        "skip_idem":       0,
        "advertencias":    [],
    }

    if os.path.isdir(IMGS_DIR_LEGACY):
        archivos = sorted(os.listdir(IMGS_DIR_LEGACY))
        print(f"  imgs/: {len(archivos)} archivos")
        for nombre in archivos:
            origen = os.path.join(IMGS_DIR_LEGACY, nombre)
            if os.path.isfile(origen):
                _copiar_seguro(origen, nombre, stats)
    else:
        print(f"  imgs/: no existe, skip")

    if os.path.isdir(EXPORTS_DIR):
        for proyecto in sorted(os.listdir(EXPORTS_DIR)):
            dcim = os.path.join(EXPORTS_DIR, proyecto, "DCIM")
            if not os.path.isdir(dcim):
                continue
            archivos = sorted(os.listdir(dcim))
            print(f"  exports/{proyecto}/DCIM/: {len(archivos)} archivos")
            for nombre in archivos:
                origen = os.path.join(dcim, nombre)
                if os.path.isfile(origen):
                    _copiar_seguro(origen, nombre, stats)

    print()
    print(f"copiadas nuevas:    {stats['copiadas_nuevas']}")
    print(f"copiadas con dup:   {stats['copiadas_dup']}")
    print(f"skip (idempotente): {stats['skip_idem']}")
    if stats["advertencias"]:
        print()
        print("Advertencias:")
        for w in stats["advertencias"]:
            print(f"  - {w}")

    if args.eliminar_fuentes:
        print()
        if os.path.isdir(IMGS_DIR_LEGACY):
            shutil.rmtree(IMGS_DIR_LEGACY)
            print(f"  Eliminado: {IMGS_DIR_LEGACY}")
        if os.path.isdir(EXPORTS_DIR):
            for proyecto in sorted(os.listdir(EXPORTS_DIR)):
                dcim = os.path.join(EXPORTS_DIR, proyecto, "DCIM")
                if os.path.isdir(dcim):
                    shutil.rmtree(dcim)
                    print(f"  Eliminado: {dcim}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
