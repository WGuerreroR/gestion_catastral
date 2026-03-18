"""
app/services/qgis_project_service.py

Clase que maneja la copia y preparación del proyecto QGIS:
  - Copia el proyecto base a una carpeta nueva con clave_proyecto
  - Renombra el .qgz con el nombre de la clave
  - Actualiza el extent del canvas en el .qgs XML
  - Comprime el resultado en un .zip para descarga
  - NO modifica el proyecto original
"""

import os
import glob
import shutil
import zipfile
from lxml import etree


PROYECTO_BASE_DIR = "/app/data/proyecto_base"


class QgisProjectService:

    def __init__(self, clave_proyecto: str, output_base_dir: str):
        """
        clave_proyecto  : identificador del proyecto (nombre de la carpeta y del .qgz)
        output_base_dir : directorio temporal donde se creará la carpeta de trabajo
        """
        self.clave_proyecto  = clave_proyecto
        self.output_dir      = os.path.join(output_base_dir, clave_proyecto)
        self.qgz_path        = None   # se asigna tras copiar

    # ── Paso 1: Copiar proyecto base ─────────────────────────────────────────

    def copiar_proyecto_base(self):
        """
        Copia toda la carpeta proyecto_base a output_dir y renombra el .qgz
        con clave_proyecto. Devuelve la ruta del nuevo .qgz.
        """
        if not os.path.isdir(PROYECTO_BASE_DIR):
            raise FileNotFoundError(f"No se encontró el directorio base: {PROYECTO_BASE_DIR}")

        # Copiar carpeta completa (sin modificar el original)
        shutil.copytree(PROYECTO_BASE_DIR, self.output_dir)

        # Renombrar el .qgz al nombre de la clave del proyecto
        qgz_files = glob.glob(os.path.join(self.output_dir, "*.qgz"))
        if not qgz_files:
            raise FileNotFoundError("No se encontró .qgz en el proyecto base")

        nuevo_nombre = os.path.join(self.output_dir, f"{self.clave_proyecto}.qgz")
        os.rename(qgz_files[0], nuevo_nombre)
        self.qgz_path = nuevo_nombre

        return self.qgz_path

    # ── Paso 2: Actualizar extent en el .qgs XML ─────────────────────────────

    def actualizar_extent(self, xmin: float, ymin: float, xmax: float, ymax: float):
        """
        Abre el .qgz (zip), modifica el extent del canvas en el .qgs (XML)
        con un margen del 5% y lo vuelve a guardar en el mismo .qgz.
        """
        if not self.qgz_path:
            raise RuntimeError("Primero llama a copiar_proyecto_base()")

        # Margen 5%
        dx = (xmax - xmin) * 0.05
        dy = (ymax - ymin) * 0.05
        exmin = xmin - dx
        eymin = ymin - dy
        exmax = xmax + dx
        eymax = ymax + dy

        # Descomprimir, modificar XML, recomprimir
        tmp_extract = self.qgz_path + "_extracted"
        with zipfile.ZipFile(self.qgz_path, "r") as zf:
            zf.extractall(tmp_extract)

        qgs_files = glob.glob(os.path.join(tmp_extract, "*.qgs"))
        if not qgs_files:
            shutil.rmtree(tmp_extract, ignore_errors=True)
            raise FileNotFoundError("No se encontró .qgs dentro del .qgz")

        qgs_path = qgs_files[0]
        self._parchear_extent_xml(qgs_path, exmin, eymin, exmax, eymax)

        # Recomprimir
        with zipfile.ZipFile(self.qgz_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for root_dir, _, files in os.walk(tmp_extract):
                for fname in files:
                    fpath   = os.path.join(root_dir, fname)
                    arcname = os.path.relpath(fpath, tmp_extract)
                    zf.write(fpath, arcname)

        shutil.rmtree(tmp_extract, ignore_errors=True)

    def _parchear_extent_xml(self, qgs_path: str,
                              xmin: float, ymin: float,
                              xmax: float, ymax: float):
        """Modifica el nodo <extent> del <mapcanvas> en el XML del .qgs"""
        with open(qgs_path, "rb") as f:
            root = etree.fromstring(f.read())

        for canvas in root.findall(".//mapcanvas"):
            extent_node = canvas.find("extent")
            if extent_node is None:
                continue
            for tag, val in [("xmin", xmin), ("ymin", ymin),
                              ("xmax", xmax), ("ymax", ymax)]:
                node = extent_node.find(tag)
                if node is not None:
                    node.text = str(val)

        with open(qgs_path, "wb") as f:
            f.write(etree.tostring(
                root,
                xml_declaration=True,
                encoding="UTF-8",
                pretty_print=True
            ))

    # ── Paso 3: Ruta del shapefile zonas en la copia ─────────────────────────

    def get_shp_path(self) -> str:
        """Devuelve la ruta del zonas.shp dentro de la copia del proyecto."""
        shp = os.path.join(self.output_dir, "zonas.shp")
        if not os.path.exists(shp):
            raise FileNotFoundError(f"No se encontró zonas.shp en {self.output_dir}")
        return shp

    # ── Paso 4: Comprimir para descarga ──────────────────────────────────────

    def comprimir(self, destino: str) -> str:
        """
        Comprime output_dir en un .zip en destino.
        Devuelve la ruta del .zip generado.
        """
        zip_path = os.path.join(destino, f"{self.clave_proyecto}.zip")
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for root_dir, _, files in os.walk(self.output_dir):
                for fname in files:
                    fpath   = os.path.join(root_dir, fname)
                    arcname = os.path.relpath(fpath, self.output_dir)
                    zf.write(fpath, arcname)
        return zip_path
