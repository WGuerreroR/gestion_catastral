"""
app/services/qgis_export_service.py

Orquesta ShapefileService, QgisProjectService y QFieldCloudService.

Directorios de salida (volumen: ./data/qgis/ → /app/data/):
  /app/data/exports/{clave}/     → host: data/qgis/exports/{clave}/   (QField Cloud)
  /app/data/exports/{clave}.zip  → host: data/qgis/exports/{clave}.zip (descarga offline)
"""

import io
import os
import shutil
import zipfile
import tempfile
from services.shapefile_service    import ShapefileService
from services.qgis_project_service import QgisProjectService
from services.qfield_cloud_service import QFieldCloudService
from repositories import asignacion_proyecto_repo
from sqlalchemy import text

QGIS_EXPORTS_DIR = "/app/data/exports"
EXPORTS_DIR      = "/app/data/exports"
QGIS_TEMP_PATH   = os.getenv("QGIS_TEMP_PATH", "/app/data/exports/temp")

# Repositorio centralizado de fotos (convención QField/Android: DCIM).
# Único lugar canónico — las rutas en BD viven en formato 'DCIM/<archivo>'
# y se resuelven a DCIM_DIR/<archivo>. Las copias scoped por proyecto
# en EXPORTS_DIR/{clave}/DCIM/ son workdir efímero al armar paquetes; la
# fuente de verdad es DCIM_DIR.
DCIM_DIR = os.getenv("DCIM_DIR", "/app/data/DCIM")

os.makedirs(QGIS_EXPORTS_DIR, exist_ok=True)
os.makedirs(EXPORTS_DIR,      exist_ok=True)
os.makedirs(DCIM_DIR,         exist_ok=True)

# Tablas y columnas en BD que guardan rutas de foto. Espejar cuando se añadan
# nuevos campos foto al modelo.
_COLUMNAS_FOTO: list[tuple[str, list[str]]] = [
    ("lc_predio_p", ["foto", "foto_2"]),
    ("cr_caracteristicasunidadconstruccion", [
        "foto_fachada", "foto_banio", "foto_cocina",
        "foto_acabados", "foto_anexo", "foto_industrial",
    ]),
]

_FK_POR_TABLA: dict[str, str] = {
    "lc_predio_p":                          "id_operacion",
    "cr_caracteristicasunidadconstruccion": "id_operacion_predio",
}


def _query_rutas_foto(db, id_operaciones: list[str]) -> set[str]:
    """Devuelve el set de rutas referenciadas por los predios.

    Itera _COLUMNAS_FOTO usando _FK_POR_TABLA para saber qué columna
    relaciona cada tabla con el universo de id_operacion. Tolera rutas
    con prefijo 'DCIM/' o 'imgs/' (pre-migración) o nombre suelto;
    quien consuma esto solo usa el basename.
    """
    rutas: set[str] = set()
    if not id_operaciones:
        return rutas

    for tabla, cols in _COLUMNAS_FOTO:
        fk = _FK_POR_TABLA.get(tabla)
        if not fk:
            continue
        for col in cols:
            try:
                res = db.execute(text(f"""
                    SELECT "{col}" FROM {tabla}
                     WHERE {fk} = ANY(:ids)
                       AND "{col}" IS NOT NULL AND "{col}" <> ''
                """), {"ids": id_operaciones}).fetchall()
            except Exception as exc:
                print(f"[FOTOS PAQUETE WARN] SELECT {tabla}.{col} falló: {exc}")
                continue
            for (ruta,) in res:
                rutas.add(ruta)
    return rutas


def _incluir_fotos_en_paquete(db, workdir: str, id_operaciones: list[str]) -> int:
    """Copia todas las fotos del universo a <workdir>/DCIM/. Idempotente.

    Las rutas en BD tienen formato 'DCIM/<archivo>' y apuntan al repo central
    DCIM_DIR. Aquí solo se copia el archivo físico al workdir; la ruta en BD
    no cambia, así que QGIS/QField la resolverá relativa al .qgs y encontrará
    la foto dentro del ZIP descargado.
    """
    dcim_dst = os.path.join(workdir, "DCIM")
    os.makedirs(dcim_dst, exist_ok=True)

    try:
        rutas = _query_rutas_foto(db, id_operaciones)
    except Exception as exc:
        print(f"[FOTOS PAQUETE WARN] _query_rutas_foto falló: {exc}")
        return 0

    copiadas = 0
    for ruta in rutas:
        # Tolerar 'DCIM/X', 'imgs/X' (legacy pre-migración) o nombre suelto.
        basename = os.path.basename(ruta.replace("\\", "/"))
        if not basename:
            continue
        src = os.path.join(DCIM_DIR, basename)
        dst = os.path.join(dcim_dst, basename)
        if os.path.exists(dst):
            continue
        if not os.path.isfile(src):
            print(f"[FOTOS PAQUETE WARN] archivo no encontrado en DCIM_DIR: {basename}")
            continue
        try:
            try:
                os.link(src, dst)
            except OSError:
                shutil.copy2(src, dst)
            copiadas += 1
        except Exception as exc:
            print(f"[FOTOS PAQUETE WARN] no se pudo copiar {basename}: {exc}")
    return copiadas


# Progreso en memoria (proyecto_id → porcentaje 0-100).
# Solo existe mientras la tarea background está activa.
_progreso: dict[int, int] = {}

# Flag de cancelación: el endpoint /cancelar-operacion setea True; la tarea
# lo revisa en puntos cooperativos y aborta con CancelacionUsuario.
_cancelar_offline: dict[int, bool] = {}


class CancelacionUsuario(Exception):
    """Se lanza cuando el usuario cancela la generación offline."""
    pass


def _check_cancel_offline(proyecto_id: int):
    """Raises CancelacionUsuario si el flag está activo para ese proyecto."""
    if _cancelar_offline.get(proyecto_id):
        raise CancelacionUsuario("Cancelado por el usuario")


def recursos_offline_existen(db, proyecto_id: int, clave: str) -> dict:
    """Indica si el proyecto offline ya existe (carpeta, zip o cloud)."""
    carpeta  = os.path.join(QGIS_EXPORTS_DIR, clave)
    zip_path = os.path.join(EXPORTS_DIR, f"{clave}.zip")
    cloud_id = asignacion_proyecto_repo.get_qfield_cloud_id(db, proyecto_id)
    return {
        "carpeta": os.path.isdir(carpeta),
        "zip":     os.path.exists(zip_path),
        "cloud":   bool(cloud_id),
        "existe":  os.path.isdir(carpeta) or os.path.exists(zip_path) or bool(cloud_id),
    }


def generar_qgz_centrado(db, proyecto_id: int) -> tuple[str, str, str]:
    """
    Genera un .zip del proyecto base con:
      - zonas.shp reescrito con el área del proyecto
      - canvas centrado en ese extent
      - conexiones PostGIS vivas (sin offline — el usuario abrirá el proyecto
        conectado a la BD)

    Returns (zip_path, clave_proyecto, temp_dir_root).
    El caller debe eliminar temp_dir_root tras servir el archivo.
    """

    proyecto = asignacion_proyecto_repo.get_by_id(db, proyecto_id)
    if not proyecto:
        raise ValueError("Proyecto no encontrado")

    clave    = proyecto["clave_proyecto"]
    wkt_9377 = asignacion_proyecto_repo.get_area_wkt_9377(db, proyecto_id)
    if not wkt_9377:
        raise ValueError("El proyecto no tiene área de asignación definida")

    temp_dir_root = os.path.join(QGIS_TEMP_PATH, str(proyecto_id))
    shutil.rmtree(temp_dir_root, ignore_errors=True)
    os.makedirs(temp_dir_root, exist_ok=True)

    # 1. Copiar proyecto base
    qgis_svc = QgisProjectService(clave_proyecto=clave, output_base_dir=temp_dir_root)
    qgis_svc.copiar_proyecto_base()

    # 2. Reemplazar geometría en zonas.shp con el área del proyecto
    shp_svc = ShapefileService(qgis_svc.get_shp_path())
    shp_svc.reemplazar_geometria(
        wkt_9377=wkt_9377,
        atributos={"nombre": clave, "id": proyecto_id},
    )

    # 3. Centrar canvas en el extent del área
    xmin, ymin, xmax, ymax = shp_svc.get_extent(wkt_9377)
    qgis_svc.actualizar_extent(xmin, ymin, xmax, ymax)

    # 4. Comprimir todo el directorio a .zip
    zip_path = qgis_svc.comprimir(temp_dir_root)

    # 5. Agregar carpetas vacías offline/ y cloud/ 
    with zipfile.ZipFile(zip_path, "a", zipfile.ZIP_DEFLATED) as zf:
        for carpeta in ("offline/", "cloud/"):
            zf.writestr(zipfile.ZipInfo(carpeta), b"")

    return zip_path, clave, temp_dir_root


def cargar_proyecto_offline(db, proyecto_id: int, contenido_zip: bytes) -> dict:
    """
    Reemplaza el proyecto offline de un proyecto con el ZIP subido.
      - Valida: ZIP no corrupto, no vacío, contiene .qgz/.qgs en raíz o 1er nivel
      - Extrae en /app/data/exports/{clave}/
      - Persiste el ZIP original en /app/data/exports/{clave}.zip
      - Rollback atómico vía carpeta .backup si algo falla
      - Actualiza estado_generacion = 'terminado'
    """

    proyecto = asignacion_proyecto_repo.get_by_id(db, proyecto_id)
    if not proyecto:
        raise ValueError("Proyecto no encontrado")
    clave = proyecto["clave_proyecto"]

    try:
        zf = zipfile.ZipFile(io.BytesIO(contenido_zip), "r")
    except zipfile.BadZipFile:
        raise ValueError("El archivo no es un ZIP válido")

    names = zf.namelist()
    if not names:
        zf.close()
        raise ValueError("El ZIP está vacío")

    tiene_proyecto = any(
        (n.endswith(".qgz") or n.endswith(".qgs")) and n.count("/") <= 1
        for n in names
    )
    if not tiene_proyecto:
        zf.close()
        raise ValueError("El ZIP no contiene un proyecto QGIS válido (.qgz o .qgs)")

    carpeta  = os.path.join(QGIS_EXPORTS_DIR, clave)
    zip_dest = os.path.join(EXPORTS_DIR, f"{clave}.zip")
    backup   = carpeta + ".backup"

    shutil.rmtree(backup, ignore_errors=True)
    if os.path.isdir(carpeta):
        shutil.move(carpeta, backup)

    try:
        os.makedirs(carpeta, exist_ok=True)
        zf.extractall(carpeta)
        extraidos = len(names)
        zf.close()

        with open(zip_dest, "wb") as f:
            f.write(contenido_zip)

        asignacion_proyecto_repo.actualizar_estado_generacion(db, proyecto_id, "terminado")
        shutil.rmtree(backup, ignore_errors=True)
    except Exception as e:
        shutil.rmtree(carpeta, ignore_errors=True)
        if os.path.isdir(backup):
            shutil.move(backup, carpeta)
        raise RuntimeError(f"Error extrayendo ZIP: {e}")

    return {
        "mensaje":            "Proyecto offline cargado exitosamente",
        "proyecto_id":        proyecto_id,
        "archivos_extraidos": extraidos,
        "ruta":               carpeta,
    }


# ── Función principal ─────────────────────────────────────────────────────────

def generar_paquete_calidad_muestreo(
    db, pc_id: int, clave: str,
) -> bytes:
    """
    Genera el .zip con un proyecto QGIS para un proyecto de calidad por
    asignación. Como generar_paquete_proyecto_2 pero:
      - area_geom se lee de admin_proyecto_calidad_muestreo (ST_Union de
        las áreas de las asignaciones).
      - Se filtran las capas catastrales (lc_predio_p, cr_terreno,
        cr_unidadconstruccion) al universo de predios del proyecto.
      - Se inyecta una capa nueva 'Predios muestra' con los en_muestra=true
        coloreados en naranja semi-transparente y etiqueta id_operacion.
    """
    row = db.execute(text("""
        SELECT ST_AsText(area_geom) AS wkt
          FROM admin_proyecto_calidad_muestreo
         WHERE id = :id AND area_geom IS NOT NULL
    """), {"id": pc_id}).fetchone()
    if not row or not row.wkt:
        raise ValueError("El proyecto no tiene área geométrica definida")
    wkt_9377 = row.wkt

    # Universo del proyecto
    universo = [
        r.id_operacion for r in db.execute(text("""
            SELECT id_operacion
              FROM admin_proyecto_calidad_muestreo_predio
             WHERE proyecto_id = :id
        """), {"id": pc_id}).fetchall()
    ]

    # Predios muestra agrupados por lote = clave_proyecto de la asignación
    # de origen (admin_persona_predio.proyecto_id → admin_asignacion).
    rows_muestra = db.execute(text("""
        SELECT mcp.id_operacion,
               COALESCE(a.clave_proyecto, 'Sin asignación') AS lote
          FROM admin_proyecto_calidad_muestreo_predio mcp
          LEFT JOIN admin_persona_predio app
                 ON app.id_operacion = mcp.id_operacion
          LEFT JOIN admin_proyecto_calidad_muestreo_asignacion mca
                 ON mca.proyecto_id = mcp.proyecto_id
                AND mca.asignacion_id = app.proyecto_id
          LEFT JOIN admin_asignacion a
                 ON a.id = mca.asignacion_id
         WHERE mcp.proyecto_id = :id
           AND mcp.en_muestra  = TRUE
    """), {"id": pc_id}).fetchall()

    muestra_por_lote: dict[str, list[str]] = {}
    for r in rows_muestra:
        muestra_por_lote.setdefault(r.lote, []).append(r.id_operacion)

    with tempfile.TemporaryDirectory() as workdir:
        from services.qgis_project_service import PROYECTO_CALIDAD_DIR
        qgis_svc = QgisProjectService(
            clave_proyecto=clave, output_base_dir=workdir,
            proyecto_base_dir=PROYECTO_CALIDAD_DIR,
        )
        qgis_svc.copiar_proyecto_base()

        shp_path = qgis_svc.get_shp_path()
        shp_svc  = ShapefileService(shp_path)
        shp_svc.reemplazar_geometria(
            wkt_9377=wkt_9377,
            atributos={"nombre": clave, "id": pc_id},
        )

        xmin, ymin, xmax, ymax = shp_svc.get_extent(wkt_9377)
        qgis_svc.actualizar_extent(xmin, ymin, xmax, ymax)

        # Filtrar catastrales al universo + capa destacada de muestra (lotes
        # por asignación). Una sola pasada de QgsProject.
        qgis_svc.aplicar_capas_calidad(
            predios_universo=universo,
            muestra_por_asignacion=muestra_por_lote,
        )

        _incluir_fotos_en_paquete(db, qgis_svc.output_dir, universo)

        zip_path = qgis_svc.comprimir(workdir)

        # Agregar carpetas vacías offline/ y cloud/ (espacio para que el
        # operador deje el .qgz offline/QFC al regresar de campo).
        with zipfile.ZipFile(zip_path, "a", zipfile.ZIP_DEFLATED) as zf:
            for carpeta in ("offline/", "cloud/"):
                zf.writestr(zipfile.ZipInfo(carpeta), b"")

        with open(zip_path, "rb") as f:
            return f.read()


def generar_paquete_proyecto_2(db, proyecto_id: int, clave_proyecto: str) -> bytes:
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


def generar_paquete_proyecto(
    db,
    proyecto_id: int,
    clave_proyecto: str,
    predios_ids: list | None = None,
    on_progress: "callable | None" = None,
) -> str:
    """
    Genera el proyecto QGIS offline en el directorio permanente.
    Devuelve la ruta del directorio generado.

    1. Lee area_geom (WKT EPSG:9377) desde PostGIS
    2. Copia el proyecto base al directorio permanente
    3. Reemplaza la geometría en zonas.shp
    4. Actualiza el extent del canvas en el .qgz
    5. Empaqueta capas PostGIS → data.gpkg (QgsVectorFileWriter, approach QFieldSync)
    """

    from sqlalchemy import text
    print("***generar_paquete_proyecto 1")
    row = db.execute(text("""
        SELECT ST_AsText(area_geom) AS wkt
        FROM admin_asignacion
        WHERE id = :id AND area_geom IS NOT NULL
    """), {"id": proyecto_id}).fetchone()

    if not row or not row.wkt:
        raise ValueError("El proyecto no tiene área geométrica definida")

    wkt_9377 = row.wkt

    if predios_ids is None:
        predios_ids = asignacion_proyecto_repo.get_predios_ids(db, proyecto_id)
   
    qgis_svc = QgisProjectService(
        clave_proyecto=clave_proyecto,
        output_base_dir=QGIS_EXPORTS_DIR,
    )

    qgis_svc.copiar_proyecto_base()

    shp_path = qgis_svc.get_shp_path()
    shp_svc  = ShapefileService(shp_path)
    shp_svc.reemplazar_geometria(
        wkt_9377=wkt_9377,
        atributos={"nombre": clave_proyecto, "id": proyecto_id}
    )

    xmin, ymin, xmax, ymax = shp_svc.get_extent(wkt_9377)
    qgis_svc.actualizar_extent(xmin, ymin, xmax, ymax)
    print("***generar_paquete_proyecto 2")
    qgis_svc.empaquetar_offline_qfieldsync(
        predios_ids,
        extent=(xmin, ymin, xmax, ymax),
        on_progress=on_progress,
    )

    _incluir_fotos_en_paquete(db, qgis_svc.output_dir, predios_ids)

    return qgis_svc.output_dir


def _comprimir_a_exports(project_dir: str, clave: str) -> str:
    """Comprime project_dir en /app/data/exports/{clave}.zip. Devuelve la ruta."""
    zip_path = os.path.join(EXPORTS_DIR, f"{clave}.zip")
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for root_dir, _, files in os.walk(project_dir):
            for fname in files:
                fpath   = os.path.join(root_dir, fname)
                arcname = os.path.relpath(fpath, project_dir)
                zf.write(fpath, arcname)
    return zip_path


def _limpiar_recursos_anteriores(db, proyecto_id: int, clave: str):
    """Borra el directorio permanente, el zip y el proyecto en QField Cloud."""
    print("_limpiar_recursos_anteriores")

    shutil.rmtree(os.path.join(QGIS_EXPORTS_DIR, clave), ignore_errors=True)

    zip_path = os.path.join(EXPORTS_DIR, f"{clave}.zip")
    if os.path.exists(zip_path):
        os.remove(zip_path)

    cloud_id = asignacion_proyecto_repo.get_qfield_cloud_id(db, proyecto_id)
    if cloud_id:
        try:
            QFieldCloudService().eliminar_proyecto(cloud_id)
        except Exception:
            pass
    asignacion_proyecto_repo.guardar_qfield_cloud_id(db, proyecto_id, None)


# ── Tarea background ──────────────────────────────────────────────────────────

def tarea_generar_proyecto(proyecto_id: int, clave: str, predios_ids: list):
    """
    Ejecutada en background por FastAPI BackgroundTasks.
    Crea su propia sesión de BD (no reutiliza la del request).

    Estados: pendiente → procesando → terminado | error
    """
    from db.database import SessionLocal

    db = SessionLocal()
    try:
        print("*** 1")
        _progreso[proyecto_id] = 0
        _cancelar_offline[proyecto_id] = False
        asignacion_proyecto_repo.actualizar_estado_generacion(db, proyecto_id, "procesando")
        print("*** 2")
        # Capturar si el proyecto estaba en QField Cloud ANTES de limpiar,
        # para recrearlo después con el mismo nombre (flujo automático).
        tenia_cloud = bool(asignacion_proyecto_repo.get_qfield_cloud_id(db, proyecto_id))
        print("*** 3")
        _check_cancel_offline(proyecto_id)
        print("*** 3.1")
       # _limpiar_recursos_anteriores(db, proyecto_id, clave)
        print("*** 3.2")
        _check_cancel_offline(proyecto_id)
        print("*** 4")
        def _on_progress(pct: int):
            _progreso[proyecto_id] = pct
            # Cada tick de progreso también chequea cancelación
            _check_cancel_offline(proyecto_id)
        print("*** 5")
        project_dir = generar_paquete_proyecto(
            db, proyecto_id, clave, predios_ids, on_progress=_on_progress
        )
        print("*** 6")
        _check_cancel_offline(proyecto_id)

        _comprimir_a_exports(project_dir, clave)
        _check_cancel_offline(proyecto_id)

        # Si el proyecto estaba en QField Cloud, recrearlo con los archivos
        # nuevos. Si la re-subida falla, solo se loggea: el offline local
        # ya quedó generado y el usuario puede re-subir manualmente.
        if tenia_cloud:
            try:
                cloud_svc = QFieldCloudService()
                cloud_id  = cloud_svc.crear_o_actualizar_proyecto(clave, project_dir)
                asignacion_proyecto_repo.guardar_qfield_cloud_id(db, proyecto_id, cloud_id)
                asignacion_proyecto_repo.actualizar_ultima_sincronizacion_cloud(db, proyecto_id)
            except Exception as cloud_err:
                print(f"[CLOUD REUPLOAD WARN] Falló re-subida a QField Cloud tras regenerar: {cloud_err}")

        asignacion_proyecto_repo.actualizar_estado_generacion(db, proyecto_id, "terminado")

    except CancelacionUsuario:
        print(f"[OFFLINE CANCEL] Proyecto {proyecto_id} cancelado por el usuario")
        try:
            asignacion_proyecto_repo.actualizar_estado_generacion(
                db, proyecto_id, "error", "Cancelado por el usuario"
            )
        except Exception:
            pass
        # Limpiar archivos parciales
        try:
            shutil.rmtree(os.path.join(QGIS_EXPORTS_DIR, clave), ignore_errors=True)
            zip_path = os.path.join(EXPORTS_DIR, f"{clave}.zip")
            if os.path.exists(zip_path):
                os.remove(zip_path)
        except Exception:
            pass
    except Exception as exc:
        try:
            asignacion_proyecto_repo.actualizar_estado_generacion(db, proyecto_id, "error", str(exc))
        except Exception:
            pass
    finally:
        _progreso.pop(proyecto_id, None)
        _cancelar_offline.pop(proyecto_id, None)
        db.close()
