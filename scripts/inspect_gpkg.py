#!/usr/bin/env python3
"""
scripts/inspect_gpkg.py

CLI standalone para inspeccionar un paquete offline de QField (zip con
data.gpkg + DCIM/) sin tocar PostGIS ni levantar la API.

Uso:
    python scripts/inspect_gpkg.py /path/a/MZ_XX.zip
    python scripts/inspect_gpkg.py /path/a/MZ_XX.zip --keep-extracted

Útil para:
  - Verificar la estrategia de aplicación (logs de QGIS Offline Editing vs diff por PK)
  - Ver qué tablas editables están presentes y cuántos cambios pendientes tiene cada una
  - Diagnosticar paquetes que vienen de QField Cloud o de QGIS Desktop
"""

import argparse
import json
import os
import shutil
import sys
import tempfile

# Permitir ejecutar el script desde la raíz del repo sin instalación
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(SCRIPT_DIR)
sys.path.insert(0, os.path.join(REPO_ROOT, "api", "v1", "app"))

from services.qfield_gpkg_inspector import inspeccionar_paquete, to_dict  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Inspecciona un paquete offline de QField (zip con data.gpkg + DCIM/)"
    )
    parser.add_argument("zip_path", help="Ruta al ZIP del paquete offline")
    parser.add_argument(
        "--keep-extracted",
        action="store_true",
        help="No borrar la carpeta temporal de extracción (útil para debug)",
    )
    parser.add_argument(
        "--extract-to",
        default=None,
        help="Carpeta donde extraer el ZIP (default: tempdir nuevo)",
    )
    args = parser.parse_args()

    if not os.path.isfile(args.zip_path):
        print(f"ERROR: archivo no encontrado: {args.zip_path}", file=sys.stderr)
        return 1

    extract_to = args.extract_to or tempfile.mkdtemp(prefix="qfield_inspect_cli_")
    cleanup = (not args.keep_extracted) and (args.extract_to is None)

    try:
        inspeccion = inspeccionar_paquete(args.zip_path, extract_to=extract_to)
        salida = to_dict(inspeccion)
        salida["_extract_to"] = extract_to
        salida["_cleanup_on_exit"] = cleanup
        print(json.dumps(salida, indent=2, ensure_ascii=False))
        return 0 if inspeccion.valido else 2
    finally:
        if cleanup and os.path.isdir(extract_to):
            shutil.rmtree(extract_to, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
