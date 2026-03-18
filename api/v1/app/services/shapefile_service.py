"""
app/services/shapefile_service.py

Clase que maneja la manipulación del shapefile 'zonas':
  - Reproyecta la geometría de EPSG:9377 al CRS del shapefile original
  - Reemplaza la geometría en la copia del shapefile
  - Usa osgeo.ogr (GDAL, ya disponible en la imagen qgis/qgis:final)
"""

import os
from osgeo import ogr, osr


class ShapefileService:

    SRID_POSTGIS = 9377   # CRS en el que viene area_geom desde PostGIS

    def __init__(self, shp_path: str):
        """
        shp_path: ruta completa al archivo .shp a modificar (la copia, no el original)
        """
        self.shp_path = shp_path

    def _detectar_crs_shp(self) -> osr.SpatialReference:
        """Lee el CRS del shapefile desde su .prj"""
        ds = ogr.Open(self.shp_path)
        if ds is None:
            raise FileNotFoundError(f"No se pudo abrir el shapefile: {self.shp_path}")
        layer = ds.GetLayer(0)
        srs   = layer.GetSpatialRef()
        ds    = None
        if srs is None:
            raise ValueError(f"El shapefile no tiene CRS definido: {self.shp_path}")
        return srs

    def _reproyectar_wkt(self, wkt_9377: str, srs_destino: osr.SpatialReference) -> ogr.Geometry:
        """
        Convierte WKT en EPSG:9377 al CRS destino.
        Devuelve un ogr.Geometry ya reproyectado.
        """
        srs_origen = osr.SpatialReference()
        srs_origen.ImportFromEPSG(self.SRID_POSTGIS)

        # Respetar el orden de ejes tal como viene de PostGIS
        srs_origen.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
        srs_destino.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)

        geom = ogr.CreateGeometryFromWkt(wkt_9377, srs_origen)
        if geom is None:
            raise ValueError("WKT inválido — no se pudo crear la geometría")

        # Solo reproyectar si los CRS son distintos
        if not srs_origen.IsSame(srs_destino):
            transform = osr.CoordinateTransformation(srs_origen, srs_destino)
            err = geom.Transform(transform)
            if err != 0:
                raise RuntimeError(f"Error reproyectando geometría (código GDAL: {err})")

        return geom

    def reemplazar_geometria(self, wkt_9377: str, atributos: dict = None):
        """
        Reemplaza todas las features del shapefile por una nueva
        con la geometría dada (WKT en EPSG:9377).

        atributos: dict opcional con campos a setear en la feature
                   ej: {"nombre": "PRY-001", "id": 1}
        """
        srs_destino = self._detectar_crs_shp()
        geom        = self._reproyectar_wkt(wkt_9377, srs_destino)

        driver = ogr.GetDriverByName("ESRI Shapefile")
        ds     = driver.Open(self.shp_path, 1)   # 1 = escritura
        if ds is None:
            raise FileNotFoundError(f"No se pudo abrir el shapefile para escritura: {self.shp_path}")

        layer = ds.GetLayer(0)

        # Borrar todas las features existentes
        layer.ResetReading()
        for feat in layer:
            layer.DeleteFeature(feat.GetFID())

        # Crear nueva feature
        layer_defn = layer.GetLayerDefn()
        new_feat   = ogr.Feature(layer_defn)
        new_feat.SetGeometry(geom)

        # Setear atributos si el campo existe
        if atributos:
            for campo, valor in atributos.items():
                idx = layer_defn.GetFieldIndex(campo)
                if idx >= 0:
                    new_feat.SetField(campo, valor)

        layer.CreateFeature(new_feat)

        # Flush y cerrar
        layer.SyncToDisk()
        ds.FlushCache()
        ds = None

    def get_extent(self, wkt_9377: str) -> tuple:
        """
        Devuelve el extent (xmin, ymin, xmax, ymax) de la geometría
        ya reproyectada al CRS del shapefile.
        Útil para centrar el proyecto QGIS.
        """
        srs_destino = self._detectar_crs_shp()
        geom        = self._reproyectar_wkt(wkt_9377, srs_destino)
        env = geom.GetEnvelope()   # (xmin, xmax, ymin, ymax)
        return (env[0], env[2], env[1], env[3])   # (xmin, ymin, xmax, ymax)