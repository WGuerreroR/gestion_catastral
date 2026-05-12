"""Service de migración LADM. Port headless del ETL PyQt5 viejo.

Origen: ETL/ladm/main/src/migracion.py + migracion_thread.py.
Cambios respecto al original:
  - Sin PyQt5 (QThread/pyqtSignal): el job corre dentro de FastAPI BackgroundTasks.
  - Progreso/errores se persisten en BD (migracion_ladm_job + migracion_ladm_log)
    en lugar de archivos .log/.json.
  - Cancelación cooperativa: chequea `cancelar_solicitado` antes de cada SQL.
  - Conexión: si el job no tiene `conexion_id`, se usa el DATABASE_URL del backend.
"""
import logging
import os
from decimal import Decimal
from datetime import datetime, date
from pathlib import Path
from typing import Optional

import psycopg2
from psycopg2.extras import execute_values
from sqlalchemy.engine.url import make_url
from sqlalchemy.orm import Session

from db.database import SessionLocal
from repositories import migracion_ladm_repo as repo


log = logging.getLogger(__name__)

# Carpeta con los 21 .sql copiados del ETL viejo.
SQL_DIR = Path(__file__).resolve().parent.parent / "sql" / "ladm_migracion" / "1_0__1_2"


class _Cancelado(Exception):
    """Se lanza para abortar la migración de forma controlada."""


# ── Helpers ────────────────────────────────────────────────────────────────

def _serializar_valor(v):
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    if isinstance(v, (int, float, str, bool)) or v is None:
        return v
    return str(v)


PSYCOPG_CONNECT_TIMEOUT = int(os.getenv("LADM_PG_CONNECT_TIMEOUT", "10"))


def _resolver_conn_params(db: Session, job: dict) -> dict:
    """Devuelve dict listo para psycopg2.connect(). Incluye connect_timeout."""
    if job["conexion_id"] is not None:
        params = repo.obtener_conexion_descifrada(db, job["conexion_id"])
        if not params:
            raise RuntimeError(f"Perfil de conexión {job['conexion_id']} no encontrado")
    else:
        url = make_url(os.getenv("DATABASE_URL"))
        params = {
            "host":     url.host,
            "port":     url.port or 5432,
            "dbname":   url.database,
            "user":     url.username,
            "password": url.password,
        }
    params["connect_timeout"] = PSYCOPG_CONNECT_TIMEOUT
    return params


def probar_conexion(host: str, port: int, dbname: str,
                    usuario: str, password: str) -> tuple[bool, str]:
    """Intenta abrir conexión + SELECT 1 con timeout corto."""
    try:
        with psycopg2.connect(
            host=host, port=port, dbname=dbname,
            user=usuario, password=password,
            connect_timeout=5,
        ) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
                cur.fetchone()
        return True, "Conexión exitosa"
    except Exception as e:
        return False, str(e)


# ── Script personalizado (pre-migración) ───────────────────────────────────

def _ejecutar_script_personalizado(conn, esquema_origen: str, esquema_destino: str) -> None:
    """Port literal de migracion.ejecutar_script_personalizado.

    Prepara cr_interesado.index, temp_aux.interesado_index y
    {esquema_origen}.caracteristicas. Cualquier excepción se propaga.
    """
    with conn.cursor() as cursor:
        cursor.execute(f"""
            ALTER TABLE {esquema_origen}.cr_interesado
            ADD COLUMN IF NOT EXISTS index INT;
        """)

        cursor.execute(f"""
            DO $$
            DECLARE
                contador INT := 1;
                fila_record RECORD;
                cur CURSOR FOR
                    SELECT * FROM {esquema_origen}.cr_interesado;
            BEGIN
                FOR fila_record IN cur LOOP
                    UPDATE {esquema_origen}.cr_interesado
                    SET index = contador
                    WHERE CURRENT OF cur;
                    contador := contador + 1;
                END LOOP;
            END $$;
        """)

        cursor.execute("CREATE SCHEMA IF NOT EXISTS temp_aux;")

        cursor.execute(f"""
            DROP TABLE IF EXISTS temp_aux.interesado_index;
            CREATE TABLE temp_aux.interesado_index AS (
                SELECT DISTINCT ON
                    (ci.nombre, ci.tipo_documento, ci.documento_identidad)
                    index, ci.nombre, ci.tipo_documento, ci.documento_identidad
                FROM {esquema_origen}.cr_interesado ci
            );
        """)

        cursor.execute(f"""
            DROP TABLE IF EXISTS {esquema_origen}.caracteristicas;
            CREATE TABLE {esquema_origen}.caracteristicas AS (
                SELECT DISTINCT
                    nextval('{esquema_destino}.t_ili2db_seq'::regclass) t_id_calificacionconvencional,
                    cc3.t_id tipo_calificacion,
                    ca2.t_id armazon,
                    cm2.t_id muros,
                    cc5.t_id cubierta,
                    ce2.t_id conservacion_estructura,
                    cf2.t_id fachada,
                    ccm2.t_id cubrimiento_muros,
                    cp2.t_id piso,
                    cet.t_id conservacion_acabados,
                    ctb2.t_id tamanio_banio,
                    ceb2.t_id enchape_banio,
                    cmb2.t_id mobiliario_banio,
                    cet2.t_id conservacion_banio,
                    ctc2.t_id tamanio_cocina,
                    cec2.t_id enchape_cocina,
                    cmc2.t_id mobiliario_cocina,
                    cet3.t_id conservacion_cocina,
                    cc7.ilicode cerchas_complemento_industria,
                    NULL::BOOLEAN altura_cerchas_superior_6m,
                    cc.total_calificacion total_calificacion,
                    ic.t_id t_id_caracteristicas,
                    cc.id_operacion_unidad_cons source_id_uc,
                    nextval('{esquema_destino}.t_ili2db_seq'::regclass) t_id_anexo,
                    ca4.t_id tipo_anexo,
                    cet4.t_id conservacion_anexo
                FROM {esquema_origen}.cr_caracteristicasunidadconstruccion cc
                LEFT JOIN {esquema_destino}.ilc_caracteristicasunidadconstruccion ic
                    ON CONCAT(cc.npn, cc.identificador) = CONCAT(ic.local_id, ic.identificador)
                LEFT JOIN {esquema_origen}.cuc_calificartipo cc2
                    ON cc.tipo_calificacion = cc2.code
                LEFT JOIN {esquema_destino}.cuc_calificartipo cc3
                    ON cc2.value = cc3.ilicode
                LEFT JOIN {esquema_origen}.cuc_anexotipo ca3
                    ON cc.tipo_anexo = ca3.code
                LEFT JOIN {esquema_destino}.cuc_anexotipo ca4
                    ON ca3.value = ca4.ilicode
                LEFT JOIN {esquema_origen}.cuc_armazontipo ca
                    ON cc.armazon = ca.code
                LEFT JOIN {esquema_destino}.cuc_armazontipo ca2
                    ON ca.value = ca2.ilicode
                LEFT JOIN {esquema_origen}.cuc_murostipo cm
                    ON cc.muros = cm.code
                LEFT JOIN {esquema_destino}.cuc_murostipo cm2
                    ON cm.value = cm2.ilicode
                LEFT JOIN {esquema_origen}.cuc_cubiertatipo cc4
                    ON cc.cubierta = cc4.code
                LEFT JOIN {esquema_destino}.cuc_cubiertatipo cc5
                    ON cc4.value = cc5.ilicode
                LEFT JOIN {esquema_origen}.cuc_estadoconservaciontipo ce
                    ON cc.conservacion_cubierta = ce.code
                LEFT JOIN {esquema_destino}.cuc_estadoconservaciontipo ce2
                    ON ce.value = ce2.ilicode
                LEFT JOIN {esquema_origen}.cuc_fachadatipo cf
                    ON cc.fachada = cf.code
                LEFT JOIN {esquema_destino}.cuc_fachadatipo cf2
                    ON cf.value = cf2.ilicode
                LEFT JOIN {esquema_origen}.cuc_cubrimiento_murostipo ccm
                    ON cc.cubrimiento_muros = ccm.code
                LEFT JOIN {esquema_destino}.cuc_cubrimiento_murostipo ccm2
                    ON ccm2.ilicode = ccm.value
                LEFT JOIN {esquema_origen}.cuc_pisotipo cp
                    ON cc.piso = cp.code
                LEFT JOIN {esquema_destino}.cuc_pisotipo cp2
                    ON cp.value = cp2.ilicode
                LEFT JOIN {esquema_origen}.cuc_estadoconservaciontipo ce3
                    ON cc.conservacion_acabados = ce3.code
                LEFT JOIN {esquema_destino}.cuc_estadoconservaciontipo cet
                    ON ce3.value = cet.ilicode
                LEFT JOIN {esquema_origen}.cuc_tamanio_baniotipo ctb
                    ON ctb.code = cc.tamanio_banio
                LEFT JOIN {esquema_destino}.cuc_tamanio_baniotipo ctb2
                    ON ctb.value = ctb2.ilicode
                LEFT JOIN {esquema_origen}.cuc_enchape_baniotipo ceb
                    ON cc.enchape_banio = ceb.code
                LEFT JOIN {esquema_destino}.cuc_enchape_baniotipo ceb2
                    ON ceb.value = ceb2.ilicode
                LEFT JOIN {esquema_origen}.cuc_mobiliario_baniotipo cmb
                    ON cc.mobiliario_banio = cmb.code
                LEFT JOIN {esquema_destino}.cuc_mobiliario_baniotipo cmb2
                    ON cmb.value = cmb2.ilicode
                LEFT JOIN {esquema_origen}.cuc_estadoconservaciontipo ce4
                    ON cc.conservacion_banio = ce4.code
                LEFT JOIN {esquema_destino}.cuc_estadoconservaciontipo cet2
                    ON cet2.ilicode = ce4.value
                LEFT JOIN {esquema_origen}.cuc_tamanio_cocinatipo ctc
                    ON cc.tamanio_cocina = ctc.code
                LEFT JOIN {esquema_destino}.cuc_tamanio_cocinatipo ctc2
                    ON ctc.value = ctc2.ilicode
                LEFT JOIN {esquema_origen}.cuc_enchape_cocinatipo cec
                    ON cc.enchape_cocina = cec.code
                LEFT JOIN {esquema_destino}.cuc_enchape_cocinatipo cec2
                    ON cec.value = cec2.ilicode
                LEFT JOIN {esquema_origen}.cuc_mobiliario_cocinatipo cmc
                    ON cc.mobiliario_cocina = cmc.code
                LEFT JOIN {esquema_destino}.cuc_mobiliario_cocinatipo cmc2
                    ON cmc.value = cmc2.ilicode
                LEFT JOIN {esquema_origen}.cuc_estadoconservaciontipo ce5
                    ON cc.conservacion_cocina = ce5.code
                LEFT JOIN {esquema_destino}.cuc_estadoconservaciontipo cet3
                    ON ce5.value = cet3.ilicode
                LEFT JOIN {esquema_origen}.cuc_cerchascomplementoindustriatipo cc6
                    ON cc.cerchas_complemento_industria = cc6.code
                LEFT JOIN {esquema_destino}.cuc_cerchascomplementoindustriatipo cc7
                    ON cc6.value = cc7.ilicode
                LEFT JOIN {esquema_origen}.cuc_estadoconservaciontipo ce6
                    ON cc.conservacion_anexo = ce6.code
                LEFT JOIN {esquema_destino}.cuc_estadoconservaciontipologiatipo cet4
                    ON ce6.value = SUBSTRING(cet4.ilicode FROM 1 FOR POSITION('_' IN cet4.ilicode) - 1)
            );
        """)
        conn.commit()


# ── Inserción dinámica con logging fila por fila a BD ──────────────────────

def _dynamic_insert_with_logging(conn, db: Session, job_id: int,
                                 source_query: str, target_table: str,
                                 nombre_archivo: str) -> None:
    with conn.cursor() as cursor:
        try:
            cursor.execute(f"TRUNCATE TABLE {target_table} CASCADE")
            cursor.execute(source_query)
        except Exception as e:
            raise RuntimeError(
                f"Fallo ejecutando SELECT del archivo '{nombre_archivo}' "
                f"(target {target_table}): {e}"
            ) from e
        rows = cursor.fetchall()
        field_mappings = {desc[0]: idx for idx, desc in enumerate(cursor.description)}
        field_list = ', '.join(field_mappings.keys())
        insert_sql = f"INSERT INTO {target_table} ({field_list}) VALUES %s"

        values = [[row[i] for i in range(len(field_mappings))] for row in rows]

        try:
            execute_values(cursor, insert_sql, values, page_size=1000)
            conn.commit()
        except Exception as e:
            log.warning("Inserción masiva falló en %s — fallback fila por fila: %s",
                        target_table, e)
            conn.rollback()
            placeholders = ', '.join(['%s'] * len(field_mappings))
            insert_one = f"INSERT INTO {target_table} ({field_list}) VALUES ({placeholders})"
            for idx, row in enumerate(rows):
                try:
                    cursor.execute(insert_one, [row[i] for i in range(len(field_mappings))])
                    if idx % 1000 == 0:
                        conn.commit()
                except Exception as err:
                    fila_dict = {
                        col: _serializar_valor(row[i])
                        for col, i in field_mappings.items()
                    }
                    repo.registrar_error_log(db, job_id, target_table, fila_dict, str(err))
                    conn.rollback()
            conn.commit()


# ── Migración principal ────────────────────────────────────────────────────

def _listar_sql_ordenados() -> list[str]:
    """Lista los .sql del directorio en el mismo orden que el ETL viejo
    (clave numérica antes del primer punto)."""
    archivos = [f for f in os.listdir(SQL_DIR) if f.endswith(".sql")]
    return sorted(archivos, key=lambda x: float(x.split('. ')[0].replace('_', '.')))


def _ejecutar_migracion_principal(db: Session, conn_params: dict, job: dict) -> None:
    job_id          = job["id"]
    esquema_origen  = job["esquema_origen"]
    esquema_destino = job["esquema_destino"]
    tabla_dominios  = job["tabla_dominios"]

    archivos = _listar_sql_ordenados()
    total = len(archivos)
    repo.actualizar_progreso(db, job_id, 0, None, 0, total)

    for index, nombre in enumerate(archivos):
        if repo.cancelacion_solicitada(db, job_id):
            raise _Cancelado()

        # "5. cr_agrupacioninteresados.sql" → "cr_agrupacioninteresados".
        # Usamos splitext para tolerar puntos dentro del nombre lógico.
        tabla = os.path.splitext(nombre.split('. ', 1)[-1].strip())[0]
        repo.actualizar_progreso(db, job_id,
                                 progreso=int(index / total * 100),
                                 tabla=tabla, idx=index + 1, total=total)

        ruta = SQL_DIR / nombre
        with open(ruta, "r", encoding="UTF-8") as f:
            source_query_pre = f.read()
        source_query = source_query_pre.format(
            esquema_origen=esquema_origen,
            esquema_destino=esquema_destino,
            tabla_dominios=tabla_dominios,
        )

        # Una conexión por tabla — replica el comportamiento del ETL viejo,
        # que abre un context manager `with psycopg2.connect(...)` por archivo.
        with psycopg2.connect(**conn_params) as conn:
            _dynamic_insert_with_logging(
                conn, db, job_id, source_query,
                f"{esquema_destino}.{tabla}", nombre,
            )

        repo.actualizar_progreso(db, job_id,
                                 progreso=int((index + 1) / total * 100),
                                 tabla=tabla, idx=index + 1, total=total)


# ── Entrada de BackgroundTasks ─────────────────────────────────────────────

def ejecutar_job(job_id: int) -> None:
    """Ejecuta el job completo. Crea su propia sesión BD."""
    log.info("ejecutar_job(%s): inicio", job_id)
    db = SessionLocal()
    try:
        job = repo.obtener_job(db, job_id)
        if not job:
            log.error("Job %s no encontrado", job_id)
            return

        repo.actualizar_estado_job(db, job_id, "running")
        conn_params = _resolver_conn_params(db, job)
        log.info("ejecutar_job(%s): conectando a %s:%s/%s (timeout=%ss)",
                 job_id, conn_params["host"], conn_params["port"],
                 conn_params["dbname"], conn_params["connect_timeout"])

        # Pre-migración: ejecuta script personalizado.
        with psycopg2.connect(**conn_params) as conn:
            _ejecutar_script_personalizado(
                conn, job["esquema_origen"], job["esquema_destino"],
            )

        # Migración: 21 SQLs.
        _ejecutar_migracion_principal(db, conn_params, job)

        repo.actualizar_progreso(db, job_id, 100, None, None, None)
        repo.actualizar_estado_job(db, job_id, "done")

    except _Cancelado:
        repo.actualizar_estado_job(db, job_id, "cancelled")
    except Exception as e:
        log.exception("Error en migración LADM job %s", job_id)
        repo.actualizar_estado_job(db, job_id, "error", error_message=str(e))
    finally:
        db.close()
