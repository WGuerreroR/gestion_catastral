"""
app/services/qfield_sync_service.py

Orquestador del sync inverso (paquete offline → PostGIS).

Patrón: el endpoint encola un sync (devuelve 202 con sync_id), y la
BackgroundTask hace todo el trabajo pesado contra una `SessionLocal()`
nueva. El frontend consulta el estado vía
`GET /offline/sync/{sync_id}/detalle` (que ya existe).

Idempotencia: cada sync se identifica por SHA256 del ZIP. Si el mismo
hash ya tiene un sync exitoso para esa asignación y no se pidió forzar,
devuelve el resumen previo y marca este sync como "idempotente".

Iter 3: solo aplica `lc_predio_p`. El resto de capas detecta cambios pero
NO los aplica todavía (advertencia explícita en el resumen).
"""

from __future__ import annotations

import hashlib
import os
import shutil
import sqlite3
import tempfile
import traceback
from typing import Optional

from db.database import SessionLocal
from repositories import asignacion_proyecto_repo, sync_history_repo
from services import qfield_upsert_service, qfield_photo_service
from services.qfield_gpkg_inspector import inspeccionar_paquete
from services.qgis_export_service import EXPORTS_DIR, QGIS_EXPORTS_DIR


# ── Estado en memoria por sync (para polling fino, opcional) ───────────────

_sync_progreso: dict[int, dict] = {}


# ── Helpers ────────────────────────────────────────────────────────────────

def _sha256_archivo(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(64 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _resumen_a_dict(resumen) -> dict:
    """Convierte ResumenCapa a dict serializable."""
    return {
        "added":            resumen.added,
        "updated":          resumen.updated,
        "deleted":          resumen.deleted,
        "errors":           resumen.errors,
        "advertencias":     resumen.advertencias,
        "errores_detalle":  resumen.errores_detalle,
    }


def _comparacion_a_dict(comp) -> dict:
    """Convierte ResumenComparacion a dict serializable (para preview-only)."""
    return {
        "added":     len(comp.added),
        "updated":   len(comp.updated),
        "unchanged": comp.unchanged,
        "errors":    len(comp.errors),
    }


def _recolectar_predios_tocados(db, gpkg_path: str, capas_info: dict, resumenes: dict) -> set[str]:
    """
    Mapea las PKs aplicadas en cada capa al `id_operacion` del predio
    correspondiente, para marcar `lc_predio_p.ultima_sync_offline`.

    Maneja dos tipos de PKs:
    - PKs reales: se busca el predio en PostGIS por la PK de negocio.
    - PKs locales `__nuevo_fid_<fid>` (rows nuevos cuyo globalid se asigna
      con DEFAULT al INSERT): se lee `id_operacion_predio` directamente
      del GPKG por `fid`.
    """
    from sqlalchemy import text as _text
    from services.qfield_upsert_service import CAPAS_EDITABLES

    predios: set[str] = set()
    # Abrir una conexión read-only al GPKG para los lookups por fid de
    # rows nuevos. Se cierra al final.
    conn_gpkg = sqlite3.connect(f"file:{gpkg_path}?mode=ro", uri=True)
    try:
        # Lookup de qgis_table por postgis_table (para leer del GPKG por fid)
        qgis_por_pg = {
            c.postgis_table: c.qgis_table
            for c in capas_info.values()
            if getattr(c, "is_editable", False)
        }

        for tabla_pg, res in resumenes.items():
            pks_tocados = list(res.added_pks) + list(res.updated_pks)
            if not pks_tocados:
                continue

            # Separar PKs reales de las locales (rows nuevos sin globalid)
            pks_reales = [p for p in pks_tocados
                          if not (isinstance(p, str) and p.startswith("__nuevo_fid_"))]
            fids_locales = [int(p.removeprefix("__nuevo_fid_"))
                            for p in pks_tocados
                            if isinstance(p, str) and p.startswith("__nuevo_fid_")]

            if tabla_pg == "lc_predio_p":
                # id_operacion ES el id del predio. PKs locales no aplican
                # (lc_predio_p.id_operacion no es autogenerado).
                predios.update(p for p in pks_reales if p)

            elif tabla_pg in (
                "cr_terreno",
                "cr_caracteristicasunidadconstruccion",
                "cr_interesado",
                "lc_derecho",
            ):
                # PKs reales: query a PostGIS
                if pks_reales:
                    pk_col = CAPAS_EDITABLES[tabla_pg]["pk_negocio"]
                    rows = db.execute(_text(f"""
                        SELECT DISTINCT id_operacion_predio
                        FROM {tabla_pg}
                        WHERE "{pk_col}" = ANY(:pks)
                          AND id_operacion_predio IS NOT NULL
                    """), {"pks": pks_reales}).fetchall()
                    predios.update(r[0] for r in rows if r[0])
                # PKs locales (rows nuevos): leer id_operacion_predio del GPKG
                qgis_table = qgis_por_pg.get(tabla_pg)
                if fids_locales and qgis_table:
                    placeholders = ",".join("?" for _ in fids_locales)
                    cur = conn_gpkg.execute(
                        f'SELECT DISTINCT id_operacion_predio FROM "{qgis_table}" '
                        f'WHERE fid IN ({placeholders}) AND id_operacion_predio IS NOT NULL',
                        fids_locales,
                    )
                    predios.update(r[0] for r in cur.fetchall() if r[0])

            elif tabla_pg == "cr_unidadconstruccion":
                # FK indirecta: u.id_operacion_unidad_const → c.id_operacion_unidad_cons
                if pks_reales:
                    rows = db.execute(_text("""
                        SELECT DISTINCT c.id_operacion_predio
                        FROM cr_unidadconstruccion u
                        JOIN cr_caracteristicasunidadconstruccion c
                          ON c.id_operacion_unidad_cons = u.id_operacion_unidad_const
                        WHERE u.id_operacion_uc_geo = ANY(:pks)
                          AND c.id_operacion_predio IS NOT NULL
                    """), {"pks": pks_reales}).fetchall()
                    predios.update(r[0] for r in rows if r[0])
                # Para rows nuevos en cr_unidadconstruccion no tenemos forma
                # directa de obtener id_operacion_predio sin joinear contra
                # cr_caracteristicasunidadconstruccion (que también puede ser
                # nuevo). Edge case: lo dejamos sin marcar; el predio igual
                # se va a marcar por las otras capas que sí mapean directo.
    finally:
        conn_gpkg.close()

    return predios


# ── API pública: encolar y ejecutar ────────────────────────────────────────

def encolar_aplicacion(
    db,
    asignacion_id: int,
    paquete_bytes: bytes,
    paquete_filename: str,
    usuario: Optional[str],
    forzar_reproceso: bool = False,
) -> tuple[int, dict]:
    """
    Persiste el ZIP en disco temporalmente, calcula su hash SHA256, crea
    el registro inicial en sync_history (estado='encolado') y devuelve
    `(sync_id, info)`. La aplicación real corre en background con
    `tarea_aplicar_paquete(sync_id, zip_path)`.

    Si el ZIP ya fue aplicado antes con éxito y `forzar_reproceso` es False,
    crea un sync con estado 'idempotente' que copia el resumen del previo.
    """
    # 1. Guardar el ZIP en una carpeta persistente (la background task lo
    #    extrae y limpia luego). Usamos /tmp porque el sync es corto.
    work_dir = tempfile.mkdtemp(prefix="qfield_sync_")
    zip_path = os.path.join(work_dir, paquete_filename or "paquete.zip")
    with open(zip_path, "wb") as f:
        f.write(paquete_bytes)

    paquete_hash = _sha256_archivo(zip_path)

    # 2. Idempotencia
    if not forzar_reproceso:
        previo = sync_history_repo.find_by_hash_ok(db, asignacion_id, paquete_hash)
        if previo:
            sync_id = sync_history_repo.create(
                db,
                asignacion_id=asignacion_id,
                paquete_nombre=paquete_filename,
                paquete_hash=paquete_hash,
                usuario=usuario,
                forzado=False,
                estado="idempotente",
            )
            sync_history_repo.update(db, sync_id, {
                "estrategia_diff": previo.get("estrategia_diff"),
                "resumen": previo.get("resumen"),
                "advertencias": ["Sync idempotente: el mismo paquete ya fue aplicado antes con éxito"],
            })
            shutil.rmtree(work_dir, ignore_errors=True)
            return sync_id, {"idempotente": True, "previo_sync_id": previo["id"]}

    # 3. Crear registro inicial
    sync_id = sync_history_repo.create(
        db,
        asignacion_id=asignacion_id,
        paquete_nombre=paquete_filename,
        paquete_hash=paquete_hash,
        usuario=usuario,
        forzado=forzar_reproceso,
        estado="encolado",
    )

    _sync_progreso[sync_id] = {
        "asignacion_id":  asignacion_id,
        "zip_path":       zip_path,
        "work_dir":       work_dir,
        "estado":         "encolado",
    }

    return sync_id, {"idempotente": False}


def tarea_aplicar_paquete(sync_id: int) -> None:
    """
    Tarea de background: extrae el zip, inspecciona, aplica capa por capa,
    actualiza sync_history. Crea su propia SessionLocal porque corre fuera
    del request lifecycle.
    """
    info = _sync_progreso.get(sync_id)
    if not info:
        # Otra instancia del proceso o reinicio — no podemos seguir
        return

    zip_path = info["zip_path"]
    work_dir = info["work_dir"]
    asignacion_id = info["asignacion_id"]

    db = SessionLocal()
    info["estado"] = "corriendo"
    sync_history_repo.update(db, sync_id, {"estado": "corriendo"})

    resumen_capas: dict[str, dict] = {}
    # ResumenCapa objects (con listas de PKs) — los necesitamos después del
    # commit para mapear a id_operacion y marcar lc_predio_p.ultima_sync_offline
    resumenes_obj: dict[str, "qfield_upsert_service.ResumenCapa"] = {}
    fotos_resumen: Optional[dict] = None
    advertencias: list[str] = []
    estado_anterior: Optional[str] = None
    estado_nuevo: Optional[str] = None
    estado_final = "ok"
    error_detalle: Optional[str] = None

    try:
        # 1. Inspeccionar
        insp = inspeccionar_paquete(zip_path, extract_to=work_dir)
        if not insp.valido:
            raise RuntimeError(
                "Paquete inválido: " + "; ".join(insp.errores)
            )
        advertencias.extend(insp.advertencias)

        # 2. Validación contra la asignación
        asignacion = asignacion_proyecto_repo.get_by_id(db, asignacion_id)
        if not asignacion:
            raise RuntimeError(f"Asignación {asignacion_id} no encontrada")
        estado_anterior = asignacion.get("estado")

        # 3. Aplicar capa por capa con SAVEPOINT independiente (la lógica
        #    está dentro de qfield_upsert_service.aplicar_capa).
        #    Iteramos en ORDEN_APLICACION (topológico por FKs) para evitar
        #    fallos por foreign key cuando llegan rows nuevos: por ejemplo,
        #    un cr_interesado nuevo no puede insertarse antes que su
        #    lc_derecho referenciado por id_operacion_derecho, ni
        #    cr_unidadconstruccion antes que cr_caracteristicasunidadconstruccion.
        conn = sqlite3.connect(f"file:{insp.gpkg_path}?mode=ro", uri=True)
        capas_por_tabla = {
            c.postgis_table: c for c in insp.capas.values() if c.is_editable
        }
        try:
            tablas_a_procesar = list(qfield_upsert_service.ORDEN_APLICACION)
            # Cualquier capa editable presente en el paquete pero no listada
            # en ORDEN_APLICACION (no debería pasar) la sumamos al final.
            for tabla_pg in capas_por_tabla:
                if tabla_pg not in tablas_a_procesar:
                    tablas_a_procesar.append(tabla_pg)

            for tabla_pg in tablas_a_procesar:
                capa = capas_por_tabla.get(tabla_pg)
                if not capa:
                    continue  # capa no presente en este paquete

                if tabla_pg in qfield_upsert_service.CAPAS_HABILITADAS_APLICAR:
                    # Aplica de verdad
                    res = qfield_upsert_service.aplicar_capa(
                        db, conn, capa.qgis_table, tabla_pg,
                        geom_col_gpkg=capa.geom_col,
                    )
                    resumenes_obj[tabla_pg] = res
                    resumen_capas[tabla_pg] = _resumen_a_dict(res)
                    if res.errors > 0:
                        estado_final = "parcial"
                else:
                    # Solo comparar (preview), sin aplicar
                    comp = qfield_upsert_service.comparar_capa(
                        db, conn, capa.qgis_table, tabla_pg,
                        geom_col_gpkg=capa.geom_col,
                    )
                    resumen_capas[tabla_pg] = {
                        "added":   0,
                        "updated": 0,
                        "deleted": 0,
                        "errors":  0,
                        "advertencias": [
                            f"capa no habilitada para apply en esta iter "
                            f"(detectados {len(comp.added)} nuevos / "
                            f"{len(comp.updated)} modificados, no aplicados)"
                        ],
                        "errores_detalle": [],
                    }

            # Procesar fotos del DCIM/ del paquete (después de aplicar capas
            # para que la BD ya tenga las rutas actualizadas).
            if insp.dcim_path:
                fotos_res = qfield_photo_service.procesar_dcim(
                    insp.dcim_path,
                    sync_id=sync_id,
                    conn_gpkg=conn,
                    capas_info=insp.capas,
                    db=db,
                    clave_proyecto=asignacion["clave_proyecto"],
                )
                fotos_resumen = fotos_res.to_dict()
                if fotos_res.errores:
                    estado_final = "parcial"
            else:
                fotos_resumen = {
                    "advertencias": ["Paquete sin carpeta DCIM/, fotos no procesadas"]
                }
        finally:
            conn.close()

        db.commit()

        # 4. Marcar sincronización exitosa en la asignación
        if estado_final in ("ok", "parcial"):
            db.execute_text = None  # placeholder
            from sqlalchemy import text
            db.execute(text("""
                UPDATE admin_asignacion
                   SET ultima_sincronizacion_offline = NOW()
                 WHERE id = :id
            """), {"id": asignacion_id})

            # Transición de estado: campo → sincronizado solo si sync ok limpio.
            # El paso a 'validacion' se hace manualmente después; un proyecto
            # puede sincronizarse varias veces sin salir de 'sincronizado'.
            if estado_final == "ok" and estado_anterior == "campo":
                db.execute(text("""
                    UPDATE admin_asignacion
                       SET estado = 'sincronizado',
                           fecha_actualizacion = NOW()
                     WHERE id = :id
                """), {"id": asignacion_id})
                estado_nuevo = "sincronizado"
                advertencias.append("Estado de la asignación pasó de 'campo' a 'sincronizado'")

            # Marcar lc_predio_p.ultima_sync_offline para los predios tocados.
            # Mapea las PKs aplicadas en cada capa al id_operacion del predio.
            predios_tocados = _recolectar_predios_tocados(
                db, insp.gpkg_path, insp.capas, resumenes_obj
            )
            if predios_tocados:
                db.execute(text("""
                    UPDATE lc_predio_p
                    SET ultima_sync_offline = NOW()
                    WHERE id_operacion = ANY(:ids)
                """), {"ids": list(predios_tocados)})
                advertencias.append(
                    f"{len(predios_tocados)} predio(s) marcados como sincronizados"
                )

            db.commit()

        # 5. Persistir el ZIP como paquete oficial de la asignación.
        # Solo si el sync terminó 100% limpio (estado='ok'); en parcial o
        # error NO se toca exports/ para evitar inconsistencias.
        if estado_final == "ok":
            clave = asignacion["clave_proyecto"]
            zip_dest    = os.path.join(EXPORTS_DIR, f"{clave}.zip")
            carpeta_dst = os.path.join(QGIS_EXPORTS_DIR, clave)
            backup_dst  = carpeta_dst + ".backup"

            try:
                # Backup atómico de la carpeta vieja (si existe) por si falla
                # el reemplazo: queda recuperable en .backup
                shutil.rmtree(backup_dst, ignore_errors=True)
                if os.path.isdir(carpeta_dst):
                    shutil.move(carpeta_dst, backup_dst)

                # Copiar el ZIP al destino oficial (sobrescribe si existe)
                os.makedirs(EXPORTS_DIR, exist_ok=True)
                shutil.copy2(zip_path, zip_dest)

                # Reemplazar la carpeta extraída con el contenido de work_dir
                # (que ya tiene data.gpkg, DCIM/, .qgs, etc.)
                shutil.copytree(work_dir, carpeta_dst)

                # Marcar generación como terminada (igual a cargar_proyecto_offline)
                asignacion_proyecto_repo.actualizar_estado_generacion(
                    db, asignacion_id, "terminado",
                )

                # Limpiar backup tras éxito
                shutil.rmtree(backup_dst, ignore_errors=True)
                advertencias.append(
                    f"Paquete persistido en {os.path.basename(zip_dest)} y carpeta {clave}/"
                )
            except Exception as exc_persist:
                # Rollback de la carpeta vieja si la teníamos respaldada
                if os.path.isdir(backup_dst):
                    shutil.rmtree(carpeta_dst, ignore_errors=True)
                    shutil.move(backup_dst, carpeta_dst)
                advertencias.append(
                    f"Sync ok pero no se pudo persistir el paquete: {exc_persist}"
                )

    except Exception as exc:
        estado_final = "error"
        error_detalle = f"{type(exc).__name__}: {exc}\n{traceback.format_exc()}"
        try:
            db.rollback()
        except Exception:
            pass

    # 5. Persistir el resumen final en sync_history
    try:
        sync_history_repo.update(db, sync_id, {
            "estado":           estado_final,
            "estrategia_diff":  "diff_por_pk",
            "resumen":          resumen_capas,
            "fotos_resumen":    fotos_resumen,
            "advertencias":     advertencias,
            "estado_anterior":  estado_anterior,
            "estado_nuevo":     estado_nuevo,
            "error_detalle":    error_detalle,
        })
    finally:
        db.close()
        _sync_progreso.pop(sync_id, None)
        shutil.rmtree(work_dir, ignore_errors=True)
