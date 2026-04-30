#!/usr/bin/env python3
"""
scripts/apply_migrations.py

Aplica los archivos .sql de migrations/ en orden alfabético contra la BD
configurada en DATABASE_URL (leída del .env de api/v1/app/).

Cada archivo se aplica en su propia transacción. Las migraciones de este
proyecto están escritas como idempotentes (IF NOT EXISTS), así que
correrlo dos veces es seguro.

Uso:
    python3 scripts/apply_migrations.py            # aplica todas las pendientes
    python3 scripts/apply_migrations.py --dry-run  # solo lista qué aplicaría
    python3 scripts/apply_migrations.py 003        # aplica solo la(s) que matchea(n) "003"
"""

from __future__ import annotations

import argparse
import glob
import os
import sys

# Asegurar que podamos importar dotenv y sqlalchemy desde el .venv del proyecto si existe
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(SCRIPT_DIR)
APP_DIR = os.path.join(REPO_ROOT, "api", "v1", "app")
MIGRATIONS_DIR = os.path.join(REPO_ROOT, "migrations")

# El .env vive en api/v1/app/.env
ENV_PATH = os.path.join(APP_DIR, ".env")

try:
    from dotenv import load_dotenv
    from sqlalchemy import create_engine, text
except ImportError as exc:
    print(
        f"ERROR: faltan dependencias ({exc}). Instalá:\n"
        "  pip3 install sqlalchemy python-dotenv psycopg2-binary",
        file=sys.stderr,
    )
    sys.exit(1)


def main() -> int:
    parser = argparse.ArgumentParser(description="Aplica migraciones SQL del directorio migrations/")
    parser.add_argument("filtro", nargs="?", default=None,
                        help="Substring opcional para filtrar archivos (ej. '003')")
    parser.add_argument("--dry-run", action="store_true",
                        help="Solo listar archivos que se aplicarían, sin ejecutar")
    args = parser.parse_args()

    if not os.path.isdir(MIGRATIONS_DIR):
        print(f"ERROR: no existe el directorio {MIGRATIONS_DIR}", file=sys.stderr)
        return 1

    archivos = sorted(glob.glob(os.path.join(MIGRATIONS_DIR, "*.sql")))
    if args.filtro:
        archivos = [a for a in archivos if args.filtro in os.path.basename(a)]
    if not archivos:
        print("No hay archivos .sql que aplicar.")
        return 0

    print(f"Migraciones a aplicar ({len(archivos)}):")
    for a in archivos:
        print(f"  - {os.path.basename(a)}")

    if args.dry_run:
        print("\n--dry-run activo, no se ejecuta nada.")
        return 0

    if not os.path.isfile(ENV_PATH):
        print(f"ERROR: no se encontró {ENV_PATH}", file=sys.stderr)
        return 1
    load_dotenv(ENV_PATH)

    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        print("ERROR: DATABASE_URL no está definido en .env", file=sys.stderr)
        return 1

    print(f"\nConectando a: {_ofuscar(db_url)}\n")

    engine = create_engine(db_url, isolation_level="AUTOCOMMIT")
    fallidas: list[tuple[str, str]] = []

    for archivo in archivos:
        nombre = os.path.basename(archivo)
        print(f"→ Aplicando {nombre} ...", end=" ", flush=True)
        try:
            with open(archivo, "r", encoding="utf-8") as f:
                sql = f.read()
            with engine.connect() as conn:
                conn.execute(text(sql))
            print("OK")
        except Exception as exc:
            print(f"FALLA: {exc}")
            fallidas.append((nombre, str(exc)))

    print()
    if fallidas:
        print(f"⚠ {len(fallidas)} migración(es) fallaron:")
        for nombre, err in fallidas:
            print(f"  - {nombre}: {err}")
        return 2

    print("✓ Todas las migraciones aplicadas correctamente.")
    return 0


def _ofuscar(db_url: str) -> str:
    """Oculta el password al imprimir la URL."""
    import re
    return re.sub(r"://([^:]+):([^@]+)@", r"://\1:***@", db_url)


if __name__ == "__main__":
    sys.exit(main())
