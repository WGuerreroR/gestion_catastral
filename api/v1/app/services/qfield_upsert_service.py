"""
app/services/qfield_upsert_service.py

Aplica el contenido del GPKG editado en QField sobre PostGIS usando
diff por PK de negocio (Estrategia B). Es la única ruta confiable para
paquetes que vienen de QField (mobile o Cloud), porque QField NO usa
QgsOfflineEditing — sus tablas log_* están vacías incluso cuando hubo
ediciones reales.

Para cada row del GPKG con PK conocida:
  - Si no existe en PostGIS → INSERT (caso "creado en campo")
  - Si existe pero difiere → UPDATE
  - Si existe y es igual → skip
NO hay DELETE — el GPKG puede haber sido recortado por bbox al exportar,
así que no podemos distinguir "borrado en campo" de "fuera del scope".

Iter 3 habilita solo `lc_predio_p`. Iter 4 generaliza al resto de capas
editables.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass, field
from datetime import datetime, date, timezone, timedelta
from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session


# PostGIS guarda timestamps "without time zone" en hora local del proyecto.
# Para Chiquinquirá la BD está en hora Bogotá (UTC-5). Cuando comparamos
# contra timestamps con tz del GPKG (que vienen como "...Z" en UTC), hay
# que aplicar este offset antes de comparar.
_TZ_LOCAL = timezone(timedelta(hours=-5))


# ── Configuración por capa ───────────────────────────────────────────────────

# Campos de auditoría/metadata que NUNCA se comparan ni copian. La razón es
# que su tz handling no es uniforme entre PostGIS y GPKG (a veces el naive
# está en UTC, a veces en local Bogotá), generando falsos positivos.
# Tampoco son ediciones del usuario en campo: se autogeneran.
CAMPOS_AUDIT_GLOBAL: set[str] = {
    "created_date",
    "last_edited_date",
    "comienzo_vida_util_version",
    "fin_vida_util_version",
}


CAPAS_EDITABLES: dict[str, dict[str, Any]] = {
    "lc_predio_p": {
        "pk_negocio":        "id_operacion",
        "geom_col_pg":       "geometry",     # nombre en PostGIS
        "geom_srid":         9377,
        # Campos del GPKG que NO se copian directamente:
        #   fid    → rowid local del GPKG, no existe en PG
        #   geom   → la geometría se trata aparte (parseo + ST_GeomFromWKB)
        #   pk     → columna basura del schema (TEXT, no es PK), evitar
        "campos_excluidos":  {"fid", "geom", "pk"},
        # Campos que el sync NUNCA puede modificar (PK estable de negocio).
        "campos_inmutables": {"id_operacion"},
        # Campos que guardan rutas de archivos foto (relativas, ej. "DCIM/...")
        "campos_foto":       ["foto", "foto_2"],
    },
    "cr_terreno": {
        "pk_negocio":        "globalid",
        "geom_col_pg":       "geometry",
        "geom_srid":         9377,
        "campos_excluidos":  {"fid", "geom"},
        "campos_inmutables": {"globalid", "id_operacion_predio"},
        "campos_foto":       [],
    },
    "cr_unidadconstruccion": {
        "pk_negocio":        "id_operacion_uc_geo",
        "geom_col_pg":       "geometry",
        "geom_srid":         9377,
        "campos_excluidos":  {"fid", "geom", "id"},  # id es serial PG
        "campos_inmutables": {"id_operacion_uc_geo"},
        "campos_foto":       [],
    },
    "cr_caracteristicasunidadconstruccion": {
        "pk_negocio":        "id_operacion_unidad_cons",
        "geom_col_pg":       None,           # tabla sin geometría
        "geom_srid":         None,
        "campos_excluidos":  {"fid"},
        "campos_inmutables": {"id_operacion_unidad_cons"},
        "campos_foto":       [
            "foto_fachada", "foto_banio", "foto_cocina",
            "foto_acabados", "foto_anexo", "foto_industrial",
        ],
    },
    "cr_interesado": {
        "pk_negocio":        "globalid",
        "geom_col_pg":       None,
        "geom_srid":         None,
        "campos_excluidos":  {"fid"},
        "campos_inmutables": {"globalid", "id_operacion_derecho"},
        "campos_foto":       [],
    },
    "lc_derecho": {
        "pk_negocio":        "id_operacion_derecho",
        "geom_col_pg":       None,
        "geom_srid":         None,
        "campos_excluidos":  {"fid"},
        # FK al predio + PK estable
        "campos_inmutables": {"id_operacion_derecho", "id_operacion_predio"},
        "campos_foto":       [],
    },
}

CAPAS_HABILITADAS_APLICAR: set[str] = {
    "lc_predio_p",
    "cr_terreno",
    "cr_unidadconstruccion",
    "cr_caracteristicasunidadconstruccion",
    "cr_interesado",
    "lc_derecho",
}

# Orden de aplicación respetando dependencias FK del schema PostGIS:
#   - lc_predio_p es la raíz (nadie depende de algo previo).
#   - cr_terreno, cr_caracteristicasunidadconstruccion, lc_derecho dependen
#     de lc_predio_p (FK id_operacion_predio).
#   - cr_unidadconstruccion depende de cr_caracteristicasunidadconstruccion
#     (FK id_operacion_unidad_const).
#   - cr_interesado depende de lc_derecho (FK id_operacion_derecho) y de
#     lc_predio_p — por eso va último.
#
# Si un INSERT de cr_interesado llega antes que su lc_derecho hermano,
# PostgreSQL rechaza por FK violation. Este orden previene ese caso.
ORDEN_APLICACION: list[str] = [
    "lc_predio_p",
    "cr_terreno",
    "cr_caracteristicasunidadconstruccion",
    "cr_unidadconstruccion",
    "lc_derecho",
    "cr_interesado",
]


# ── Estructuras de retorno ──────────────────────────────────────────────────

@dataclass
class ResumenComparacion:
    """Read-only: resultado de comparar el GPKG contra PostGIS."""
    capa: str
    added: list[str] = field(default_factory=list)      # PKs presentes en GPKG, no en PG
    updated: list[str] = field(default_factory=list)    # PKs que difieren
    unchanged: int = 0                                  # iguales en ambos
    errors: list[str] = field(default_factory=list)     # mensajes


@dataclass
class ResumenCapa:
    """Write: resultado de aplicar los cambios a PostGIS."""
    capa: str
    added: int = 0
    updated: int = 0
    deleted: int = 0          # siempre 0 en estrategia diff_por_pk
    errors: int = 0
    # Listas de PKs efectivamente aplicadas, para que el sync_service pueda
    # mapear a id_operacion y marcar lc_predio_p.ultima_sync_offline.
    added_pks:   list[str] = field(default_factory=list)
    updated_pks: list[str] = field(default_factory=list)
    advertencias: list[str] = field(default_factory=list)
    errores_detalle: list[str] = field(default_factory=list)


# ── Normalización de valores para comparación robusta GPKG ↔ PG ─────────────

def _normalizar(v: Any) -> Any:
    """
    Normaliza valores antes de comparar GPKG vs PostGIS para evitar falsos
    positivos por:
      - timestamps con encoding distinto (str ISO vs datetime)
      - timezone awareness inconsistente (GPKG usa UTC con Z, PG naive en
        hora local)
      - "" vs None (SQLite a veces serializa NULL como cadena vacía)
    """
    if v is None or v == "":
        return None
    if isinstance(v, bytes):
        return bytes(v)  # asegurar bytes plano (no memoryview)
    if isinstance(v, str):
        # ¿Parece timestamp/fecha ISO? '2025-07-24T05:00:00Z' / '2025-07-24'
        if len(v) >= 10 and v[4] == "-" and v[7] == "-":
            try:
                if "T" in v or " " in v:
                    norm = v.replace("Z", "+00:00").replace(" ", "T", 1)
                    dt = datetime.fromisoformat(norm)
                    # Sin tz → asumir UTC local del GPKG (raro, pero cubrir)
                    if dt.tzinfo is None:
                        dt = dt.replace(tzinfo=timezone.utc)
                    # Convertir a UTC para comparación uniforme
                    return dt.astimezone(timezone.utc).replace(microsecond=0)
                return date.fromisoformat(v)
            except ValueError:
                pass
        return v
    if isinstance(v, datetime):
        if v.tzinfo is None:
            # PostGIS naive timestamp → asumir hora local Bogotá (UTC-5)
            v = v.replace(tzinfo=_TZ_LOCAL)
        return v.astimezone(timezone.utc).replace(microsecond=0)
    return v


# ── Parser de geometría GPKG ────────────────────────────────────────────────

def parse_gpkg_geom(blob: Optional[bytes]) -> tuple[Optional[bytes], Optional[int]]:
    """
    Parsea un GPKG geometry blob al WKB raw + SRID.

    Spec: https://www.geopackage.org/spec/#gpb_format
        Byte 0-1   : magic "GP"
        Byte 2     : version
        Byte 3     : flags (bit 0 = endianness, bits 1-3 = envelope type)
        Byte 4-7   : srs_id (int32)
        Byte 8...  : envelope (tamaño según envelope type)
        Resto      : WKB estándar (lo que entiende PostGIS via ST_GeomFromWKB)
    """
    if blob is None or len(blob) < 8 or blob[:2] != b"GP":
        return None, None
    flags = blob[3]
    little_endian = bool(flags & 0x01)
    byteorder = "little" if little_endian else "big"
    srid = int.from_bytes(blob[4:8], byteorder=byteorder, signed=True)

    envelope_type = (flags >> 1) & 0x07
    envelope_sizes = {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}
    env_size = envelope_sizes.get(envelope_type, 0)
    wkb_start = 8 + env_size
    return bytes(blob[wkb_start:]), srid


# ── Helpers de schema ───────────────────────────────────────────────────────

def _columnas_gpkg(conn: sqlite3.Connection, tabla: str) -> list[str]:
    cur = conn.execute(f'PRAGMA table_info("{tabla}")')
    return [r[1] for r in cur.fetchall()]


def _columnas_postgis(db: Session, tabla: str) -> list[str]:
    rows = db.execute(text("""
        SELECT column_name FROM information_schema.columns
        WHERE table_name = :t AND table_schema = 'public'
        ORDER BY ordinal_position
    """), {"t": tabla}).fetchall()
    return [r[0] for r in rows]


def _columnas_comunes(
    conn_gpkg: sqlite3.Connection,
    qgis_table: str,
    postgis_table: str,
    db: Session,
    campos_excluidos: set[str],
) -> list[str]:
    """
    Intersección GPKG ∩ PostGIS, sin los campos excluidos por config y
    sin los campos de auditoría globales (timestamps con tz handling
    inconsistente).
    """
    cols_gpkg = set(_columnas_gpkg(conn_gpkg, qgis_table))
    cols_pg = set(_columnas_postgis(db, postgis_table))
    return sorted((cols_gpkg & cols_pg) - campos_excluidos - CAMPOS_AUDIT_GLOBAL)


# ── Comparación (read-only) ─────────────────────────────────────────────────

def comparar_capa(
    db: Session,
    conn_gpkg: sqlite3.Connection,
    qgis_table: str,
    postgis_table: str,
    geom_col_gpkg: Optional[str] = None,
) -> ResumenComparacion:
    """
    Read-only. Para cada row del GPKG con PK no nula, compara contra PostGIS
    por la PK de negocio. Devuelve listas de PKs nuevos / modificados /
    iguales. NO toca PostGIS.
    """
    if postgis_table not in CAPAS_EDITABLES:
        return ResumenComparacion(capa=postgis_table,
                                  errors=[f"capa no editable: {postgis_table}"])

    cfg = CAPAS_EDITABLES[postgis_table]
    pk = cfg["pk_negocio"]

    # PK siempre va en el SELECT pero excluida del SET de comparación
    excl = set(cfg["campos_excluidos"]) | {pk}
    cols_comunes = _columnas_comunes(conn_gpkg, qgis_table, postgis_table, db, excl)
    if not cols_comunes:
        return ResumenComparacion(
            capa=postgis_table,
            errors=[f"no hay columnas comunes entre GPKG y PostGIS para {postgis_table}"],
        )

    # 1. Leer rows del GPKG (incluye fid para identificar rows nuevos sin PK).
    #    Ya NO filtramos por "pk IS NOT NULL": en tablas con PK autogenerada
    #    (globalid con default nextval('etiqueta_seq')), QField crea rows
    #    con globalid NULL y los flagueamos como nuevos.
    cols_select = [pk, "fid"] + cols_comunes + ([geom_col_gpkg] if geom_col_gpkg else [])
    cols_quoted = ", ".join(f'"{c}"' for c in cols_select)
    cur = conn_gpkg.execute(f'SELECT {cols_quoted} FROM "{qgis_table}"')
    rows_gpkg = [dict(zip(cols_select, r)) for r in cur.fetchall()]
    if not rows_gpkg:
        return ResumenComparacion(capa=postgis_table)

    # PKs reales (no NULL) → se buscan en PostGIS para diff vs added
    pks_gpkg = [r[pk] for r in rows_gpkg if r[pk] is not None]

    # 2. Leer mismos PKs en PostGIS
    rows_pg_by_pk: dict = {}
    if pks_gpkg:
        pg_cols = [pk] + cols_comunes
        pg_select = ", ".join(f'"{c}"' for c in pg_cols)
        if geom_col_gpkg and cfg["geom_col_pg"]:
            pg_select += f', ST_AsBinary("{cfg["geom_col_pg"]}") AS __geom_wkb'

        rows_pg_raw = db.execute(text(f"""
            SELECT {pg_select}
            FROM {postgis_table}
            WHERE "{pk}" = ANY(:pks)
        """), {"pks": pks_gpkg}).fetchall()
        rows_pg_by_pk = {r._mapping[pk]: dict(r._mapping) for r in rows_pg_raw}

    # 3. Comparar
    resumen = ResumenComparacion(capa=postgis_table)
    for row in rows_gpkg:
        pk_val = row[pk]

        # Row con PK NULL → es nuevo (QField aún no le asignó globalid).
        # Lo marcamos como added con un id local basado en fid; aplicar_capa
        # lo reconoce y omite la columna pk en el INSERT para que PostGIS
        # aplique el default (nextval('etiqueta_seq')).
        if pk_val is None:
            local_id = f"__nuevo_fid_{row['fid']}"
            resumen.added.append(local_id)
            continue

        if pk_val not in rows_pg_by_pk:
            resumen.added.append(pk_val)
            continue

        pg_row = rows_pg_by_pk[pk_val]
        difiere = False

        for col in cols_comunes:
            if _normalizar(row.get(col)) != _normalizar(pg_row.get(col)):
                difiere = True
                break

        if not difiere and geom_col_gpkg:
            wkb_gpkg, _ = parse_gpkg_geom(row.get(geom_col_gpkg))
            wkb_pg = pg_row.get("__geom_wkb")
            if wkb_pg is not None:
                wkb_pg = bytes(wkb_pg)
            if wkb_gpkg != wkb_pg:
                difiere = True

        if difiere:
            resumen.updated.append(pk_val)
        else:
            resumen.unchanged += 1

    return resumen


# ── Aplicación (write) ──────────────────────────────────────────────────────

def aplicar_capa(
    db: Session,
    conn_gpkg: sqlite3.Connection,
    qgis_table: str,
    postgis_table: str,
    geom_col_gpkg: Optional[str] = None,
) -> ResumenCapa:
    """
    Write. Aplica los cambios detectados por comparar_capa: INSERT para PKs
    nuevos, UPDATE para PKs que difieren. Sin DELETEs.

    Cada operación va dentro de un SAVEPOINT independiente: si una falla,
    se hace rollback solo de esa, las demás siguen.
    """
    res = ResumenCapa(capa=postgis_table)

    if postgis_table not in CAPAS_EDITABLES:
        res.errors = 1
        res.errores_detalle.append(f"capa no soportada: {postgis_table}")
        return res

    if postgis_table not in CAPAS_HABILITADAS_APLICAR:
        res.advertencias.append(
            f"capa no habilitada para apply en esta iter: {postgis_table}"
        )
        return res

    cfg = CAPAS_EDITABLES[postgis_table]
    pk = cfg["pk_negocio"]
    geom_col_pg = cfg["geom_col_pg"]
    geom_srid = cfg["geom_srid"]

    # 1. Comparar para saber qué hay que aplicar
    comp = comparar_capa(db, conn_gpkg, qgis_table, postgis_table, geom_col_gpkg)
    if comp.errors:
        res.errors = len(comp.errors)
        res.errores_detalle.extend(comp.errors)
        return res

    if not comp.added and not comp.updated:
        res.advertencias.append("sin cambios respecto a PostGIS")
        return res

    # 2. Re-leer las filas a aplicar — distinguir rows nuevos sin PK
    #    (cuyo id local es '__nuevo_fid_<fid>') de los que ya tienen PK real.
    excl = set(cfg["campos_excluidos"]) | {pk}
    cols_comunes = _columnas_comunes(conn_gpkg, qgis_table, postgis_table, db, excl)
    cols_a_traer = [pk, "fid"] + cols_comunes + ([geom_col_gpkg] if geom_col_gpkg else [])
    cols_quoted = ", ".join(f'"{c}"' for c in cols_a_traer)

    pks_a_aplicar = list(comp.added) + list(comp.updated)
    rows_by_pk: dict = {}

    # Separar pks reales de los locales (rows nuevos sin globalid asignado)
    pks_reales = [p for p in pks_a_aplicar if not (isinstance(p, str) and p.startswith("__nuevo_fid_"))]
    fids_locales = [int(p.removeprefix("__nuevo_fid_")) for p in pks_a_aplicar
                    if isinstance(p, str) and p.startswith("__nuevo_fid_")]

    if pks_reales:
        placeholders = ",".join("?" for _ in pks_reales)
        cur = conn_gpkg.execute(
            f'SELECT {cols_quoted} FROM "{qgis_table}" WHERE "{pk}" IN ({placeholders})',
            pks_reales,
        )
        for r in cur.fetchall():
            d = dict(zip(cols_a_traer, r))
            rows_by_pk[d[pk]] = d

    if fids_locales:
        placeholders = ",".join("?" for _ in fids_locales)
        cur = conn_gpkg.execute(
            f'SELECT {cols_quoted} FROM "{qgis_table}" WHERE fid IN ({placeholders})',
            fids_locales,
        )
        for r in cur.fetchall():
            d = dict(zip(cols_a_traer, r))
            rows_by_pk[f"__nuevo_fid_{d['fid']}"] = d

    set_cols = [c for c in cols_comunes if c not in cfg["campos_inmutables"]]

    # 3. Aplicar cada PK en su propio SAVEPOINT
    pks_added_set = set(comp.added)

    for pk_val in pks_a_aplicar:
        es_insert = pk_val in pks_added_set
        es_nuevo_sin_pk = isinstance(pk_val, str) and pk_val.startswith("__nuevo_fid_")
        row = rows_by_pk.get(pk_val)
        if row is None:
            res.errors += 1
            res.errores_detalle.append(f"{pk_val}: row desapareció del GPKG")
            continue

        sp = db.begin_nested()
        try:
            params = {c: row.get(c) for c in cols_comunes}
            # Solo agregamos pk a params si NO es un id local sintético.
            # Para rows nuevos sin globalid, PostGIS aplica el default
            # (nextval('etiqueta_seq')) al omitir la columna del INSERT.
            if not es_nuevo_sin_pk:
                params[pk] = pk_val

            geom_expr: Optional[str] = None
            if geom_col_gpkg and row.get(geom_col_gpkg):
                wkb, srid_origen = parse_gpkg_geom(row[geom_col_gpkg])
                if wkb:
                    params["__wkb"] = wkb
                    srid_in = srid_origen or geom_srid
                    # ST_GeomFromWKB → ST_MakeValid → ST_Transform al SRID destino
                    geom_expr = (
                        f"ST_Transform("
                        f"ST_MakeValid(ST_GeomFromWKB(:__wkb, {srid_in}))"
                        f", {geom_srid})"
                    )

            if es_insert:
                if es_nuevo_sin_pk:
                    cols_ins = list(cols_comunes) + ([geom_col_pg] if geom_expr else [])
                    vals_ins = [f":{c}" for c in cols_comunes] + ([geom_expr] if geom_expr else [])
                else:
                    cols_ins = [pk] + cols_comunes + ([geom_col_pg] if geom_expr else [])
                    vals_ins = [f":{pk}"] + [f":{c}" for c in cols_comunes] + ([geom_expr] if geom_expr else [])
                cols_ins_quoted = ", ".join('"' + c + '"' for c in cols_ins)
                vals_ins_joined = ", ".join(vals_ins)
                sql = (
                    f'INSERT INTO {postgis_table} '
                    f'({cols_ins_quoted}) '
                    f'VALUES ({vals_ins_joined})'
                )
                db.execute(text(sql), params)
                res.added += 1
                res.added_pks.append(pk_val)
            else:
                set_clauses = [f'"{c}" = :{c}' for c in set_cols]
                if geom_expr:
                    set_clauses.append(f'"{geom_col_pg}" = {geom_expr}')
                sql = (
                    f'UPDATE {postgis_table} '
                    f'SET {", ".join(set_clauses)} '
                    f'WHERE "{pk}" = :{pk}'
                )
                db.execute(text(sql), params)
                res.updated += 1
                res.updated_pks.append(pk_val)

            sp.commit()
        except Exception as exc:
            sp.rollback()
            res.errors += 1
            res.errores_detalle.append(f"{pk_val}: {exc}")

    return res
