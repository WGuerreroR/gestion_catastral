import math


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