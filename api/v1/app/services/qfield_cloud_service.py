"""
app/services/qfield_cloud_service.py

Cliente para QField Cloud usando el SDK oficial qfieldcloud-sdk.
Autenticación lazy: el Client se crea y loguea la primera vez que se necesita.
"""

import os
from qfieldcloud_sdk import sdk


QFIELD_CLOUD_URL      = os.getenv("QFIELD_CLOUD_URL", "https://app.qfield.cloud")
QFIELD_CLOUD_USERNAME = os.getenv("QFIELD_CLOUD_USERNAME", "")
QFIELD_CLOUD_PASSWORD = os.getenv("QFIELD_CLOUD_PASSWORD", "")


class QFieldCloudService:

    def __init__(self):
        self.base_url = QFIELD_CLOUD_URL.rstrip("/")
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
        )
               
        return cloud_id

    def eliminar_proyecto(self, cloud_project_id: str):
        """Elimina el proyecto en QField Cloud."""
        self._get_client().delete_project(cloud_project_id)

    def get_status(self, cloud_project_id: str) -> dict:
        data = self._get_client().get_project(cloud_project_id)
        return {
            "name":       data.get("name", ""),
            "status":     data.get("status", "unknown"),
            "updated_at": data.get("updated_at", ""),
            "url":        f"{self.base_url}/projects/{cloud_project_id}/",
        }

    def sincronizar(self, cloud_project_id: str, source_dir: str):
        """Sube una nueva versión de los archivos a un proyecto ya existente."""
        self._get_client().upload_files(
            project_id=cloud_project_id,
            upload_type=sdk.FileTransferType.PROJECT,
            project_path=source_dir,
        )
      
