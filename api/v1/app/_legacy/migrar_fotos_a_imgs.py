"""Migración: centraliza las fotos sincronizadas en el repo común `imgs/`
y reescribe las referencias en BD para que apunten ahí.

Flujo:
  1. Recorre EXPORTS_DIR/<clave_proyecto>/DCIM/ por cada proyecto.
  2. Por cada archivo, llama a `qfield_photo_service.copiar_a_imgs` que
     deja una copia (o hardlink) en IMGS_DIR. Idempotente vía SHA-256.
  3. UPDATE masivo en las columnas `foto*` de lc_predio_p y
     cr_caracteristicasunidadconstruccion: cambia el prefijo `DCIM/` por
     `imgs/`. No toca las que ya están en formato `imgs/...`.

Las fotos físicas en EXPORTS_DIR/<clave>/DCIM/ se conservan — siguen
siendo necesarias para que QField regenere el paquete offline.

Uso:
    docker exec aplicacion_v2-api_v1-1 python /app/migrar_fotos_a_imgs.py

(O `docker cp` el script al contenedor primero si no está montado.)
"""
import os
import sys

sys.path.insert(0, "/app")

from sqlalchemy import text
from db.database import SessionLocal
from services.qgis_export_service import EXPORTS_DIR, IMGS_DIR
from services.qfield_photo_service import copiar_a_imgs


# Columnas conocidas que guardan rutas de foto.
COLUMNAS = [
    ("lc_predio_p",                           ["foto", "foto_2"]),
    ("cr_caracteristicasunidadconstruccion",  [
        "foto_fachada", "foto_banio", "foto_cocina",
        "foto_acabados", "foto_anexo", "foto_industrial",
    ]),
]


def main() -> None:
    print(f"EXPORTS_DIR = {EXPORTS_DIR}")
    print(f"IMGS_DIR    = {IMGS_DIR}")
    print()

    # 1) Copiar archivos físicos
    n_ok = n_fail = 0
    if os.path.isdir(EXPORTS_DIR):
        for proyecto in sorted(os.listdir(EXPORTS_DIR)):
            dcim = os.path.join(EXPORTS_DIR, proyecto, "DCIM")
            if not os.path.isdir(dcim):
                continue
            archivos = sorted(os.listdir(dcim))
            print(f"  {proyecto}: {len(archivos)} archivos en DCIM/")
            for archivo in archivos:
                origen = os.path.join(dcim, archivo)
                if not os.path.isfile(origen):
                    continue
                if copiar_a_imgs(origen, archivo):
                    n_ok += 1
                else:
                    n_fail += 1
    print()
    print(f"Archivos replicados a IMGS_DIR: ok={n_ok}, fallidas={n_fail}")
    print()

    # 2) Reescribir rutas en BD
    db = SessionLocal()
    try:
        total = 0
        for tabla, cols in COLUMNAS:
            for col in cols:
                try:
                    res = db.execute(text(f"""
                        UPDATE {tabla}
                           SET "{col}" = 'imgs/' || substring("{col}" from 6)
                         WHERE "{col}" LIKE 'DCIM/%'
                    """))
                    n = res.rowcount or 0
                    print(f"  {tabla}.{col}: {n} filas")
                    total += n
                except Exception as e:
                    db.rollback()
                    print(f"  {tabla}.{col}: SKIP ({str(e)[:80]})")
        db.commit()
        print()
        print(f"Total referencias reescritas: {total}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
