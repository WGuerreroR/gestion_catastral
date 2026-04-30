"""
tests/test_qfield_gpkg_inspector.py

Unit tests para qfield_gpkg_inspector con GPKGs sintéticos creados al vuelo
con sqlite3 (no requiere QgsApplication ni una BD PostGIS real).

Cada test prepara un GPKG mínimo con las tablas relevantes, lo zipea con
una carpeta DCIM/, y verifica que el inspector lo lea correctamente.
"""

import os
import sqlite3
import tempfile
import zipfile

import pytest

from services.qfield_gpkg_inspector import (
    ESTRATEGIA_DIFF,
    ESTRATEGIA_LOG,
    inspeccionar_paquete,
    normalizar_codigo_manzana,
    quitar_uuid,
)


# ── Helpers ──────────────────────────────────────────────────────────────────

def _crear_gpkg_minimo(path: str, con_logs: bool = False) -> None:
    """
    Crea un GPKG mínimo con:
      - tablas de sistema GPKG (gpkg_contents, gpkg_geometry_columns)
      - una tabla editable lc_predio_p_<UUID> (con UUID válido)
      - opcionalmente, las tablas log_* de Offline Editing

    Es lo mínimo para que el inspector lo procese sin errores.
    """
    conn = sqlite3.connect(path)
    cur = conn.cursor()

    # Tablas mínimas del estándar GPKG
    cur.executescript("""
        CREATE TABLE gpkg_contents (
            table_name TEXT PRIMARY KEY,
            data_type TEXT,
            identifier TEXT,
            description TEXT,
            last_change TEXT,
            min_x REAL, min_y REAL, max_x REAL, max_y REAL,
            srs_id INTEGER
        );
        CREATE TABLE gpkg_geometry_columns (
            table_name TEXT PRIMARY KEY,
            column_name TEXT,
            geometry_type_name TEXT,
            srs_id INTEGER,
            z TINYINT, m TINYINT
        );
    """)

    # Capa lc_predio_p con sufijo UUID
    uuid_suffix = "2dc9463c_9a05_44c4_85cc_f2821b5522c9"
    qgis_predio = f"lc_predio_p_{uuid_suffix}"

    cur.execute(f"""
        CREATE TABLE "{qgis_predio}" (
            fid INTEGER PRIMARY KEY,
            geom BLOB,
            id_operacion TEXT,
            nombre_predio TEXT,
            foto TEXT
        )
    """)
    cur.execute(
        "INSERT INTO gpkg_contents (table_name, data_type) VALUES (?, 'features')",
        (qgis_predio,),
    )
    cur.execute(
        "INSERT INTO gpkg_geometry_columns (table_name, column_name, geometry_type_name, srs_id) "
        "VALUES (?, 'geom', 'POINT', 9377)",
        (qgis_predio,),
    )
    cur.execute(
        f'INSERT INTO "{qgis_predio}" (id_operacion, nombre_predio) VALUES (?, ?)',
        ("OP_001", "Casa A"),
    )
    cur.execute(
        f'INSERT INTO "{qgis_predio}" (id_operacion, nombre_predio) VALUES (?, ?)',
        ("OP_002", "Casa B"),
    )

    # Tabla de dominio NO editable, para verificar que el filtro la marque is_editable=False
    qgis_tipo = f"lc_prediotipo_{uuid_suffix}".replace("2dc", "abc")
    cur.execute(f'CREATE TABLE "{qgis_tipo}" (fid INTEGER PRIMARY KEY, code INTEGER, value TEXT)')
    cur.execute(
        "INSERT INTO gpkg_contents (table_name, data_type) VALUES (?, 'attributes')",
        (qgis_tipo,),
    )

    if con_logs:
        cur.executescript("""
            CREATE TABLE log_layer_ids (id INTEGER, qgis_id TEXT);
            CREATE TABLE log_fids (
                layer_id INTEGER, offline_fid INTEGER,
                remote_fid INTEGER, remote_pk TEXT
            );
            CREATE TABLE log_added_features (layer_id INTEGER, fid INTEGER);
            CREATE TABLE log_added_attrs (
                layer_id INTEGER, commit_no INTEGER, name TEXT,
                type INTEGER, length INTEGER, precision INTEGER, comment TEXT
            );
            CREATE TABLE log_feature_updates (
                layer_id INTEGER, commit_no INTEGER, fid INTEGER,
                attr INTEGER, value TEXT
            );
            CREATE TABLE log_geometry_updates (
                layer_id INTEGER, commit_no INTEGER, fid INTEGER, geom_wkt TEXT
            );
            CREATE TABLE log_removed_features (layer_id INTEGER, fid INTEGER);
        """)
        cur.execute("INSERT INTO log_layer_ids VALUES (?, ?)", (0, qgis_predio))
        cur.execute("INSERT INTO log_layer_ids VALUES (?, ?)", (1, qgis_tipo))
        # Mapeo de remote_pk para los 2 features iniciales
        cur.execute("INSERT INTO log_fids VALUES (?, ?, ?, ?)", (0, 1, 1, "OP_001"))
        cur.execute("INSERT INTO log_fids VALUES (?, ?, ?, ?)", (0, 2, 2, "OP_002"))
        # Una edición simulada: 1 added, 1 update_attrs, 1 update_geom, 0 removed
        cur.execute(f'INSERT INTO "{qgis_predio}" (id_operacion, nombre_predio) VALUES (?, ?)',
                    ("OP_003", "Nuevo en campo"))
        cur.execute("INSERT INTO log_added_features VALUES (?, ?)", (0, 3))
        cur.execute("INSERT INTO log_feature_updates VALUES (?, ?, ?, ?, ?)",
                    (0, 1, 1, 3, "Casa A modificada"))  # attr=3 → nombre_predio
        cur.execute("INSERT INTO log_geometry_updates VALUES (?, ?, ?, ?)",
                    (0, 1, 1, "POINT(1 2)"))

    conn.commit()
    conn.close()


def _crear_zip_paquete(zip_path: str, gpkg_path: str, dcim_files: list[str] | None = None) -> None:
    """Empaqueta `gpkg_path` como `data.gpkg` dentro del zip + carpeta DCIM/."""
    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.write(gpkg_path, arcname="data.gpkg")
        # Crear DCIM/ aunque esté vacía
        zf.writestr("DCIM/.keep", b"")
        for foto in dcim_files or []:
            zf.writestr(f"DCIM/{foto}", b"\xff\xd8\xff\xe0fake jpeg")


# ── Tests de helpers puros ───────────────────────────────────────────────────

def test_quitar_uuid_remueve_sufijo_estandar():
    nombre = "lc_predio_p_2dc9463c_9a05_44c4_85cc_f2821b5522c9"
    assert quitar_uuid(nombre) == "lc_predio_p"


def test_quitar_uuid_no_toca_si_no_hay_sufijo():
    assert quitar_uuid("lc_predio_p") == "lc_predio_p"
    assert quitar_uuid("alguna_tabla_normal") == "alguna_tabla_normal"


def test_quitar_uuid_solo_remueve_uuid_v4_canonico():
    # No es UUID válido (largo incorrecto), no se toca
    assert quitar_uuid("lc_predio_p_xxx_yyy_zzz") == "lc_predio_p_xxx_yyy_zzz"


def test_normalizar_codigo_manzana_quita_leading_zeros():
    assert normalizar_codigo_manzana("MZ_019") == "MZ_19"
    assert normalizar_codigo_manzana("MZ_19") == "MZ_19"
    assert normalizar_codigo_manzana("MZ_007") == "MZ_7"


def test_normalizar_codigo_manzana_quita_sufijo_qfield_cloud():
    assert normalizar_codigo_manzana("MZ_019_qfield_cloud") == "MZ_19"
    assert normalizar_codigo_manzana("MZ_019_qfield") == "MZ_19"


def test_normalizar_codigo_manzana_acepta_path_con_zip():
    assert normalizar_codigo_manzana("/tmp/MZ_019.zip") == "MZ_19"


def test_normalizar_codigo_manzana_caso_no_estandar():
    # Si no encaja con el patrón letras_numero, devuelve el base sin extensión
    assert normalizar_codigo_manzana("alguna_cosa") == "alguna_cosa"
    assert normalizar_codigo_manzana("") == ""


# ── Tests de inspección de paquete ───────────────────────────────────────────

def test_inspeccionar_paquete_con_logs_estrategia_A(tmp_path):
    """GPKG con tablas log_* → estrategia 'log_qgis_offline_editing' + preview."""
    gpkg = tmp_path / "data.gpkg"
    _crear_gpkg_minimo(str(gpkg), con_logs=True)

    zip_path = tmp_path / "MZ_19.zip"
    _crear_zip_paquete(str(zip_path), str(gpkg), dcim_files=["foto1.jpg"])

    extract_to = tmp_path / "extract"
    extract_to.mkdir()

    insp = inspeccionar_paquete(str(zip_path), extract_to=str(extract_to))

    assert insp.valido
    assert insp.estrategia == ESTRATEGIA_LOG
    assert len(insp.fotos_en_paquete) == 1

    # capa lc_predio_p detectada como editable
    capas_editables = [c for c in insp.capas.values() if c.is_editable]
    assert len(capas_editables) == 1
    capa = capas_editables[0]
    assert capa.postgis_table == "lc_predio_p"
    assert capa.geom_col == "geom"
    assert capa.feature_count == 3  # 2 originales + 1 added

    # preview refleja la edición simulada
    pv = insp.preview["lc_predio_p"]
    assert pv.added == 1
    assert pv.updated_attrs_features == 1
    assert pv.updated_geom_features == 1
    assert pv.removed == 0


def test_inspeccionar_paquete_sin_logs_estrategia_B(tmp_path):
    """GPKG sin tablas log_* → estrategia 'diff_por_pk' + preview vacío."""
    gpkg = tmp_path / "data.gpkg"
    _crear_gpkg_minimo(str(gpkg), con_logs=False)

    zip_path = tmp_path / "paquete.zip"
    _crear_zip_paquete(str(zip_path), str(gpkg))

    insp = inspeccionar_paquete(str(zip_path), extract_to=str(tmp_path / "ex"))

    assert insp.valido
    assert insp.estrategia == ESTRATEGIA_DIFF
    # Sin logs no hay preview
    assert insp.preview == {}
    # Pero las capas se enumeran vía gpkg_contents
    assert any(c.postgis_table == "lc_predio_p" and c.is_editable for c in insp.capas.values())


def test_inspeccionar_paquete_zip_sin_gpkg(tmp_path):
    """ZIP sin data.gpkg → valido=False con error claro."""
    zip_path = tmp_path / "vacio.zip"
    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.writestr("README.txt", b"hola")
        zf.writestr("DCIM/.keep", b"")

    insp = inspeccionar_paquete(str(zip_path), extract_to=str(tmp_path / "ex"))

    assert not insp.valido
    assert any("data.gpkg" in e for e in insp.errores)


def test_inspeccionar_paquete_sin_dcim_advertencia(tmp_path):
    """ZIP con gpkg pero sin DCIM/ → valido=True + advertencia."""
    gpkg = tmp_path / "data.gpkg"
    _crear_gpkg_minimo(str(gpkg))

    zip_path = tmp_path / "sin_dcim.zip"
    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.write(str(gpkg), arcname="data.gpkg")

    insp = inspeccionar_paquete(str(zip_path), extract_to=str(tmp_path / "ex"))

    assert insp.valido  # con logs vacíos pero gpkg ok, sigue válido
    assert any("DCIM" in a for a in insp.advertencias)


def test_inspeccionar_paquete_logs_vacios_es_estrategia_diff(tmp_path):
    """
    GPKG con tablas log_* presentes pero sin ediciones → estrategia
    'diff_por_pk' (caso típico de paquetes QField, no usa Offline Editing).
    Sin advertencia: es lo esperado.
    """
    gpkg = tmp_path / "data.gpkg"
    _crear_gpkg_minimo(str(gpkg), con_logs=True)

    # Limpiar las tablas de log (dejar solo el schema y log_layer_ids/log_fids)
    conn = sqlite3.connect(str(gpkg))
    conn.execute("DELETE FROM log_added_features")
    conn.execute("DELETE FROM log_feature_updates")
    conn.execute("DELETE FROM log_geometry_updates")
    conn.execute("DELETE FROM log_removed_features")
    conn.commit()
    conn.close()

    zip_path = tmp_path / "MZ_19.zip"
    _crear_zip_paquete(str(zip_path), str(gpkg), dcim_files=["a.jpg"])

    insp = inspeccionar_paquete(str(zip_path), extract_to=str(tmp_path / "ex"))

    assert insp.valido
    assert insp.estrategia == ESTRATEGIA_DIFF
    # No debe haber advertencia "ediciones": es flujo normal en QField
    assert not any("ediciones" in a.lower() for a in insp.advertencias)


def test_inspeccionar_paquete_ignora_macosx(tmp_path):
    """Entradas __MACOSX/ del ZIP no deben confundir al inspector."""
    gpkg = tmp_path / "data.gpkg"
    _crear_gpkg_minimo(str(gpkg))

    zip_path = tmp_path / "con_macosx.zip"
    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.write(str(gpkg), arcname="data.gpkg")
        zf.writestr("DCIM/.keep", b"")
        zf.writestr("__MACOSX/._data.gpkg", b"binarioMac")
        zf.writestr("__MACOSX/DCIM/._foto.jpg", b"binarioMac")

    insp = inspeccionar_paquete(str(zip_path), extract_to=str(tmp_path / "ex"))

    assert insp.valido
    # __MACOSX no debe haberse extraído
    assert not os.path.isdir(os.path.join(str(tmp_path / "ex"), "__MACOSX"))


def test_inspeccionar_paquete_zip_corrupto(tmp_path):
    """Archivo que no es un ZIP válido → valido=False con error claro."""
    zip_path = tmp_path / "corrupto.zip"
    zip_path.write_bytes(b"esto no es un zip")

    insp = inspeccionar_paquete(str(zip_path), extract_to=str(tmp_path / "ex"))

    assert not insp.valido
    assert any("ZIP" in e or "corrupto" in e.lower() for e in insp.errores)
