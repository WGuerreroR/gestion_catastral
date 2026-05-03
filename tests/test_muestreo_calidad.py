"""
Tests del cálculo de muestra usado por el módulo de calidad por asignación
y por /calidad-externa.
"""

import math

import pytest

from utils.calidad import calcular_muestra, calcular_muestra_minima


def _formula_referencia(N, Z=1.96, e=0.05):
    if N <= 0:
        return 0
    if N == 1:
        return 1
    p = q = 0.5
    num = N * (Z ** 2) * p * q
    den = (e ** 2) * (N - 1) + (Z ** 2) * p * q
    return max(1, math.ceil(num / den))


# ─── calcular_muestra_minima (e=5%, Z=1.96) ──────────────────────────────────

@pytest.mark.parametrize("N", [3, 100, 1000, 10000])
def test_minima_distintos_N(N):
    assert calcular_muestra_minima(N) == _formula_referencia(N)


def test_minima_clamps():
    assert calcular_muestra_minima(0)  == 0
    assert calcular_muestra_minima(-5) == 0
    assert calcular_muestra_minima(1)  == 1


# ─── calcular_muestra parametrizable ─────────────────────────────────────────

@pytest.mark.parametrize("e", [0.05, 0.10, 0.15, 0.20, 0.25])
@pytest.mark.parametrize("N", [3, 61, 100, 1000, 10000])
def test_parametrizable_distintos_e(N, e):
    assert calcular_muestra(N, margen_error=e) == _formula_referencia(N, Z=1.96, e=e)


def test_parametrizable_caso_61_predios():
    # El caso real que motivó la feature.
    assert calcular_muestra(61, margen_error=0.05) == 53
    assert calcular_muestra(61, margen_error=0.10) == 38
    assert calcular_muestra(61, margen_error=0.15) == 26
    assert calcular_muestra(61, margen_error=0.20) == 18
    assert calcular_muestra(61, margen_error=0.25) == 13


def test_parametrizable_default_es_e_10():
    assert calcular_muestra(61) == calcular_muestra(61, margen_error=0.10)


def test_parametrizable_clamps():
    assert calcular_muestra(0)  == 0
    assert calcular_muestra(-5) == 0
    assert calcular_muestra(1)  == 1


def test_parametrizable_distintos_IC():
    n90 = calcular_muestra(1000, margen_error=0.10, nivel_confianza=0.90)
    n95 = calcular_muestra(1000, margen_error=0.10, nivel_confianza=0.95)
    n99 = calcular_muestra(1000, margen_error=0.10, nivel_confianza=0.99)
    # Más confianza ⇒ muestra más grande
    assert n90 < n95 < n99


def test_parametrizable_rechaza_e_invalido():
    with pytest.raises(ValueError):
        calcular_muestra(100, margen_error=0.07)
    with pytest.raises(ValueError):
        calcular_muestra(100, margen_error=0)


def test_parametrizable_rechaza_IC_invalido():
    with pytest.raises(ValueError):
        calcular_muestra(100, nivel_confianza=0.97)


def test_muestra_no_excede_universo():
    for N in (2, 5, 10, 50, 200, 5000):
        for e in (0.05, 0.10, 0.15, 0.20, 0.25):
            n = calcular_muestra(N, margen_error=e)
            assert 1 <= n <= N


# ─── Cierre de proyecto: lógica de validación previa ─────────────────────────

class _DBStub:
    """Stub mínimo de Session para probar la guardia de cierre sin BD real."""
    def __init__(self, scripted_rows):
        self._scripted = list(scripted_rows)  # cola de respuestas (objetos con atributos)
        self.statements = []
        self.committed = False

    def execute(self, stmt, params=None):
        self.statements.append((str(stmt), params))
        row = self._scripted.pop(0)

        class _Result:
            def __init__(self, r): self._r = r
            def fetchone(self): return self._r
            @property
            def rowcount(self): return getattr(self._r, "_rowcount", 0)
        return _Result(row)

    def commit(self): self.committed = True


class _Row:
    def __init__(self, **kw):
        for k, v in kw.items():
            setattr(self, k, v)


def test_cerrar_proyecto_aborta_si_faltan_validados():
    from repositories.calidad_muestreo_repo import cerrar_proyecto
    db = _DBStub([
        _Row(estado="activo", total_predios=10),
        _Row(total_muestra=5, validados=3),
    ])
    with pytest.raises(ValueError, match="Faltan validar"):
        cerrar_proyecto(db, pc_id=1, cerrado_por=42)
    assert not db.committed


def test_cerrar_proyecto_aborta_si_ya_cerrado():
    from repositories.calidad_muestreo_repo import cerrar_proyecto
    db = _DBStub([_Row(estado="cerrado", total_predios=10)])
    with pytest.raises(ValueError, match="ya está cerrado"):
        cerrar_proyecto(db, pc_id=1, cerrado_por=42)


def test_cerrar_proyecto_aborta_si_no_hay_muestra():
    from repositories.calidad_muestreo_repo import cerrar_proyecto
    db = _DBStub([
        _Row(estado="activo", total_predios=10),
        _Row(total_muestra=0, validados=0),
    ])
    with pytest.raises(ValueError, match="no tiene predios en muestra"):
        cerrar_proyecto(db, pc_id=1, cerrado_por=42)


def test_cerrar_proyecto_ok_propaga_y_cierra():
    """Con todos validados: corre los UPDATEs (calidad_campo + cerrar) y commitea."""
    from repositories.calidad_muestreo_repo import cerrar_proyecto
    from datetime import datetime
    db = _DBStub([
        _Row(estado="activo", total_predios=10),
        _Row(total_muestra=5, validados=5),
        _Row(_rowcount=10),  # UPDATE lc_predio_p
        _Row(fecha_cierre=datetime(2026, 5, 2, 10, 0)),  # RETURNING fecha_cierre
    ])
    out = cerrar_proyecto(db, pc_id=1, cerrado_por=42)
    assert out["predios_marcados"] == 10
    assert out["fecha_cierre"] == datetime(2026, 5, 2, 10, 0)
    assert db.committed
    # Verificar que se ejecutaron las 4 sentencias esperadas en orden
    sqls = [s for s, _ in db.statements]
    assert any("admin_proyecto_calidad_muestreo"     in s for s in sqls)
    assert any("UPDATE lc_predio_p"                  in s for s in sqls)
    assert any("estado              = 'cerrado'"     in s for s in sqls)
