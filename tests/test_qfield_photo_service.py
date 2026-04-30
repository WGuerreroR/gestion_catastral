"""
tests/test_qfield_photo_service.py

Tests del servicio de fotos. Usa SQLite in-memory + GPKG sintético para
probar todos los caminos sin depender de PostgreSQL ni del contenedor:
- Primera vez: copia limpia
- skip_idem: archivo ya existe con mismo contenido (hash igual) → no duplica
- Colisión real: mismo nombre, contenido distinto → genera _collision_X
- Huérfana: foto en paquete no referenciada en BD → se copia igual
- Faltante: referenciada en BD pero no en paquete → advertencia, no falla
- Sin DCIM/: paquete vacío → advertencia limpia
"""

import os
import sqlite3
from dataclasses import dataclass

import pytest
from sqlalchemy import create_engine, text

from services import qfield_photo_service
from services.qfield_photo_service import (
    DCIM_SUBDIR,
    ResumenFotos,
    _archivos_son_iguales,
    _aplicar_sufijo_colision,
    _solo_basename,
    procesar_dcim,
)


# ── Helpers ──────────────────────────────────────────────────────────────────

@dataclass
class _CapaFake:
    """Mock mínimo del CapaInfo del inspector, suficiente para el photo service."""
    qgis_table: str
    postgis_table: str
    is_editable: bool = True


def _crear_gpkg_con_fotos(path: str, refs: dict[str, dict[str, str]]) -> None:
    """
    Crea un GPKG con la tabla `lc_predio_p_<UUID>` y filas que referencian
    fotos. `refs = {pk: {'foto': nombre, 'foto_2': nombre}}`.
    """
    conn = sqlite3.connect(path)
    cur = conn.cursor()
    qgis_predio = "lc_predio_p_2dc9463c_9a05_44c4_85cc_f2821b5522c9"
    cur.execute(f"""
        CREATE TABLE "{qgis_predio}" (
            fid INTEGER PRIMARY KEY,
            id_operacion TEXT,
            foto TEXT,
            foto_2 TEXT
        )
    """)
    for pk, fotos in refs.items():
        cur.execute(
            f'INSERT INTO "{qgis_predio}" (id_operacion, foto, foto_2) VALUES (?, ?, ?)',
            (pk, fotos.get("foto"), fotos.get("foto_2")),
        )
    conn.commit()
    conn.close()


def _crear_db_sqlite_con_lc_predio(rutas_iniciales: dict[str, dict[str, str]]):
    """
    Crea un engine SQLAlchemy SQLite in-memory con una tabla `lc_predio_p`
    mínima. Esto permite que el photo service haga UPDATEs cuando hay
    colisión. Devuelve `(engine, session)`.
    """
    engine = create_engine("sqlite://", future=True)
    with engine.begin() as c:
        c.execute(text("""
            CREATE TABLE lc_predio_p (
                id_operacion TEXT PRIMARY KEY,
                foto TEXT,
                foto_2 TEXT
            )
        """))
        for pk, rutas in rutas_iniciales.items():
            c.execute(
                text(
                    "INSERT INTO lc_predio_p (id_operacion, foto, foto_2) "
                    "VALUES (:pk, :f, :f2)"
                ),
                {"pk": pk, "f": rutas.get("foto"), "f2": rutas.get("foto_2")},
            )
    # Para tests, una sesión simple con la conexión de SQLAlchemy core
    # es suficiente porque el servicio solo usa db.execute(text(...))
    from sqlalchemy.orm import Session
    return engine, Session(bind=engine)


def _escribir_jpg(ruta: str, contenido: bytes) -> None:
    """Crea un archivo binario en `ruta` con el contenido dado."""
    os.makedirs(os.path.dirname(ruta), exist_ok=True)
    with open(ruta, "wb") as f:
        f.write(contenido)


# ── Tests de helpers puros ───────────────────────────────────────────────────

def test_solo_basename_limpia_path():
    assert _solo_basename("DCIM/IMG_001.jpg") == "IMG_001.jpg"
    assert _solo_basename("/abs/path/foto.jpg") == "foto.jpg"
    assert _solo_basename("foto.jpg") == "foto.jpg"
    assert _solo_basename("") == ""
    assert _solo_basename(None) == ""


def test_aplicar_sufijo_colision_preserva_extension():
    assert _aplicar_sufijo_colision("IMG_001.jpg", 42) == "IMG_001_collision_42.jpg"
    assert _aplicar_sufijo_colision("foto.PNG", 7) == "foto_collision_7.PNG"
    # Sin extensión
    assert _aplicar_sufijo_colision("sin_ext", 3) == "sin_ext_collision_3"


def test_archivos_son_iguales_detecta_contenido(tmp_path):
    a = tmp_path / "a.bin"
    b = tmp_path / "b.bin"
    c = tmp_path / "c.bin"
    a.write_bytes(b"hola")
    b.write_bytes(b"hola")
    c.write_bytes(b"chau")

    assert _archivos_son_iguales(str(a), str(b))
    assert not _archivos_son_iguales(str(a), str(c))


def test_archivos_son_iguales_falso_si_no_existe(tmp_path):
    existente = tmp_path / "x.bin"
    existente.write_bytes(b"x")
    assert not _archivos_son_iguales(str(existente), str(tmp_path / "no_existe"))


# ── Tests de procesar_dcim ───────────────────────────────────────────────────

def _setup_caso_basico(tmp_path, monkeypatch):
    """
    Monta un escenario completo:
    - GPKG con `ch-001` referenciando 2 fotos
    - paquete con esas 2 fotos físicamente
    - destino vacío
    - PROYECTO_BASE_PATH apunta al destino temporal
    """
    pkg_dcim = tmp_path / "pkg" / "DCIM"
    destino_root = tmp_path / "proyecto_base"
    destino_dcim = destino_root / "DCIM"
    pkg_dcim.mkdir(parents=True)
    destino_root.mkdir()

    _escribir_jpg(str(pkg_dcim / "foto1.jpg"), b"contenido_foto1")
    _escribir_jpg(str(pkg_dcim / "foto2.jpg"), b"contenido_foto2")

    gpkg = tmp_path / "data.gpkg"
    _crear_gpkg_con_fotos(str(gpkg), {
        "ch-001": {"foto": "DCIM/foto1.jpg", "foto_2": "DCIM/foto2.jpg"},
    })
    conn = sqlite3.connect(str(gpkg))

    engine, db = _crear_db_sqlite_con_lc_predio({
        "ch-001": {"foto": "DCIM/foto1.jpg", "foto_2": "DCIM/foto2.jpg"},
    })

    # Apuntar PROYECTO_BASE_PATH al destino temporal del test
    monkeypatch.setattr(qfield_photo_service, "PROYECTO_BASE_PATH", str(destino_root))

    capas = {
        42: _CapaFake(
            qgis_table="lc_predio_p_2dc9463c_9a05_44c4_85cc_f2821b5522c9",
            postgis_table="lc_predio_p",
        )
    }
    return {
        "pkg_dcim":     str(pkg_dcim),
        "destino_dcim": destino_dcim,
        "conn":         conn,
        "db":           db,
        "engine":       engine,
        "capas":        capas,
    }


def test_primera_copia_destino_vacio(tmp_path, monkeypatch):
    """Caso normal: destino vacío, todas las fotos referenciadas presentes."""
    s = _setup_caso_basico(tmp_path, monkeypatch)

    res = procesar_dcim(
        carpeta_dcim_paquete=s["pkg_dcim"],
        sync_id=1,
        conn_gpkg=s["conn"],
        capas_info=s["capas"],
        db=s["db"],
    )

    assert res.encontradas_en_paquete == 2
    assert res.referenciadas_en_bd == 2
    assert res.copiadas_nuevas == 2
    assert res.skip_idem == 0
    assert res.colisiones_nombre == 0
    assert res.huerfanas_copiadas == 0
    assert res.faltantes_referenciadas == 0
    assert res.fallidas == 0
    # Archivos físicamente en el destino
    assert (s["destino_dcim"] / "foto1.jpg").exists()
    assert (s["destino_dcim"] / "foto2.jpg").exists()


def test_skip_idem_archivo_ya_existe_con_mismo_contenido(tmp_path, monkeypatch):
    """Re-sync forzado: las fotos ya están en destino con contenido idéntico."""
    s = _setup_caso_basico(tmp_path, monkeypatch)
    # Pre-poblar destino con las MISMAS fotos
    _escribir_jpg(str(s["destino_dcim"] / "foto1.jpg"), b"contenido_foto1")
    _escribir_jpg(str(s["destino_dcim"] / "foto2.jpg"), b"contenido_foto2")

    res = procesar_dcim(
        carpeta_dcim_paquete=s["pkg_dcim"],
        sync_id=2,
        conn_gpkg=s["conn"],
        capas_info=s["capas"],
        db=s["db"],
    )

    assert res.copiadas_nuevas == 0
    assert res.skip_idem == 2
    assert res.colisiones_nombre == 0
    # No se generan archivos _collision_2
    assert not (s["destino_dcim"] / "foto1_collision_2.jpg").exists()


def test_colision_real_contenido_distinto(tmp_path, monkeypatch):
    """Mismo nombre, contenido distinto → _collision_X + reescribe BD."""
    s = _setup_caso_basico(tmp_path, monkeypatch)
    # Pre-poblar destino con foto1.jpg de DISTINTO contenido
    _escribir_jpg(str(s["destino_dcim"] / "foto1.jpg"), b"contenido_VIEJO_distinto")
    # foto2 idéntica
    _escribir_jpg(str(s["destino_dcim"] / "foto2.jpg"), b"contenido_foto2")

    res = procesar_dcim(
        carpeta_dcim_paquete=s["pkg_dcim"],
        sync_id=7,
        conn_gpkg=s["conn"],
        capas_info=s["capas"],
        db=s["db"],
    )

    assert res.colisiones_nombre == 1
    assert res.skip_idem == 1
    assert res.copiadas_nuevas == 0
    # El archivo _collision_7 existe
    assert (s["destino_dcim"] / "foto1_collision_7.jpg").exists()
    # El original sigue intacto (con su contenido viejo)
    with open(s["destino_dcim"] / "foto1.jpg", "rb") as f:
        assert f.read() == b"contenido_VIEJO_distinto"

    # En BD, el campo `foto` debe haberse reescrito al collision; `foto_2` no
    with s["engine"].connect() as c:
        r = c.execute(text(
            "SELECT foto, foto_2 FROM lc_predio_p WHERE id_operacion = 'ch-001'"
        )).fetchone()
        assert r[0] == f"{DCIM_SUBDIR}/foto1_collision_7.jpg"
        assert r[1] == "DCIM/foto2.jpg"


def test_foto_huerfana_copiada(tmp_path, monkeypatch):
    """Foto presente en el paquete pero no referenciada en BD → se copia."""
    s = _setup_caso_basico(tmp_path, monkeypatch)
    # Foto extra "a mano" en el paquete que no está en ningún row del GPKG
    _escribir_jpg(str(s["destino_dcim"].parent / ".." / "pkg" / "DCIM" / "huerfana.jpg"),
                  b"foto_huerfana_data")
    # Path normalizado
    _escribir_jpg(str(s["pkg_dcim"]) + "/huerfana.jpg", b"foto_huerfana_data")

    res = procesar_dcim(
        carpeta_dcim_paquete=s["pkg_dcim"],
        sync_id=3,
        conn_gpkg=s["conn"],
        capas_info=s["capas"],
        db=s["db"],
    )

    assert res.huerfanas_copiadas == 1
    assert (s["destino_dcim"] / "huerfana.jpg").exists()


def test_foto_faltante_referenciada(tmp_path, monkeypatch):
    """Referenciada en BD pero no presente en el paquete → advertencia, no aborta."""
    s = _setup_caso_basico(tmp_path, monkeypatch)
    # Borrar foto2 del paquete para simular faltante
    os.remove(os.path.join(s["pkg_dcim"], "foto2.jpg"))

    res = procesar_dcim(
        carpeta_dcim_paquete=s["pkg_dcim"],
        sync_id=4,
        conn_gpkg=s["conn"],
        capas_info=s["capas"],
        db=s["db"],
    )

    assert res.faltantes_referenciadas == 1
    assert res.copiadas_nuevas == 1  # solo foto1
    assert res.fallidas == 0
    assert any("foto2.jpg" in a for a in res.advertencias)


def test_sin_dcim_no_falla(tmp_path, monkeypatch):
    """Si el paquete no trae DCIM/, devuelve advertencia y resumen vacío."""
    s = _setup_caso_basico(tmp_path, monkeypatch)

    res = procesar_dcim(
        carpeta_dcim_paquete=None,
        sync_id=5,
        conn_gpkg=s["conn"],
        capas_info=s["capas"],
        db=s["db"],
    )

    assert res.encontradas_en_paquete == 0
    assert res.copiadas_nuevas == 0
    assert any("DCIM" in a for a in res.advertencias)


def test_capa_no_editable_se_ignora(tmp_path, monkeypatch):
    """Una capa con is_editable=False no debe intentar leer sus fotos."""
    s = _setup_caso_basico(tmp_path, monkeypatch)
    s["capas"][42].is_editable = False

    res = procesar_dcim(
        carpeta_dcim_paquete=s["pkg_dcim"],
        sync_id=6,
        conn_gpkg=s["conn"],
        capas_info=s["capas"],
        db=s["db"],
    )

    # Sin capas editables, nadie referencia las fotos → todas son huérfanas
    assert res.referenciadas_en_bd == 0
    assert res.huerfanas_copiadas == 2
    assert res.copiadas_nuevas == 0
