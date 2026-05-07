"""Validación de calidad de datos catastrales.

Orquesta la ejecución asíncrona de reglas SQL contra `lc_predio_p` y tablas
relacionadas, persiste errores aislados por job y poblando el esquema
`validado` con los predios que cumplen.

Las reglas son dinámicas (CRUD desde la UI). Cada regla declara su `entidad`
objetivo (predio | terreno | interesado | unidad_construccion) y un
`sql_template` con el placeholder `{{filtro_alcance}}` que el service
sustituye por el JOIN apropiado según el alcance del job.
"""
import re
import logging
from typing import Iterable, Optional
from sqlalchemy import text
from sqlalchemy.orm import Session

from repositories import validacion_calidad_repo as repo
from repositories import marca_predio_repo


logger = logging.getLogger(__name__)


class CancelacionUsuario(Exception):
    pass


# ── Convención de aliases por entidad ───────────────────────────────────────
# Cada entidad debe usar el alias indicado. El sustitutor de {{filtro_alcance}}
# genera el JOIN contra ese alias. Las reglas que validan cualquier cosa
# distinta de `predio` deben siempre hacer JOIN con `lc_predio_p p` para
# poder reportar `p.numero_predial` en el log.

ALIAS_POR_ENTIDAD = {
    "predio":              ("p",  "p.id_operacion"),
    "terreno":             ("t",  "t.id_operacion_predio"),
    "interesado":          ("ci", "ci.id_operacion_predio"),
    "unidad_construccion": ("uc", "uc.id_operacion_predio"),
}

# Tablas de dominios LADM (las copiamos completas a `validado` la primera vez)
TABLAS_DOMINIO = [
    "campobooleano", "caracteristicas", "clase_viaprincipal", "codigo_novedad",
    "cr_construccion_planta", "cr_documentotipo", "cr_grupoetnicotipo",
    "cr_interesadotipo", "cr_serviciospublicos", "cr_unidadconstrucciontipo",
    "cr_usoconstipo", "cuc_anexotipo", "cuc_armazontipo", "cuc_calificartipo",
    "cuc_cerchascomplementoindustriatipo", "cuc_cubiertatipo",
    "cuc_cubrimiento_murostipo", "cuc_enchape_baniotipo", "cuc_enchape_cocinatipo",
    "cuc_estadoconservaciontipo", "cuc_fachadatipo", "cuc_mobiliario_baniotipo",
    "cuc_mobiliario_cocinatipo", "cuc_murostipo", "cuc_pisotipo",
    "cuc_tamanio_baniotipo", "cuc_tamanio_cocinatipo", "lc_calidad",
    "lc_categoria_suelo", "lc_clasesuelotipo", "lc_colindantetipo",
    "lc_condicionprediotipo", "lc_derechotipo", "lc_destinacioneconomicatipo",
    "lc_direcciontipo", "lc_escalatipo", "lc_metodotipo", "lc_orientaciontipo",
    "lc_prediotipo", "lc_resultadovisitatipo", "sector", "sexo",
    "tipo_fteadm",
]

# Tablas vacías que se crean con el mismo esquema que public (se poblan en cada job)
TABLAS_DATOS_VACIAS = [
    "cr_caracteristicasunidadconstruccion", "cr_construccion", "cr_interesado",
    "cr_terreno", "cr_unidadconstruccion", "lc_derecho",
    "lc_estructuranovedadnumeropredial", "lc_informalidad", "lc_predio_p",
    "procedimiento_catresg", "restriccion",
]

# Tablas relacionadas que se pueblan tras insertar lc_predio_p
TABLAS_RELACIONADAS = [
    ("cr_terreno",                          "id_operacion_predio"),
    ("cr_unidadconstruccion",               "id_operacion_predio"),
    ("cr_caracteristicasunidadconstruccion","id_operacion_predio"),
    ("cr_interesado",                       "id_operacion_predio"),
    ("lc_derecho",                          None),  # se omite si no hay FK directo
]


# ── Validación al guardar reglas ────────────────────────────────────────────
#
# El usuario provee SOLO el cuerpo SELECT (o WITH ... SELECT) que produce las
# 4 columnas (job_id, numero_predial, regla, descripcion). El service envuelve
# automáticamente con `INSERT INTO validacion_calidad_log (...)` antes de
# ejecutar. Esto evita que una regla maliciosa pueda escribir un INSERT en
# otra tabla.

PLACEHOLDER = "{{filtro_alcance}}"
INSERT_PREFIX = (
    "INSERT INTO validacion_calidad_log "
    "(job_id, numero_predial, regla, descripcion)\n"
)
RE_STARTS_WITH_INSERT = re.compile(r"^\s*INSERT\b", re.IGNORECASE)
RE_STARTS_WITH_SELECT_OR_WITH = re.compile(r"^\s*(SELECT|WITH)\b", re.IGNORECASE)


def envolver_con_insert(sql_select: str) -> str:
    """Envuelve un SELECT (o WITH ... SELECT) con el prefijo INSERT
    autorizado. El service llama esto justo antes de ejecutar."""
    return INSERT_PREFIX + sql_select


def validar_sql_template(sql: str, entidad: str) -> None:
    """Lanza ValueError si el SQL no cumple las reglas mínimas de seguridad/forma.
    Espera SOLO el cuerpo SELECT (o WITH ... SELECT). El INSERT se añade en
    tiempo de ejecución."""
    sql = sql or ""
    if RE_STARTS_WITH_INSERT.match(sql):
        raise ValueError(
            "El SQL debe ser un SELECT (o WITH ... SELECT) que devuelva las 4 "
            "columnas del error: (:job_id, p.numero_predial, 'CODIGO', 'descripción'). "
            "No incluyas instrucciones INSERT."
        )
    if not RE_STARTS_WITH_SELECT_OR_WITH.match(sql):
        raise ValueError("El SQL debe iniciar con SELECT o WITH ... SELECT")
    if sql.count(PLACEHOLDER) != 1:
        raise ValueError(f"El SQL debe contener exactamente un {PLACEHOLDER}")
    if entidad not in ALIAS_POR_ENTIDAD:
        raise ValueError(f"Entidad inválida: {entidad}")
    alias, _ = ALIAS_POR_ENTIDAD[entidad]
    if not re.search(rf"\b{re.escape(alias)}\b", sql):
        raise ValueError(
            f"El SQL debe usar el alias '{alias}' para la entidad '{entidad}'"
        )
    if "p.numero_predial" not in sql:
        raise ValueError(
            "El SQL debe incluir 'p.numero_predial' (alias 'p' del JOIN a lc_predio_p)"
        )
    if ":job_id" not in sql:
        raise ValueError(
            "El SQL debe referenciar ':job_id' como primera columna del SELECT"
        )


def explain_sql(db: Session, sql_template: str, entidad: str) -> tuple[bool, str | None]:
    """Hace EXPLAIN del SQL final (envuelto con INSERT) sustituyendo placeholder
    por cadena vacía y :job_id por 0. Retorna (ok, error_message)."""
    try:
        sql_select = sql_template.replace(PLACEHOLDER, "")
        sql_full = envolver_con_insert(sql_select)
        db.execute(text("EXPLAIN " + sql_full), {"job_id": 0})
        db.rollback()
        return True, None
    except Exception as e:
        try:
            db.rollback()
        except Exception:
            pass
        return False, str(e)


# ── Sustitución del placeholder ─────────────────────────────────────────────

def construir_join_alcance(entidad: str, tabla_alcance: str) -> str:
    """Genera el INNER JOIN al alcance según la entidad. Si no hay tabla
    (alcance='todo'), retorna cadena vacía."""
    if not tabla_alcance:
        return ""
    _, fk = ALIAS_POR_ENTIDAD[entidad]
    return f"INNER JOIN {tabla_alcance} ap ON ap.id_operacion = {fk}"


def aplicar_filtro(sql_template: str, entidad: str, tabla_alcance: str | None) -> str:
    """Sustituye el placeholder y envuelve con el INSERT autorizado."""
    sql_select = sql_template.replace(
        PLACEHOLDER, construir_join_alcance(entidad, tabla_alcance or "")
    )
    return envolver_con_insert(sql_select)


# ── Esquema validado ────────────────────────────────────────────────────────

def asegurar_esquema_validado(db: Session) -> None:
    """Crea esquema `validado` y todas las tablas necesarias si no existen."""
    db.execute(text("CREATE SCHEMA IF NOT EXISTS validado"))

    # Dominios: copia completa la primera vez
    for tabla in TABLAS_DOMINIO:
        # Solo si la tabla pública existe; algunas instalaciones pueden no tenerlas
        existe_pub = db.execute(
            text("SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=:t"),
            {"t": tabla},
        ).fetchone()
        if not existe_pub:
            continue
        db.execute(text(
            f"CREATE TABLE IF NOT EXISTS validado.{tabla} AS SELECT * FROM public.{tabla}"
        ))

    # Tablas de datos vacías
    for tabla in TABLAS_DATOS_VACIAS:
        existe_pub = db.execute(
            text("SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=:t"),
            {"t": tabla},
        ).fetchone()
        if not existe_pub:
            continue
        db.execute(text(
            f"CREATE TABLE IF NOT EXISTS validado.{tabla} AS SELECT * FROM public.{tabla} WHERE false"
        ))

    # Unique index sobre validado.lc_predio_p(id_operacion). CREATE TABLE AS
    # SELECT no preserva la PK; este índice protege contra duplicados ante
    # re-ejecuciones concurrentes y permite ON CONFLICT si se necesitara.
    db.execute(text(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_validado_lc_predio_p_idop "
        "ON validado.lc_predio_p (id_operacion)"
    ))

    db.commit()


# ── Tabla temporal de alcance ───────────────────────────────────────────────

def _nombre_tabla_alcance(job_id: int) -> str:
    # Nombre cualificado en public para que sea visible desde el mismo proceso
    # entre transacciones (no usamos TEMP TABLE porque puede haber commits intermedios).
    return f"public._vc_alcance_{job_id}"


def crear_tabla_alcance(db: Session, job_id: int, alcance_tipo: str,
                        alcance_valores: list[str]) -> tuple[str, int]:
    """Crea la tabla con los predios del alcance. Retorna (nombre_tabla, n_predios)."""
    tabla = _nombre_tabla_alcance(job_id)
    db.execute(text(f"DROP TABLE IF EXISTS {tabla}"))
    db.execute(text(f"""
        CREATE UNLOGGED TABLE {tabla} (
            id_operacion   varchar(50) PRIMARY KEY,
            numero_predial varchar(50)
        )
    """))

    if alcance_tipo == "todo":
        db.execute(text(f"""
            INSERT INTO {tabla} (id_operacion, numero_predial)
            SELECT id_operacion, numero_predial FROM public.lc_predio_p
            WHERE id_operacion IS NOT NULL
        """))
    elif alcance_tipo == "predios":
        # Acepta números prediales o id_operacion (el usuario puede pegar
        # cualquiera de los dos, incluso mezclados).
        db.execute(text(f"""
            INSERT INTO {tabla} (id_operacion, numero_predial)
            SELECT id_operacion, numero_predial FROM public.lc_predio_p
            WHERE numero_predial = ANY(:vals)
               OR id_operacion   = ANY(:vals)
        """), {"vals": alcance_valores})
    elif alcance_tipo == "manzanas":
        db.execute(text(f"""
            INSERT INTO {tabla} (id_operacion, numero_predial)
            SELECT id_operacion, numero_predial FROM public.lc_predio_p
            WHERE LEFT(numero_predial, 17) = ANY(:vals)
        """), {"vals": alcance_valores})
    else:
        raise ValueError(f"alcance_tipo inválido: {alcance_tipo}")

    n = db.execute(text(f"SELECT COUNT(*) AS n FROM {tabla}")).fetchone().n
    db.commit()
    return tabla, n


def borrar_tabla_alcance(db: Session, job_id: int) -> None:
    try:
        db.execute(text(f"DROP TABLE IF EXISTS {_nombre_tabla_alcance(job_id)}"))
        db.commit()
    except Exception:
        pass


# ── Limpieza/inserción en esquema validado ──────────────────────────────────

def _tabla_validado_existe(db: Session, tabla: str) -> bool:
    return db.execute(text(
        "SELECT 1 FROM information_schema.tables "
        "WHERE table_schema='validado' AND table_name=:t"
    ), {"t": tabla}).fetchone() is not None


def _columna_existe(db: Session, schema: str, tabla: str, columna: str) -> bool:
    return db.execute(text(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_schema=:s AND table_name=:t AND column_name=:c"
    ), {"s": schema, "t": tabla, "c": columna}).fetchone() is not None


def _limpiar_alcance_en_validado(db: Session, alcance_tipo: str,
                                  tabla_alcance: str) -> list[str]:
    """Borra de validado.lc_predio_p y relacionadas los predios del alcance.
    Cada tabla aislada con commit/rollback propio para que un fallo no
    contamine las demás. Devuelve lista de warnings (tablas que no se
    pudieron procesar)."""
    warnings: list[str] = []
    relacionadas = (
        "cr_terreno", "cr_unidadconstruccion",
        "cr_caracteristicasunidadconstruccion", "cr_interesado",
    )

    # 1) Tabla principal — si esto falla el caller decide qué hacer
    if alcance_tipo == "todo":
        db.execute(text("TRUNCATE validado.lc_predio_p CASCADE"))
    else:
        db.execute(text(f"""
            DELETE FROM validado.lc_predio_p
            WHERE id_operacion IN (SELECT id_operacion FROM {tabla_alcance})
        """))
    db.commit()

    # 2) Relacionadas — solo las que tengan id_operacion_predio.
    #    cr_unidadconstruccion, p.ej., NO lo tiene (usa id_operacion_unidad_const).
    for t in relacionadas:
        if not _tabla_validado_existe(db, t):
            continue
        if not _columna_existe(db, "validado", t, "id_operacion_predio"):
            warnings.append(f"validado.{t}: sin id_operacion_predio (omitida)")
            continue
        try:
            if alcance_tipo == "todo":
                db.execute(text(f"TRUNCATE validado.{t}"))
            else:
                db.execute(text(f"""
                    DELETE FROM validado.{t}
                    WHERE id_operacion_predio IN (SELECT id_operacion FROM {tabla_alcance})
                """))
            db.commit()
        except Exception as e:
            try: db.rollback()
            except Exception: pass
            msg = f"validado.{t}: fallo al limpiar — {str(e)[:200]}"
            logger.warning(f"[validacion_calidad] {msg}")
            warnings.append(msg)
    return warnings


def _insertar_predios_validos(db: Session, job_id: int, tabla_alcance: str,
                              aplicar_filtro_calidad: bool = True) -> int:
    """Inserta en validado.lc_predio_p los predios del alcance cuyos errores,
    si los hay, están TODOS cubiertos por exclusiones del mismo job. Si
    aplicar_filtro_calidad es True (default), exige además que las 6 columnas
    calidad_* estén en 1 (gate del equipo de calidad).

    Asume que `_limpiar_alcance_en_validado` ya se ejecutó: no hay duplicados
    porque las filas del alcance se borraron antes. El unique index
    `uq_validado_lc_predio_p_idop` protege contra carreras concurrentes."""
    filtro_cal = ""
    if aplicar_filtro_calidad:
        filtro_cal = """
          AND lp.calidad_campo          = 1
          AND lp.calidad_sig            = 1
          AND lp.calidad_fisica         = 1
          AND lp.calidad_juridica       = 1
          AND lp.calidad_economica      = 1
          AND lp.calidad_identificacion = 1
        """
    res = db.execute(text(f"""
        INSERT INTO validado.lc_predio_p
        SELECT lp.* FROM public.lc_predio_p lp
        JOIN {tabla_alcance} ap ON ap.id_operacion = lp.id_operacion
        WHERE NOT EXISTS (
          SELECT 1 FROM validacion_calidad_log l
           WHERE l.job_id = :job_id
             AND l.numero_predial = lp.numero_predial
             AND l.numero_predial IS NOT NULL
             AND NOT EXISTS (
               SELECT 1 FROM validacion_calidad_excepcion x
                WHERE x.job_id = l.job_id
                  AND x.numero_predial = l.numero_predial
                  AND (x.regla IS NULL OR x.regla = l.regla)
             )
        )
        {filtro_cal}
    """), {"job_id": job_id})
    return res.rowcount or 0


def _poblar_relacionadas(db: Session) -> list[str]:
    """Pobla validado.cr_terreno, cr_unidadconstruccion, cr_caracteristicas...,
    cr_interesado a partir de los predios ya insertados en validado.lc_predio_p.
    Cada tabla aislada — si una falla las demás continúan. Skip si la tabla
    pública no tiene la FK declarada (caso cr_unidadconstruccion sin
    id_operacion_predio). Devuelve lista de warnings."""
    warnings: list[str] = []
    for tabla, fk in TABLAS_RELACIONADAS:
        if not fk:
            continue
        if not _tabla_validado_existe(db, tabla):
            continue
        if not _columna_existe(db, "public", tabla, fk):
            warnings.append(f"validado.{tabla}: public.{tabla}.{fk} no existe (omitida)")
            continue
        try:
            db.execute(text(f"""
                INSERT INTO validado.{tabla}
                SELECT t.* FROM public.{tabla} t
                JOIN validado.lc_predio_p p ON p.id_operacion = t.{fk}
            """))
            db.commit()
        except Exception as e:
            try: db.rollback()
            except Exception: pass
            msg = f"validado.{tabla}: fallo al poblar — {str(e)[:200]}"
            logger.warning(f"[validacion_calidad] {msg}")
            warnings.append(msg)
    return warnings


# ── Tarea principal del job ─────────────────────────────────────────────────

def ejecutar_job(job_id: int) -> None:
    """Punto de entrada para BackgroundTasks. Crea su propia sesión BD."""
    from db.database import SessionLocal

    db = SessionLocal()
    try:
        job = repo.obtener_job(db, job_id)
        if job is None:
            logger.error(f"[validacion_calidad] job {job_id} no existe")
            return

        repo.actualizar_estado_job(db, job_id, "running")
        repo.actualizar_progreso(db, job_id, 1)

        # Registrar el PID del backend para que cancelar_job pueda llamar a
        # pg_cancel_backend y matar la query activa si una regla pesada se
        # demora. Sin esto la cancelación es solo cooperativa.
        try:
            pid = db.execute(text("SELECT pg_backend_pid()")).scalar()
            repo.actualizar_worker_pid(db, job_id, int(pid))
        except Exception as e:
            logger.warning(f"[validacion_calidad] no se pudo registrar worker_pid: {e}")

        # 1. Esquema validado
        asegurar_esquema_validado(db)
        _check_cancel(db, job_id)
        repo.actualizar_progreso(db, job_id, 5)

        # 2. Tabla de alcance
        tabla_alcance, n_predios = crear_tabla_alcance(
            db, job_id, job["alcance_tipo"], list(job["alcance_valores"] or [])
        )
        _check_cancel(db, job_id)

        # 3. Reglas a ejecutar
        reglas = repo.obtener_reglas_para_ejecutar(db, list(job["reglas_omitidas"] or []))
        total_reglas = len(reglas)

        # 4. Ejecutar cada regla
        for i, regla in enumerate(reglas):
            _check_cancel(db, job_id)
            # Indicador para el UI mientras esta regla corre.
            repo.actualizar_regla_actual(
                db, job_id, f"[{regla['codigo']}] {regla['nombre']}"
            )
            try:
                # Techo defensivo de 2h por regla; en la práctica no debería
                # alcanzarse, pero evita que una regla mal escrita cuelgue
                # el worker indefinidamente.
                db.execute(text("SET LOCAL statement_timeout = '2h'"))
                sql_final = aplicar_filtro(
                    regla["sql_template"], regla["entidad"], tabla_alcance
                )
                # Inyectar prefijo INSERT (ya viene en el template) y job_id
                db.execute(text(sql_final), {"job_id": job_id})
                db.commit()
            except Exception as e:
                db.rollback()
                logger.error(
                    f"[validacion_calidad] regla {regla['codigo']} falló en job {job_id}: {e}"
                )
                # Persistir el fallo de la regla como un error sintético del log
                try:
                    db.execute(text("""
                        INSERT INTO validacion_calidad_log
                          (job_id, numero_predial, regla, descripcion)
                        VALUES (:jid, NULL, :regla, :desc)
                    """), {
                        "jid": job_id,
                        "regla": regla["codigo"],
                        "desc": f"[ERROR EJECUCIÓN REGLA] {e}"[:2000],
                    })
                    db.commit()
                except Exception:
                    db.rollback()

            # progreso: 10..80% durante reglas
            pct = 10 + int(70 * (i + 1) / max(1, total_reglas))
            repo.actualizar_progreso(db, job_id, pct)

        _check_cancel(db, job_id)

        # IMPORTANTE: el worker NO toca `validado.*`. Esa tabla solo se
        # modifica explícitamente cuando el usuario clica "Migrar a validado"
        # vía el endpoint /migrar-validado. Esto evita que un job sin
        # elegibles (p.ej. todos bloqueados por el gate de calidad) borre
        # accidentalmente predios que estaban allí desde un job anterior.
        repo.actualizar_progreso(db, job_id, 85)

        # Calcular cuántos predios serían elegibles (sin INSERT — solo COUNT).
        n_validos = _contar_predios_elegibles(
            db, job_id, tabla_alcance,
            aplicar_filtro_calidad=bool(job.get("aplicar_filtro_calidad", True)),
        )
        repo.actualizar_progreso(db, job_id, 95)

        # Totales y cierre
        n_errores = db.execute(
            text("SELECT COUNT(*) AS n FROM validacion_calidad_log WHERE job_id = :id"),
            {"id": job_id},
        ).fetchone().n
        repo.actualizar_totales(db, job_id, n_predios, n_validos, n_errores)
        repo.actualizar_progreso(db, job_id, 100)

        # `migrado_en` solo se setea cuando el usuario clica el botón
        # "Migrar a validado", no aquí.
        repo.actualizar_estado_job(db, job_id, "done", marcar_finalizado=True)

    except CancelacionUsuario:
        logger.info(f"[validacion_calidad] job {job_id} cancelado por el usuario")
        try: db.rollback()
        except Exception: pass
        try:
            repo.actualizar_estado_job(
                db, job_id, "cancelled",
                error_message="Cancelado por el usuario",
                marcar_finalizado=True,
            )
        except Exception:
            logger.exception(f"[validacion_calidad] job {job_id} no se pudo marcar cancelled")
    except Exception as exc:
        logger.exception(f"[validacion_calidad] job {job_id} falló")
        # CRÍTICO: rollback antes de actualizar el estado. Si la sesión
        # quedó en transacción abortada (p.ej. SQL inválido), todos los
        # UPDATEs siguientes fallan y el job queda huérfano en 'running'.
        try: db.rollback()
        except Exception: pass
        try:
            repo.actualizar_estado_job(
                db, job_id, "error", error_message=str(exc)[:2000], marcar_finalizado=True
            )
        except Exception:
            logger.exception(f"[validacion_calidad] job {job_id} no se pudo marcar error")
    finally:
        try:
            borrar_tabla_alcance(db, job_id)
        except Exception:
            pass
        try:
            # Garantiza limpieza del indicador en cualquier caso (done, cancelled, error)
            repo.actualizar_regla_actual(db, job_id, None)
        except Exception:
            pass
        try:
            # Limpia el PID del worker para que un eventual cancelar tardío
            # no intente matar un backend que ya no es nuestro.
            repo.actualizar_worker_pid(db, job_id, None)
        except Exception:
            pass
        db.close()


def _check_cancel(db: Session, job_id: int) -> None:
    if repo.cancelacion_solicitada(db, job_id):
        raise CancelacionUsuario()


# ── Recálculo de validez tras cambios de exclusiones ───────────────────────

class JobOcupado(Exception):
    """El job aún está corriendo o pendiente; no se puede recalcular."""
    pass


def _contar_predios_elegibles(db: Session, job_id: int, tabla_alcance: str,
                              aplicar_filtro_calidad: bool) -> int:
    """Cuenta cuántos predios del alcance serían elegibles para validado.*
    sin hacer INSERT. Misma lógica que `_insertar_predios_validos`."""
    filtro_cal = ""
    if aplicar_filtro_calidad:
        filtro_cal = """
          AND lp.calidad_campo          = 1
          AND lp.calidad_sig            = 1
          AND lp.calidad_fisica         = 1
          AND lp.calidad_juridica       = 1
          AND lp.calidad_economica      = 1
          AND lp.calidad_identificacion = 1
        """
    n = db.execute(text(f"""
        SELECT COUNT(*)
          FROM public.lc_predio_p lp
          JOIN {tabla_alcance} ap ON ap.id_operacion = lp.id_operacion
         WHERE NOT EXISTS (
           SELECT 1 FROM validacion_calidad_log l
            WHERE l.job_id = :job_id
              AND l.numero_predial = lp.numero_predial
              AND l.numero_predial IS NOT NULL
              AND NOT EXISTS (
                SELECT 1 FROM validacion_calidad_excepcion x
                 WHERE x.job_id = l.job_id
                   AND x.numero_predial = l.numero_predial
                   AND (x.regla IS NULL OR x.regla = l.regla)
              )
         )
         {filtro_cal}
    """), {"job_id": job_id}).scalar() or 0
    return int(n)


def recalcular_metricas_job(db: Session, job_id: int) -> dict:
    """Recalcula `predios_validos` y `errores_total` SIN migrar a validado.*.

    Lo dispara cualquier acción que cambie el estado lógico (crear/borrar
    excepciones, marcar como excluido, etc.) sin tocar las tablas de
    `validado.*`. La migración real es separada y manual vía
    `migrar_a_validado_job` (botón "Migrar a validado").
    """
    job = repo.obtener_job(db, job_id)
    if job is None:
        raise ValueError(f"Job {job_id} no existe")
    if job["estado"] in ("pending", "running"):
        raise JobOcupado(f"Job {job_id} aún en estado '{job['estado']}'")

    db.execute(text("SELECT pg_advisory_xact_lock(:id)"), {"id": job_id})

    tabla_alcance, n_predios = crear_tabla_alcance(
        db, job_id, job["alcance_tipo"], list(job["alcance_valores"] or [])
    )
    try:
        n_validos = _contar_predios_elegibles(
            db, job_id, tabla_alcance,
            aplicar_filtro_calidad=bool(job.get("aplicar_filtro_calidad", True)),
        )

        n_errores_activos = db.execute(text("""
            SELECT COUNT(*) AS n FROM validacion_calidad_log l
             WHERE l.job_id = :id
               AND NOT EXISTS (
                 SELECT 1 FROM validacion_calidad_excepcion x
                  WHERE x.job_id = l.job_id
                    AND x.numero_predial = l.numero_predial
                    AND (x.regla IS NULL OR x.regla = l.regla)
               )
        """), {"id": job_id}).scalar() or 0

        repo.actualizar_totales(db, job_id, n_predios, n_validos, n_errores_activos)
        db.commit()
        return {
            "predios_total":   n_predios,
            "predios_validos": n_validos,
            "errores_total":   n_errores_activos,
        }
    finally:
        try: borrar_tabla_alcance(db, job_id)
        except Exception: pass


def recalcular_validez_job(db: Session, job_id: int) -> dict:
    """Tras crear/borrar una excepción, repromueve/degrada los predios del
    alcance en `validado.*` y actualiza las métricas del job.

    Atómica: una sola transacción. Idempotente: ejecutar dos veces seguidas
    produce el mismo resultado. Serializada por job vía advisory lock para
    proteger contra carreras de clicks simultáneos.
    """
    job = repo.obtener_job(db, job_id)
    if job is None:
        raise ValueError(f"Job {job_id} no existe")
    if job["estado"] in ("pending", "running"):
        raise JobOcupado(f"Job {job_id} aún en estado '{job['estado']}'")

    # Lock por sesión durante la transacción (se libera con commit/rollback).
    db.execute(text("SELECT pg_advisory_xact_lock(:id)"), {"id": job_id})

    asegurar_esquema_validado(db)
    tabla_alcance, n_predios = crear_tabla_alcance(
        db, job_id, job["alcance_tipo"], list(job["alcance_valores"] or [])
    )
    try:
        _limpiar_alcance_en_validado(db, job["alcance_tipo"], tabla_alcance)
        n_validos = _insertar_predios_validos(
            db, job_id, tabla_alcance,
            aplicar_filtro_calidad=bool(job.get("aplicar_filtro_calidad", True)),
        )
        _poblar_relacionadas(db)

        n_errores_activos = db.execute(text("""
            SELECT COUNT(*) AS n FROM validacion_calidad_log l
             WHERE l.job_id = :id
               AND NOT EXISTS (
                 SELECT 1 FROM validacion_calidad_excepcion x
                  WHERE x.job_id = l.job_id
                    AND x.numero_predial = l.numero_predial
                    AND (x.regla IS NULL OR x.regla = l.regla)
               )
        """), {"id": job_id}).scalar() or 0

        repo.actualizar_totales(db, job_id, n_predios, n_validos, n_errores_activos)
        # Marca explícitamente que el usuario disparó la migración. La UI
        # usa esto para ocultar el botón "Migrar a validado" tras el primer
        # click — para volver a migrar hay que crear un job nuevo.
        repo.marcar_migrado(db, job_id)
        db.commit()
        return {
            "predios_total":   n_predios,
            "predios_validos": n_validos,
            "errores_total":   n_errores_activos,
        }
    finally:
        try:
            borrar_tabla_alcance(db, job_id)
        except Exception:
            pass


# Alias semántico: lo que hace `recalcular_validez_job` ES migrar a validado
# (limpiar + insertar elegibles + poblar relacionadas + recalcular métricas).
# El endpoint /migrar-validado usa este nombre.
migrar_a_validado_job = recalcular_validez_job


# ── Conversión de errores activos a marcas ─────────────────────────────────

def crear_marcas_desde_errores(db: Session, job_id: int, numero_predial: str,
                               regla: Optional[str] = None,
                               usuario_id: Optional[int] = None) -> dict:
    """Convierte errores activos del predio en marcas (admin_marca_predio).
    Si regla es None, procesa todos los errores activos del predio.

    Por cada error:
      - sin_tipo: la regla no tiene tipo_marca_id  → skip
      - duplicada: ya existe marca abierta del mismo (id_operacion, tipo_marca_id)
                   → vincula al log y skip
      - creada: inserta nueva marca + evento CREACION + vincula log

    Devuelve {creadas, duplicadas, sin_tipo, errores, items[]}.

    NOTA: marca_predio_repo.crear hace su propio commit; el vínculo en el log
    se hace en una segunda transacción. Si esa segunda transacción falla, la
    marca igual queda creada — el siguiente intento la detectará como duplicada
    y vinculará el log a la marca existente. Auto-recoverable.
    """
    job = repo.obtener_job(db, job_id)
    if job is None:
        raise ValueError(f"Job {job_id} no existe")
    if job["estado"] in ("pending", "running"):
        raise JobOcupado(f"Job {job_id} aún en estado '{job['estado']}'")

    op_row = db.execute(text(
        "SELECT id_operacion FROM lc_predio_p WHERE numero_predial = :np LIMIT 1"
    ), {"np": numero_predial}).fetchone()
    if not op_row:
        raise ValueError(f"Predio {numero_predial} no existe en lc_predio_p")
    id_operacion = op_row.id_operacion

    sql_errores = """
      SELECT l.id, l.regla, l.descripcion,
             r.tipo_marca_id, t.categoria
        FROM validacion_calidad_log l
        LEFT JOIN validacion_calidad_regla r ON r.codigo = l.regla
        LEFT JOIN admin_tipo_marca t         ON t.id     = r.tipo_marca_id
       WHERE l.job_id = :job_id
         AND l.numero_predial = :np
         AND l.marca_id IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM validacion_calidad_excepcion x
            WHERE x.job_id = l.job_id
              AND x.numero_predial = l.numero_predial
              AND (x.regla IS NULL OR x.regla = l.regla)
         )
    """
    params: dict = {"job_id": job_id, "np": numero_predial}
    if regla:
        sql_errores += " AND l.regla = :regla"
        params["regla"] = regla

    errores = db.execute(text(sql_errores), params).fetchall()

    items: list[dict] = []
    creadas = duplicadas = sin_tipo = errores_count = 0

    for err in errores:
        if not err.tipo_marca_id:
            sin_tipo += 1
            items.append({
                "log_id": err.id, "regla": err.regla, "estado": "sin_tipo",
                "marca_id": None,
                "motivo": "La regla no tiene tipo de marca asociado",
            })
            continue

        existente = repo.existe_marca_abierta(db, id_operacion, err.tipo_marca_id)
        if existente:
            duplicadas += 1
            try:
                repo.vincular_marca_a_log(db, err.id, existente)
            except Exception as exc:
                logger.warning(
                    f"[crear_marcas_desde_errores] no se pudo vincular log "
                    f"{err.id} a marca existente {existente}: {exc}"
                )
            items.append({
                "log_id": err.id, "regla": err.regla, "estado": "duplicada",
                "marca_id": existente,
                "motivo": f"Ya existe marca abierta #{existente} del mismo tipo",
            })
            continue

        try:
            data = {
                "tipo_marca_id":       err.tipo_marca_id,
                "categoria":           err.categoria,
                "descripcion_novedad": (err.descripcion or "")[:1000] or "(sin descripción)",
                "fuente_deteccion":    f"Validación de calidad job #{job_id} regla {err.regla}",
                "prioridad":           "MEDIA",
                "accion_sugerida":     None,
                "responsable_id":      None,
                "estado_esperado":     "AJUSTE",
                "observacion":         None,
            }
            marca_id = marca_predio_repo.crear(db, id_operacion, data, usuario_id)
            try:
                repo.vincular_marca_a_log(db, err.id, marca_id)
            except Exception as exc:
                logger.warning(
                    f"[crear_marcas_desde_errores] marca {marca_id} creada pero "
                    f"no se pudo vincular log {err.id}: {exc}"
                )
            creadas += 1
            items.append({
                "log_id": err.id, "regla": err.regla, "estado": "creada",
                "marca_id": marca_id, "motivo": None,
            })
        except Exception as exc:
            try:
                db.rollback()
            except Exception:
                pass
            logger.exception(
                f"[crear_marcas_desde_errores] error creando marca para log {err.id}"
            )
            errores_count += 1
            items.append({
                "log_id": err.id, "regla": err.regla, "estado": "error",
                "marca_id": None, "motivo": str(exc)[:500],
            })

    return {
        "creadas":    creadas,
        "duplicadas": duplicadas,
        "sin_tipo":   sin_tipo,
        "errores":    errores_count,
        "items":      items,
    }


# ── Acciones masivas a nivel job ────────────────────────────────────────────

def crear_marcas_masivo_job(db: Session, job_id: int,
                            usuario_id: Optional[int]) -> dict:
    """Aplica `crear_marcas_desde_errores` a TODOS los predios del job que
    aún tengan errores activos no convertidos. Devuelve el agregado."""
    job = repo.obtener_job(db, job_id)
    if job is None:
        raise ValueError(f"Job {job_id} no existe")
    if job["estado"] in ("pending", "running"):
        raise JobOcupado(f"Job {job_id} aún en estado '{job['estado']}'")

    rows = db.execute(text("""
        SELECT DISTINCT l.numero_predial
          FROM validacion_calidad_log l
         WHERE l.job_id = :id
           AND l.numero_predial IS NOT NULL
           AND l.marca_id IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM validacion_calidad_excepcion x
              WHERE x.job_id = l.job_id
                AND x.numero_predial = l.numero_predial
                AND (x.regla IS NULL OR x.regla = l.regla)
           )
         ORDER BY l.numero_predial
    """), {"id": job_id}).fetchall()
    predios = [r.numero_predial for r in rows]

    creadas = duplicadas = sin_tipo = errores_count = 0
    predios_procesados = 0
    for np in predios:
        try:
            res = crear_marcas_desde_errores(
                db, job_id, np, regla=None, usuario_id=usuario_id,
            )
            creadas    += res.get("creadas", 0)
            duplicadas += res.get("duplicadas", 0)
            sin_tipo   += res.get("sin_tipo", 0)
            errores_count += res.get("errores", 0)
            predios_procesados += 1
        except Exception as exc:
            logger.exception(
                f"[crear_marcas_masivo_job {job_id}] falló para {np}: {exc}"
            )
            errores_count += 1

    return {
        "predios_procesados": predios_procesados,
        "creadas":            creadas,
        "duplicadas":         duplicadas,
        "sin_tipo":           sin_tipo,
        "errores":            errores_count,
    }


def excluir_todos_los_errores_job(db: Session, job_id: int,
                                  motivo: Optional[str], usuario: str) -> dict:
    """Crea exclusiones wildcard (regla=NULL) para TODOS los predios del job
    que tengan errores activos. Recalcula validez una sola vez al final.

    Lógica intencional: un predio que ya tenía errores parcialmente excluidos
    se "completa" con la wildcard. Idempotente vía ON CONFLICT del repo.
    """
    job = repo.obtener_job(db, job_id)
    if job is None:
        raise ValueError(f"Job {job_id} no existe")
    if job["estado"] in ("pending", "running"):
        raise JobOcupado(f"Job {job_id} aún en estado '{job['estado']}'")

    rows = db.execute(text("""
        SELECT DISTINCT l.numero_predial
          FROM validacion_calidad_log l
         WHERE l.job_id = :id
           AND l.numero_predial IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM validacion_calidad_excepcion x
              WHERE x.job_id = l.job_id
                AND x.numero_predial = l.numero_predial
                AND x.regla IS NULL
           )
         ORDER BY l.numero_predial
    """), {"id": job_id}).fetchall()
    predios = [r.numero_predial for r in rows]

    creadas = 0
    for np in predios:
        try:
            repo.crear_excepcion(db, job_id, np, regla=None, motivo=motivo, usuario=usuario)
            creadas += 1
        except Exception as exc:
            logger.warning(
                f"[excluir_todos_los_errores_job {job_id}] falló para {np}: {exc}"
            )

    # Recalcular SOLO métricas (no migrar a validado.*) — la migración es
    # explícita ahora vía endpoint /migrar-validado.
    metricas = recalcular_metricas_job(db, job_id)
    return {
        "predios_excluidos": creadas,
        "metricas":          metricas,
    }


# ── Preview de calidad antes de crear job ──────────────────────────────────

_COLS_CALIDAD = [
    ("calidad_campo",          "campo"),
    ("calidad_sig",            "SIG"),
    ("calidad_fisica",         "física"),
    ("calidad_juridica",       "jurídica"),
    ("calidad_economica",      "económica"),
    ("calidad_identificacion", "identificación"),
]

_FILTRO_CALIDAD_OK = (
    "calidad_campo = 1 AND calidad_sig = 1 AND calidad_fisica = 1 "
    "AND calidad_juridica = 1 AND calidad_economica = 1 "
    "AND calidad_identificacion = 1"
)


def preview_calidad_alcance(db: Session, alcance_tipo: str,
                            alcance_valores: list[str]) -> dict:
    """Preview del alcance antes de crear el job. Devuelve:
      - total_alcance: cuántos predios reales hay en BD para el alcance dado.
      - solicitados / valores_no_encontrados: para alcance='predios', cuáles
        identificadores que pegó el usuario NO matchean ningún predio.
      - sin_calidad / items / overflow: predios que NO pasan el gate calidad_*=1.
    No materializa tablas — query directa sobre lc_predio_p."""
    if alcance_tipo == "todo":
        where = "TRUE"
        params: dict = {}
    elif alcance_tipo == "predios":
        where = "(numero_predial = ANY(:vals) OR id_operacion = ANY(:vals))"
        params = {"vals": alcance_valores}
    elif alcance_tipo == "manzanas":
        where = "LEFT(numero_predial, 17) = ANY(:vals)"
        params = {"vals": alcance_valores}
    else:
        raise ValueError(f"alcance_tipo inválido: {alcance_tipo}")

    total_alcance = db.execute(
        text(f"SELECT COUNT(*) FROM lc_predio_p WHERE {where}"), params
    ).scalar() or 0

    # Identificadores que el usuario pegó pero no existen en BD.
    # Solo aplicable a 'predios' (en 'manzanas' un código puede agrupar 0
    # predios sin que sea un identificador "no encontrado", y en 'todo' no hay
    # lista del usuario).
    solicitados: Optional[int] = None
    valores_no_encontrados: list[str] = []
    if alcance_tipo == "predios":
        solicitados = len(alcance_valores)
        if alcance_valores:
            rows = db.execute(text("""
                SELECT v.val
                  FROM unnest(CAST(:vals AS text[])) AS v(val)
                 WHERE NOT EXISTS (
                   SELECT 1 FROM lc_predio_p
                    WHERE numero_predial = v.val OR id_operacion = v.val
                 )
            """), {"vals": alcance_valores}).fetchall()
            valores_no_encontrados = [r.val for r in rows]

    sin_calidad = db.execute(text(f"""
        SELECT COUNT(*) FROM lc_predio_p
         WHERE {where} AND NOT ({_FILTRO_CALIDAD_OK})
    """), params).scalar() or 0

    rows = db.execute(text(f"""
        SELECT numero_predial, id_operacion,
               calidad_campo, calidad_sig, calidad_fisica,
               calidad_juridica, calidad_economica, calidad_identificacion
          FROM lc_predio_p
         WHERE {where} AND NOT ({_FILTRO_CALIDAD_OK})
         ORDER BY numero_predial
         LIMIT 100
    """), params).fetchall()

    items: list[dict] = []
    for r in rows:
        pendientes = [label for col, label in _COLS_CALIDAD
                      if (getattr(r, col) or 0) != 1]
        items.append({
            "numero_predial":      r.numero_predial,
            "id_operacion":        r.id_operacion,
            "columnas_pendientes": pendientes,
        })

    return {
        "total_alcance":          int(total_alcance),
        "solicitados":            solicitados,
        "valores_no_encontrados": valores_no_encontrados,
        "sin_calidad":            int(sin_calidad),
        "items":                  items,
        "overflow":               sin_calidad > len(items),
    }
