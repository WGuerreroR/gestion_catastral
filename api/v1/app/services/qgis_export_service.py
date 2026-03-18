"""
app/services/qgis_export.py

Orquesta ShapefileService y QgisProjectService para generar
el paquete descargable de un proyecto de asignación.
Llamado directamente desde el router.
"""

import os
import tempfile
from sqlalchemy.orm import Session
from sqlalchemy import text

from services.shapefile_service   import ShapefileService
from services.qgis_project_service import QgisProjectService


def generar_paquete_proyecto(db: Session, proyecto_id: int, clave_proyecto: str) -> bytes:
    """
    1. Lee area_geom (WKT EPSG:9377) desde PostGIS
    2. Copia el proyecto base a una carpeta con clave_proyecto
    3. Reemplaza la geometría en zonas.shp (reproyectando al CRS del shp)
    4. Actualiza el extent del canvas en el .qgz
    5. Comprime y devuelve bytes del .zip
    """

    # ── 1. Obtener WKT desde PostGIS ──────────────────────────────────────────
    row = db.execute(text("""
        SELECT ST_AsText(area_geom) AS wkt
        FROM admin_asignacion
        WHERE id = :id AND area_geom IS NOT NULL
    """), {"id": proyecto_id}).fetchone()

    if not row or not row.wkt:
        raise ValueError("El proyecto no tiene área geométrica definida")

    wkt_9377 = row.wkt

    with tempfile.TemporaryDirectory() as workdir:

        # ── 2. Copiar proyecto base y renombrar .qgz ──────────────────────────
        qgis_svc = QgisProjectService(
            clave_proyecto=clave_proyecto,
            output_base_dir=workdir
        )
        qgis_svc.copiar_proyecto_base()

        # ── 3. Reemplazar geometría en zonas.shp ──────────────────────────────
        shp_path = qgis_svc.get_shp_path()
        shp_svc  = ShapefileService(shp_path)

        shp_svc.reemplazar_geometria(
            wkt_9377=wkt_9377,
            atributos={
                "nombre": clave_proyecto,
                "id":     proyecto_id
            }
        )

        # ── 4. Obtener extent reproyectado y actualizar canvas del .qgz ───────
        xmin, ymin, xmax, ymax = shp_svc.get_extent(wkt_9377)
        qgis_svc.actualizar_extent(xmin, ymin, xmax, ymax)

        # ── 5. Comprimir y devolver bytes ─────────────────────────────────────
        zip_path = qgis_svc.comprimir(workdir)
        with open(zip_path, "rb") as f:
            return f.read()