"""
app/services/qfield_cloud_service.py

Cliente para QField Cloud usando el SDK oficial qfieldcloud-sdk.
Autenticación lazy: el Client se crea y loguea la primera vez que se necesita.
"""

import os
from pathlib import Path
from qfieldcloud_sdk import sdk

from db.database import SessionLocal
from repositories import asignacion_proyecto_repo


QFIELD_CLOUD_URL      = os.getenv("QFIELD_CLOUD_URL", "https://app.qfield.cloud")
QFIELD_CLOUD_USERNAME = os.getenv("QFIELD_CLOUD_USERNAME", "")
QFIELD_CLOUD_PASSWORD = os.getenv("QFIELD_CLOUD_PASSWORD", "")

# Progreso en memoria de operaciones cloud por proyecto.
# proyecto_id → {operacion, progreso, archivos_procesados, archivos_total, error, cancelar}
_cloud_progreso: dict[int, dict] = {}


class CancelacionUsuarioCloud(Exception):
    """Se lanza cuando el usuario cancela una operación de QField Cloud."""
    pass


def _check_cancel_cloud(proyecto_id: int):
    """Raises CancelacionUsuarioCloud si el flag está activo."""
    if _cloud_progreso.get(proyecto_id, {}).get("cancelar"):
        raise CancelacionUsuarioCloud("Cancelado por el usuario")


def _normalizar_url_qfieldcloud(url: str) -> str:
    """
    El SDK concatena la URL base con paths sin separador, así que requiere
    que termine en '/api/v1/'. Aceptamos cualquiera de estas formas del .env
    y las normalizamos:
      - https://app.qfield.cloud
      - https://app.qfield.cloud/
      - https://app.qfield.cloud/api/v1
      - https://app.qfield.cloud/api/v1/
    """
    u = url.rstrip("/")
    if not u.endswith("/api/v1"):
        u = u + "/api/v1"
    return u + "/"


class QFieldCloudService:

    def __init__(self):
        self.base_url = _normalizar_url_qfieldcloud(QFIELD_CLOUD_URL)
        self.username = QFIELD_CLOUD_USERNAME
        self.password = QFIELD_CLOUD_PASSWORD
        self._client: sdk | None = None

    # ── Cliente autenticado (lazy) ────────────────────────────────────────────

    def _get_client(self):
        if not self._client:
            if not self.username or not self.password:
                raise RuntimeError(
                    "QFIELD_CLOUD_USERNAME y QFIELD_CLOUD_PASSWORD deben estar configurados en .env"
                )
            client = sdk.Client(url=self.base_url)
            client.login(username=self.username, password=self.password)
            self._client = client
        return self._client

    # ── Búsqueda interna ──────────────────────────────────────────────────────

    def _buscar_proyecto(self, nombre: str) -> str | None:
        for p in self._get_client().list_projects():
            if p.get("name") == nombre:
                return p["id"]
        return None

    # ── API pública ───────────────────────────────────────────────────────────

    def crear_o_actualizar_proyecto(self, clave: str, source_dir: str) -> str:
        """
        Busca el proyecto por nombre; si no existe lo crea.
        Sube todos los archivos del directorio source_dir.
        Devuelve el cloud_project_id (UUID string).
        """
        client   = self._get_client()
        cloud_id = self._buscar_proyecto(clave)
        if not cloud_id:
            proyecto = client.create_project(
                name=clave,
                owner=self.username,
                description=f"Proyecto catastral {clave}",
                is_public=False,
            )
            cloud_id = proyecto["id"]
        client.upload_files(
            project_id=cloud_id,
            upload_type=sdk.FileTransferType.PROJECT,
            project_path=source_dir,
            filter_glob="*",
        )
        return cloud_id

    def eliminar_proyecto(self, cloud_project_id: str):
        """Elimina el proyecto en QField Cloud."""
        self._get_client().delete_project(cloud_project_id)

    def get_status(self, cloud_project_id: str) -> dict:
        data = self._get_client().get_project(cloud_project_id)
        # URL de la UI web del proyecto (fuera del /api/v1/)
        web_root = QFIELD_CLOUD_URL.rstrip("/").replace("/api/v1", "")
        return {
            "name":       data.get("name", ""),
            "status":     data.get("status", "unknown"),
            "updated_at": data.get("updated_at", ""),
            "url":        f"{web_root}/projects/{cloud_project_id}/",
        }

    def sincronizar(self, cloud_project_id: str, source_dir: str):
        """Sube una nueva versión de los archivos a un proyecto ya existente."""
        self._get_client().upload_files(
            project_id=cloud_project_id,
            upload_type=sdk.FileTransferType.PROJECT,
            project_path=source_dir,
            filter_glob="*",
        )

    def descargar_proyecto(self, cloud_project_id: str, dest_dir: str):
        """
        Descarga todos los archivos del proyecto desde QField Cloud a dest_dir.
        Sobrescribe lo que haya localmente con lo que esté en cloud (pull).
        """
        self._get_client().download_project(
            project_id=cloud_project_id,
            local_dir=dest_dir,
            filter_glob="*",
        )


# ── Helpers top-level (flujo UI) ──────────────────────────────────────────────

def _parsear_iso(dt_str: str):
    """Parsea ISO datetime del cloud a datetime naive en UTC, o None."""
    from datetime import datetime
    if not dt_str:
        return None
    try:
        dt = datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
        if dt.tzinfo:
            dt = dt.replace(tzinfo=None)
        return dt
    except Exception:
        return None


def cloud_status(db, proyecto_id: int) -> dict:
    """
    Devuelve el estado combinado local + cloud para decidir qué botón mostrar.
    - existe_offline_local: carpeta y zip en disco
    - estado_proyecto: estado_generacion en BD
    - existe_en_cloud: qfield_cloud_project_id no null
    - sincronizaciones_pendientes: cloud.updated_at > ultima_sincronizacion_cloud
    - ultima_sincronizacion: timestamp local del último push/pull
    - cloud_updated_at: timestamp que reporta la cloud
    """
    from datetime import timedelta
    from services.qgis_export_service import recursos_offline_existen

    proyecto = asignacion_proyecto_repo.get_by_id(db, proyecto_id)
    if not proyecto:
        raise ValueError("Proyecto no encontrado")
    clave = proyecto["clave_proyecto"]

    recursos = recursos_offline_existen(db, proyecto_id, clave)
    existe_offline_local = recursos["carpeta"] and recursos["zip"]

    estado = asignacion_proyecto_repo.get_estado_generacion(db, proyecto_id)
    estado_proyecto = estado["estado_generacion"] if estado else "sin_generar"

    cloud_id = asignacion_proyecto_repo.get_qfield_cloud_id(db, proyecto_id)
    existe_en_cloud = bool(cloud_id)

    ultima = asignacion_proyecto_repo.get_ultima_sincronizacion_cloud(db, proyecto_id)
    cloud_updated_at = None
    sincronizaciones_pendientes = False

    if existe_en_cloud:
        try:
            svc = QFieldCloudService()
            status = svc.get_status(cloud_id)
            cloud_updated_at = _parsear_iso(status.get("updated_at"))
            if cloud_updated_at:
                if ultima is None:
                    sincronizaciones_pendientes = True
                else:
                    sincronizaciones_pendientes = cloud_updated_at > (ultima + timedelta(seconds=5))
        except Exception as e:
            print(f"[CLOUD STATUS WARN] No se pudo consultar cloud: {e}")

    # Agregar progreso de operación en curso si hay
    op = _cloud_progreso.get(proyecto_id)

    return {
        "existe_offline_local":        existe_offline_local,
        "estado_proyecto":             estado_proyecto,
        "existe_en_cloud":             existe_en_cloud,
        "sincronizaciones_pendientes": sincronizaciones_pendientes,
        "ultima_sincronizacion":       ultima.isoformat() if ultima else None,
        "cloud_updated_at":            cloud_updated_at.isoformat() if cloud_updated_at else None,
        "operacion_en_curso":             op.get("operacion")             if op else None,
        "operacion_progreso":             op.get("progreso", 0)           if op else 0,
        "operacion_archivos_procesados":  op.get("archivos_procesados", 0) if op else 0,
        "operacion_archivos_total":       op.get("archivos_total", 0)      if op else 0,
        "operacion_error":                op.get("error")                  if op else None,
    }


# ── Validaciones previas usadas por los endpoints (rápidas, no entran a BG) ──

def validar_subida(db, proyecto_id: int) -> str:
    """Valida que se pueda subir. Devuelve la clave del proyecto."""
    from services.qgis_export_service import QGIS_EXPORTS_DIR

    if proyecto_id in _cloud_progreso:
        raise ValueError("Ya hay una operación en curso para este proyecto")

    proyecto = asignacion_proyecto_repo.get_by_id(db, proyecto_id)
    if not proyecto:
        raise ValueError("Proyecto no encontrado")

    if asignacion_proyecto_repo.get_qfield_cloud_id(db, proyecto_id):
        raise ValueError("El proyecto ya existe en QField Cloud. Usá sincronizar.")

    estado = asignacion_proyecto_repo.get_estado_generacion(db, proyecto_id)
    if not estado or estado["estado_generacion"] != "terminado":
        raise ValueError("El proyecto offline no está terminado")

    clave   = proyecto["clave_proyecto"]
    carpeta = os.path.join(QGIS_EXPORTS_DIR, clave)
    if not os.path.isdir(carpeta):
        raise ValueError("No existe la carpeta local del proyecto offline")

    return clave


def validar_sincronizacion(db, proyecto_id: int) -> str:
    """
    Valida que se pueda sincronizar (o crear si aún no está en cloud).
    Devuelve la clave del proyecto.
    """
    from services.qgis_export_service import QGIS_EXPORTS_DIR

    if proyecto_id in _cloud_progreso:
        raise ValueError("Ya hay una operación en curso para este proyecto")

    proyecto = asignacion_proyecto_repo.get_by_id(db, proyecto_id)
    if not proyecto:
        raise ValueError("Proyecto no encontrado")

    estado = asignacion_proyecto_repo.get_estado_generacion(db, proyecto_id)
    if not estado or estado["estado_generacion"] != "terminado":
        raise ValueError("El proyecto offline no está terminado")

    clave   = proyecto["clave_proyecto"]
    carpeta = os.path.join(QGIS_EXPORTS_DIR, clave)
    if not os.path.isdir(carpeta):
        raise ValueError("No existe la carpeta local del proyecto offline")

    return clave


# ── Tareas background con progreso por archivo ────────────────────────────────

def tarea_subir_cloud(proyecto_id: int):
    """
    Background task. Crea el proyecto en QField Cloud si no existe y sube
    los archivos uno por uno actualizando _cloud_progreso[proyecto_id].
    """
    from services.qgis_export_service import QGIS_EXPORTS_DIR

    db = SessionLocal()
    try:
        proyecto = asignacion_proyecto_repo.get_by_id(db, proyecto_id)
        if not proyecto:
            return
        clave   = proyecto["clave_proyecto"]
        carpeta = os.path.join(QGIS_EXPORTS_DIR, clave)

        # Enumerar archivos a subir (recursivo)
        archivos = []
        for root, _, files in os.walk(carpeta):
            for fname in files:
                full = os.path.join(root, fname)
                rel  = os.path.relpath(full, carpeta)
                archivos.append((full, rel))

        # Orden CRÍTICO: .qgs/.qgz deben subirse al FINAL. QField Cloud
        # dispara el job "package" automáticamente al detectar la subida del
        # project file; si se sube antes que los demás archivos, empaqueta
        # con datos parciales y QField mobile no ve contenido.
        # Ref: qfieldsync/core/cloud_transferrer.py
        archivos.sort(key=lambda a: a[1].lower().endswith((".qgs", ".qgz")))

        total = len(archivos)
        _cloud_progreso[proyecto_id] = {
            "operacion":           "subir",
            "progreso":            0,
            "archivos_procesados": 0,
            "archivos_total":      total,
            "error":               None,
            "cancelar":            False,
        }

        svc    = QFieldCloudService()
        client = svc._get_client()

        # Crear el proyecto en cloud si no existe
        cloud_id = svc._buscar_proyecto(clave)
        if not cloud_id:
            proyecto_cloud = client.create_project(
                name=clave,
                owner=svc.username,
                description=f"Proyecto catastral {clave}",
                is_public=False,
            )
            cloud_id = proyecto_cloud["id"]

        # Subir archivo por archivo reportando progreso
        for i, (local, remote) in enumerate(archivos):
            _check_cancel_cloud(proyecto_id)
            client.upload_file(
                project_id=cloud_id,
                upload_type=sdk.FileTransferType.PROJECT,
                local_filename=Path(local),
                remote_filename=remote,
                show_progress=False,
            )
            _cloud_progreso[proyecto_id]["archivos_procesados"] = i + 1
            _cloud_progreso[proyecto_id]["progreso"] = int((i + 1) / max(total, 1) * 100)

        # Guardar estado final en BD
        asignacion_proyecto_repo.guardar_qfield_cloud_id(db, proyecto_id, cloud_id)
        asignacion_proyecto_repo.actualizar_ultima_sincronizacion_cloud(db, proyecto_id)

        # Disparar el job "package" para que QField mobile pueda descargar el
        # proyecto armado. Fire-and-forget: QField Cloud procesa en background
        # (30s-2min según tamaño). El estado se ve en la web de QField Cloud.
        try:
            client.job_trigger(
                project_id=cloud_id,
                job_type="package",
                force=True,
            )
        except Exception as pkg_err:
            print(f"[CLOUD PACKAGE WARN] No se pudo disparar el job package: {pkg_err}")

    except CancelacionUsuarioCloud:
        print(f"[CLOUD SUBIR] Proyecto {proyecto_id} cancelado por el usuario")
        # Limpiamos de una — el usuario ya sabe que canceló, no mostramos error
    except Exception as exc:
        if proyecto_id in _cloud_progreso:
            _cloud_progreso[proyecto_id]["error"] = str(exc)
        print(f"[CLOUD SUBIR ERROR] {exc}")
        # Si falló, dejamos la entrada con error durante ~10s para que el frontend
        # la vea, luego se limpia en el finally.
        import time
        time.sleep(10)
    finally:
        _cloud_progreso.pop(proyecto_id, None)
        db.close()


def tarea_sincronizar_cloud(proyecto_id: int):
    """
    Background task. Descarga del cloud los archivos actualizados uno por uno.
    Si el proyecto ya no existe en QField Cloud (fue borrado desde la web),
    limpia el cloud_id local y dispara una subida nueva para recrearlo.
    """
    from services.qgis_export_service import QGIS_EXPORTS_DIR

    db = SessionLocal()
    try:
        proyecto = asignacion_proyecto_repo.get_by_id(db, proyecto_id)
        if not proyecto:
            return
        clave    = proyecto["clave_proyecto"]
        carpeta  = os.path.join(QGIS_EXPORTS_DIR, clave)
        cloud_id = asignacion_proyecto_repo.get_qfield_cloud_id(db, proyecto_id)

        # Si el proyecto nunca se subió → fallback a subir (creación inicial)
        if not cloud_id:
            db.close()
            _cloud_progreso.pop(proyecto_id, None)
            tarea_subir_cloud(proyecto_id)
            return

        svc    = QFieldCloudService()
        client = svc._get_client()

        # Verificar que el proyecto siga existiendo en cloud. Si fue borrado
        # desde la web de QField Cloud, recrearlo subiendo de cero.
        try:
            client.get_project(project_id=cloud_id)
        except Exception as e:
            msg = str(e).lower()
            if "404" in msg or "not found" in msg or "no encontrado" in msg:
                print(f"[CLOUD SYNC] Proyecto {cloud_id} ya no existe en cloud. Recreando…")
                asignacion_proyecto_repo.guardar_qfield_cloud_id(db, proyecto_id, None)
                db.close()
                _cloud_progreso.pop(proyecto_id, None)
                tarea_subir_cloud(proyecto_id)
                return
            raise

        remote_files = client.list_remote_files(project_id=cloud_id) or []
        total = len(remote_files)

        _cloud_progreso[proyecto_id] = {
            "operacion":           "sincronizar",
            "progreso":            0,
            "archivos_procesados": 0,
            "archivos_total":      total,
            "error":               None,
            "cancelar":            False,
        }

        for i, f in enumerate(remote_files):
            _check_cancel_cloud(proyecto_id)
            # El nombre del archivo remoto viene en "name" o "path" según versión
            remote_name = f.get("name") or f.get("path") or f.get("filename")
            if not remote_name:
                continue
            destino = os.path.join(carpeta, remote_name)
            os.makedirs(os.path.dirname(destino), exist_ok=True)
            client.download_file(
                project_id=cloud_id,
                remote_filename=remote_name,
                local_filename=Path(destino),
                show_progress=False,
            )
            _cloud_progreso[proyecto_id]["archivos_procesados"] = i + 1
            _cloud_progreso[proyecto_id]["progreso"] = int((i + 1) / max(total, 1) * 100)

        asignacion_proyecto_repo.actualizar_ultima_sincronizacion_cloud(db, proyecto_id)

    except CancelacionUsuarioCloud:
        print(f"[CLOUD SINCRONIZAR] Proyecto {proyecto_id} cancelado por el usuario")
    except Exception as exc:
        if proyecto_id in _cloud_progreso:
            _cloud_progreso[proyecto_id]["error"] = str(exc)
        print(f"[CLOUD SINCRONIZAR ERROR] {exc}")
        import time
        time.sleep(10)
    finally:
        _cloud_progreso.pop(proyecto_id, None)
        db.close()


# ── Helpers legacy (aún referenciados por código/pruebas antiguas) ────────────

def subir_a_cloud(db, proyecto_id: int) -> dict:
    """
    PUSH inicial sincrónico. DEPRECATED — usar tarea_subir_cloud en background.
    Mantenido por compat con código viejo.
    """
    from services.qgis_export_service import QGIS_EXPORTS_DIR

    proyecto = asignacion_proyecto_repo.get_by_id(db, proyecto_id)
    if not proyecto:
        raise ValueError("Proyecto no encontrado")
    clave = proyecto["clave_proyecto"]

    if asignacion_proyecto_repo.get_qfield_cloud_id(db, proyecto_id):
        raise ValueError("El proyecto ya existe en QField Cloud. Usá sincronizar.")

    estado = asignacion_proyecto_repo.get_estado_generacion(db, proyecto_id)
    if not estado or estado["estado_generacion"] != "terminado":
        raise ValueError("El proyecto offline no está terminado")

    carpeta = os.path.join(QGIS_EXPORTS_DIR, clave)
    if not os.path.isdir(carpeta):
        raise ValueError("No existe la carpeta local del proyecto offline")

    svc      = QFieldCloudService()
    cloud_id = svc.crear_o_actualizar_proyecto(clave, carpeta)
    asignacion_proyecto_repo.guardar_qfield_cloud_id(db, proyecto_id, cloud_id)
    asignacion_proyecto_repo.actualizar_ultima_sincronizacion_cloud(db, proyecto_id)

    return {
        "mensaje":           "Proyecto subido a QField Cloud",
        "cloud_proyecto_id": cloud_id,
    }


def bajar_desde_cloud(db, proyecto_id: int) -> dict:
    """PULL sincrónico. DEPRECATED — usar tarea_sincronizar_cloud."""
    from services.qgis_export_service import QGIS_EXPORTS_DIR

    proyecto = asignacion_proyecto_repo.get_by_id(db, proyecto_id)
    if not proyecto:
        raise ValueError("Proyecto no encontrado")
    clave = proyecto["clave_proyecto"]

    cloud_id = asignacion_proyecto_repo.get_qfield_cloud_id(db, proyecto_id)
    if not cloud_id:
        raise ValueError("El proyecto no existe en QField Cloud")

    carpeta = os.path.join(QGIS_EXPORTS_DIR, clave)
    if not os.path.isdir(carpeta):
        raise ValueError("No existe la carpeta local del proyecto offline")

    svc = QFieldCloudService()
    svc.descargar_proyecto(cloud_id, carpeta)
    asignacion_proyecto_repo.actualizar_ultima_sincronizacion_cloud(db, proyecto_id)

    return {
        "mensaje": "Cambios del campo descargados a la carpeta local",
    }
