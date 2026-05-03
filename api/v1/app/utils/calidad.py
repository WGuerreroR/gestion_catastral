import math


_Z_POR_CONFIANZA = {0.90: 1.645, 0.95: 1.96, 0.99: 2.58}
_MARGENES_VALIDOS = {0.05, 0.10, 0.15, 0.20, 0.25}


def calcular_muestra_minima(n_total: int) -> int:
    """
    Fórmula estadística para muestra mínima representativa.
    Nivel de confianza: 95% (Z=1.96)
    Proporción esperada: p=q=0.5 (máxima variabilidad)
    Margen de error: e=5%
    """
    if n_total <= 0:
        return 0
    if n_total == 1:
        return 1

    Z, p, q, e = 1.96, 0.5, 0.5, 0.05
    numerador   = n_total * (Z ** 2) * p * q
    denominador = (e ** 2) * (n_total - 1) + (Z ** 2) * p * q
    n = numerador / denominador

    return max(1, math.ceil(n))


def calcular_muestra(
    n_total: int,
    margen_error: float = 0.10,
    nivel_confianza: float = 0.95,
) -> int:
    """
    Versión parametrizable. Misma fórmula que calcular_muestra_minima pero
    expone margen_error (5/10/15%) y nivel_confianza (90/95/99%) como
    argumentos. Defaults: e=10%, IC=95%.
    """
    if n_total <= 0:
        return 0
    if n_total == 1:
        return 1

    e = round(float(margen_error), 2)
    if e not in _MARGENES_VALIDOS:
        raise ValueError(
            f"margen_error inválido: {margen_error}. Válidos: {sorted(_MARGENES_VALIDOS)}"
        )
    Z = _Z_POR_CONFIANZA.get(round(float(nivel_confianza), 2))
    if Z is None:
        raise ValueError(
            f"nivel_confianza inválido: {nivel_confianza}. "
            f"Válidos: {sorted(_Z_POR_CONFIANZA.keys())}"
        )

    p = q = 0.5
    numerador   = n_total * (Z ** 2) * p * q
    denominador = (e ** 2) * (n_total - 1) + (Z ** 2) * p * q
    return max(1, math.ceil(numerador / denominador))
