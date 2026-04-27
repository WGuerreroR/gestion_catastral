from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from fastapi.responses import FileResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from sqlalchemy.orm import Session
from typing import List, Optional
from db.database import get_db
from core.deps import get_current_user, require_roles
from core.security import verify_password
from fastapi import BackgroundTasks
from services.qgis_export_service import (
    generar_paquete_proyecto, tarea_generar_proyecto, _comprimir_a_exports,generar_paquete_proyecto_2,
    _limpiar_recursos_anteriores, recursos_offline_existen,
)
from services.qfield_cloud_service import cloud_status
from repositories import asignacion_proyecto_repo,persona_repo
from schemas.asignacion_proyecto import (
    AsignacionProyectoCreate, AsignacionProyectoUpdate,
    AsignacionProyectoResponse, CambioResponsable,
    QFieldStatusResponse, QFieldSincronizarResponse,
)
from services.qfield_cloud_service import QFieldCloudService
from pydantic import BaseModel
import json
import os
basic_auth = HTTPBasic(auto_error=False)  



router = APIRouter(prefix="/proyectos", tags=["proyectos"])

class ConfirmarAsignacion(BaseModel):
    proyecto_id:     int
    persona_id:      int
    id_operaciones:  List[str]
    tipo_asignacion: str = "espacial"
    geojson:         Optional[dict] = None  # viene de polígono o shapefile
    codigo_manzana:  Optional[str]  = None  # viene de búsqueda por manzana
    modo:            str = "reemplazar"     # reemplazar | agregar
    estrategia_area: str = "union"          # union | convex_hull (solo si modo=agregar)

class CambioEstadoPredio(BaseModel):
    estado: str



EXPORTS_DIR = "/app/data/exports"
os.makedirs(EXPORTS_DIR, exist_ok=True)
 
 
def _zip_path(clave: str) -> str:
    return os.path.join(EXPORTS_DIR, f"{clave}.zip")
 

@router.get("/", response_model=List[AsignacionProyectoResponse])
def listar_proyectos(
    db: Session = Depends(get_db),
    user=Depends(get_current_user)
):
    return asignacion_proyecto_repo.get_all(db)

@router.get("/{proyecto_id}", response_model=AsignacionProyectoResponse)
def obtener_proyecto(
    proyecto_id: int,
    db: Session = Depends(get_db),
    user=Depends(get_current_user)
):
    proyecto = asignacion_proyecto_repo.get_by_id(db, proyecto_id)
    if not proyecto:
        raise HTTPException(status_code=404, detail="Proyecto no encontrado")
    return proyecto

@router.get("/{proyecto_id}/predios")
def predios_del_proyecto(
    proyecto_id: int,
    db: Session = Depends(get_db),
    user=Depends(get_current_user)
):
    return asignacion_proyecto_repo.get_predios(db, proyecto_id)

@router.get("/{proyecto_id}/geojson")
def geojson_proyecto(
    proyecto_id: int,
    db: Session = Depends(get_db),
    user=Depends(get_current_user)
):
    return asignacion_proyecto_repo.get_geojson(db, proyecto_id)

@router.post("/", status_code=201)
def crear_proyecto(
    data: AsignacionProyectoCreate,
    db: Session = Depends(get_db),
    user=Depends(require_roles("administrador", "supervisor"))
):
    if asignacion_proyecto_repo.get_by_clave(db, data.clave_proyecto):
        raise HTTPException(status_code=400, detail="Ya existe un proyecto con esa clave")
    id_ = asignacion_proyecto_repo.create(db, data.model_dump())
    return {"id": id_, "mensaje": "Proyecto creado exitosamente"}

@router.put("/{proyecto_id}")
def actualizar_proyecto(
    proyecto_id: int,
    data: AsignacionProyectoUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_roles("administrador", "supervisor"))
):
    if not asignacion_proyecto_repo.get_by_id(db, proyecto_id):
        raise HTTPException(status_code=404, detail="Proyecto no encontrado")
    campos = {k: v for k, v in data.model_dump().items() if v is not None}
    if not campos:
        raise HTTPException(status_code=400, detail="No hay campos para actualizar")
    asignacion_proyecto_repo.update(db, proyecto_id, campos)
    return {"mensaje": "Proyecto actualizado exitosamente"}

@router.put("/{proyecto_id}/responsable")
def cambiar_responsable(
    proyecto_id: int,
    data: CambioResponsable,
    db: Session = Depends(get_db),
    user=Depends(require_roles("administrador", "supervisor"))
):
    if not asignacion_proyecto_repo.get_by_id(db, proyecto_id):
        raise HTTPException(status_code=404, detail="Proyecto no encontrado")
    asignacion_proyecto_repo.update_responsable(db, proyecto_id, data.responsable_id)
    return {"mensaje": "Responsable actualizado. Todos los predios fueron reasignados"}

@router.post("/confirmar-asignacion")
def confirmar_asignacion(
    data: ConfirmarAsignacion,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user=Depends(require_roles("administrador", "supervisor"))
):
    if not data.id_operaciones:
        raise HTTPException(status_code=400, detail="No hay predios para asignar")

    if data.modo not in ("reemplazar", "agregar"):
        raise HTTPException(status_code=400, detail="modo inválido (reemplazar | agregar)")
    if data.estrategia_area not in ("union", "convex_hull"):
        raise HTTPException(status_code=400, detail="estrategia_area inválida (union | convex_hull)")

    proyecto = asignacion_proyecto_repo.get_by_id(db, data.proyecto_id)
    if not proyecto:
        raise HTTPException(status_code=404, detail="Proyecto no encontrado")

    # Modo reemplazar: borrar predios previos antes de insertar los nuevos
    if data.modo == "reemplazar":
        asignacion_proyecto_repo.borrar_predios_proyecto(db, data.proyecto_id)

    # Guardar / agregar área según modo y estrategia
    if data.geojson:
        if data.modo == "reemplazar":
            asignacion_proyecto_repo.guardar_area_poligono(
                db, data.proyecto_id, json.dumps(data.geojson)
            )
        else:
            asignacion_proyecto_repo.agregar_area_poligono(
                db, data.proyecto_id, json.dumps(data.geojson), data.estrategia_area
            )
    elif data.codigo_manzana:
        if data.modo == "reemplazar":
            asignacion_proyecto_repo.guardar_area_manzana(
                db, data.proyecto_id, data.codigo_manzana
            )
        else:
            asignacion_proyecto_repo.agregar_area_manzana(
                db, data.proyecto_id, data.codigo_manzana, data.estrategia_area
            )

    # Insertar predios (asignar_predios ya maneja duplicados)
    insertados = asignacion_proyecto_repo.asignar_predios(
        db,
        proyecto_id=data.proyecto_id,
        persona_id=data.persona_id,
        asignado_por=int(user.get("sub", 0)),
        predios=data.id_operaciones,
        tipo=data.tipo_asignacion
    )

    # Marcar como pendiente y lanzar generación en background
    asignacion_proyecto_repo.actualizar_estado_generacion(db, data.proyecto_id, "pendiente")
    """
    background_tasks.add_task(
        tarea_generar_proyecto,
        data.proyecto_id,
        proyecto["clave_proyecto"],
        data.id_operaciones,
    )
    """

    return {
        "mensaje":           f"{insertados} predios asignados exitosamente",
        "insertados":        insertados,
        "duplicados":        len(data.id_operaciones) - insertados,
        "estado_generacion": "pendiente",
    }

@router.put("/{proyecto_id}/predios/{asignacion_id}/estado")
def cambiar_estado_predio(
    proyecto_id: int,
    asignacion_id: int,
    data: CambioEstadoPredio,
    db: Session = Depends(get_db),
    user=Depends(get_current_user)
):
    estados_validos = ("campo", "validacion", "completado")
    if data.estado not in estados_validos:
        raise HTTPException(
            status_code=400,
            detail=f"Estado inválido. Use: {estados_validos}"
        )
    asignacion_proyecto_repo.actualizar_estado_predio(db, asignacion_id, proyecto_id, data.estado)
    return {"mensaje": f"Estado actualizado a '{data.estado}'"}

@router.delete("/{proyecto_id}/area")
def limpiar_area(
    proyecto_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_roles("administrador", "supervisor"))
):
    asignacion_proyecto_repo.limpiar_area(db, proyecto_id)
    return {"mensaje": "Área del proyecto limpiada"}

@router.delete("/{proyecto_id}")
def eliminar_proyecto(
    proyecto_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_roles("administrador"))
):
    proyecto = asignacion_proyecto_repo.get_by_id(db, proyecto_id)
    if not proyecto:
        raise HTTPException(status_code=404, detail="Proyecto no encontrado")

    # Borrar carpeta generada, zip de descarga y proyecto en QField Cloud
    _limpiar_recursos_anteriores(db, proyecto_id, proyecto["clave_proyecto"])

    asignacion_proyecto_repo.delete(db, proyecto_id)
    return {"mensaje": "Proyecto eliminado"}

@router.get("/{proyecto_id}/area")
def get_area_proyecto(
    proyecto_id: int,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """Devuelve el área del proyecto como GeoJSON Feature"""
    area = asignacion_proyecto_repo.get_area_geojson(db, proyecto_id)
    if not area:
        raise HTTPException(status_code=404, detail="El proyecto no tiene área definida")
    return area
 


 
def _generar_y_guardar(db: Session, proyecto_id: int, clave: str) -> str:
    """Genera el proyecto en el directorio permanente, crea el zip y devuelve su ruta."""
    project_dir = generar_paquete_proyecto(db, proyecto_id, clave)
    return _comprimir_a_exports(project_dir, clave)
 
 
@router.get("/id/{id}/descarga")
def descargar_proyecto_por_id(
    id: int,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user)
):
    proyecto = asignacion_proyecto_repo.get_by_id(db, id)
    if not proyecto:
        raise HTTPException(status_code=404, detail="Proyecto no encontrado")

    clave_proyecto = proyecto['clave_proyecto']
    zip_path = _zip_path(clave_proyecto)

    if not os.path.exists(zip_path):
        try:
            zip_path = _generar_y_guardar(db, id, clave_proyecto)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except FileNotFoundError as e:
            raise HTTPException(status_code=500, detail=str(e))
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Error generando paquete: {e}")

    return FileResponse(
        path=zip_path,
        media_type="application/zip",
        filename=f"{clave_proyecto}_offline.zip"
    )


@router.get("/clave/{clave_proyecto}/descarga")
def descargar_proyecto_por_clave(
    clave_proyecto: str,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user)
):
    ref = asignacion_proyecto_repo.get_by_clave(db, clave_proyecto)
    if not ref:
        raise HTTPException(status_code=404, detail="Proyecto no encontrado")

    zip_path = _zip_path(clave_proyecto)

    if not os.path.exists(zip_path):
        try:
            zip_path = _generar_y_guardar(db, ref.id, clave_proyecto)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except FileNotFoundError as e:
            raise HTTPException(status_code=500, detail=str(e))
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Error generando paquete: {e}")

    return FileResponse(
        path=zip_path,
        media_type="application/zip",
        filename=f"{clave_proyecto}_offline.zip"
    )
 

def _autenticar_qfield(db: Session, credentials: HTTPBasicCredentials, token: str):
    # ── Basic Auth ────────────────────────────────────────────────────────────
    if credentials and credentials.username:
        persona = persona_repo.get_by_identificacion(db, credentials.username)
        if not persona or not verify_password(credentials.password, persona.password_hash):
            raise HTTPException(
                status_code=401,
                detail="Credenciales inválidas",
                headers={"WWW-Authenticate": 'Basic realm="QField"'}
            )
        return persona
 
    # ── Token JWT en query param ──────────────────────────────────────────────
    if token:
        from app.core.security import decode_token
        payload = decode_token(token)
        if not payload:
            raise HTTPException(status_code=401, detail="Token inválido o expirado")
        return payload
 
    # ── Sin credenciales → QField muestra diálogo de login ───────────────────
    raise HTTPException(
        status_code=401,
        detail="Autenticación requerida",
        headers={"WWW-Authenticate": 'Basic realm="QField"'}
    )
 
 
@router.get("/clave/{clave_proyecto}/descarga/qfields")
def descargar_proyecto_qfield(
    clave_proyecto: str,
    db: Session                       = Depends(get_db),
    credentials: HTTPBasicCredentials = Depends(basic_auth),
    token: str                        = Query(default=None, include_in_schema=False)
):
    """
    Descarga el paquete QField.
    Cualquier usuario activo puede descargar (Basic Auth o ?token=<jwt>).
    Usa cache si existe, genera si no.
    """
    _autenticar_qfield(db, credentials, token)

    zip_path = _zip_path(clave_proyecto)

    if os.path.exists(zip_path):
        return FileResponse(
            path=zip_path,
            media_type="application/zip",
            filename=f"{clave_proyecto}_offline.zip"
        )

    ref = asignacion_proyecto_repo.get_by_clave(db, clave_proyecto)
    if not ref:
        raise HTTPException(status_code=404, detail="Proyecto no encontrado")

    try:
        zip_path = _generar_y_guardar(db, ref.id, clave_proyecto)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except FileNotFoundError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error generando paquete: {e}")

    return FileResponse(
        path=zip_path,
        media_type="application/zip",
        filename=f"{clave_proyecto}_offline.zip"
    )


# ── Endpoints QField Cloud ────────────────────────────────────────────────────

@router.get("/{proyecto_id}/qfield/status", response_model=QFieldStatusResponse)
def qfield_status(
    proyecto_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Consulta el estado del proyecto en QField Cloud.
    Retorna 'sin_cloud' si el proyecto aún no ha sido sincronizado.
    """
    proyecto = asignacion_proyecto_repo.get_by_id(db, proyecto_id)
    if not proyecto:
        raise HTTPException(status_code=404, detail="Proyecto no encontrado")

    cloud_id = asignacion_proyecto_repo.get_qfield_cloud_id(db, proyecto_id)

    if not cloud_id:
        return QFieldStatusResponse(
            proyecto_id=proyecto_id,
            nombre=proyecto["clave_proyecto"],
            estado="sin_cloud",
        )

    try:
        cloud_svc = QFieldCloudService()
        info = cloud_svc.get_status(cloud_id)
        return QFieldStatusResponse(
            proyecto_id=proyecto_id,
            cloud_project_id=cloud_id,
            nombre=proyecto["clave_proyecto"],
            estado="sincronizado",
            url_cloud=info.get("url"),
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Error consultando QField Cloud: {exc}")


@router.post("/{proyecto_id}/qfield/sincronizar", response_model=QFieldSincronizarResponse)
def qfield_sincronizar(
    proyecto_id: int,
    db: Session = Depends(get_db),
    _user=Depends(require_roles("administrador", "supervisor")),
):
    """
    Regenera el paquete del proyecto y lo sincroniza con QField Cloud.
    Actualiza el cloud_project_id en BD si cambia.
    """
    proyecto = asignacion_proyecto_repo.get_by_id(db, proyecto_id)
    if not proyecto:
        raise HTTPException(status_code=404, detail="Proyecto no encontrado")

    clave       = proyecto["clave_proyecto"]
    predios_ids = asignacion_proyecto_repo.get_predios_ids(db, proyecto_id)

    try:
        project_dir = generar_paquete_proyecto(db, proyecto_id, clave, predios_ids)
        _comprimir_a_exports(project_dir, clave)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Error generando paquete: {exc}")

    try:
        cloud_svc = QFieldCloudService()
        cloud_id  = cloud_svc.crear_o_actualizar_proyecto(clave, project_dir)
        asignacion_proyecto_repo.guardar_qfield_cloud_id(db, proyecto_id, cloud_id)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Error sincronizando con QField Cloud: {exc}")

    url_cloud = f"{os.getenv('QFIELD_CLOUD_URL', 'https://app.qfield.cloud')}/projects/{cloud_id}/"

    return QFieldSincronizarResponse(
        mensaje=f"Proyecto '{clave}' sincronizado exitosamente con QField Cloud",
        cloud_project_id=cloud_id,
        url_cloud=url_cloud,
    )


@router.get("/{proyecto_id}/qfield/descargar")
def qfield_descargar(
    proyecto_id: int,
    db: Session = Depends(get_db),
    credentials: HTTPBasicCredentials = Depends(basic_auth),
    token: str = Query(default=None, include_in_schema=False),
):
    """
    Descarga el paquete QField del proyecto por ID.
    Misma autenticación que /clave/{clave}/descarga/qfields (Basic Auth o ?token=<jwt>).
    Usa el zip en disco si existe; lo genera si no.
    """
    _autenticar_qfield(db, credentials, token)

    proyecto = asignacion_proyecto_repo.get_by_id(db, proyecto_id)
    if not proyecto:
        raise HTTPException(status_code=404, detail="Proyecto no encontrado")

    clave    = proyecto["clave_proyecto"]
    zip_path = _zip_path(clave)

    if not os.path.exists(zip_path):
        try:
            zip_path = _generar_y_guardar(db, proyecto_id, clave)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Error generando paquete: {exc}")

    return FileResponse(
        path=zip_path,
        media_type="application/zip",
        filename=f"{clave}.zip",
    )


@router.get("/{proyecto_id}/estado-generacion")
def estado_generacion(
    proyecto_id: int,
    db: Session = Depends(get_db),
    _current_user=Depends(get_current_user),
):
    """
    Consulta el estado de generación del paquete QField.
    Útil para hacer polling después de confirmar-asignacion.
    Estados: sin_generar | pendiente | procesando | terminado | error
    """
    estado = asignacion_proyecto_repo.get_estado_generacion(db, proyecto_id)
    if not estado:
        raise HTTPException(status_code=404, detail="Proyecto no encontrado")

    from services.qgis_export_service import _progreso, recursos_offline_existen
    estado["progreso"] = _progreso.get(
        proyecto_id,
        100 if estado["estado_generacion"] == "terminado" else 0,
    )

    # Verificación física: el estado en BD puede decir "terminado" pero los
    # archivos pueden haber sido borrados manualmente o perdidos en un rebuild.
    # Para considerar el proyecto offline "disponible" se exigen AMBOS:
    # la carpeta desempaquetada y el zip de descarga.
    recursos = recursos_offline_existen(db, proyecto_id, estado["clave"])
    estado["archivo_existe"] = recursos["carpeta"] and recursos["zip"]
    estado["recursos"]       = {
        "carpeta": recursos["carpeta"],
        "zip":     recursos["zip"],
        "cloud":   recursos["cloud"],
    }

    return estado


@router.post("/{proyecto_id}/proyecto-offline/generar", status_code=202)
def generar_proyecto_offline(
    proyecto_id: int,
    background_tasks: BackgroundTasks,
    reemplazar: bool = False,
    db: Session = Depends(get_db),
    _user=Depends(require_roles("administrador", "supervisor")),
):
    """
    Dispara la generación del proyecto offline en background.
      202 → tarea encolada
      404 → proyecto no encontrado
      409 → ya existe (carpeta/zip/cloud) y reemplazar=False
    """
    proyecto = asignacion_proyecto_repo.get_by_id(db, proyecto_id)
    if not proyecto:
        raise HTTPException(status_code=404, detail="Proyecto no encontrado")

    clave = proyecto["clave_proyecto"]
    info  = recursos_offline_existen(db, proyecto_id, clave)

    if info["existe"] and not reemplazar:
        raise HTTPException(
            status_code=409,
            detail={
                "mensaje": "El proyecto offline ya existe",
                "carpeta": info["carpeta"],
                "zip":     info["zip"],
                "cloud":   info["cloud"],
            },
        )

    predios = asignacion_proyecto_repo.get_predios_ids(db, proyecto_id)
    asignacion_proyecto_repo.actualizar_estado_generacion(db, proyecto_id, "pendiente")
    background_tasks.add_task(tarea_generar_proyecto, proyecto_id, clave, predios)

    return {"mensaje": "Generación encolada", "estado_generacion": "pendiente"}


@router.get("/{proyecto_id}/descargar-proyecto-qgis")
def descargar_proyecto_qgis(
    proyecto_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _user=Depends(get_current_user),
):
    """
    Descarga un .qgz copia del proyecto base con el canvas centrado en el
    área del proyecto. Mantiene las conexiones PostGIS vivas (no offline).
    """
    from fastapi.responses import FileResponse
    import shutil
    from services.qgis_export_service import generar_qgz_centrado

    try:
        zip_path, clave, temp_root = generar_qgz_centrado(db, proyecto_id)
    except ValueError as e:
        msg = str(e)
        if msg == "Proyecto no encontrado":
            raise HTTPException(404, msg)
        raise HTTPException(400, msg)
    except Exception as e:
        raise HTTPException(500, f"Error generando QGZ: {e}")

    background_tasks.add_task(shutil.rmtree, temp_root, ignore_errors=True)
    return FileResponse(
        zip_path,
        filename=f"{clave}.zip",
        media_type="application/zip",
    )


@router.post("/{proyecto_id}/cargar-offline")
async def cargar_offline(
    proyecto_id: int,
    archivo: UploadFile = File(...),
    db: Session = Depends(get_db),
    _user=Depends(require_roles("administrador", "supervisor")),
):
    """
    Sube un .zip con un proyecto offline ya preparado (ej. generado en QGIS
    desktop con QFieldSync) y lo instala como el proyecto offline del proyecto
    de asignación. Reemplaza cualquier proyecto offline previo.
    """
    from services.qgis_export_service import cargar_proyecto_offline

    if not archivo.filename or not archivo.filename.lower().endswith(".zip"):
        raise HTTPException(400, "El archivo debe tener extensión .zip")

    contenido = await archivo.read()
    if not contenido:
        raise HTTPException(400, "El archivo está vacío")

    try:
        return cargar_proyecto_offline(db, proyecto_id, contenido)
    except ValueError as e:
        msg = str(e)
        if msg == "Proyecto no encontrado":
            raise HTTPException(404, msg)
        raise HTTPException(400, msg)
    except Exception as e:
        raise HTTPException(500, str(e))


# ── QField Cloud: subir / sincronizar / estado combinado ────────────────────

@router.get("/{proyecto_id}/qfield/cloud-status")
def qfield_cloud_status(
    proyecto_id: int,
    db: Session = Depends(get_db),
    _user=Depends(get_current_user),
):
    """
    Estado combinado local + QField Cloud. Usado por el UI para decidir
    qué botón mostrar (Subir / Sincronizar / ninguno).
    """


    try:
        return cloud_status(db, proyecto_id)
    except ValueError as e:
        raise HTTPException(404, str(e))
    except Exception as e:
        raise HTTPException(500, str(e))


@router.post("/{proyecto_id}/qfield/subir-cloud", status_code=202)
def qfield_subir_cloud(
    proyecto_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _user=Depends(require_roles("administrador", "supervisor")),
):
    """
    PUSH inicial en background. Devuelve 202 inmediato. El frontend hace
    polling a /cloud-status para ver el progreso.
    """
    from services.qfield_cloud_service import validar_subida, tarea_subir_cloud

    try:
        validar_subida(db, proyecto_id)
    except ValueError as e:
        msg = str(e)
        if msg == "Proyecto no encontrado":
            raise HTTPException(404, msg)
        if "en curso" in msg:
            raise HTTPException(409, msg)
        raise HTTPException(400, msg)

    background_tasks.add_task(tarea_subir_cloud, proyecto_id)
    return {"mensaje": "Subida encolada", "operacion": "subir"}


@router.post("/{proyecto_id}/qfield/sincronizar-cloud", status_code=202)
def qfield_sincronizar_cloud(
    proyecto_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _user=Depends(require_roles("administrador", "supervisor")),
):
    """
    PULL en background. Devuelve 202 inmediato. Polling vía /cloud-status.
    """
    from services.qfield_cloud_service import validar_sincronizacion, tarea_sincronizar_cloud

    try:
        validar_sincronizacion(db, proyecto_id)
    except ValueError as e:
        msg = str(e)
        if msg == "Proyecto no encontrado":
            raise HTTPException(404, msg)
        if "en curso" in msg:
            raise HTTPException(409, msg)
        raise HTTPException(400, msg)

    background_tasks.add_task(tarea_sincronizar_cloud, proyecto_id)
    return {"mensaje": "Sincronización encolada", "operacion": "sincronizar"}


@router.post("/{proyecto_id}/cancelar-operacion")
def cancelar_operacion(
    proyecto_id: int,
    db: Session = Depends(get_db),
    _user=Depends(require_roles("administrador", "supervisor")),
):
    """
    Cancela una operación en curso sobre el proyecto (generación offline o
    subida/sincronización con QField Cloud). Las tareas background revisan
    el flag en puntos cooperativos y salen limpiamente.
    """
    from services.qgis_export_service import _cancelar_offline, _progreso
    from services.qfield_cloud_service import _cloud_progreso

    cancelado = []

    if proyecto_id in _progreso:
        _cancelar_offline[proyecto_id] = True
        cancelado.append("offline")

    if proyecto_id in _cloud_progreso:
        _cloud_progreso[proyecto_id]["cancelar"] = True
        cancelado.append("cloud")

    if not cancelado:
        return {"mensaje": "No hay operaciones en curso para cancelar", "cancelado": []}

    return {
        "mensaje":   f"Solicitud de cancelación enviada para: {', '.join(cancelado)}",
        "cancelado": cancelado,
    }