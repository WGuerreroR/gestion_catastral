"""
app/services/qgis_project_service.py

Clase que maneja la copia y preparación del proyecto QGIS:
  - Copia el proyecto base a una carpeta nueva con clave_proyecto
  - Renombra el .qgz con el nombre de la clave
  - Actualiza el extent del canvas en el .qgs XML
  - Empaqueta capas PostGIS para uso offline (dos métodos disponibles)
  - Comprime el resultado en un .zip para descarga
  - NO modifica el proyecto original
"""

import os
import glob
import shutil
import zipfile
from lxml import etree
from qgis.core import (
    Qgis,
    QgsProject,
    QgsOfflineEditing,
    QgsVectorLayer,
    QgsMapLayer,
    QgsRectangle,
    QgsReferencedRectangle,
    QgsDataSourceUri,
    QgsCoordinateTransform,
    QgsCsException,
)

# Ruta absoluta a `proyecto_base/` dentro del contenedor. Configurable
# por env var `PROYECTO_BASE_PATH` (compartida con qfield_photo_service).
PROYECTO_BASE_DIR = os.environ.get("PROYECTO_BASE_PATH", "/app/data/proyecto_base")


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

    # ── Reparche de conexiones PostGIS en memoria ────────────────────────────

    @staticmethod
    def _reparchar_conexiones_postgis(project):
        """
        Reparcha en memoria el host/puerto/db/usuario/password de toda capa
        PostGIS inválida, usando DATABASE_URL del entorno. No toca el .qgs
        en disco. Devuelve (reparadas, siguen_invalidas) para logging.
        """
        import re
        print("-- _reparchar_conexiones_postgis 1")
        db_url = os.getenv("DATABASE_URL", "")
        m = re.match(
            r"postgresql(?:\+\w+)?://([^:]+):([^@]+)@([^:/]+):?(\d+)?/(.+)",
            db_url,
        )
        print("-- _reparchar_conexiones_postgis 2")
        if not m:
            print("[POSTGIS REPARCHE] DATABASE_URL inválida o ausente — se omite")
            return [], []
        user, pwd, host, port, dbname = m.groups()
        port = port or "5432"
        print("-- _reparchar_conexiones_postgis 3")
        reparadas        = []
        siguen_invalidas = []
        print("-- _reparchar_conexiones_postgis 4")
        for layer in project.mapLayers().values():
            print("-- _reparchar_conexiones_postgis 5")
            if not isinstance(layer, QgsVectorLayer):
                continue
           
            print("-- _reparchar_conexiones_postgis layer.isValid() ",layer.isValid())
            source = layer.source()
            if "dbname=" not in source:
                continue
            if layer.isValid():
                continue
            print("-- _reparchar_conexiones_postgis 6")
            uri = QgsDataSourceUri(layer.source())
            print("-- _reparchar_conexiones_postgis 7")
            uri = QgsDataSourceUri(layer.source())

            # extraer info existente
            schema = uri.schema()
            table = uri.table()
            geom = uri.geometryColumn()
            sql = uri.sql()
            key = uri.keyColumn()

            # volver a armar conexión
            uri.setConnection(host, port, dbname, user, pwd)

            # MUY IMPORTANTE: volver a definir la capa
            uri.setDataSource(schema, table, geom, sql, key)

            layer.setDataSource(uri.uri(False), layer.name(), "postgres")
        
            if layer.isValid():
                reparadas.append(layer.name())
            else:
                siguen_invalidas.append(layer.name())
        print("*** _reparchar_conexiones_postgis ",siguen_invalidas)
        return reparadas, siguen_invalidas

    # ── Paso 3: Ruta del shapefile zonas en la copia ─────────────────────────

    def get_shp_path(self) -> str:
        """Devuelve la ruta del zonas.shp dentro de la copia del proyecto."""
        shp = os.path.join(self.output_dir, "zonas.shp")
        if not os.path.exists(shp):
            raise FileNotFoundError(f"No se encontró zonas.shp en {self.output_dir}")
        return shp

    # ── Paso 5A: Offline con QgsOfflineEditing (QFieldSync) ──────────────────

    def empaquetar_offline_qfieldsync(
        self,
        predios_ids: list,
        extent: tuple[float, float, float, float] | None = None,
        on_progress: "callable | None" = None,
    ):
        """
        Convierte las capas PostGIS del proyecto a offline.gpkg usando
        QgsOfflineEditing, siguiendo el patrón de libqfieldsync.

        Si se provee bbox (QgsRectangle en el CRS del proyecto), cada capa
        vectorial con geometría se filtra espacialmente con selectByRect y se
        pasa onlySelected=True — exactamente como lo hace QFieldSync.
        Si no hay bbox y se reciben predios_ids, se aplica setSubsetString en
        capas cuyo nombre contenga "predio".

        El .qgz se elimina al final: output_dir queda con archivos sueltos
        (.qgs + offline.gpkg + shapefiles) listos para subir a QField Cloud.

        Requiere QgsApplication inicializado (ver main.py lifespan).
        """
        print("*** 3")
        if not self.qgz_path:
            raise RuntimeError("Primero llama a copiar_proyecto_base()")

        # Extraer el .qgz en output_dir para que el .qgs quede al lado de
        # zonas.shp — así QgsProject resuelve correctamente las rutas relativas.
        with zipfile.ZipFile(self.qgz_path, "r") as zf:
            zf.extractall(self.output_dir)

        qgs_files = glob.glob(os.path.join(self.output_dir, "*.qgs"))
        if not qgs_files:
            raise FileNotFoundError("No se encontró .qgs dentro del .qgz")

        qgs_path = qgs_files[0]
        print("*** 1")
        # ── Cargar proyecto ───────────────────────────────────────────────────
        project = QgsProject.instance()
        if not project.read(qgs_path):
            raise RuntimeError(f"No se pudo abrir el proyecto QGIS: {qgs_path}")
        print("*** 1.5")
        # ── Reparche en memoria de conexiones PostGIS inválidas ──────────────
        """
        reparadas, siguen_invalidas = self._reparchar_conexiones_postgis(project)
        print("*** reparadas ",reparadas)
        if reparadas:
            print(f"[POSTGIS REPARCHE] capas reconectadas: {reparadas}")
        if siguen_invalidas:
            print(f"[POSTGIS REPARCHE][WARN] capas que siguen inválidas: {siguen_invalidas}")
        """
        layers        = list(project.mapLayers().values())
        only_selected = False
        print("*** 2")
        # ── Diagnóstico: estado de cada capa tras cargar el proyecto ─────────
        print(f"[OFFLINE] Proyecto cargado, {len(layers)} capas encontradas:")
        for layer in layers:
            valido   = "OK" if layer.isValid() else "INVÁLIDA"
            provider = layer.dataProvider().name() if layer.dataProvider() else "?"
            if isinstance(layer, QgsVectorLayer):
                total = layer.featureCount()
                print(f"  [{valido}] {layer.name()} (provider={provider}, geom={layer.geometryType()}, features={total})")
            else:
                print(f"  [{valido}] {layer.name()} (provider={provider}, type={layer.type()})")

        # ── Filtro espacial por bbox (patrón libqfieldsync) ──────────────────
        # Selecciona features intersectando el bbox en cada capa vectorial con
        # geometría y luego pasa only_selected=True a convertToOfflineProject.
        # Capas sin geometría: removeSelection() → QgsOfflineEditing exporta
        # todas sus filas (necesario para tablas alfanuméricas).
        if extent:
            only_selected = True
            xmin, ymin, xmax, ymax = extent
            bbox = QgsRectangle(xmin, ymin, xmax, ymax)

            if Qgis.versionInt() >= 33000:
                no_geometry_types = [Qgis.GeometryType.Null, Qgis.GeometryType.Unknown]
            else:
                from qgis.core import QgsWkbTypes
                no_geometry_types = [
                    QgsWkbTypes.GeometryType.NullGeometry,
                    QgsWkbTypes.GeometryType.UnknownGeometry,
                ]

            for layer in layers:
                if layer.type() != QgsMapLayer.LayerType.VectorLayer:
                    continue
                assert isinstance(layer, QgsVectorLayer)

                if layer.geometryType() in no_geometry_types:
                    # Tabla sin geometría: limpiar selección → exporta todo
                    layer.removeSelection()
                    continue

                tr = QgsCoordinateTransform(project.crs(), layer.crs(), project)
                try:
                    layer_bbox = tr.transform(bbox)
                    layer.selectByRect(layer_bbox)
                except QgsCsException as err:
                    print(
                        f"[BBOX FILTER][WARN] No se pudo transformar bbox "
                        f"{project.crs().authid()} → {layer.crs().authid()} "
                        f"para '{layer.name()}': {err}. Se exportarán todas las features."
                    )

                # Centinela: si la selección quedó vacía usar FID_NULL (-1)
                # para que QgsOfflineEditing no vuelque todas las features.
                if layer.selectedFeatureCount() == 0:
                    layer.selectByIds([-1])

                print(f"[BBOX FILTER] {layer.name()}: {layer.selectedFeatureCount()} features seleccionadas")
        # ── Convertir a offline (TODAS las features de capas no-predio) ──────
        # Nota: only_selected=False evita que capas sin selección se exporten
        # vacías. El filtro de predios se aplica vía setSubsetString arriba.
        layer_ids      = [layer.id() for layer in layers]
        print("*** 4")
        print(layer_ids)

        offline_editor = QgsOfflineEditing()

        # Log de warnings internos de QgsOfflineEditing (capas que fallan)
        offline_editor.warning.connect(
            lambda title, msg: print(f"[OFFLINE WARNING] {title}: {msg}")
        )
        print("*** 5")
        if on_progress:
            def _layer_progress(layer_num: int, total: int):
                if total > 0:
                    on_progress(int(layer_num / total * 100))
            offline_editor.layerProgressUpdated.connect(_layer_progress)
        print(layer_ids)
        print("*** 6")
        exito = offline_editor.convertToOfflineProject(
            self.output_dir,
            "offline.gpkg",
            layer_ids,
            only_selected,
            containerType=QgsOfflineEditing.ContainerType.GPKG,
            layerNameSuffix=None,
        )

        if not exito:
            project.clear()
            raise RuntimeError("QgsOfflineEditing.convertToOfflineProject() falló")

        # ── Fijar título del proyecto (aparece en la barra de QGIS/QField) ───
        project.setTitle(self.clave_proyecto)

        # ── Fijar zoom inicial sobre el área del proyecto (API oficial) ──────
        # QField/QGIS 3.x leen ProjectViewSettings/DefaultViewExtent para el
        # zoom inicial. No alcanza con patchar <mapcanvas> en el XML.
        if extent:
            xmin, ymin, xmax, ymax = extent
            dx = (xmax - xmin) * 0.05
            dy = (ymax - ymin) * 0.05
            rect     = QgsRectangle(xmin - dx, ymin - dy, xmax + dx, ymax + dy)
            ref_rect = QgsReferencedRectangle(rect, project.crs())
            project.viewSettings().setDefaultViewExtent(ref_rect)
            project.viewSettings().setPresetFullExtent(ref_rect)

        # ── Guardar y liberar ─────────────────────────────────────────────────
        project.write(qgs_path)
        project.clear()

        # ── Renombrar .qgs (y attachments) al código del proyecto ────────────
        target_qgs = os.path.join(self.output_dir, f"{self.clave_proyecto}.qgs")
        if qgs_path != target_qgs:
            os.rename(qgs_path, target_qgs)
            original_base = os.path.splitext(os.path.basename(qgs_path))[0]
            old_attach    = os.path.join(self.output_dir, f"{original_base}_attachments.zip")
            new_attach    = os.path.join(self.output_dir, f"{self.clave_proyecto}_attachments.zip")
            if os.path.exists(old_attach):
                os.rename(old_attach, new_attach)
            qgs_path = target_qgs

        # ── Centrar canvas en el bbox del área del proyecto (margen 5%) ──────
        if extent:
            xmin, ymin, xmax, ymax = extent
            dx = (xmax - xmin) * 0.05
            dy = (ymax - ymin) * 0.05
            self._parchear_extent_xml(
                qgs_path,
                xmin - dx, ymin - dy,
                xmax + dx, ymax + dy,
            )

        # Eliminar el .qgz — subimos archivos sueltos a QField Cloud
        if os.path.exists(self.qgz_path):
            os.remove(self.qgz_path)

    # ── Paso 5B: Offline con XML + GDAL/OGR (fallback sin QgsApplication) ────

    def empaquetar_offline_xml(self, predios_ids: list, db_url: str):
        """
        Alternativa sin QgsApplication: exporta las capas PostGIS a GeoPackage
        usando osgeo.ogr y parchea los datasources en el XML del .qgs.

        predios_ids : lista de id_operacion a incluir (filtro por atributo).
        db_url      : DATABASE_URL (postgresql://user:pass@host:port/db)
                      para construir la conexión OGR.
        """
        if not self.qgz_path:
            raise RuntimeError("Primero llama a copiar_proyecto_base()")

        import re
        from osgeo import ogr

        # ── Extraer .qgz ──────────────────────────────────────────────────────
        tmp_extract = self.qgz_path + "_xml_extract"
        shutil.rmtree(tmp_extract, ignore_errors=True)
        with zipfile.ZipFile(self.qgz_path, "r") as zf:
            zf.extractall(tmp_extract)

        qgs_files = glob.glob(os.path.join(tmp_extract, "*.qgs"))
        if not qgs_files:
            shutil.rmtree(tmp_extract, ignore_errors=True)
            raise FileNotFoundError("No se encontró .qgs dentro del .qgz")

        qgs_path = qgs_files[0]
        gpkg_path = os.path.join(tmp_extract, "offline.gpkg")

        # ── Parsear XML y encontrar datasources PostGIS ───────────────────────
        with open(qgs_path, "rb") as f:
            root = etree.fromstring(f.read())

        # Construir string de conexión OGR desde DATABASE_URL
        # postgresql://user:pass@host:port/db → PG:"host=... dbname=..."
        pg_conn = self._db_url_to_ogr(db_url)
        pg_ds   = ogr.Open(pg_conn)
        if pg_ds is None:
            shutil.rmtree(tmp_extract, ignore_errors=True)
            raise RuntimeError(f"No se pudo conectar a PostGIS: {pg_conn}")

        gpkg_driver = ogr.GetDriverByName("GPKG")
        gpkg_ds     = gpkg_driver.CreateDataSource(gpkg_path)

        ids_sql = ",".join(f"'{pid}'" for pid in predios_ids) if predios_ids else None

        # Iterar capas del XML que tienen datasource PostGIS
        for datasource_node in root.findall(".//datasource"):
            ds_text = datasource_node.text or ""
            if "dbname" not in ds_text and "host=" not in ds_text:
                continue

            # Extraer nombre de tabla del datasource
            table_match = re.search(r'table="([^"]+)"', ds_text)
            if not table_match:
                continue
            table_name = table_match.group(1).strip('"')

            sql = f'SELECT * FROM {table_name}'
            if ids_sql and "predio" in table_name.lower():
                sql += f" WHERE id_operacion IN ({ids_sql})"

            src_layer = pg_ds.ExecuteSQL(sql)
            if src_layer is None:
                continue

            gpkg_ds.CopyLayer(src_layer, table_name, ["OVERWRITE=YES"])
            pg_ds.ReleaseResultSet(src_layer)

            # Actualizar datasource en el XML a ruta local .gpkg
            datasource_node.text = f"./offline.gpkg|layername={table_name}"

        gpkg_ds = None
        pg_ds   = None

        # ── Guardar XML parchado ──────────────────────────────────────────────
        with open(qgs_path, "wb") as f:
            f.write(etree.tostring(root, xml_declaration=True,
                                   encoding="UTF-8", pretty_print=True))

        # ── Recomprimir ───────────────────────────────────────────────────────
        with zipfile.ZipFile(self.qgz_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for root_dir, _, files in os.walk(tmp_extract):
                for fname in files:
                    fpath   = os.path.join(root_dir, fname)
                    arcname = os.path.relpath(fpath, tmp_extract)
                    zf.write(fpath, arcname)

        shutil.rmtree(tmp_extract, ignore_errors=True)

    @staticmethod
    def _db_url_to_ogr(db_url: str) -> str:
        """Convierte DATABASE_URL de SQLAlchemy al formato PG: de OGR."""
        import re
        m = re.match(
            r"postgresql(?:\+\w+)?://([^:]+):([^@]+)@([^:/]+):?(\d+)?/(.+)",
            db_url,
        )
        if not m:
            raise ValueError(f"No se pudo parsear DATABASE_URL: {db_url}")
        user, pwd, host, port, dbname = m.groups()
        port_str = f" port={port}" if port else ""
        return f'PG:host={host}{port_str} dbname={dbname} user={user} password={pwd}'

    # ── Paso 6: Comprimir para descarga ──────────────────────────────────────

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
