from typing import Optional, List
from sqlalchemy.orm import Session
from sqlalchemy import text


# ── Reglas ──────────────────────────────────────────────────────────────────

def listar_reglas(db: Session, solo_activas: bool = False) -> list[dict]:
    where = "WHERE r.activa = TRUE" if solo_activas else ""
    sql = f"""
        SELECT r.id, r.codigo, r.nombre, r.entidad, r.activa, r.orden,
               r.tipo_marca_id, tm.codigo AS tipo_marca_codigo, tm.categoria AS tipo_marca_categoria
        FROM validacion_calidad_regla r
        LEFT JOIN admin_tipo_marca tm ON tm.id = r.tipo_marca_id
        {where}
        ORDER BY r.orden ASC, r.id ASC
    """
    return [dict(r._mapping) for r in db.execute(text(sql)).fetchall()]


def obtener_regla(db: Session, regla_id: int) -> Optional[dict]:
    row = db.execute(text("""
        SELECT r.id, r.codigo, r.nombre, r.descripcion, r.entidad, r.sql_template,
               r.activa, r.orden,
               r.tipo_marca_id, tm.codigo AS tipo_marca_codigo, tm.categoria AS tipo_marca_categoria,
               r.creado_en, r.creado_por, r.actualizado_en, r.actualizado_por
        FROM validacion_calidad_regla r
        LEFT JOIN admin_tipo_marca tm ON tm.id = r.tipo_marca_id
        WHERE r.id = :id
    """), {"id": regla_id}).fetchone()
    return dict(row._mapping) if row else None


def obtener_reglas_para_ejecutar(db: Session, omitidas: List[int]) -> list[dict]:
    """Reglas activas no omitidas, en orden."""
    sql = """
        SELECT id, codigo, nombre, entidad, sql_template, tipo_marca_id
        FROM validacion_calidad_regla
        WHERE activa = TRUE
          AND NOT (id = ANY(:omitidas))
        ORDER BY orden ASC, id ASC
    """
    return [dict(r._mapping) for r in db.execute(text(sql), {"omitidas": omitidas or []}).fetchall()]


def crear_regla(db: Session, data: dict, usuario: str) -> int:
    row = db.execute(text("""
        INSERT INTO validacion_calidad_regla
          (codigo, nombre, descripcion, entidad, sql_template, activa, orden,
           tipo_marca_id, creado_por, actualizado_por)
        VALUES
          (:codigo, :nombre, :descripcion, :entidad, :sql_template, :activa, :orden,
           :tipo_marca_id, :usuario, :usuario)
        RETURNING id
    """), {**data, "usuario": usuario}).fetchone()
    db.commit()
    return row.id


def actualizar_regla(db: Session, regla_id: int, data: dict, usuario: str) -> bool:
    sets, params = [], {"id": regla_id, "usuario": usuario}
    for k, v in data.items():
        if v is not None:
            sets.append(f"{k} = :{k}")
            params[k] = v
    if not sets:
        return True
    sets.append("actualizado_por = :usuario")
    sets.append("actualizado_en = NOW()")
    sql = f"UPDATE validacion_calidad_regla SET {', '.join(sets)} WHERE id = :id"
    res = db.execute(text(sql), params)
    db.commit()
    return res.rowcount > 0


def borrar_regla(db: Session, regla_id: int) -> bool:
    res = db.execute(text("DELETE FROM validacion_calidad_regla WHERE id = :id"), {"id": regla_id})
    db.commit()
    return res.rowcount > 0


def existe_codigo(db: Session, codigo: str, excluir_id: Optional[int] = None) -> bool:
    sql = "SELECT 1 FROM validacion_calidad_regla WHERE codigo = :c"
    params = {"c": codigo}
    if excluir_id is not None:
        sql += " AND id <> :id"
        params["id"] = excluir_id
    return db.execute(text(sql), params).fetchone() is not None


# ── Jobs ────────────────────────────────────────────────────────────────────

def crear_job(db: Session, alcance_tipo: str, alcance_valores: list[str],
              reglas_omitidas: list[int], usuario: str,
              aplicar_filtro_calidad: bool = True) -> int:
    row = db.execute(text("""
        INSERT INTO validacion_calidad_job
          (estado, alcance_tipo, alcance_valores, reglas_omitidas,
           aplicar_filtro_calidad, creado_por)
        VALUES
          ('pending', :alcance_tipo, :alcance_valores, :reglas_omitidas,
           :aplicar_filtro_calidad, :usuario)
        RETURNING id
    """), {
        "alcance_tipo":           alcance_tipo,
        "alcance_valores":        alcance_valores,
        "reglas_omitidas":        reglas_omitidas,
        "aplicar_filtro_calidad": aplicar_filtro_calidad,
        "usuario":                usuario,
    }).fetchone()
    db.commit()
    return row.id


def obtener_job(db: Session, job_id: int) -> Optional[dict]:
    row = db.execute(text("""
        SELECT id, estado, alcance_tipo, alcance_valores, reglas_omitidas, progreso,
               predios_total, predios_validos, errores_total,
               iniciado_en, finalizado_en, error_message, cancelar_solicitado, creado_por,
               aplicar_filtro_calidad, regla_actual, oculto, migrado_en
        FROM validacion_calidad_job WHERE id = :id
    """), {"id": job_id}).fetchone()
    return dict(row._mapping) if row else None


def listar_jobs(db: Session, limit: int = 50, offset: int = 0,
                incluir_ocultos: bool = False) -> list[dict]:
    where = "" if incluir_ocultos else "WHERE oculto = FALSE"
    sql = f"""
        SELECT id, estado, alcance_tipo, alcance_valores, progreso,
               predios_total, predios_validos, errores_total,
               iniciado_en, finalizado_en, creado_por, aplicar_filtro_calidad,
               regla_actual, oculto, migrado_en
        FROM validacion_calidad_job
        {where}
        ORDER BY iniciado_en DESC
        LIMIT :limit OFFSET :offset
    """
    return [dict(r._mapping) for r in db.execute(
        text(sql), {"limit": limit, "offset": offset}
    ).fetchall()]


def marcar_migrado(db: Session, job_id: int) -> None:
    """Setea migrado_en=NOW() — registra que el usuario disparó la migración
    a validado.*. Se llama desde `migrar_a_validado_job` al final."""
    db.execute(text(
        "UPDATE validacion_calidad_job SET migrado_en = NOW() WHERE id = :id"
    ), {"id": job_id})
    db.commit()


def actualizar_visibilidad(db: Session, job_id: int, oculto: bool) -> bool:
    """Marca el job como oculto/visible. Idempotente; devuelve si afectó fila."""
    res = db.execute(text(
        "UPDATE validacion_calidad_job SET oculto = :o WHERE id = :id"
    ), {"o": oculto, "id": job_id})
    db.commit()
    return (res.rowcount or 0) > 0


def actualizar_regla_actual(db: Session, job_id: int, texto: Optional[str]) -> None:
    """Indica al UI qué regla está corriendo. Pasar None para limpiar (job
    terminado o entre fases sin regla activa)."""
    db.execute(text(
        "UPDATE validacion_calidad_job SET regla_actual = :t WHERE id = :id"
    ), {"t": texto, "id": job_id})
    db.commit()


def actualizar_worker_pid(db: Session, job_id: int, pid: Optional[int]) -> None:
    """Registra/limpia el PID del backend PG del worker. Permite que
    `cancelar_job` mate la query activa con pg_cancel_backend."""
    db.execute(text(
        "UPDATE validacion_calidad_job SET worker_pid = :p WHERE id = :id"
    ), {"p": pid, "id": job_id})
    db.commit()


def obtener_worker_pid(db: Session, job_id: int) -> Optional[int]:
    row = db.execute(text(
        "SELECT worker_pid FROM validacion_calidad_job WHERE id = :id"
    ), {"id": job_id}).fetchone()
    return row.worker_pid if row else None


def actualizar_estado_job(db: Session, job_id: int, estado: str,
                          error_message: Optional[str] = None,
                          marcar_finalizado: bool = False) -> None:
    sets = ["estado = :estado"]
    params: dict = {"id": job_id, "estado": estado}
    if error_message is not None:
        sets.append("error_message = :err")
        params["err"] = error_message
    if marcar_finalizado:
        sets.append("finalizado_en = NOW()")
    db.execute(text(f"UPDATE validacion_calidad_job SET {', '.join(sets)} WHERE id = :id"), params)
    db.commit()


def actualizar_progreso(db: Session, job_id: int, progreso: int) -> None:
    db.execute(
        text("UPDATE validacion_calidad_job SET progreso = :p WHERE id = :id"),
        {"p": max(0, min(100, int(progreso))), "id": job_id},
    )
    db.commit()


def actualizar_totales(db: Session, job_id: int, predios_total: int,
                       predios_validos: int, errores_total: int) -> None:
    db.execute(text("""
        UPDATE validacion_calidad_job
        SET predios_total = :pt, predios_validos = :pv, errores_total = :et
        WHERE id = :id
    """), {"pt": predios_total, "pv": predios_validos, "et": errores_total, "id": job_id})
    db.commit()


def solicitar_cancelacion(db: Session, job_id: int) -> bool:
    res = db.execute(text("""
        UPDATE validacion_calidad_job SET cancelar_solicitado = TRUE
        WHERE id = :id AND estado IN ('pending','running')
    """), {"id": job_id})
    db.commit()
    return res.rowcount > 0


def cancelacion_solicitada(db: Session, job_id: int) -> bool:
    row = db.execute(
        text("SELECT cancelar_solicitado FROM validacion_calidad_job WHERE id = :id"),
        {"id": job_id},
    ).fetchone()
    return bool(row and row.cancelar_solicitado)


def forzar_cancelacion(db: Session, job_id: int, motivo: str) -> bool:
    """Marca el job como `cancelled` + finaliza + limpia regla_actual/worker_pid.
    Idempotente: si el job ya está en estado terminal, no hace nada (rowcount=0).

    Útil cuando el worker está muerto o no responde y necesitamos cerrar el
    job desde el endpoint de cancelar para que el UI se actualice de inmediato.
    """
    res = db.execute(text("""
        UPDATE validacion_calidad_job
           SET estado              = 'cancelled',
               error_message       = COALESCE(error_message, '') || :motivo,
               finalizado_en       = COALESCE(finalizado_en, NOW()),
               regla_actual        = NULL,
               worker_pid          = NULL,
               cancelar_solicitado = TRUE
         WHERE id = :id AND estado IN ('pending','running')
    """), {"id": job_id, "motivo": motivo})
    db.commit()
    return (res.rowcount or 0) > 0


# ── Errores ─────────────────────────────────────────────────────────────────

def listar_errores(db: Session, job_id: int, limit: int = 100, offset: int = 0) -> tuple[int, list[dict]]:
    total = db.execute(
        text("SELECT COUNT(*) AS n FROM validacion_calidad_log WHERE job_id = :id"),
        {"id": job_id},
    ).fetchone().n
    rows = db.execute(text("""
        SELECT id, numero_predial, regla, descripcion, fecha_registro
        FROM validacion_calidad_log
        WHERE job_id = :id
        ORDER BY id ASC
        LIMIT :limit OFFSET :offset
    """), {"id": job_id, "limit": limit, "offset": offset}).fetchall()
    return total, [dict(r._mapping) for r in rows]


def iter_errores_para_reporte(db: Session, job_id: int):
    """Generador para streaming del CSV/log. Incluye flag excluido y motivo
    para que el reporte sea auditable (qué se justificó y por qué)."""
    return db.execute(text("""
        SELECT l.id, l.numero_predial, l.regla, l.descripcion, l.fecha_registro,
               EXISTS (
                 SELECT 1 FROM validacion_calidad_excepcion x
                  WHERE x.job_id = l.job_id
                    AND x.numero_predial = l.numero_predial
                    AND (x.regla IS NULL OR x.regla = l.regla)
               ) AS excluido,
               (
                 SELECT x.motivo FROM validacion_calidad_excepcion x
                  WHERE x.job_id = l.job_id
                    AND x.numero_predial = l.numero_predial
                    AND (x.regla IS NULL OR x.regla = l.regla)
                  ORDER BY (x.regla IS NULL) ASC, x.id DESC
                  LIMIT 1
               ) AS motivo_exclusion
        FROM validacion_calidad_log l
        WHERE l.job_id = :id
        ORDER BY l.id ASC
    """), {"id": job_id})


# ── Errores agrupados por predio ────────────────────────────────────────────

def listar_errores_agrupados(db: Session, job_id: int,
                             limit: int = 50, offset: int = 0) -> list[dict]:
    """Una fila por predio con sus errores y flags por error: excluido,
    marca_id (si ya se convirtió en marca), tiene_tipo_marca (si la regla
    declara tipo_marca_id). Ordenado por errores_activos desc."""
    rows = db.execute(text("""
        WITH errores AS (
          SELECT l.id, l.numero_predial, l.regla, l.descripcion, l.fecha_registro,
                 l.marca_id,
                 (r.tipo_marca_id IS NOT NULL) AS tiene_tipo_marca,
                 EXISTS (
                   SELECT 1 FROM validacion_calidad_excepcion x
                    WHERE x.job_id = l.job_id
                      AND x.numero_predial = l.numero_predial
                      AND (x.regla IS NULL OR x.regla = l.regla)
                 ) AS excluido
            FROM validacion_calidad_log l
            LEFT JOIN validacion_calidad_regla r ON r.codigo = l.regla
           WHERE l.job_id = :job_id AND l.numero_predial IS NOT NULL
        )
        SELECT e.numero_predial,
               (
                 SELECT lp.id_operacion FROM lc_predio_p lp
                  WHERE lp.numero_predial = e.numero_predial
                  LIMIT 1
               )                                       AS id_operacion,
               COUNT(*)                                AS errores_total,
               COUNT(*) FILTER (WHERE NOT e.excluido)  AS errores_activos,
               EXISTS (
                 SELECT 1 FROM validacion_calidad_excepcion x
                  WHERE x.job_id = :job_id
                    AND x.numero_predial = e.numero_predial
                    AND x.regla IS NULL
               )                                       AS predio_excluido_total,
               json_agg(json_build_object(
                 'id', e.id, 'regla', e.regla, 'descripcion', e.descripcion,
                 'fecha_registro', e.fecha_registro, 'excluido', e.excluido,
                 'marca_id', e.marca_id, 'tiene_tipo_marca', e.tiene_tipo_marca
               ) ORDER BY e.regla, e.id)               AS errores
          FROM errores e
         GROUP BY e.numero_predial
         ORDER BY (COUNT(*) FILTER (WHERE NOT e.excluido)) DESC, e.numero_predial
         LIMIT :limit OFFSET :offset
    """), {"job_id": job_id, "limit": limit, "offset": offset}).fetchall()
    return [dict(r._mapping) for r in rows]


def contar_predios_con_errores(db: Session, job_id: int) -> int:
    return db.execute(text(
        "SELECT COUNT(DISTINCT numero_predial) AS n FROM validacion_calidad_log "
        "WHERE job_id = :id AND numero_predial IS NOT NULL"
    ), {"id": job_id}).scalar() or 0


def listar_errores_sin_predial(db: Session, job_id: int) -> list[dict]:
    """Errores sintéticos sin numero_predial (fallos de ejecución de regla).
    No son agrupables ni excluibles."""
    rows = db.execute(text("""
        SELECT id, numero_predial, regla, descripcion, fecha_registro
        FROM validacion_calidad_log
        WHERE job_id = :id AND numero_predial IS NULL
        ORDER BY id ASC
    """), {"id": job_id}).fetchall()
    return [dict(r._mapping) for r in rows]


def predio_tiene_errores(db: Session, job_id: int, numero_predial: str) -> bool:
    return db.execute(text(
        "SELECT 1 FROM validacion_calidad_log "
        "WHERE job_id = :id AND numero_predial = :np LIMIT 1"
    ), {"id": job_id, "np": numero_predial}).fetchone() is not None


# ── Excepciones ─────────────────────────────────────────────────────────────

def crear_excepcion(db: Session, job_id: int, numero_predial: str,
                    regla: Optional[str], motivo: Optional[str],
                    usuario: str) -> dict:
    """INSERT idempotente. Si ya existe la misma combinación (job, predio, regla),
    actualiza motivo/creado_por/creado_en."""
    row = db.execute(text("""
        INSERT INTO validacion_calidad_excepcion
          (job_id, numero_predial, regla, motivo, creado_por)
        VALUES (:job_id, :np, :regla, :motivo, :usuario)
        ON CONFLICT (job_id, numero_predial, regla) DO UPDATE
          SET motivo = EXCLUDED.motivo,
              creado_por = EXCLUDED.creado_por,
              creado_en = NOW()
        RETURNING id, job_id, numero_predial, regla, motivo, creado_en, creado_por
    """), {
        "job_id": job_id, "np": numero_predial, "regla": regla,
        "motivo": motivo, "usuario": usuario,
    }).fetchone()
    db.commit()
    return dict(row._mapping)


def borrar_excepcion(db: Session, job_id: int, numero_predial: str,
                     regla: Optional[str]) -> bool:
    res = db.execute(text("""
        DELETE FROM validacion_calidad_excepcion
        WHERE job_id = :id
          AND numero_predial = :np
          AND regla IS NOT DISTINCT FROM :regla
    """), {"id": job_id, "np": numero_predial, "regla": regla})
    db.commit()
    return (res.rowcount or 0) > 0


def listar_excepciones(db: Session, job_id: int) -> list[dict]:
    rows = db.execute(text("""
        SELECT id, job_id, numero_predial, regla, motivo, creado_en, creado_por
        FROM validacion_calidad_excepcion
        WHERE job_id = :id
        ORDER BY creado_en DESC, id DESC
    """), {"id": job_id}).fetchall()
    return [dict(r._mapping) for r in rows]


# ── Conversión error → marca ────────────────────────────────────────────────

def vincular_marca_a_log(db: Session, log_id: int, marca_id: int) -> None:
    """Anota en el log que el error ya fue convertido a marca. Hace su propio commit."""
    db.execute(text(
        "UPDATE validacion_calidad_log SET marca_id = :m WHERE id = :id"
    ), {"m": marca_id, "id": log_id})
    db.commit()


def existe_marca_abierta(db: Session, id_operacion: str, tipo_marca_id: int) -> Optional[int]:
    """Si ya existe una marca ABIERTA del mismo (id_operacion, tipo_marca_id),
    devuelve su id. Si no, None."""
    row = db.execute(text("""
        SELECT id FROM admin_marca_predio
         WHERE id_operacion = :op AND tipo_marca_id = :t AND estado = 'ABIERTA'
         ORDER BY fecha_creacion DESC
         LIMIT 1
    """), {"op": id_operacion, "t": tipo_marca_id}).fetchone()
    return row.id if row else None
